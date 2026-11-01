import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parseFile } from 'music-metadata'

const playwright = process.env.PLAYWRIGHT_MODULE || 'D:/Tools/TwilightEchoToolchain/study/automation/node_modules/playwright-core/index.mjs'
const { _electron } = await import(pathToFileURL(playwright).href)
const cli = process.env.TWILIGHT_AGENT_CLI || 'D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe'
const executable = resolve(process.env.TWILIGHT_PRELOAD_VERIFY_EXE || 'dist/study-preload/win-unpacked/TwilightEcho.exe')
const profile = resolve('.local/study-preload-app-' + Date.now())
const output = resolve('output/playwright/study-preload-' + Date.now())
await mkdir(profile, { recursive: true }); await mkdir(output, { recursive: true })
await writeFile(join(profile, 'settings.json'), JSON.stringify({ onboardingCompleted: true, autoCheckLogin: false, motionPreference: 'off', volume: 0 }))
const env = { ...process.env, TWILIGHT_MUSIC_STUDY_HOME: process.env.TWILIGHT_MUSIC_STUDY_HOME || 'D:/Tools/TwilightEchoToolchain/study' }
delete env.ELECTRON_RUN_AS_NODE
const run = promisify(execFile), evidence = { profile, output, checks: {} }, errors = []
async function call(name, payload = {}) {
  const result = await run(cli, ['--json', '--profile', profile, '--timeout', '120', 'call', name, '--payload', JSON.stringify(payload)],
    { windowsHide: true, timeout: 130000, maxBuffer: 32 * 1024 ** 2 })
  const value = JSON.parse(result.stdout)
  assert.equal(value.ok, true, value.error?.message)
  return value.value
}
async function until(action, accept, timeout = 180000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await action()
    if (accept(value)) return value
    await new Promise(done => setTimeout(done, 400))
  }
  throw new Error('Verification timed out')
}
let app
try {
  app = await _electron.launch({ executablePath: executable, args: [...(process.env.TWILIGHT_PRELOAD_VERIFY_ENTRY ? [resolve(process.env.TWILIGHT_PRELOAD_VERIFY_ENTRY)] : []), '--agent-profile', profile, '--mute-audio'], env, timeout: 60000 })
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForFunction(() => !!window.api?.core, { timeout: 60000 })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('[data-settings-category="playback"]').click()
  const group = page.locator('#playback-song-analysis')
  await group.locator('.settings-group-trigger').click()
  const toggle = group.getByRole('switch', { name: '预分析下一首' })
  await toggle.waitFor()
  await until(() => toggle.isEnabled(), Boolean)
  assert.equal((await call('study.cache')).limitBytes, 2 * 1024 ** 3)
  await toggle.click()
  await until(() => call('study.cache'), cache => cache.preloadNext === false)
  await group.locator('select').selectOption('4')
  await until(() => call('study.cache'), cache => cache.limitBytes === 4 * 1024 ** 3)
  await toggle.click()
  await group.locator('select').selectOption('2')
  evidence.checks.settingsRoundTrip = true
  for (const [name, width] of [['wide', 1440], ['narrow', 880]]) {
    await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(640, 600); win.setSize(width, 960) }, width)
    await group.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, 'settings-' + name + '.png') })
    const bounds = await group.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, viewport: innerWidth, overflow: element.scrollWidth > element.clientWidth + 1 }
    })
    assert(bounds.left >= 0 && bounds.right <= bounds.viewport && !bounds.overflow, JSON.stringify(bounds))
  }
  evidence.runtime = await until(() => call('study.runtime'), runtime => runtime.state === 'ready')
  const inputs = []
  for (const file of ['.local/song-analysis-media/MyFriend.wav', '.local/vocal-rhythm-media/Qinghuaci.wav']) {
    const { path } = await call('agent.files.authorize', { path: resolve(file), kind: 'audio' })
    const metadata = await parseFile(path)
    inputs.push({ kind: 'local', id: 'agent-file:' + createHash('sha256').update(path.toLowerCase()).digest('hex'),
      fallback: { filePath: path, title: basename(file, '.wav'), artist: '', album: '', duration: metadata.format.duration } })
  }
  const begin = await call('queue.submit', { kind: 'begin', selectedIndex: 0, play: false })
  await call('queue.submit', { kind: 'append', id: begin.id, sequence: 1, items: inputs })
  await call('queue.submit', { kind: 'commit', id: begin.id, sequence: 2 })
  const started = performance.now()
  const current = await call('study.analyze', { songId: inputs[0].id })
  const state = await until(() => call('study.state'), state => state.total === 2 && state.projects.every(p => p.status === 'completed'))
  evidence.queueWallMs = Math.round(performance.now() - started)
  assert.equal(state.total, 2)
  const projects = await Promise.all(state.projects.map(p => call('study.project', { id: p.id })))
  for (const project of projects) {
    assert(project.sixReady && project.chordsReady)
    assert(!project.leadBacking && !project.twoSingers)
  }
  evidence.projects = projects.map(p => ({ id: p.id, title: p.title, duration: p.result.duration, timings: p.result.timings }))
  evidence.checks.realQueueNextOnly = true
  const standby = await until(() => call('study.runtime'), runtime => runtime.devices?.chords === 'cpu', 45000)
  assert.equal(standby.devices.six, 'cuda')
  evidence.standby = standby
  const repeat = performance.now()
  assert.equal((await call('study.analyze', { songId: inputs[0].id })).id, current.id)
  evidence.cachedRequestMs = Math.round(performance.now() - repeat)
  assert.equal((await call('study.runtime')).pid, evidence.runtime.pid)
  assert.equal((await call('study.runtime')).devices.chords, 'cpu', 'cached annotations must not move weights')
  const reference = projects.find(project => project.id === current.id).result.chords.segments
  await call('study.analyzeChords', { id: current.id, stems: ['bass', 'piano', 'guitar', 'other'] })
  const restored = await until(() => call('study.project', { id: current.id }), project => project.status === 'completed' && project.chordsReady)
  assert.deepEqual(restored.result.chords.segments.map(({ start, end, label }) => ({ start, end, label })),
    reference.map(({ start, end, label }) => ({ start, end, label })))
  evidence.restored = await call('study.runtime')
  assert.equal(evidence.restored.devices.chords, 'cuda')
  evidence.checks.residencyRoundTrip = true
  await group.getByRole('button', { name: '清理音频缓存', exact: true }).click()
  await until(() => call('study.project', { id: current.id }), p => !p.sixReady)
  assert((await call('study.project', { id: current.id })).chordsReady)
  assert((await call('study.cache')).protectedBytes > 0)
  await call('study.setCachePolicy', { preloadNext: false })
  const cleared = await call('study.clearAudioCache')
  assert.equal(cleared.usedBytes, 0)
  assert(cleared.resultBytes > 0)
  const cached = await call('agent.music.context', { id: current.id })
  assert(cached.result.chords.segments.length > 0 && !cached.sixReady)
  evidence.checks.clearRetainsAnnotations = true
  evidence.cache = cleared
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'verification.json'), JSON.stringify(evidence, null, 2))
  process.stdout.write(JSON.stringify({ ok: true, evidence: join(output, 'verification.json'), checks: evidence.checks }) + '\n')
} finally {
  if (app) await app.close()
}
