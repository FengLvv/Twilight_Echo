import assert from 'node:assert/strict'
import test from 'node:test'
import { shallowRef } from 'vue'
import { createCoreListeningStats, projectListeningDisplayStat } from './coreListeningStats.ts'
import type { CoreSnapshot } from '../../../shared/coreProtocol.ts'
import type { CoreStatisticsOverview } from '../../../shared/coreStatistics.ts'
import { isCoreRequest } from '../../../shared/coreProtocol.ts'

function assertValidPage(payload: unknown): void {
  assert.equal(isCoreRequest({
    kind: 'query', name: 'statistics.tracks', payload, requestId: 'rankings', epoch: 'first'
  }), true)
}

const rows = Array.from({ length: 450 }, (_, index) => ({
  id: `track-${index}`, title: `Track ${index}`, artist: 'Artist', cover: null, sourceIds: [],
  seconds: 10, plays: 1, lastPlayed: 0, skips: 0, completions: 0, track: null
}))

const stateAt = (epoch = 'first', revision = 3) =>
  ({ epoch, phase: 'ready', statisticsRevision: revision }) as CoreSnapshot
const summary = (revision = 3): CoreStatisticsOverview => ({
  revision, trackCount: 450, days: { '2026-10-23': 4500 },
  persistence: { dirty: false, failureCount: 0, error: null },
  recorded: { seconds: 4500, plays: 450, trackCount: 450, formats: [] },
  artists: [], history: { mode: 'sqlite', ready: true, pending: false, revision: 1, error: '' }
})
const tick = () => new Promise<void>((done) => setImmediate(done))

test('all ranking adapters retain artwork when a page consumes only displayTrack', () => {
  const row = { ...rows[0], cover: 'twilight-media://image/song', track: {
    id: 'ncm:42', source: 'ncm', title: 'Song', artist: 'Artist', album: 'Album', duration: 180, size: 0
  } }
  const display = projectListeningDisplayStat(row)
  assert.equal(display.displayTrack?.cover, row.cover)
  assert.equal(display.cover, row.cover)
  assert.equal(projectListeningDisplayStat({ ...row, track: null }).displayTrack, null)
  assert.equal('cover' in row.track, false, 'the immutable Core DTO is not mutated')
})

test('statistics projection uses bounded ranking pages and exact all-history totals; snapshots are immutable', async () => {
  const state = shallowRef<CoreSnapshot | null>(stateAt())
  const queries: unknown[] = [], clears: unknown[] = []
  const projection = createCoreListeningStats({
    state, overview: async () => summary(),
    page: async (query) => {
      assertValidPage(query)
      queries.push(query)
      const offset = query.offset ?? 0
      return { revision: 3, total: 450, offset, items: rows.slice(offset, offset + query.limit!) }
    },
    clear: async (...args) => { clears.push(args) }
  })
  await projection.ensure()
  assert.deepEqual(queries, [
    ...['recent', 'plays', 'seconds'].map((sort) => ({ sort, revision: 3, limit: 128 })),
    ...['recent', 'plays', 'seconds'].map((sort) => ({ sort, revision: 3, offset: 128, limit: 72 }))
  ])
  for (const sort of ['recent', 'plays', 'seconds'] as const)
    assert.deepEqual(projection.windows.value[sort].map(row => row.id), rows.slice(0, 200).map(row => row.id))
  assert.equal(projection.overview.value?.recorded.trackCount, 450)
  assert.throws(() => { projection.overview.value!.days['2026-10-23'] = 0 }, TypeError)
  await projection.clear(null, 2)
  assert.deepEqual(clears, [[null, 2]], 'preview revision is forwarded unchanged, not silently replaced')
  projection.dispose()
  assert.equal(clears.length, 1)
})

test('a new profile loads empty rankings through valid Core requests without querying extra pages', async () => {
  const queries: unknown[] = []
  const projection = createCoreListeningStats({
    state: shallowRef<CoreSnapshot | null>(stateAt()),
    overview: async () => ({ ...summary(), trackCount: 0 }),
    page: async (query) => {
      assertValidPage(query)
      queries.push(query)
      return { revision: 3, total: 0, offset: 0, items: [] }
    },
    clear: async () => {}
  })
  await projection.ensure()
  assert.equal(projection.error.value, '')
  assert.equal(projection.ready.value, true)
  assert.deepEqual(projection.windows.value, { recent: [], plays: [], seconds: [] })
  assert.equal(queries.length, 3)
  projection.dispose()
})

test('epoch changes cancel old reads without cancelling Core work or publishing stale results', async () => {
  const state = shallowRef<CoreSnapshot | null>(stateAt())
  const requests: Array<{ signal: AbortSignal; resolve(value: CoreStatisticsOverview): void }> = []
  const projection = createCoreListeningStats({ state,
    overview: (signal) => new Promise((resolve) => { requests.push({ signal, resolve }) }),
    page: async (query) => ({ revision: query.revision!, total: 0, offset: 0, items: [] }),
    clear: async () => { throw Error('no writes expected') }
  })
  state.value = stateAt('second', 4)
  assert.equal(requests[0].signal.aborted, true)
  requests[1].resolve(summary(4))
  await tick()
  requests[0].resolve(summary(3))
  await tick()
  assert.equal(projection.overview.value?.revision, 4)
  projection.dispose()
  assert.equal(requests[1].signal.aborted, true)
})
