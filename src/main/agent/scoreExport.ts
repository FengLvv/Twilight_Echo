import { BrowserWindow, ipcMain } from 'electron'
import { join, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import type { AgentScoreExportData, AgentScoreExportReply } from '../../shared/agentScoreExport.ts'

/** Export the actual shared score components; never screen-scrape the player. */
export function createNativeScoreExporter() {
  const jobs = new Map<number, { data: AgentScoreExportData; complete(reply: AgentScoreExportReply): void; fail(error: Error): void; window: BrowserWindow }>()
  ipcMain.handle('agent-score:bootstrap', event => {
    const job = jobs.get(event.sender.id)
    if (!job) throw new Error('Unknown native score export window')
    return job.data
  })
  ipcMain.handle('agent-score:complete', (event, reply: AgentScoreExportReply) => {
    const job = jobs.get(event.sender.id)
    if (!job) throw new Error('Unknown native score export window')
    if (reply.error) return job.fail(new Error(reply.error))
    if (!Array.isArray(reply.rows) || reply.rows.length !== job.data.rows.length ||
        reply.rows.some((row, index) => row.lineId !== job.data.rows[index].lineId || row.text !== job.data.rows[index].text || typeof row.svg !== 'string' || !row.svg.startsWith('<svg') || row.svg.length > 2 * 1024 * 1024))
      return job.fail(new Error('Invalid native score export result'))
    job.complete(reply)
  })
  return {
    async export(data: AgentScoreExportData, destination: string) {
      if (!data.rows.length) throw new Error('No recognized score rows; complete melody analysis first')
      const root = resolve(destination)
      await mkdir(root, { recursive: true })
      const output = join(root, `TwilightEcho-score-${data.id.slice(0,8)}-${randomBytes(5).toString('hex')}`)
      await mkdir(output)
      const window = new BrowserWindow({ show: false, width: 1100, height: 900,
        webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false } })
      const senderId = window.webContents.id
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const ready = new Promise<AgentScoreExportReply>((complete, fail) => {
          jobs.set(window.webContents.id, { data, complete, fail, window })
          timer = setTimeout(() => fail(new Error('Native score export timed out')), 120000)
          window.webContents.once('render-process-gone', () => fail(new Error('Native score export renderer stopped')))
          window.once('closed', () => fail(new Error('Native score export window closed')))
        })
        const load = process.env.ELECTRON_RENDERER_URL
          ? window.loadURL(process.env.ELECTRON_RENDERER_URL + '?window=score-export')
          : window.loadFile(join(__dirname, '../renderer/index.html'), { query: { window: 'score-export' } })
        // Observe both promises immediately so renderer/load failures cannot become unhandled.
        const [, rendered] = await Promise.all([load, ready])
        clearTimeout(timer)
        const files: Array<{ lineId: number; text: string; path: string }> = []
        for (const [index, row] of rendered.rows.entries()) {
          const target = join(output, `${String(index + 1).padStart(4,'0')}.svg`)
          await writeFile(target, row.svg, { flag: 'wx' })
          files.push({ lineId: row.lineId, text: row.text, path: target })
        }
        const pdf = join(output, 'score.pdf')
        await writeFile(pdf, await window.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: .35, bottom: .35, left: .35, right: .35 } }), { flag: 'wx' })
        const manifest = join(output, 'score.json')
        await writeFile(manifest, JSON.stringify({ version: 1, id: data.id, title: data.title, notation: data.notation, key: data.key,
          rows: files, pdf, notes: data.rows.flatMap(row => row.notes) }, null, 2), { flag: 'wx' })
        return { directory: output, manifest, pdf, rows: files, notation: data.notation, key: data.key }
      } finally {
        clearTimeout(timer)
        jobs.delete(senderId)
        if (!window.isDestroyed()) window.destroy()
      }
    },
    async stop() {
      for (const job of jobs.values()) {
        job.fail(new Error('Application is stopping'))
        if (!job.window.isDestroyed()) job.window.destroy()
      }
      jobs.clear()
      ipcMain.removeHandler('agent-score:bootstrap')
      ipcMain.removeHandler('agent-score:complete')
    }
  }
}
