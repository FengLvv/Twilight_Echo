import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createStudyRepository } from './studyRepository.ts'
import { createStudyCacheValidator, studySignature } from './studyCache.ts'
import { VOCAL_MODEL_HASHES } from './studyModelRegistry.ts'
import type { StudyRecord } from '../../core/audio/musicStudyService.ts'
import type { StudyResult } from '../../shared/musicStudy.ts'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function result(): StudyResult {
  const six = studySignature(['htdemucs6-reference-seeded-v1', 'torch/hub/checkpoints/5c90dfd2-34c22ccb.th'], 'source', {})
  const notes = studySignature(['vocal2midi-tifa-game-medium-rhythm-v1', ...Object.keys(VOCAL_MODEL_HASHES).sort()], six + '|' + hash('lyrics'), {})
  return { version: 1, duration: 10, sampleRate: 44100, frames: 441000, stems: ['vocals'], harmonicStems: ['piano'],
    ready: ['six', 'chords', 'melody'], sourceSha256: 'source', waveforms: {},
    chords: { segments: [{ start: 0, end: 10, label: 'C', confidence: 'unrated', candidates: [] }], algorithm: 'model', tuningCents: null }, originalChords: { segments: [] },
    melody: { notes: [{ start: 1, end: 2, midi: 60 }], scores: [{ lineId: 0, text: 'lyrics', svg: '<svg>' + '<g></g>'.repeat(1000) + '</svg>' }],
      key: null, algorithm: 'vocal2midi-tifa-game-medium-rhythm-v1', source: 'vocals', lyricsKey: hash('lyrics') },
    cache: { signatures: { six, notes, score: 'lyric-phrase-v1|notesHash', chords: studySignature(['sheetsage2-mert2-chord-full-paper-v1', 'sheetsage2/model.safetensors', 'mert2/model.safetensors'], six + '|piano', {}) },
      files: {}, notesHash: 'notesHash' },
    models: { instruments: 'six', voices: 'kara', singers: 'duet', singersSampleRate: 24000, singersChannels: 1 } }
}

test('compressed artifacts survive audio eviction and restart; summary saves cannot overwrite them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-artifacts-'))
  let repository = createStudyRepository(root)
  try {
    const expected = result()
    expected.melody!.reuse = { parent: 'model-and-pcm', beats: [0, 1, 2], downbeats: [0],
      groups: [{ key: 'context', lineIds: [0], wordBase: 0, noteIndices: [0] }] }
    await repository.save({ id: 'song', title: 'Song', source: { path: '/song.wav', identity: 'song' }, result: expected } as StudyRecord)
    const summary = (await repository.list())[0]
    assert.equal(summary.result!.melody!.scores.length, 0)
    assert.equal(summary.result!.melody!.reuse, undefined)
    assert.equal(summary.resultLoaded, false)
    summary.result!.ready = ['chords', 'melody']
    await repository.save(summary)
    const restored = await repository.loadResult!('song')
    assert.deepEqual(restored!.melody, expected.melody)
    assert.deepEqual(restored!.ready, ['chords', 'melody'])
    assert.ok(await repository.resultBytes!() < JSON.stringify(expected).length / 2)
    const database = new DatabaseSync(join(root, 'projects.sqlite'), { readOnly: true })
    const stored = String(database.prepare('SELECT data FROM analysis_projects').get()!.data)
    assert.equal(stored.includes('<svg>'), false)
    assert.equal(stored.includes('model-and-pcm'), false)
    assert.equal(Number(database.prepare('SELECT count(*) AS n FROM analysis_artifacts WHERE kind=?').get('score')!.n), 1)
    database.close()
    repository.close!()
    repository = createStudyRepository(root)
    assert.deepEqual((await repository.loadResult!('song'))!.melody, expected.melody)
  } finally { repository.close!(); await rm(root, { recursive: true, force: true }) }
})

test('missing WAV never invalidates committed chords or vocal score', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-provenance-'))
  try {
    const value = result(), validate = createStudyCacheValidator()
    const first = await validate(root, {}, undefined, value)
    assert.deepEqual(first.ready, ['chords', 'melody'])
    assert.equal(first.notesReady, true)
    delete value.cache!.signatures.score
    const scoreMissing = await validate(root, {}, undefined, value)
    assert.deepEqual(scoreMissing.ready, ['chords'])
    assert.equal(scoreMissing.notesReady, true)
    assert.equal((await validate(root, { 'vocal2midi/game/encoder.onnx': 'changed' }, undefined, value)).notesReady, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('local source change fences results while unavailable source retains committed annotations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-source-'))
  try {
    const value = result(), source = join(root, 'source.wav')
    await writeFile(source, 'old')
    const info = await stat(source)
    value.cache!.input = { path: source, size: info.size, mtimeMs: info.mtimeMs, sha256: hash('old') }
    await writeFile(source, 'different')
    assert.equal((await createStudyCacheValidator()(root, {}, source, value)).sourceChanged, true)
    await rm(source)
    assert.deepEqual((await createStudyCacheValidator()(root, {}, source, value)).ready, ['chords', 'melody'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
