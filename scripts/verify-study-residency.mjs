import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { brotliDecompressSync } from 'node:zlib'
import { StudyResidentProcess } from '../src/main/audio/studyResidentProcess.ts'
import { StudyRuntimeResidency } from '../src/main/audio/studyRuntimeResidency.ts'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []))
assert(args.home && args.audio, '--home and --audio are required')
const root = resolve('.local/study-residency-evidence', String(Date.now()))
await mkdir(root, { recursive: true })
const run = promisify(execFile)
const gpu = async () => Number((await run('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'])).stdout.trim())
const rpc = new StudyResidentProcess(() => join(args.home, 'runtime/Scripts/python.exe'), resolve('resources/music-study/worker.py'))
const evidence = { startedAt: new Date().toISOString(), checks: {}, transitions: [] }
let state = {}
const residency = new StudyRuntimeResidency({
  call: (...params) => rpc.call(...params), alive: () => rpc.pid !== null,
  changed: value => { state = value; evidence.transitions.push({ at: Date.now(), ...value }) },
  failed: error => { throw error },
  schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer) }
})
const fingerprints = { ...JSON.parse(await readFile('resources/music-study/models.json', 'utf8')).files,
  ...JSON.parse(await readFile('resources/music-study/vocal_models.json', 'utf8')).files }
const params = { directory: join(root, 'audio'), source: resolve(args.audio), operation: 'analyze',
  pack: join(args.home, 'models'), modelFingerprints: fingerprints, budgetBytes: 2 * 1024 ** 3 }
const labels = result => result.chords.segments.map(({ start, end, label }) => ({ start, end, label }))
const withoutChords = result => {
  const previous = structuredClone(result)
  delete previous.cache.signatures.chords
  previous.ready = previous.ready.filter(stage => stage !== 'chords')
  return previous
}
const save = () => writeFile(join(root, 'verification.json'), JSON.stringify(evidence, null, 2))
try {
  evidence.gpuBaselineMiB = await gpu()
  residency.setDemand(true)
  evidence.warm = await residency.run('warm', { pack: params.pack })
  assert.equal(state.devices.chords, 'cuda')
  assert(state.cudaReservedBytes < 3.2 * 1024 ** 3)
  const first = await residency.run('analyze', params)
  evidence.before = { timings: first.timings, residency: state }
  if (args['baseline-db'] && args['baseline-id']) {
    const db = new DatabaseSync(args['baseline-db'], { readOnly: true })
    const row = db.prepare('SELECT data FROM analysis_artifacts WHERE project_id=? AND kind=?').get(args['baseline-id'], 'chords')
    assert(row)
    const old = JSON.parse(brotliDecompressSync(row.data).toString('utf8'))
    db.close()
    assert.deepEqual(labels(first), old.segments.map(({ start, end, label }) => ({ start, end, label })))
    evidence.checks.matchesPreviousBuild = true
  }
  await save()
  residency.setDemand(false)
  const idleStarted = performance.now()
  while (state.devices.chords !== 'cpu' && performance.now() - idleStarted < 45000) await new Promise(done => setTimeout(done, 200))
  assert.equal(state.devices.chords, 'cpu')
  assert.equal(state.devices.six, 'cuda')
  evidence.idle = { wallMs: Math.round(performance.now() - idleStarted), residency: state, gpuMiB: await gpu() }
  assert(state.cudaAllocatedBytes < 256 * 1024 ** 2)
  const stats = await residency.run('stats', {})
  assert.equal(stats.chords.misses, 1)
  assert.equal(stats.six.misses, 1)
  evidence.checks.idleOffload = true
  residency.setDemand(true)
  const restored = await residency.run('analyze', { ...params, previous: withoutChords(first) })
  assert.deepEqual(labels(restored), labels(first))
  assert.equal(state.devices.chords, 'cuda')
  evidence.restored = { timings: restored.timings, residency: state, gpuMiB: await gpu() }
  evidence.checks.identicalAfterRestore = true
  await save()
  await residency.run('standby', {})
  const cancellation = new AbortController()
  await assert.rejects(residency.run('analyze', { ...params, previous: withoutChords(first) }, cancellation.signal, event => {
    if (event.kind === 'progress' && event.stage.startsWith('高精度和弦分析')) cancellation.abort()
  }), /取消/)
  await residency.run('residency', {})
  const afterCancel = await residency.run('analyze', { ...params, previous: withoutChords(first) })
  assert.deepEqual(labels(afterCancel), labels(first))
  const finalStats = await residency.run('stats', {})
  assert.equal(finalStats.pid, stats.pid)
  assert.equal(finalStats.chords.misses, 1)
  assert.equal(finalStats.six.misses, 1)
  evidence.checks.cancelAndContinue = true
  evidence.checks.noWeightReload = finalStats
  evidence.completedAt = new Date().toISOString()
  await save()
  process.stdout.write(JSON.stringify({ ok: true, evidence: join(root, 'verification.json'), checks: evidence.checks,
    idle: evidence.idle, restored: evidence.restored.residency }) + '\n')
} finally { residency.suspend(); await rpc.close() }
