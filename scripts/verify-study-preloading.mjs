import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, rm, writeFile, stat, appendFile } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { StudyResidentProcess } from '../src/main/audio/studyResidentProcess.ts'
import { createStudyRepository } from '../src/main/audio/studyRepository.ts'
import { createStudyCacheValidator } from '../src/main/audio/studyCache.ts'
import { studyLyricsFromText } from '../src/core/audio/studyLyrics.ts'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[i + 1]]] : pairs, []))
for (const key of ['home', 'audio', 'next', 'lyrics']) assert(args[key], `--${key} is required`)
const root = resolve(args.output ?? join('.local/study-preload-evidence', String(Date.now())))
const local = relative(resolve('.local'), root)
assert(local && !isAbsolute(local) && !local.startsWith('..'), 'Evidence must stay within workspace .local')
await mkdir(root, { recursive: true })
const pack = join(args.home, 'models')
const fingerprints = { ...JSON.parse(await readFile('resources/music-study/models.json', 'utf8')).files,
  ...JSON.parse(await readFile('resources/music-study/vocal_models.json', 'utf8')).files }
const lyrics = studyLyricsFromText(await readFile(args.lyrics, 'utf8'), 28)
const python = join(args.home, 'runtime/Scripts/python.exe')
process.env.STUDY_DIAGNOSTIC_STACKS = '1'
const rpc = new StudyResidentProcess(() => python, resolve('resources/music-study/worker.py'), message => {
  void appendFile(join(root, 'runtime.log'), message)
})
const repository = createStudyRepository(root)
const records = new Map()
for (const record of await repository.list()) records.set(record.id, { ...record, result: await repository.loadResult(record.id), resultLoaded: true })
const evidence = { startedAt: new Date().toISOString(), phases: [], checks: {} }
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const save = async () => writeFile(join(root, 'summary.json'), JSON.stringify(evidence, null, 2))

async function analyze(id, source, operation = 'analyze') {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  const record = records.get(id) ?? { id, title: id, source: { identity: id, path: source }, status: 'running', stage: 'analysis', progress: 0, createdAt: Date.now(), revision: 0, leadBacking: false, twoSingers: false, lyrics }
  let writes = Promise.resolve()
  const started = performance.now()
  const result = await rpc.call('analyze', { directory: dir, source, operation, pack, modelFingerprints: fingerprints,
    previous: record.result, lyrics, budgetBytes: 2 * 1024 ** 3 }, undefined, event => {
    void appendFile(join(root, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), id, operation, kind: event.kind, stage: event.stage, phase: event.phase }) + '\n')
    if (event.kind === 'stageReady') {
      record.result = event.result
      record.resultLoaded = true
      writes = writes.then(() => repository.save(record))
    }
  })
  await writes
  record.result = result
  records.set(id, record)
  await repository.save(record)
  evidence.phases.push({ id, operation, wallMs: Math.round(performance.now() - started), timings: result.timings })
  await save()
  return result
}

try {
  await save()
  const started = performance.now()
  const timeout = setTimeout(() => { void rpc.close() }, 180000)
  let warm
  try { warm = await rpc.call('warm', { pack }) } finally { clearTimeout(timeout) }
  evidence.warm = { ...warm, wallMs: Math.round(performance.now() - started) }
  await save()
  await analyze('first', resolve(args.audio))
  await analyze('next', resolve(args.next))
  let stats = await rpc.call('stats', {})
  assert.equal(stats.six.misses, 1)
  assert.equal(stats.chords.misses, 1)
  assert.equal(stats.pid, warm.pid)
  evidence.checks.modelReuseAcrossSongs = stats
  await analyze('first', resolve(args.audio), 'melody')
  const original = structuredClone(records.get('first').result)
  assert(original.melody.scores.length)
  const notesBefore = sha(original.melody)
  for (const name of await readdir(join(root, 'first'))) if (name.endsWith('.wav') || name.endsWith('.temix')) await rm(join(root, 'first', name))
  const retained = await repository.loadResult('first')
  retained.ready = (await createStudyCacheValidator()(join(root, 'first'), fingerprints, undefined, retained)).ready
  records.get('first').result = retained
  assert(retained.ready.includes('chords') && retained.ready.includes('melody') && !retained.ready.includes('six'))
  await analyze('first', '', 'melody')
  assert.equal(sha(records.get('first').result.melody), notesBefore)
  assert(!(await readdir(join(root, 'first'))).some(name => name.endsWith('.wav')))
  evidence.checks.annotationsWithoutAudio = true
  delete records.get('first').result.cache.signatures.score
  await analyze('first', '', 'melody')
  assert.equal(records.get('first').result.timings.melody.parts.recognitionMs, undefined)
  assert.equal(sha(records.get('first').result.melody), notesBefore)
  evidence.checks.layoutOnly = true
  const chordBefore = sha(records.get('first').result.chords)
  await analyze('first', resolve(args.audio))
  assert.equal(records.get('first').result.timings.six.cacheHit, false)
  assert.equal(records.get('first').result.timings.chords.cacheHit, true)
  assert.equal(sha(records.get('first').result.melody), notesBefore)
  assert.equal(sha(records.get('first').result.chords), chordBefore)
  evidence.checks.audioRebuildPreservesResults = true
  const sourceOutput = join(root, 'source-export')
  await rpc.call('notationSources', { melody: retained.melody, lines: JSON.parse(lyrics), directory: sourceOutput, pack })
  assert((await stat(join(sourceOutput, 'vocal-raw.mid'))).size > 0)
  assert((await readdir(sourceOutput)).some(name => name.endsWith('.musicxml')))
  evidence.checks.sourceExport = true
  const controller = new AbortController()
  await assert.rejects(rpc.call('analyze', { directory: join(root, 'cancelled'), source: resolve(args.audio), operation: 'analyze', pack,
    modelFingerprints: fingerprints, budgetBytes: 2 * 1024 ** 3 }, controller.signal,
    event => { if (event.kind === 'progress') controller.abort() }), /取消/)
  stats = await rpc.call('stats', {})
  assert.equal(stats.pid, warm.pid)
  assert.equal(stats.six.misses, 1)
  evidence.checks.cancelKeepsRuntime = true
  evidence.resultBytes = await repository.resultBytes()
  evidence.completedAt = new Date().toISOString()
  await save()
  process.stdout.write(JSON.stringify({ ok: true, evidence: join(root, 'summary.json'), checks: evidence.checks, resultBytes: evidence.resultBytes }) + '\n')
} finally {
  await rpc.close()
  repository.close()
}
