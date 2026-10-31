import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, ref, shallowRef } from 'vue'
import { createCorePlayerStore } from './corePlayerStore.ts'
import { createCorePlayerResource } from './corePlayerResource.ts'
import type { CorePlayerClient } from './corePlayerTypes.ts'
import type { CoreClientMessage, CoreSnapshot } from '../../../../shared/coreProtocol.ts'
import type { CoreBridgeStatus } from '../../../../shared/coreBridge.ts'
import type { CorePlaybackView } from '../../../../shared/coreViews.ts'
import type { TrackData } from '../../../../shared/track.ts'
import type { CoreQueueSubmitCommand } from '../../../../shared/coreQueueSubmission.ts'
import { createInactiveVisualizationData } from './useVisualizationPolling.ts'

const tick = async () => {
  await nextTick()
  await new Promise<void>((resolve) => setImmediate(resolve))
}
function snapshot(): CoreSnapshot {
  return {
    protocolVersion: 1,
    epoch: 'one',
    sequence: 0,
    phase: 'ready',
    playback: null,
    track: null,
    queue: null,
    error: null,
    migrationRequired: false,
    loading: false,
    isStreamBuffering: false,
    presentationRevision: null,
    pluginsRevision: null,
    libraryRevision: null,
    abLoop: null,
    mute: null,
    modelPack: null,
    cloudTransfers: null,
    inbox: null,
    libraryLoudness: null,
    loudness: null,
    scan: null,
    statisticsRevision: null,
    playlistsRevision: null,
    versionsRevision: null,
    audioRevision: null,
    settingsRevision: null,
    sleepTimer: null,
    bookmarksRevision: null,
    lyricsRevision: null,
    lyricsContentRevision: null,
    workspaceRevision: null,
    workspaceContentRevision: null,
    streams: null,
    cast: null,
    network: null,
    downloads: null,
    personalized: null,
    heart: null
  }
}
const track = (id = 'one'): TrackData => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  filePath: `D:/Fixture/${id}.flac`,
  fileName: `${id}.flac`,
  duration: 60,
  size: 100,
  cover: null,
  lyrics: null
})
function fixture(initial = snapshot()) {
  const state = shallowRef(initial)
  const status = shallowRef<CoreBridgeStatus | null>({
    connectionId: 'window',
    epoch: initial.epoch,
    phase: initial.phase
  })
  const requests: Array<{ name: string; payload: unknown }> = []
  const listeners = new Set<(event: CoreClientMessage) => void>()
  let handler: (name: string, payload: unknown) => Promise<unknown> = async () => null
  let query: (name: string, payload: unknown) => Promise<unknown> = async () => null
  const core: CorePlayerClient = {
    state,
    status,
    failure: shallowRef(null),
    attach: async () => state.value,
    refresh: async () => state.value,
    command: async (name, payload) => {
      requests.push({ name, payload })
      return handler(name, payload)
    },
    query: async (name, payload) => (await query(name, payload)) as never,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  let now = 0,
    nextId = 0
  const frames = new Map<number, () => void>()
  const player = createCorePlayerStore(core, {
    now: () => now,
    requestFrame: (callback) => {
      frames.set(++nextId, callback)
      return nextId
    },
    cancelFrame: (id) => {
      frames.delete(id)
    },
    visible: ref(true),
    resolveArtwork: async () => null,
    newId: () => `id-${++nextId}`
  })
  return {
    state,
    status,
    requests,
    player,
    setHandler: (next: typeof handler) => {
      handler = next
    },
    setQuery: (next: typeof query) => {
      query = next
    },
    emit: (event: CoreClientMessage) => {
      for (const listener of listeners) listener(event)
    },
    advance: (time: number) => {
      now = time
      for (const [id, callback] of [...frames]) {
        frames.delete(id)
        callback()
      }
    }
  }
}

test('construct, attach, rebuild and Core epoch changes never issue playback or session commands', async () => {
  const f = fixture()
  await f.player.attach()
  f.state.value = { ...snapshot(), epoch: 'two', sequence: 1 }
  f.status.value = { connectionId: 'window', epoch: 'two', phase: 'ready' }
  await tick()
  assert.deepEqual(f.requests, [])
  f.player.dispose()
  const next = fixture(f.state.value)
  await next.player.attach()
  assert.deepEqual(next.requests, [])
  next.player.dispose()
})

test('clock only interpolates Core samples, does not re-anchor on unrelated state or issue seek', async () => {
  const f = fixture()
  f.state.value = {
    ...snapshot(),
    sequence: 1,
    track: track(),
    playback: {
      state: 'playing',
      position: 10,
      duration: 60,
      playbackRate: 1
    } as CorePlaybackView
  }
  await tick()
  f.advance(500)
  assert.equal(f.player.currentTime.value, 10.5)
  f.state.value = { ...f.state.value, sequence: 2, statisticsRevision: 5 }
  await tick()
  f.advance(1000)
  assert.equal(f.player.currentTime.value, 11)
  f.status.value = { connectionId: 'window', epoch: 'one', phase: 'recovering' }
  await tick()
  f.advance(1300)
  assert.equal(f.player.currentTime.value, 10)
  assert.deepEqual(f.requests, [])
  f.player.dispose()
})

test('queue submission streams bounded identity-only batches and keeps selected duplicate CUE occurrence', async () => {
  const f = fixture()
  const tracks = Array.from({ length: 401 }, (_, index) => track(String(index)))
  tracks[0] = {
    ...track('cue'),
    subTrack: '2',
    cueRange: { startSeconds: 30, endSeconds: 90, pregapSeconds: 0 }
  }
  tracks[400] = { ...tracks[0] }
  f.setHandler(async (name, payload) => {
    assert.equal(name, 'queue.submit')
    const command = payload as CoreQueueSubmitCommand
    return {
      id: 'build',
      state: command.kind === 'commit' ? 'committed' : 'building',
      sequence: 'sequence' in command ? command.sequence : 0,
      total: 0
    }
  })
  await f.player.playTrack(tracks[400], tracks)
  const commands = f.requests.map((request) => request.payload as CoreQueueSubmitCommand)
  assert.deepEqual(commands[0], { kind: 'begin', selectedIndex: 400, play: true, position: 0 })
  const appends = commands.filter((command) => command.kind === 'append')
  assert.deepEqual(
    appends.map((command) => command.items.length),
    [200, 200, 1]
  )
  assert.deepEqual(appends[0].items[0], {
    kind: 'local',
    id: 'cue',
    fallback: {
      filePath: 'D:/Fixture/cue.flac',
      title: 'cue',
      artist: 'Artist',
      album: 'Album',
      duration: 60,
      subTrack: '2',
      cueRange: { startSeconds: 30, endSeconds: 90, pregapSeconds: 0 }
    }
  })
  assert.deepEqual(commands.at(-1), { kind: 'commit', id: 'build', sequence: 4 })
  f.player.dispose()
})

test('superseded play and skip intents complete quietly while genuine errors still reject',async()=>{
  const f=fixture()
  try {
    f.setHandler(async()=>{throw Object.assign(new Error('Playback request superseded'),{code:'CANCELLED'})})
    await f.player.playTrack(track())
    await f.player.next()
    await f.player.prev()
    assert.equal(f.player.audioEngineError.value,null)
    f.setHandler(async()=>{throw new Error('Audio device failed')})
    await assert.rejects(f.player.playTrack(track()),/Audio device failed/)
    assert.equal(f.player.audioEngineError.value,'Audio device failed')
  } finally { f.player.dispose() }
})

test('playback position ticks do not re-enumerate diagnostic devices',async()=>{
  const f=fixture({...snapshot(),audioRevision:1,playback:{state:'playing',position:0} as CorePlaybackView})
  let diagnostics=0
  f.setQuery(async name=>{if(name==='playback.diagnostics')diagnostics++;return null})
  try {
    await tick();const initial=diagnostics
    for(let i=1;i<10;i++){f.state.value={...f.state.value,playback:{...f.state.value.playback!,position:i}};await tick()}
    assert.equal(diagnostics,initial)
    f.state.value={...f.state.value,audioRevision:2};await tick()
    assert.equal(diagnostics,initial+1)
  } finally {f.player.dispose()}
})

test('resource replacement and disposal cancel their obsolete reads without reporting an error',async()=>{
  const scope=effectScope(),key=ref('first'),signals:AbortSignal[]=[],errors:unknown[]=[]
  scope.run(()=>createCorePlayerResource(()=>key.value,signal=>{
    signals.push(signal)
    return new Promise<void>((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{code:'CANCELLED'})),{once:true}))
  },error=>errors.push(error)))
  key.value='second';await tick();assert.equal(signals[0].aborted,true)
  scope.stop();await tick();assert.equal(signals[1].aborted,true)
  assert.deepEqual(errors,[])
})

test('provider playback strips resolved URLs and unknown commit outcomes are never replayed', async () => {
  const f = fixture()
  f.setHandler(async (_name, payload) => {
    const command = payload as CoreQueueSubmitCommand
    if (command.kind === 'commit')
      throw Object.assign(new Error('reply lost'), { code: 'OUTCOME_UNKNOWN' })
    return {
      id: 'build',
      state: 'building',
      sequence: 'sequence' in command ? command.sequence : 0,
      total: 0
    }
  })
  await assert.rejects(
    f.player.playTrack({
      ...track('ncm:1'),
      source: 'ncm',
      ncmSongId: 1,
      streamUrl: 'https://example.test/secret-token',
      filePath: 'https://example.test/secret-token'
    }),
    /reply lost/
  )
  assert.equal(JSON.stringify(f.requests).includes('secret-token'), false)
  assert.deepEqual(
    f.requests.map((request) => (request.payload as CoreQueueSubmitCommand).kind),
    ['begin', 'append', 'commit']
  )
  f.player.dispose()
})

test('Pause is not serialized behind slow queue/source resolution', async () => {
  const f = fixture()
  f.state.value = { ...snapshot(), playback: { state: 'playing' } as CorePlaybackView }
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  f.setHandler(async (name, payload) => {
    if (name === 'playback.pause') return null
    const command = payload as CoreQueueSubmitCommand
    if (command.kind === 'commit') await pending
    return {
      id: 'build',
      state: 'building',
      sequence: 'sequence' in command ? command.sequence : 0,
      total: 0
    }
  })
  const play = f.player.playTrack(track())
  await tick()
  await f.player.togglePlay()
  assert.equal(f.requests.at(-1)?.name, 'playback.pause')
  release()
  await play
  f.player.dispose()
})

test('query projection fences stale replies, freezes data and ignores replies after disposal', async () => {
  const scope = effectScope()
  const key = ref('first'),
    replies: Array<(value: { items: string[] }) => void> = []
  const resource = scope.run(() =>
    createCorePlayerResource(
      () => key.value,
      () => new Promise<{ items: string[] }>((resolve) => replies.push(resolve)),
      () => {}
    )
  )!
  key.value = 'second'
  await tick()
  replies[1]({ items: ['current'] })
  await tick()
  replies[0]({ items: ['stale'] })
  await tick()
  assert.deepEqual(resource.value.value, { items: ['current'] })
  assert.throws(() => resource.value.value!.items.push('mutated'), TypeError)
  key.value = 'third'
  await tick()
  scope.stop()
  replies[2]({ items: ['disposed'] })
  await tick()
  assert.deepEqual(resource.value.value, { items: ['current'] })
})

test('FFT starts only with a consumer, reconnects subscriptions and stops at zero consumers', async () => {
  const f = fixture()
  assert.equal(f.requests.length, 0)
  const release = f.player.acquireVisualizationConsumer({ spectrumPoints: 128 })
  await tick()
  const first = f.requests[0].payload as { subscriptionId: string }
  assert.equal(f.requests[0].name, 'visualization.subscribe')
  const data = { ...createInactiveVisualizationData(), active: true }
  f.emit({
    kind: 'visualization',
    epoch: 'one',
    subscriptionId: first.subscriptionId,
    sequence: 1,
    data
  })
  assert.equal(f.player.visualizationData.value.active, true)
  f.state.value = { ...snapshot(), epoch: 'two' }
  f.status.value = { connectionId: 'window', epoch: 'two', phase: 'ready' }
  await tick()
  const second = f.requests.at(-1)!.payload as { subscriptionId: string }
  assert.notEqual(second.subscriptionId, first.subscriptionId)
  f.emit({
    kind: 'visualization',
    epoch: 'one',
    subscriptionId: first.subscriptionId,
    sequence: 2,
    data
  })
  assert.equal(f.player.visualizationData.value.active, false)
  release()
  await tick()
  assert.deepEqual(f.requests.at(-1), {
    name: 'visualization.unsubscribe',
    payload: { subscriptionId: second.subscriptionId }
  })
  assert.equal(
    f.requests.some((request) => request.name.startsWith('playback.')),
    false
  )
  f.player.dispose()
})

const queueReference = (revision = 4) => ({
  id: 'queue', revision, index: 0, total: 901, occurrenceId: 'entry:0', canUndo: false, undoLabel: ''
})

test('clicking the same submitted playlist reuses SQL occurrences, including duplicate songs, without uploading it again', async () => {
  const f = fixture(), tracks = [track('duplicate'), track('other'), track('duplicate')]
  f.setQuery(async (name, payload) => {
    if(name === 'queue.page' && (payload as {limit:number}).limit === 1) {
      assert.deepEqual(payload,{id:'built',revision:10,offset:2,limit:1})
      return {items:[{position:2,queueEntryId:'entry:2',track:tracks[2]}]}
    }
    return null
  })
  f.setHandler(async (name, payload) => {
    if(name === 'queue.select') {
      assert.deepEqual(payload,{id:'built',revision:10,index:2,occurrenceId:'entry:2'})
      f.state.value = {...f.state.value,queue:{...f.state.value.queue!,revision:11,index:2,occurrenceId:'entry:2'}}
      return
    }
    const command=payload as CoreQueueSubmitCommand
    if(command.kind === 'commit') {
      const queue={id:'built',revision:10,index:0,total:3,occurrenceId:'entry:0'}
      f.state.value={...f.state.value,queue}
      return {id:'upload',state:'committed',sequence:2,total:3,queue}
    }
    return {id:'upload',state:'building',sequence:command.kind === 'append' ? 1:0,total:0}
  })
  try {
    await f.player.playTrack(tracks[0],tracks)
    f.requests.length=0
    await f.player.playTrack(tracks[2],tracks)
    assert.deepEqual(f.requests.map(r=>r.name),['queue.select'])
    assert.equal(f.state.value.queue?.occurrenceId,'entry:2')
  } finally { f.player.dispose() }
})

test('changed playlist order, external queue revisions and Core reconnects invalidate the reuse receipt', async t => {
  for(const change of ['order','revision','epoch','library','metadata'] as const) await t.test(change,async()=>{
    const f=fixture(),tracks=[track('one'),track('two')]
    let revision=10
    f.setHandler(async (name,payload)=>{
      assert.equal(name,'queue.submit')
      const command=payload as CoreQueueSubmitCommand
      if(command.kind === 'commit') {
        const queue={id:'built',revision:revision++,index:0,total:2,occurrenceId:'entry:0'}
        f.state.value={...f.state.value,queue}
        return {id:'upload',state:'committed',sequence:2,total:2,queue}
      }
      return {id:'upload',state:'building',sequence:command.kind === 'append'?1:0,total:0}
    })
    try {
      await f.player.playTrack(tracks[0],tracks)
      f.requests.length=0
      if(change==='order')tracks.reverse()
      if(change==='revision')f.state.value={...f.state.value,queue:{...f.state.value.queue!,revision:90}}
      if(change==='epoch')f.state.value={...f.state.value,epoch:'new-core'}
      if(change==='library')f.state.value={...f.state.value,libraryRevision:90}
      if(change==='metadata')tracks[0]={...tracks[0],title:'Edited title'}
      await f.player.playTrack(tracks[0],tracks)
      assert.deepEqual(f.requests.map(r=>(r.payload as CoreQueueSubmitCommand).kind),['begin','append','commit'])
    } finally { f.player.dispose() }
  })
})

test('selecting an occurrence outside the display window locates its absolute position', async () => {
  const f = fixture()
  f.state.value = { ...snapshot(), queue: queueReference() }
  f.setQuery(async (name, payload) => {
    if (name === 'queue.locate') {
      assert.deepEqual(payload, { id: 'queue', revision: 4, occurrenceId: 'entry:900' })
      return { position: 900 }
    }
    return null
  })
  await f.player.playLibraryQueueEntry('entry:900', { id: 'queue', revision: 4 })
  assert.deepEqual(f.requests, [{ name: 'queue.select', payload: {
    id: 'queue', revision: 4, index: 900, occurrenceId: 'entry:900'
  } }])
  f.player.dispose()
})

test('append batches advance the returned Core revision; no queue starts paused', async () => {
  const f = fixture()
  f.state.value = { ...snapshot(), queue: queueReference() }
  f.setHandler(async (name, payload) => {
    assert.equal(name, 'queue.insert')
    return queueReference((payload as { revision: number }).revision + 1)
  })
  await f.player.appendQueueTracks(Array.from({ length: 401 }, (_, i) => track(String(i))))
  assert.deepEqual(f.requests.map(request => (request.payload as { revision: number }).revision), [4, 5, 6])
  f.player.dispose()
  const empty = fixture()
  empty.setHandler(async (_name, payload) => ({
    id: 'build', state: 'building', sequence: (payload as { sequence?: number }).sequence ?? 0, total: 0
  }))
  await empty.player.enqueueTrack(track())
  assert.deepEqual(empty.requests[0], { name: 'queue.submit', payload: { kind: 'begin', selectedIndex: 0, play: false } })
  assert.equal(empty.requests.some(request => request.name === 'playback.play'), false)
  empty.player.dispose()
})

test('duplicate mixed-source entries copy a private Core occurrence, never a display path', async () => {
  const f = fixture()
  f.state.value = { ...snapshot(), queue: queueReference() }
  await f.player.duplicateLibraryQueueEntry('entry:800', true, { id: 'queue', revision: 4 })
  assert.deepEqual(f.requests[0], { name: 'queue.insert', payload: {
    id: 'queue', revision: 4,
    items: [{ kind: 'occurrence', queueId: 'queue', revision: 4, occurrenceId: 'entry:800' }],
    afterEntryId: 'entry:0'
  } })
  f.player.dispose()
})

test('presentation and bookmark lists remain fenced by the current occurrence', async () => {
  const f = fixture()
  const current = { trackId: 'one', occurrenceId: 'entry:0' }
  f.setQuery(async name => {
    if (name === 'player.presentation') return { current, cover: 'cover://one', coverSource: null, favorite: { available: true, liked: true, loading: false } }
    if (name === 'bookmarks.state') return { revision: 3, current, resumeOffer: null, longTrackResumeSeconds: 600, error: null }
    if (name === 'bookmarks.page') return { revision: 3, total: 1, offset: 0, items: [{ id: 'bookmark', label: 'Verse', positionSeconds: 10 }] }
    return null
  })
  f.state.value = { ...snapshot(), track: track(), queue: queueReference(), presentationRevision: 1, bookmarksRevision: 3 }
  await tick()
  assert.equal(f.player.currentTrack.value?.cover, 'cover://one')
  assert.equal(f.player.currentFavorite.value?.liked, true)
  assert.equal(f.player.currentTrackBookmarks.value[0].id, 'bookmark')
  await f.player.seekBookmark('bookmark')
  assert.deepEqual(f.requests.at(-1), { name: 'bookmarks.seek', payload: { revision: 3, id: 'bookmark', current } })
  f.state.value = { ...f.state.value, queue: { ...queueReference(), occurrenceId: 'entry:1' } }
  await tick()
  assert.equal(f.player.currentTrack.value?.cover, null)
  assert.equal(f.player.currentFavorite.value, null)
  assert.deepEqual(f.player.currentTrackBookmarks.value, [])
  f.player.dispose()
})
