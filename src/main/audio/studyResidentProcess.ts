import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

type Pending = { resolve(value: any): void; reject(error: Error): void; event(value: any): void; dispose(): void }

/** A transport only. Core schedules jobs; the process retains its model objects. */
export class StudyResidentProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, Pending>()
  private closing: Promise<void> | null = null
  private generation = 0
  private errors = ''
  private readonly python: () => string
  private readonly script: string
  private readonly diagnostic: (message: string) => void
  constructor(python: () => string, script: string, diagnostic: (message: string) => void = () => {}) {
    this.python = python; this.script = script; this.diagnostic = diagnostic
  }
  get pid() { return this.child?.pid ?? null }
  private start() {
    if (this.child) return this.child
    if (this.closing) throw new Error('分析运行时正在关闭')
    const generation = ++this.generation
    const child = spawn(this.python(), ['-u', this.script], {
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', HF_HUB_OFFLINE: '1',
        TRANSFORMERS_OFFLINE: '1', OMP_NUM_THREADS: '4', TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD: '1' }
    })
    this.child = child
    this.errors = ''
    let buffered = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (block: string) => {
      if (generation !== this.generation) return
      buffered += block
      if (buffered.length > 32 * 1024 ** 2) {
        this.fail(new Error('分析运行时输出超出限制'))
        void this.close()
        return
      }
      let end: number
      while ((end = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, end); buffered = buffered.slice(end + 1)
        let value: any
        try { value = JSON.parse(line) } catch { continue }
        const request = this.pending.get(value.id)
        if (!request) continue
        if (value.event) {
          try { request.event(value.event) } catch (error) {
            child.stdin.write(JSON.stringify({ method: 'cancel', target: value.id }) + '\n')
            this.pending.delete(value.id); request.dispose(); request.reject(error instanceof Error ? error : new Error(String(error)))
          }
        } else {
          this.pending.delete(value.id); request.dispose()
          if (value.error) request.reject(Object.assign(new Error(value.error), { code: value.cancelled ? 'CANCELLED' : 'ANALYSIS_FAILED' }))
          else request.resolve(value.result)
        }
      }
    })
    child.stderr.on('data', block => {
      const message = block.toString('utf8')
      this.errors = (this.errors + message).slice(-6000)
      this.diagnostic(message)
    })
    child.on('error', error => { if (generation === this.generation) this.fail(error) })
    child.on('close', () => {
      if (generation !== this.generation) return
      this.child = null
      this.fail(new Error(this.errors || '分析运行时已退出'))
    })
    child.stdin.on('error', error => { if (generation === this.generation) this.fail(error) })
    return child
  }
  private fail(error: Error) {
    const requests = [...this.pending.values()]; this.pending.clear()
    for (const request of requests) { request.dispose(); request.reject(error) }
  }
  call(method: string, params: object, signal?: AbortSignal, event: (value: any) => void = () => {}): Promise<any> {
    signal?.throwIfAborted()
    const child = this.start(), id = randomUUID()
    const serialized = JSON.stringify({ id, method, params }) + '\n'
    if (serialized.length > 32 * 1024 ** 2) throw new Error('分析请求超出限制')
    return new Promise((resolve, reject) => {
      const abort = () => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ method: 'cancel', target: id }) + '\n') }
      this.pending.set(id, { resolve, reject, event, dispose: () => signal?.removeEventListener('abort', abort) })
      signal?.addEventListener('abort', abort, { once: true })
      child.stdin.write(serialized, error => {
        if (error) { const request = this.pending.get(id); this.pending.delete(id); request?.dispose(); reject(error) }
      })
      if (signal?.aborted) abort()
    })
  }
  async close() {
    if (this.closing) return this.closing
    const child = this.child
    if (!child) return
    this.closing = new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        if (process.platform === 'win32' && child.pid)
          execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill())
        else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill() } }
      }, 10000)
      child.once('close', () => { clearTimeout(timer); resolve() })
      child.stdin.end()
    }).finally(() => { this.closing = null })
    return this.closing
  }
}
