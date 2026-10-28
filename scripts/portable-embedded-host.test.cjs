const assert = require('node:assert/strict')
const test = require('node:test')
const { PortError, createEmbeddedHarness, createFakePlatform, wireTrack } = require('./portable-embedded-harness.cjs')

const TRACKS = ['a', 'b', 'c'].map((id) => wireTrack(id))

function assertNoNulls(value, at = 'snapshot') {
  if (value === null) assert.fail(`${at} is null; the Kotlin decoder rejects nulls for required fields`)
  if (Array.isArray(value)) value.forEach((item, index) => assertNoNulls(item, `${at}[${index}]`))
  else if (typeof value === 'object') for (const [key, item] of Object.entries(value)) assertNoNulls(item, `${at}.${key}`)
}

function assertIntegers(object, keys, at) {
  for (const key of keys) {
    if (object[key] === undefined) continue
    assert.ok(Number.isInteger(object[key]), `${at}.${key} must be integral, got ${object[key]}`)
  }
}

/** Mirrors the non-null / Int / Long fields of the Android CoreSnapshot DTOs. */
function assertKotlinSnapshot(snapshot) {
  assertNoNulls(snapshot)
  assert.equal(snapshot.protocolVersion, 1)
  assert.equal(typeof snapshot.epoch, 'string')
  assert.ok(['starting', 'ready', 'recovering', 'failed', 'stopped'].includes(snapshot.phase))
  assertIntegers(snapshot, ['sequence', 'libraryRevision', 'playlistsRevision', 'audioRevision', 'settingsRevision', 'lyricsRevision', 'libraryTrackCount'], 'snapshot')
  for (const key of ['isStreamBuffering', 'loading', 'migrationRequired']) assert.equal(typeof snapshot[key], 'boolean')
  if (snapshot.playback) {
    const p = snapshot.playback
    for (const key of ['dspActive', 'eqActive', 'exclusive', 'nativePlaybackActive', 'outputPerfect', 'sourceExact', 'pcmPassthrough', 'isDsd', 'gaplessActive', 'preloadReady', 'crossfadeActive', 'crossfadeMixActive']) {
      assert.equal(typeof p[key], 'boolean', `playback.${key}`)
    }
    for (const key of ['latencyMs', 'position', 'duration', 'volume', 'playbackRate', 'crossfadeSeconds', 'crossfadeEffectiveSeconds']) {
      assert.equal(typeof p[key], 'number', `playback.${key}`)
    }
    assert.ok(['stopped', 'loading', 'playing', 'paused', 'buffering', 'error'].includes(p.state))
    assert.ok(['sequence', 'loop', 'single', 'shuffle', 'heart'].includes(p.playMode))
    assertIntegers(p, ['bufferSizeFrames', 'queueIndex', 'queueRevision', 'requestedConfigRevision', 'appliedConfigRevision', 'clipCount', 'sourceSampleRate', 'sourceChannels', 'sourceBitDepth', 'actualSampleRate', 'actualBitDepth', 'actualChannels'], 'playback')
  }
  if (snapshot.track) {
    assert.equal(typeof snapshot.track.title, 'string')
    assert.ok(snapshot.track.title.length > 0)
    assertIntegers(snapshot.track, ['size', 'sampleRate', 'bitDepth', 'discNumber', 'trackNumber', 'addedAt'], 'track')
    if (snapshot.track.ncmSongId !== undefined) assert.equal(typeof snapshot.track.ncmSongId, 'string')
  }
  if (snapshot.queue) assertIntegers(snapshot.queue, ['revision', 'total', 'index'], 'queue')
  for (const bookmark of snapshot.bookmarks) assertIntegers(bookmark, ['createdAtMs'], 'bookmark')
  for (const playlist of snapshot.playlists) assertIntegers(playlist, ['trackCount', 'updatedAtMs'], 'playlist')
  if (snapshot.currentLyrics) for (const line of snapshot.currentLyrics.lines) assertIntegers(line, ['timeMs'], 'lyrics')
}

async function bootWithQueue(options = {}) {
  const h = createEmbeddedHarness(options)
  await h.boot({ epoch: 'embedded-test' })
  await h.value('library.syncTracks', { tracks: TRACKS })
  await h.value('playback.replaceQueue', { tracks: TRACKS.map(({ id }) => ({ id })), startIndex: 0, play: true })
  return h
}

for (const eventLoop of [true, false]) {
  test(`embedded host plays a queue and projects Kotlin-decodable snapshots (eventLoop=${eventLoop})`, async () => {
    const h = await bootWithQueue({ eventLoop })
    const snapshot = await h.snapshot()
    assertKotlinSnapshot(snapshot)
    assert.equal(snapshot.track.id, 'a')
    assert.equal(snapshot.track.source, TRACKS[0].source)
    assert.equal(snapshot.playback.state, 'playing')
    assert.equal(snapshot.queue.total, 3)
    assert.equal(snapshot.libraryTrackCount, 3)

    const window = await h.value('playback.getQueueWindow', { offset: 0, limit: 10 }, 'query')
    assert.equal(window.queueId, snapshot.queue.id)
    assert.deepEqual(window.items.map((item) => item.track.id), ['a', 'b', 'c'])
    assert.equal(window.currentIndex, 0)

    const selected = await h.value('playback.selectQueueIndex', { index: 2, occurrenceId: window.items[2].occurrenceId }, 'command', { expectedRevision: snapshot.queue.revision })
    assert.equal(selected.snapshot.track.id, 'c')
    const previous = await h.value('playback.previous')
    assert.equal(previous.snapshot.track.id, 'b')
    const paused = await h.value('playback.pause')
    assert.equal(paused.snapshot.playback.state, 'paused')
    const moded = await h.value('playback.setPlayMode', { mode: 'single' })
    assert.equal(moded.snapshot.playback.playMode, 'single')
    assert.equal(h.platform.audio.playMode, 'single')
    const volume = await h.value('playback.setVolume', { volume: 0.4 })
    assert.equal(volume.snapshot.playback.volume, 0.4)

    const states = h.events.filter((event) => event.kind === 'state')
    assert.ok(states.length > 0, 'drain must publish coalesced state events')
    for (let i = 1; i < states.length; i++) assert.ok(states[i].sequence > states[i - 1].sequence)
    for (const state of states) assertKotlinSnapshot(state.snapshot)
  })
}

test('natural track end advances through the Core session', async () => {
  const h = await bootWithQueue()
  // Native engine finished track 'a': Kotlin reports a stopped/ended engine.
  h.platform.audio.state = 'ended'
  h.platform.audio.positionMs = 200_000
  await h.audioEvent({ type: 'track-ended', queueIndex: 0, reason: 'eof' })
  await h.settle({ timersUpToMs: 50 })
  const snapshot = await h.snapshot()
  assert.equal(snapshot.track.id, 'b')
  assert.equal(snapshot.queue.index, 1)
})

test('wire guards: epoch, queue revision, duplicates, unknown names, readiness', async () => {
  const h = await bootWithQueue()
  const snapshot = await h.snapshot()

  const stale = await h.request('playback.pause', {}, 'command', { epoch: 'old-epoch' })
  assert.equal(stale.error.code, 'STALE_EPOCH')
  assert.equal(stale.error.retryable, true)

  const bootSnapshot = await h.request('core.getSnapshot', {}, 'query', { epoch: 'epoch-boot' })
  assert.equal(bootSnapshot.ok, true, 'the first snapshot query is epoch-exempt')

  const guarded = await h.request('playback.selectQueueIndex', { index: 1 }, 'command', { expectedRevision: snapshot.queue.revision + 7 })
  assert.equal(guarded.error.code, 'STALE_REVISION')
  assert.equal(guarded.error.retryable, true)

  const first = await h.request('playback.pause', {}, 'command', { commandId: 'cmd-1' })
  assert.equal(first.ok, true)
  const again = await h.request('playback.pause', {}, 'command', { commandId: 'cmd-1' })
  assert.equal(again.error.code, 'OUTCOME_UNKNOWN')

  const unknown = await h.request('nope.nothing', {}, 'query')
  assert.equal(unknown.error.code, 'INVALID_REQUEST')
  const badMode = await h.request('playback.setPlayMode', { mode: 'warp' })
  assert.equal(badMode.error.code, 'INVALID_REQUEST')
  const tooLoud = await h.request('playback.setVolume', { volume: 3 })
  assert.equal(tooLoud.error.code, 'INVALID_REQUEST')
  const future = await h.request('core.getSnapshot', {}, 'query', { protocolVersion: 99 })
  assert.equal(future.error.code, 'INVALID_REQUEST')

  const cold = createEmbeddedHarness()
  JSON.parse(cold.core.bootHost(JSON.stringify({ epoch: 'cold' })))
  const { requestId } = cold.send('playback.play', {}, 'command', { epoch: 'cold' })
  cold.settle()
  await cold.settle()
  assert.equal(cold.responses.get(requestId).error.code, 'NOT_READY')
})

test('cancelled requests answer CANCELLED once and drop the late result', async () => {
  const h = await bootWithQueue()
  const { requestId } = h.send('search.songs', { query: 'Title' }, 'query')
  assert.equal(JSON.parse(h.core.cancelRequest(JSON.stringify({ requestId }))).accepted, true)
  await h.settle()
  assert.equal(h.responses.get(requestId).error.code, 'CANCELLED')
})

test('revoked SAF grants surface PERMISSION_EXPIRED instead of a generic failure', async () => {
  const h = await bootWithQueue()
  await h.value('playback.stop')
  h.platform.revoked.add(TRACKS[1].source)
  const response = await h.request('playback.selectQueueIndex', { index: 1 })
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'PERMISSION_EXPIRED')
})

test('library sync replaces or merges membership without touching the queue', async () => {
  const h = await bootWithQueue()
  const merged = await h.value('library.syncTracks', { tracks: [wireTrack('d')], merge: true })
  assert.equal(merged.snapshot.libraryTrackCount, 4)
  const replaced = await h.value('library.syncTracks', { tracks: [wireTrack('d')] })
  assert.equal(replaced.snapshot.libraryTrackCount, 1)
  assert.equal(replaced.snapshot.queue.total, 3, 'a scan must not replace the playing queue')
  assert.equal(replaced.snapshot.track.id, 'a')
  const search = await h.value('search.songs', { query: 'Title d' }, 'query')
  assert.deepEqual(search.items.map((item) => item.id), ['d'])
})

test('playlists, favorites and collections go through the Core playlist service', async () => {
  const h = await bootWithQueue()
  let snapshot = (await h.value('playlists.create', { name: 'Commute', trackIds: ['a', 'b'] })).snapshot
  assert.equal(snapshot.playlists.length, 1)
  const playlist = snapshot.playlists[0]
  assert.equal(playlist.name, 'Commute')
  assert.equal(playlist.trackCount, 2)
  snapshot = (await h.value('playlists.addTracks', { playlistId: playlist.id, trackIds: ['c'] })).snapshot
  assert.equal(snapshot.playlists[0].trackCount, 3)
  snapshot = (await h.value('playlists.rename', { playlistId: playlist.id, name: 'Evening' })).snapshot
  assert.equal(snapshot.playlists[0].name, 'Evening')
  snapshot = (await h.value('playlists.removeTrack', { playlistId: playlist.id, trackId: 'b' })).snapshot
  assert.deepEqual(snapshot.playlists[0].trackIds, ['a', 'c'])
  const duplicate = await h.request('playlists.create', { name: '' })
  assert.equal(duplicate.error.code, 'INVALID_REQUEST')
  const missing = await h.request('playlists.delete', { playlistId: 'nope' })
  assert.equal(missing.error.code, 'NOT_FOUND')

  snapshot = (await h.value('playlists.toggleFavorite', { trackId: 'b' })).snapshot
  assert.deepEqual(snapshot.favoriteTrackIds, ['b'])
  snapshot = (await h.value('playlists.toggleFavorite', { trackId: 'b' })).snapshot
  assert.deepEqual(snapshot.favoriteTrackIds, [])

  snapshot = (await h.value('playlists.delete', { playlistId: playlist.id })).snapshot
  assert.equal(snapshot.playlists.length, 0)

  const collections = await h.value('library.collections', {}, 'query')
  assert.equal(collections.albums.length, 1)
  assert.equal(collections.albums[0].trackCount, 3)
})

test('bookmarks use the Core-observed position of the current track', async () => {
  const h = await bootWithQueue()
  h.platform.audio.positionMs = 42_000
  await h.audioEvent({ type: 'snapshot', snapshot: { ...h.platform.audio } })
  let snapshot = (await h.value('bookmarks.add', { trackId: 'a', positionSec: 999, label: 'Chorus' })).snapshot
  assert.equal(snapshot.bookmarks.length, 1)
  assert.equal(snapshot.bookmarks[0].trackId, 'a')
  assert.equal(snapshot.bookmarks[0].label, 'Chorus')
  assert.ok(Math.abs(snapshot.bookmarks[0].positionSec - 42) < 1)
  const wrongTrack = await h.request('bookmarks.add', { trackId: 'b', positionSec: 1 })
  assert.equal(wrongTrack.error.code, 'STALE_REVISION')
  snapshot = (await h.value('bookmarks.remove', { bookmarkId: snapshot.bookmarks[0].id })).snapshot
  assert.equal(snapshot.bookmarks.length, 0)
  const missing = await h.request('bookmarks.remove', { bookmarkId: 'nope' })
  assert.equal(missing.error.code, 'NOT_FOUND')
})

test('lyrics import and lrclib fetch are stored as Core lyric overrides', async () => {
  const h = await bootWithQueue()
  const imported = await h.value('lyrics.importLrc', {
    trackId: 'a',
    lrcText: '[00:01.50]First synced line\n[00:01.50]第一行翻译\n[00:08.00]Second synced line'
  })
  assert.equal(imported.source, 'imported')
  assert.equal(imported.synced, true)
  assert.equal(imported.lines.length, 2)
  assert.equal(imported.lines[0].timeMs, 1500)
  assert.equal(imported.lines[0].translation, '第一行翻译')
  assert.equal(imported.snapshot.currentLyrics.source, 'imported')

  let lastUrl = null
  h.platform.network = ({ url }) => {
    lastUrl = url
    return { statusCode: 200, headers: {}, bodyUtf8: JSON.stringify({ syncedLyrics: '[00:02.00]Online line' }) }
  }
  const online = await h.value('lyrics.fetchOnline', { trackId: 'b' }, 'query')
  assert.match(lastUrl, /^https:\/\/lrclib\.net\/api\/get\?track_name=Title%20b&artist_name=Echo%20Ensemble/)
  assert.equal(online.source, 'online')
  assert.equal(online.lines[0].text, 'Online line')
  const viewB = await h.value('lyrics.current', { trackId: 'b' }, 'query')
  assert.equal(viewB.source, 'online')

  h.platform.network = () => ({ statusCode: 404, headers: {}, bodyUtf8: '' })
  const missing = await h.request('lyrics.fetchOnline', { trackId: 'c' }, 'query')
  assert.equal(missing.error.code, 'NOT_FOUND')
  const insecure = await h.request('lyrics.fetchOnline', { trackId: 'c', url: 'http://example.com/a.lrc' }, 'query')
  assert.equal(insecure.error.code, 'INVALID_REQUEST')
  h.platform.network = () => { throw new PortError('FAILED', 'offline', true) }
  const offline = await h.request('lyrics.fetchOnline', { trackId: 'c' }, 'query')
  assert.equal(offline.error.code, 'FAILED')
  assert.equal(offline.error.retryable, true)
})

test('a restart restores the queue, settings and documents from the session store', async () => {
  const platform = createFakePlatform()
  const first = createEmbeddedHarness({ platform })
  await first.boot({ epoch: 'run-1' })
  await first.value('library.syncTracks', { tracks: TRACKS })
  await first.value('playback.replaceQueue', { tracks: TRACKS.map(({ id }) => ({ id })), startIndex: 1, play: true })
  await first.value('playlists.toggleFavorite', { trackId: 'c' })
  await first.value('settings.edit', { key: 'playbackResumeMode', valueJson: '"track"' })
  await first.settle({ timersUpToMs: 50 })

  const second = createEmbeddedHarness({ platform })
  await second.boot({ epoch: 'run-2' })
  const snapshot = await second.snapshot()
  assertKotlinSnapshot(snapshot)
  assert.equal(snapshot.epoch, 'run-2')
  assert.equal(snapshot.track.id, 'b')
  assert.equal(snapshot.queue.total, 3)
  assert.equal(snapshot.libraryTrackCount, 3)
  assert.deepEqual(snapshot.favoriteTrackIds, ['c'])
})

test('legacy Kotlin-mirror and corrupt payloads migrate instead of failing boot', async () => {
  const legacy = createFakePlatform()
  legacy.revision = 3
  legacy.stored = JSON.stringify({
    libraryTracks: TRACKS,
    queueTracks: TRACKS,
    currentQueueIndex: 2,
    queueRevision: 9,
    playMode: 'loop',
    favoriteTrackIds: ['a'],
    bookmarks: [{ id: 'bm-1', trackId: 'b', positionSec: 12.5, label: 'Intro', createdAtMs: 1_700_000_000_000 }],
    playlists: [{ id: 'pl-1', name: 'Old list', trackIds: ['a', 'c'], trackCount: 2, updatedAtMs: 1_700_000_000_000 }],
    customLyrics: { a: { trackId: 'a', source: 'imported', synced: true, lines: [{ timeMs: 1000, text: 'Hello', translation: '你好' }] } },
    eqConfig: { enabled: true, preset: 'Rock', preampDb: -3, bandsDb: [4, 3, 1.5, -1, -1.5, 0, 2, 3.5, 4, 4], bitPerfect: false, gapless: true }
  })
  const h = createEmbeddedHarness({ platform: legacy })
  const booted = await h.boot({ epoch: 'legacy' })
  assert.equal(booted.boot.ok, true)
  const snapshot = await h.snapshot()
  assertKotlinSnapshot(snapshot)
  assert.equal(snapshot.libraryTrackCount, 3)
  assert.equal(snapshot.track.id, 'c')
  assert.equal(snapshot.queue.total, 3)
  assert.deepEqual(snapshot.favoriteTrackIds, ['a'])
  assert.equal(snapshot.bookmarks[0].label, 'Intro')
  assert.equal(snapshot.playlists[0].name, 'Old list')
  assert.equal(snapshot.eqConfig.preset, 'Rock')
  const lyrics = await h.value('lyrics.current', { trackId: 'a' }, 'query')
  assert.equal(lyrics.lines[0].text, 'Hello')
  assert.equal(lyrics.lines[0].translation, '你好')

  const corrupt = createFakePlatform()
  corrupt.revision = 1
  corrupt.stored = '{not json'
  const c = createEmbeddedHarness({ platform: corrupt })
  assert.equal((await c.boot({ epoch: 'corrupt' })).boot.ok, true)
  assert.ok(c.logs.some((log) => log.level === 'error' && /not valid JSON/.test(log.message)))
  await c.value('library.syncTracks', { tracks: TRACKS })
  await c.settle({ timersUpToMs: 50 })
  assert.equal(JSON.parse(corrupt.stored).schema, 'portable-core/1', 'the next save keeps CAS and replaces the corrupt payload')
})

test('rebooting retires the previous runtime and its pending port calls', async () => {
  const h = await bootWithQueue()
  const { requestId } = h.send('audioDevice.getRoute', {}, 'query')
  // The port call is queued in the outbox but never completed before the reboot.
  JSON.parse(h.core.bootHost(JSON.stringify({ epoch: 'second' })))
  await h.settle()
  assert.equal(h.responses.get(requestId).error.code, 'CANCELLED')
})

test('the host-pumped event loop exposes timers through nextTimerDelayMs', async () => {
  const h = createEmbeddedHarness({ eventLoop: true })
  assert.equal(typeof h.sandbox.__TWILIGHT_EVENT_LOOP__, 'object')
  assert.equal(typeof h.sandbox.setImmediate, 'undefined')
  h.sandbox.setTimeout(() => {}, 30)
  const drained = JSON.parse(h.core.drain())
  assert.ok(drained.nextTimerDelayMs > 0 && drained.nextTimerDelayMs <= 30)
})
