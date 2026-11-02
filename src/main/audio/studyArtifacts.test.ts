import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createStudyRepository } from './studyRepository.ts'
import { createStudyCacheValidator, studySignature, studyVocalKeys } from './studyCache.ts'
import type { StudyRecord } from '../../core/audio/musicStudyService.ts'
import type { StudyResult } from '../../shared/musicStudy.ts'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function result(): StudyResult {
  const six = studySignature(['htdemucs6-reference-seeded-v1', 'torch/hub/checkpoints/5c90dfd2-34c22ccb.th'], 'source', {})
  const notes = studySignature(studyVocalKeys(), six + '|' + hash('lyrics'), {})
  return { version: 1, duration: 10, sampleRate: 44100, frames: 441000, stems: ['vocals'], harmonicStems: ['piano'],
    ready: ['six', 'chords', 'melody'], sourceSha256: 'source', waveforms: {},
    chords: { segments: [{ start: 0, end: 10, label: 'C', confidence: 'unrated', candidates: [] }], algorithm: 'model', tuningCents: null }, originalChords: { segments: [] },
    melody: { notes: [{ start: 1, end: 2, midi: 60 }], scores: [{ lineId: 0, text: 'lyrics', svg: '<svg>' + '<g></g>'.repeat(1000) + '</svg>' }],
      key: null, algorithm: 'vocal2midi-tifa-game-medium-rhythm-v10', source: 'vocals', lyricsKey: hash('lyrics') },
    cache: { signatures: { six, notes, score: 'lyric-phrase-v4|notesHash', chords: studySignature(['sheetsage2-mert2-chord-full-paper-v1', 'sheetsage2/model.safetensors', 'mert2/model.safetensors'], six + '|piano', {}) },
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
    await repository.commitArtifacts({ id: 'song', title: 'Song', source: { path: '/song.wav', identity: 'song' }, result: expected } as StudyRecord)
    const summary = (await repository.list())[0]
    assert.equal(summary.result!.melody!.scores.length, 0)
    assert.equal(summary.result!.melody!.reuse, undefined)
    assert.equal(summary.resultLoaded, false)
    summary.result!.ready = ['chords', 'melody']
    await repository.saveSummary(summary)
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


test('one-time revision upgrade backs up legacy rows and retains compressed scores and manual edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-upgrade-'))
  let repository = createStudyRepository(root)
  try {
    const expected = result()
    expected.chords.segments[0].edited = true
    const record = { id: 'song', title: 'Saved song', revision: 10, source: { path: '/song.wav', identity: 'song' }, result: expected } as unknown as StudyRecord
    await repository.commitArtifacts(record)
    repository.close!()
    const db = new DatabaseSync(join(root, 'projects.sqlite'))
    const row = JSON.parse(String(db.prepare('SELECT data FROM analysis_projects').get()!.data))
    delete row.artifactRevision
    db.prepare('UPDATE analysis_projects SET data=?').run(JSON.stringify(row))
    db.exec('PRAGMA user_version=0'); db.close()
    repository = createStudyRepository(root)
    const upgraded = (await repository.list())[0]
    assert.equal(upgraded.artifactRevision, 1)
    assert.equal((await repository.loadResult!('song'))!.chords.segments[0].edited, true)
    assert.deepEqual((await repository.loadResult!('song'))!.melody, expected.melody)
    const backups = (await readdir(root)).filter(name => name.startsWith('projects-before-artifact-revisions-'))
    assert.equal(backups.length, 1)
    const backup = new DatabaseSync(join(root, backups[0]), { readOnly: true })
    assert.equal(backup.prepare('PRAGMA user_version').get()!.user_version, 0)
    assert.equal(JSON.parse(String(backup.prepare('SELECT data FROM analysis_projects').get()!.data)).artifactRevision, undefined)
    backup.close()
    const next = { ...upgraded, revision: 11, resultLoaded: true, result: await repository.loadResult!('song') } as StudyRecord
    assert.equal(await repository.commitArtifacts(next), 1)
    next.result!.chords.segments = [{ start: 0, end: 10, label: 'Dm', confidence: 'high', candidates: ['Dm'], edited: true }]
    assert.equal(await repository.commitArtifacts(next), 2)
    await repository.saveSummary({ ...next, artifactRevision: 0, progress: 0.7 })
    assert.equal((await repository.list())[0].artifactRevision, 2)
    repository.close!(); repository = createStudyRepository(root)
    assert.equal((await readdir(root)).filter(name => name.startsWith('projects-before-artifact-revisions-')).length, 1)
  } finally { repository.close!(); await rm(root, { recursive: true, force: true }) }
})
