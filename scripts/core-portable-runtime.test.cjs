const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '..')
const BUNDLE_PATH = path.join(ROOT, 'dist', 'portable-core', 'music-core.js')
const LOCK_PATH = path.join(ROOT, 'dist', 'portable-core', 'core-lock.json')

function loadPortableCoreInIsolatedSandbox() {
  assert.equal(
    fs.existsSync(BUNDLE_PATH),
    true,
    'dist/portable-core/music-core.js must exist (run scripts/build-portable-core.mjs first)',
  )
  const bundleCode = fs.readFileSync(BUNDLE_PATH, 'utf8')

  const sandbox = {
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Symbol,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Uint8Array,
    Int32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
  }
  sandbox.globalThis = sandbox

  const context = vm.createContext(sandbox, {
    name: 'QuickJS-Simulated-Sandbox',
    codeGeneration: { strings: false, wasm: false },
  })

  vm.runInContext(bundleCode, context, {
    filename: 'music-core.js',
    timeout: 5000,
  })

  assert.equal(typeof sandbox.process, 'undefined', 'Sandbox must not expose process')
  assert.equal(typeof sandbox.require, 'undefined', 'Sandbox must not expose require')
  assert.equal(
    typeof sandbox.__TWILIGHT_CORE_PORTS__,
    'undefined',
    'Sandbox must not rely on __TWILIGHT_CORE_PORTS__',
  )
  assert.equal(
    typeof sandbox.__TWILIGHT_PORTABLE_CORE__,
    'object',
    'Bundle must register globalThis.__TWILIGHT_PORTABLE_CORE__',
  )

  return sandbox.__TWILIGHT_PORTABLE_CORE__
}

function createFakePorts() {
  let storedSession = null
  let revisionCounter = 0
  let nowTick = 1_710_000_000_000
  const audioListeners = new Set()
  const engineCalls = []

  let queueItems = []
  let queueCursor = 0
  let currentSource = ''
  let currentPosition = 0
  let currentDuration = 210
  let state = 'stopped'
  let volume = 0.7
  let playMode = 'sequential'

  const buildPlaybackInfo = () => {
    const activeItem = queueItems[queueCursor] ?? null
    return {
      state,
      currentTime: currentPosition,
      duration: activeItem?.duration ?? currentDuration,
      volume,
      playMode: playMode === 'heart' ? 'sequential' : playMode,
      currentTrack: activeItem?.source || currentSource,
      queueIndex: queueItems.length > 0 ? queueCursor : -1,
      queueLength: queueItems.length,
    }
  }

  const emitNativeEvent = (event) => {
    for (const listener of [...audioListeners]) {
      listener(event)
    }
  }

  const clock = {
    nowUnixMs() {
      nowTick += 15
      return nowTick
    },
    nowMonotonicMs() {
      nowTick += 15
      return nowTick
    },
  }

  const sessionStore = {
    async load() {
      return storedSession ? { ...storedSession } : null
    },
    async save(payloadJson, expectedRevision) {
      if (storedSession && expectedRevision !== storedSession.revision) {
        return { ok: false, reason: 'conflict' }
      }
      revisionCounter += 1
      const revision = String(revisionCounter)
      storedSession = { revision, payloadJson }
      return { ok: true, revision }
    },
  }

  const audioEngine = {
    async start() {
      engineCalls.push({ method: 'start' })
    },
    async loadQueue(items, startIndex = 0) {
      engineCalls.push({ method: 'loadQueue', count: items.length, startIndex })
      queueItems = items.map((item) => ({ ...item }))
      queueCursor = items.length === 0 ? 0 : Math.max(0, Math.min(items.length - 1, startIndex))
      if (queueItems[queueCursor]) {
        currentSource = queueItems[queueCursor].source
        currentDuration = queueItems[queueCursor].duration || 210
      }
    },
    async play(source, positionSeconds = 0) {
      engineCalls.push({ method: 'play', source, positionSeconds })
      currentSource = source
      currentPosition = positionSeconds
      state = 'playing'
      const matchedIdx = queueItems.findIndex((item) => item.source === source)
      if (matchedIdx >= 0) queueCursor = matchedIdx
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
      return { nativeStarted: true, fallbackReason: '' }
    },
    async pause() {
      engineCalls.push({ method: 'pause' })
      state = 'paused'
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
    },
    async stop() {
      engineCalls.push({ method: 'stop' })
      state = 'stopped'
      currentPosition = 0
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
    },
    async seek(positionSeconds) {
      engineCalls.push({ method: 'seek', positionSeconds })
      currentPosition = positionSeconds
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
    },
    async setVolume(nextVolume) {
      engineCalls.push({ method: 'setVolume', volume: nextVolume })
      volume = nextVolume
    },
    async setPlaybackRate(rate) {
      engineCalls.push({ method: 'setPlaybackRate', rate })
    },
    async setPlayMode(mode) {
      engineCalls.push({ method: 'setPlayMode', mode })
      playMode = mode
    },
    async selectQueueIndex(index) {
      engineCalls.push({ method: 'selectQueueIndex', index })
      if (index < 0 || index >= queueItems.length) return false
      queueCursor = index
      currentSource = queueItems[queueCursor].source
      currentPosition = 0
      state = 'playing'
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
      return true
    },
    async next() {
      engineCalls.push({ method: 'next' })
      if (queueCursor + 1 < queueItems.length) {
        queueCursor += 1
        currentSource = queueItems[queueCursor].source
        currentPosition = 0
      }
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
      return true
    },
    async previous() {
      engineCalls.push({ method: 'previous' })
      if (queueCursor > 0) {
        queueCursor -= 1
        currentSource = queueItems[queueCursor].source
        currentPosition = 0
      }
      emitNativeEvent({ type: 'playback-info', info: buildPlaybackInfo() })
      return true
    },
    async getSnapshot() {
      return buildPlaybackInfo()
    },
    subscribe(listener) {
      audioListeners.add(listener)
      return () => {
        audioListeners.delete(listener)
      }
    },
    emitNativeEvent,
  }

  return {
    clock,
    sessionStore,
    audioEngine,
    engineCalls,
    getStoredSession: () => storedSession,
  }
}

function sendRequestAndWait(host, requestEnvelope) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timed out waiting for response to ${requestEnvelope.requestId}`))
    }, 3000)

    const unsubscribe = host.subscribeMessages((msg) => {
      if (msg.kind === 'response' && msg.requestId === requestEnvelope.requestId) {
        clearTimeout(timer)
        unsubscribe()
        resolve(msg)
      }
    })

    host.dispatchRequest(requestEnvelope)
  })
}

test('core-lock.json metadata matches built portable bundle', () => {
  assert.equal(fs.existsSync(LOCK_PATH), true, 'core-lock.json must exist')
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'))
  assert.equal(lock.protocolVersion, 1)
  assert.equal(lock.bundleFile, 'music-core.js')
  assert.match(lock.bundleSha256, /^[0-9a-f]{64}$/)
  assert.ok(lock.bundleBytes > 1000)
})

test('Portable MusicCore runs inside a zero-Node sandbox and fulfills Phase 1 PoC lifecycle', async () => {
  const portableCore = loadPortableCoreInIsolatedSandbox()
  const ports = createFakePorts()
  const initialTracks = [
    {
      id: 'track-101',
      filePath: 'content://media/external/audio/media/101',
      title: 'Twilight Overture',
      artist: 'Echo Ensemble',
      album: 'Phase One',
      duration: 210,
    },
    {
      id: 'track-102',
      filePath: 'content://media/external/audio/media/102',
      title: 'Midnight Horizon',
      artist: 'Echo Ensemble',
      album: 'Phase One',
      duration: 185,
    },
    {
      id: 'track-103',
      filePath: 'content://media/external/audio/media/103',
      title: 'Dawn Resonance',
      artist: 'Echo Ensemble',
      album: 'Phase One',
      duration: 240,
    },
  ]

  const host = portableCore.createPortableMusicCoreHost({
    epoch: 'epoch-poc-1',
    platform: 'android',
    clock: ports.clock,
    sessionStore: ports.sessionStore,
    audioEngine: ports.audioEngine,
    initialTracks,
    initialSettings: {
      playbackResumeMode: 'trackAndPosition',
    },
  })

  const stateSequences = []
  const unsubscribe = host.subscribeMessages((message) => {
    if (message.kind === 'state') {
      stateSequences.push(message.sequence)
    }
  })

  // 1. Initialize
  await host.initialize()
  const initSnap = host.getSnapshot()
  assert.equal(initSnap.protocolVersion, 1)
  assert.equal(initSnap.phase, 'ready')

  // 2. Build queue & play tracks
  await host.playTracks(initialTracks, 0)
  const playingSnap = host.getSnapshot()
  assert.equal(playingSnap.track?.id, 'track-101')
  assert.equal(playingSnap.queue?.total, 3)
  assert.equal(playingSnap.queue?.index, 0)

  // 3. Change play mode via standard CoreRequestEnvelope ('playback.mode')
  const modeResp = await sendRequestAndWait(host, {
    kind: 'command',
    requestId: 'req-mode-1',
    epoch: host.epoch,
    name: 'playback.mode',
    payload: { mode: 'listLoop' },
  })
  assert.equal(modeResp.ok, true, `modeResp failed: ${JSON.stringify(modeResp)}`)
  assert.equal(host.getSnapshot().playback?.playMode, 'listLoop')

  // 4. Advance to next track via standard CoreRequestEnvelope ('playback.next')
  const nextResp = await sendRequestAndWait(host, {
    kind: 'command',
    requestId: 'req-next-1',
    epoch: host.epoch,
    name: 'playback.next',
    payload: {},
  })
  assert.equal(nextResp.ok, true, `nextResp failed: ${JSON.stringify(nextResp)}`)
  assert.equal(host.getSnapshot().track?.id, 'track-102')
  assert.equal(host.getSnapshot().queue?.index, 1)

  // 5. Query queue page via standard CoreRequestEnvelope ('queue.page')
  const queueRef = host.getSnapshot().queue
  assert.ok(queueRef, 'Active queue reference must exist')
  const pageResp = await sendRequestAndWait(host, {
    kind: 'query',
    requestId: 'req-queue-page-1',
    epoch: host.epoch,
    name: 'queue.page',
    payload: {
      id: queueRef.id,
      revision: queueRef.revision,
      offset: 0,
      limit: 10,
    },
  })
  assert.equal(pageResp.ok, true, `pageResp failed: ${JSON.stringify(pageResp)}`)
  assert.equal(pageResp.value.items.length, 3)

  // 6. Trigger platform safety brake (e.g. Bluetooth A2DP disconnected / AudioNoisy)
  await host.triggerPlatformSafetyBrake('android.media.AUDIO_BECOMING_NOISY')
  assert.equal(host.getSnapshot().playback?.state, 'paused')

  // 7. Verify monotonic sequence numbers on emitted state messages
  assert.ok(stateSequences.length >= 4, 'Expected at least 4 state snapshots emitted')
  for (let i = 1; i < stateSequences.length; i += 1) {
    assert.ok(
      stateSequences[i] > stateSequences[i - 1],
      `State sequence must be strictly increasing (${stateSequences[i - 1]} -> ${stateSequences[i]})`,
    )
  }

  // 8. Shutdown & restore in a brand-new host instance sharing sessionStore
  await host.shutdown()
  unsubscribe()
  assert.ok(ports.getStoredSession(), 'Session store must contain persisted envelope after shutdown')

  const restoredHost = portableCore.createPortableMusicCoreHost({
    epoch: 'epoch-poc-2',
    platform: 'android',
    clock: ports.clock,
    sessionStore: ports.sessionStore,
    audioEngine: ports.audioEngine,
    initialSettings: {
      playbackResumeMode: 'trackAndPosition',
    },
  })
  await restoredHost.initialize()
  const restoredSnap = restoredHost.getSnapshot()
  assert.equal(restoredSnap.phase, 'ready')
  assert.equal(restoredSnap.queue?.total, 3)
  assert.equal(restoredSnap.track?.id, 'track-102')
  assert.equal(restoredSnap.playback?.playMode, 'listLoop')
  await restoredHost.shutdown()
})
