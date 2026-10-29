import assert from 'node:assert/strict'
import test from 'node:test'
import { CoreStateDatabase } from '../../main/library/coreStateDatabase.ts'
import { LibraryDatabase } from '../../main/library/libraryDatabase.ts'
import { emptyCoreStateCounts } from '../../shared/coreState.ts'
import type { CoreStatisticsApi } from '../../shared/coreStatistics.ts'
import type { TrackData } from '../../shared/track.ts'
import { CoreStatisticsRepository } from './repository.ts'
import { CoreStatisticsService } from './service.ts'
import { createLibraryListeningProjection } from './libraryProjection.ts'
import { listeningSourceIdentity } from '../../shared/listeningSourceIdentity.ts'
import { buildLastPlayedBySource } from './model.ts'
import { createArtworkProjection } from '../../main/coreProcess/artworkProjection.ts'

const local: TrackData = {
  id: 'local:cue',
  title: 'Song',
  artist: 'Singer',
  album: 'Album',
  filePath: 'D:/Music/disc.flac',
  fileName: 'disc.flac',
  duration: 100,
  size: 1,
  cover: null,
  lyrics: null,
  source: 'local',
  queueEntryId: 'first',
  cueRange: { startSeconds: 100, endSeconds: 200, pregapSeconds: 0 },
  cueSheetPath: 'D:/Music/disc.cue'
}
const provider: TrackData = {
  ...local,
  id: 'provider:1',
  source: 'provider',
  filePath: 'provider:1',
  streamUrl: 'https://private:secret@host.test/file?token=secret',
  cueRange: undefined,
  queueEntryId: 'second',
  duration: 100
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
class Timers {
  now = Date.UTC(2026, 9, 22, 12)
  serial = 0
  pending = new Map<number, { at: number; callback: () => void }>()
  setTimeout = (callback: () => void, delay: number) => {
    const id = ++this.serial
    this.pending.set(id, { at: this.now + delay, callback })
    return id
  }
  clearTimeout = (id: unknown) => {
    this.pending.delete(id as number)
  }
  advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const first = [...this.pending]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!first) break
      this.now = first[1].at
      this.pending.delete(first[0])
      first[1].callback()
    }
    this.now = end
  }
}
async function fixture(t: test.TestContext) {
  const db = new CoreStateDatabase(':memory:')
  db.begin('upgrade', { version: 1, counts: emptyCoreStateCounts() })
  db.commit('upgrade')
  const library = new LibraryDatabase(':memory:')
  const timers = new Timers()
  let id = 0,
    changes = 0
  const database: CoreStatisticsApi &
    Pick<import('../../shared/coreState.ts').CoreStateApi, 'coreStateRead'> = {
    coreStateRead: async (...args) => db.read(...args),
    coreStatisticsStatus: async () => db.statisticsStatus(),
    coreStatisticsBegin: async (...args) => db.statisticsBegin(...args),
    coreStatisticsStage: async (...args) => db.statisticsStage(...args),
    coreStatisticsCommit: async (...args) => db.statisticsCommit(...args),
    coreStatisticsAbort: async (...args) => db.statisticsAbort(...args)
  }
  const history = createLibraryListeningProjection({
    getStorageMode: async () => 'sqlite',
    ready: async () => {},
    snapshot: () => service.historySnapshot(),
    identity: () => `history:${++id}`,
    sync: async (request) => library.syncListeningHistory(request)
  })
  const repository = new CoreStatisticsRepository({ database, newId: () => `stats:${++id}` })
  const service = new CoreStatisticsService({
    repository,
    now: () => timers.now,
    timers,
    history,
    changed: () => changes++
  })
  await service.initialize()
  t.after(async () => {
    await service.shutdown()
    db.close()
    library.close()
  })
  const observe = (
    track: TrackData | null,
    state: 'playing' | 'paused' | 'stopped',
    position = 0,
    duration = 100
  ) => service.observe(track, { state, position, duration })
  const snapshot = async () => {
    await service.flush()
    return new CoreStatisticsRepository({ database, newId: () => `read:${++id}` }).load()
  }
  return {
    db,
    library,
    repository,
    database,
    service,
    timers,
    observe,
    snapshot,
    get changes() {
      return changes
    }
  }
}

test('Focus history projection distinguishes equal raw provider IDs and keeps original raw sorting keys', async t => {
  const f = await fixture(t)
  f.observe({ ...provider, id: '42', source: 'ncm', title: 'NCM song' }, 'playing')
  f.timers.advance(5_000)
  const ncmAt = f.timers.now
  f.observe({ ...provider, id: '42', source: 'other', title: 'Other provider song' }, 'playing')
  f.timers.advance(5_000)
  const otherAt = f.timers.now
  await f.service.overview()
  const snapshot = f.service.historySnapshot()
  assert.equal(snapshot.get(listeningSourceIdentity('ncm', 'ncm:42')), ncmAt)
  assert.equal(snapshot.get(listeningSourceIdentity('other', '42')), otherAt)
  assert.equal(snapshot.get('42'), otherAt)
  assert.equal(f.library.sql.prepare('SELECT last_played FROM library_history WHERE id=?').get(listeningSourceIdentity('ncm', '42'))!.last_played, ncmAt)
  assert.equal(f.library.sql.prepare('SELECT last_played FROM library_history WHERE id=?').get(listeningSourceIdentity('other', '42'))!.last_played, otherAt)
  assert.equal(snapshot.has(listeningSourceIdentity('unplayed', '42')), false)
})

test('Focus qualified history uses catalog local-path detection and normalized recorded provider identities', async t => {
  const f = await fixture(t), id = 'D:\\Music\\legacy.flac'
  f.observe({ ...local, id, source: undefined }, 'playing')
  f.timers.advance(5_000)
  await f.service.overview()
  assert.equal(f.service.historySnapshot().get(listeningSourceIdentity('local', id)), f.timers.now)
  const stats = await f.snapshot()
  Object.values(stats.tracks)[0].sourceIds = [{ source: ' NCM ', trackId: 'ncm:42' }]
  const qualified = buildLastPlayedBySource(stats)
  assert.equal(qualified.get(listeningSourceIdentity('ncm', '42')), f.timers.now)
  assert.equal(qualified.has(JSON.stringify(['focus-source-v1', 'D', id])), false)
})

test('one Core timer counts five-second ticks; duplicate state observations and reconnect-style reads cannot multiply listening', async (t) => {
  const f = await fixture(t)
  f.observe(local, 'playing')
  for (let i = 0; i < 20; i++) {
    f.observe(local, 'playing', i)
    f.service.summary()
    f.service.page({})
  }
  f.timers.advance(15_000)
  const before = f.service.page({}).items[0]
  assert.equal(before.seconds, 15)
  assert.equal(before.plays, 1)
  f.observe(local, 'paused', 15)
  f.timers.advance(60_000)
  assert.equal(f.service.page({}).items[0].seconds, 15)
  f.observe(local, 'playing', 15)
  f.timers.advance(5_000)
  const saved = await f.snapshot(),
    stat = saved.tracks['logic:song::singer']
  assert.equal(stat.seconds, 20)
  assert.equal(stat.plays, 1)
  assert.deepEqual(stat.track?.cueRange, local.cueRange)
  assert.equal(stat.track?.cueSheetPath, local.cueSheetPath)
  assert.equal(stat.track?.queueEntryId, 'first')
  assert.equal(saved.days['2026-10-22'], 20)
  await tick()
  await f.service.shutdown()
  assert.equal(f.timers.pending.size, 0)
})

test('cross-source aggregation, skips and completions retain existing thresholds without exposing private sources', async (t) => {
  const f = await fixture(t)
  f.observe(local, 'playing', 20)
  f.timers.advance(5_000)
  f.observe(local, 'playing', 49)
  f.observe(provider, 'playing', 0)
  f.timers.advance(5_000)
  f.observe(provider, 'playing', 90)
  f.observe({ ...local, queueEntryId: 'third' }, 'paused', 0)
  const [stat] = f.service.page({ sort: 'plays' }).items
  assert.equal(stat.seconds, 10)
  assert.equal(stat.plays, 2)
  assert.equal(stat.skips, 1)
  assert.equal(stat.completions, 1)
  assert.doesNotMatch(
    JSON.stringify(f.service.page({})),
    /private|secret|token=|streamUrl|filePath/
  )
  const saved = await f.snapshot()
  assert.deepEqual(
    saved.tracks['logic:song::singer'].sourceIds?.map((source) => source.trackId),
    [local.id, provider.id]
  )
  assert.equal(saved.tracks['logic:song::singer'].track?.streamUrl, null)
})

test('recent history re-grants NetEase artwork after repository reload without exposing CDN URLs', async (t) => {
  const f = await fixture(t)
  const origin = 'https://p1.music.126.net/album.jpg?token=private'
  f.observe({ ...provider, id: 'ncm:42', source: 'ncm', ncmSongId: 42,
    cover: 'twilight-media://image/previous-session', coverSource: origin }, 'playing')
  f.timers.advance(5_000)
  f.observe(null, 'stopped')
  await f.service.flush()
  const restored = new CoreStatisticsService({
    repository: new CoreStatisticsRepository({ database: f.database, newId: () => 'restored' }),
    now: () => f.timers.now, timers: f.timers, changed: () => {}
  })
  await restored.initialize()
  t.after(() => restored.shutdown())
  const sources: string[] = []
  const project = createArtworkProjection({
    normalizeCachedCover: async handle => handle, migrateBase64Cover: () => null,
    resolve: () => { throw Error('Previous-session grant is unavailable') },
    grant: source => { sources.push(source); return 'twilight-media://image/current-session' }
  })
  const before = restored.exportData()
  for (const sort of ['recent', 'plays', 'seconds'] as const) {
    const page = await restored.pageWithArtwork({ sort }, (track, signal) => project({
      cover: track.cover, coverSource: track.coverSource ?? null
    }, signal), new AbortController().signal)
    assert.equal(page.items[0].cover, 'twilight-media://image/current-session')
    assert.equal(page.items[0].track?.id, 'ncm:42')
    assert.doesNotMatch(JSON.stringify(page), /https:|token=|private|previous-session/)
  }
  assert.deepEqual(sources, [origin, origin, origin])
  assert.deepEqual(restored.exportData(), before, 'display grants must not replace durable history')
})

test('history artwork preserves local covers, supports legacy HTTP covers and isolates broken images', async t => {
  const f = await fixture(t)
  for (const [title, cover] of [
    ['Local', 'cover://local.jpg'], ['Legacy', 'https://p2.music.126.net/legacy.jpg'],
    ['Broken', 'https://p2.music.126.net/broken.jpg'], ['Missing', null]
  ] as const) {
    f.observe({ ...provider, id: title, title, cover }, 'playing')
    f.timers.advance(5_000)
  }
  f.observe(null, 'stopped')
  const projected: string[] = []
  const page = await f.service.pageWithArtwork({}, async track => {
    projected.push(track.title)
    if (track.title === 'Missing') return { cover: null }
    if (track.title === 'Broken') throw Error('Expired grant')
    assert.equal(track.coverSource, 'https://p2.music.126.net/legacy.jpg')
    return { cover: 'twilight-media://image/legacy' }
  }, new AbortController().signal)
  assert.deepEqual(projected.sort(), ['Broken', 'Legacy', 'Missing'])
  const covers = Object.fromEntries(page.items.map(item => [item.title, item.cover]))
  assert.deepEqual(covers, { Missing: null, Broken: null,
    Legacy: 'twilight-media://image/legacy', Local: 'cover://local.jpg' })
})

test('history artwork cancels requests and rejects a page changed while granting images', async t => {
  const f = await fixture(t)
  f.observe({ ...provider, cover: 'https://p1.music.126.net/a.jpg' }, 'playing')
  f.timers.advance(5_000)
  f.observe(null, 'stopped')
  const controller = new AbortController()
  await assert.rejects(f.service.pageWithArtwork({}, async () => {
    controller.abort()
    return { cover: 'twilight-media://image/late' }
  }, controller.signal), { name: 'AbortError' })
  await assert.rejects(f.service.pageWithArtwork({}, async () => {
    await f.service.clear(null, f.service.getRevision())
    return { cover: 'twilight-media://image/late' }
  }, new AbortController().signal), { code: 'STALE_REVISION' })
})

test('artist ranking thumbnails use the recorded source through the same controlled artwork path', async t => {
  const f = await fixture(t)
  f.observe({ ...provider, id: 'ncm:42', source: 'ncm', ncmSongId: 42, cover: null }, 'playing')
  f.timers.advance(5_000)
  f.observe(null, 'stopped')
  const view = await f.service.overview(async track => {
    assert.equal(track.id, 'ncm:42')
    return { cover: 'twilight-media://image/artist-recording' }
  })
  assert.equal(view.artists[0].cover, 'twilight-media://image/artist-recording')
  assert.equal(view.artists[0].coverSource, null)
})

test('Pause and Stop do not count outcomes, same-track occurrences keep legacy play counting, and 50–90 percent is neither outcome', async (t) => {
  const f = await fixture(t)
  f.observe(local, 'playing', 55)
  f.timers.advance(5_000)
  f.observe(local, 'paused', 55)
  f.observe(local, 'stopped', 0)
  assert.equal(f.service.page({}).items[0].skips, 0)
  f.observe({ ...local, queueEntryId: 'duplicate' }, 'playing', 55)
  f.timers.advance(5_000)
  f.observe({ ...local, id: 'other', title: 'Other' }, 'paused', 0)
  const stat = f.service.page({}).items.find((stat) => stat.id === 'logic:song::singer')!
  assert.equal(stat.plays, 1)
  assert.equal(stat.completions, 0)
  assert.equal(stat.skips, 0)
})

test('clear ranges preserve other days and legacy totals; clear is revision-fenced, immediate, and continues counting freshly', async (t) => {
  const f = await fixture(t)
  f.observe(local, 'playing', 30)
  f.timers.advance(5_000)
  const firstDay = '2026-10-22'
  f.observe(local, 'paused', 30)
  f.timers.advance(86_400_000)
  f.observe(provider, 'playing', 20)
  f.timers.advance(5_000)
  const revision = f.service.getRevision()
  await assert.rejects(
    f.service.clear(null, revision - 1),
    (error) => (error as { code: string }).code === 'STALE_REVISION'
  )
  await f.service.clear({ startDay: firstDay, endDay: firstDay }, revision)
  let saved = await f.snapshot()
  assert.equal(saved.days[firstDay], undefined)
  assert.equal(saved.tracks['logic:song::singer'].seconds, 5)
  await f.service.clear(null, f.service.getRevision())
  saved = await f.snapshot()
  assert.deepEqual(saved, { days: {}, tracks: {} })
  f.timers.advance(5_000)
  assert.equal(f.service.page({}).items[0].plays, 1)
  assert.equal(f.service.page({}).items[0].seconds, 5)
})

test('ticks during a slow checkpoint stay dirty; commit loss followed by unreadable status is recovered without replay or duplicate counters', async (t) => {
  const f = await fixture(t)
  const commit = f.database.coreStatisticsCommit,
    status = f.database.coreStatisticsStatus
  let release!: () => void,
    offline = false,
    commits = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  f.database.coreStatisticsCommit = async (...args) => {
    commits++
    if (commits !== 1) return commit(...args)
    const result = await commit(...args)
    await gate
    offline = true
    void result
    throw Error('Lost commit reply')
  }
  f.database.coreStatisticsStatus = async () => {
    if (offline) throw Error('Offline')
    return status()
  }
  f.observe(local, 'playing')
  f.timers.advance(5_000)
  const pending = f.service.flush()
  await tick()
  f.timers.advance(5_000)
  release()
  await assert.rejects(pending, /Offline/)
  assert.equal(f.service.summary().persistence.dirty, true)
  assert.equal(f.service.page({}).items[0].seconds, 10)
  offline = false
  await f.service.flush()
  assert.equal(commits, 2, 'one old confirmed commit and one new checkpoint for the later tick')
  assert.equal((await f.snapshot()).tracks['logic:song::singer'].seconds, 10)
  assert.equal(f.service.summary().persistence.dirty, false)
})

test('history hydration projects the complete cross-source last-played index and clearing updates that derived SQL index', async (t) => {
  const f = await fixture(t)
  f.observe(local, 'playing')
  f.timers.advance(5_000)
  f.observe(provider, 'playing')
  f.timers.advance(5_000)
  await tick()
  const rows = f.library.sql.prepare('SELECT id,last_played FROM library_history ORDER BY id').all()
  assert.deepEqual(
    rows.map((row) => row.id),
    [listeningSourceIdentity('local', local.id), listeningSourceIdentity('provider', provider.id), local.id, provider.id].sort()
  )
  assert.ok(rows.every((row) => Number(row.last_played) > 0))
  await f.service.clear(null, f.service.getRevision())
  await tick()
  assert.equal(f.library.sql.prepare('SELECT COUNT(*) AS n FROM library_history').get()?.n, 0)
})

test('overview and clear preview cover history beyond the 200-row ranking window', async (t) => {
  const f = await fixture(t)
  for (let i = 0; i < 451; i++) {
    f.observe({ ...local, id: `local:${i}`, title: `Song ${i}`, format: i < 300 ? 'FLAC' : 'MP3' }, 'playing')
    f.timers.advance(5_000)
  }
  f.observe(null, 'stopped')
  const overview = await f.service.overview()
  assert.equal(f.service.page({ limit: 200 }).items.length, 200)
  assert.deepEqual(overview.recorded, {
    seconds: 2255, plays: 451, trackCount: 451,
    formats: [
      { key: 'FLAC', label: 'FLAC', count: 300, percent: 300 / 451 * 100 },
      { key: 'MP3', label: 'MP3', count: 151, percent: 151 / 451 * 100 }
    ]
  })
  assert.equal(overview.artists[0].trackCount, 451)
  assert.equal(overview.artists[0].seconds, 2255)
  assert.equal(overview.artists[0].sourceIds.length, 200)
  const preview = f.service.previewClear(null, overview.revision)
  assert.equal(preview.trackCount, 451)
  assert.equal(preview.seconds, 2255)
  assert.throws(() => f.service.previewClear(null, overview.revision - 1), { code: 'STALE_REVISION' })
  assert.equal(overview.history.ready, true)
})
