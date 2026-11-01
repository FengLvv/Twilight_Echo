import test from 'node:test'
import assert from 'node:assert/strict'
import { CoreStudyAudioCache } from './studyAudioCache.ts'
import type { StudyAudioGroup } from '../../shared/musicStudy.ts'
import type { StudyRecord } from './musicStudyService.ts'

function fixture() {
  let groups: StudyAudioGroup[] = [{ id: 'old', kind: 'six', bytes: 40 }, { id: 'recent', kind: 'six', bytes: 40 }]
  const records = new Map(['old', 'recent'].map((id, i) => [id, { id, audioAccess: { six: i + 1 }, result: {
    ready: ['six', 'chords', 'melody'], stems: ['vocals', 'drums'], chords: { segments: [{ label: 'C' }] }, melody: { notes: [60], scores: ['svg'] }
  } } as unknown as StudyRecord]))
  const removed: string[] = []
  const cache = new CoreStudyAudioCache({ inventory: async () => structuredClone(groups),
    remove: async group => { removed.push(group.id); groups = groups.filter(g => g.id !== group.id || g.kind !== group.kind) },
    record: id => records.get(id), save: async () => {}, resultBytes: async () => 5, now: () => 10 })
  cache.policy.limitBytes = 100
  return { cache, records, removed }
}

test('LRU evicts old audio while retaining chords, notes and scores', async () => {
  const f = fixture()
  await f.cache.reserve('incoming', 40)
  assert.deepEqual(f.removed, ['old'])
  assert.deepEqual(f.records.get('old')!.result!.ready, ['chords', 'melody'])
  assert.equal(f.records.get('old')!.result!.chords.segments[0].label, 'C')
  assert.deepEqual(f.records.get('old')!.result!.melody!.scores, ['svg'])
})

test('leases protect playback, inference and exports from clear and admission', async () => {
  const f = fixture(), releaseOld = await f.cache.acquire('old'), releaseRecent = await f.cache.acquire('recent')
  await f.cache.trim(true)
  assert.deepEqual(f.removed, [])
  await assert.rejects(f.cache.reserve('incoming', 30), /容量不足/)
  releaseOld(); releaseOld()
  await f.cache.reserve('incoming', 30)
  assert.deepEqual(f.removed, ['old'])
  releaseRecent()
})

test('concurrent reservations cannot overbook unseen temporary files', async () => {
  const f = fixture()
  await f.cache.trim(true)
  await f.cache.reserve('a', 60)
  await assert.rejects(f.cache.reserve('b', 60), /容量不足/)
  const status = await f.cache.status()
  assert.equal(status.usedBytes + status.reservedBytes, 100)
  f.cache.releaseReservation('a')
  await f.cache.reserve('b', 60)
})

test('next-song lease is released on queue changes; reads do not refresh audio LRU', async () => {
  const f = fixture()
  f.cache.protectNext('old')
  await f.cache.trim(true)
  assert.deepEqual(f.removed, ['recent'])
  f.cache.protectNext(null)
  await f.cache.trim(true)
  assert.deepEqual(f.removed, ['recent', 'old'])
})

test('failed file deletion leaves accounting and result availability intact', async () => {
  const record = { result: { ready: ['six'] } } as unknown as StudyRecord
  const cache = new CoreStudyAudioCache({ inventory: async () => [{ id: 'locked', kind: 'six', bytes: 80 }],
    remove: async () => { throw new Error('locked') }, record: () => record, save: async () => {}, resultBytes: async () => 0, now: () => 1 })
  await assert.rejects(cache.trim(true), /locked/)
  assert.deepEqual(record.result!.ready, ['six'])
  assert.equal((await cache.status()).usedBytes, 80)
})
