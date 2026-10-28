const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function harness() {
  let stored = null, rejected = false, applied = null
  const audio = { state: 'playing', actualSampleRate: 48000, actualBitDepth: 32, actualChannels: 2,
    outputPerfect: false, dspActive: true, gaplessActive: false, preloadReady: false,
    crossfadeMixActive: true, crossfadeEffectiveSeconds: 2.3, perfectReasonCode: 'shared_mixer' }
  const sandbox = { setTimeout, clearTimeout, __TWILIGHT_HOST_BRIDGE__: {
    invokePort(port, method, raw) {
      const args = JSON.parse(raw)
      if (port === 'sessionStore' && method === 'load') return JSON.stringify({ ok: true, value: stored && { revision: '1', payloadJson: stored } })
      if (port === 'sessionStore' && method === 'save') { stored = args.payloadJson; return JSON.stringify({ ok: true, value: { ok: true, revision: '1' } }) }
      if (port === 'audioEngine' && method === 'getSnapshot') return JSON.stringify({ ok: true, value: audio })
      if (port === 'audioEngine' && method === 'setDspConfig') {
        if (rejected) return JSON.stringify({ ok: false, error: { code: 'FAILED', message: 'IR missing' } })
        applied = JSON.parse(args.configJson)
      }
      return JSON.stringify({ ok: true, value: true })
    }, emitCoreEvent() {}
  } }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../dist/portable-core/music-core.js'), 'utf8'), sandbox)
  const core = sandbox.__TWILIGHT_PORTABLE_CORE__
  const boot = () => core.bootHost(JSON.stringify({ epoch: 'dsp-test' }))
  const request = (name, payload = {}, kind = 'command') => JSON.parse(core.handleRequest(JSON.stringify({ kind, requestId: 'dsp', epoch: 'dsp-test', name, payload })))
  boot()
  return { boot, request, reject() { rejected = true }, get applied() { return applied }, get stored() { return JSON.parse(stored) } }
}

test('embedded DSP edits survive EQ-only legacy patches and a runtime restart', () => {
  const h = harness()
  const config = h.request('audio.getEq', {}, 'query').value
  config.dsp.nodes = [{ id: 'cf', type: 'crossfeed', enabled: true, params: { strength: 0.42 } }]
  config.dsp.eqMode = 'parametric'
  config.dsp.crossfadeSeconds = 5
  assert.equal(h.request('audio.setEq', config).ok, true)
  assert.equal(h.request('audio.setEq', { enabled: true, preampDb: -4 }).ok, true)
  assert.equal(h.applied.dsp.nodes[0].params.strength, 0.42)
  h.boot()
  assert.equal(h.applied.preampDb, -4)
  assert.equal(h.applied.dsp.eqMode, 'parametric')
  assert.equal(h.applied.dsp.crossfadeSeconds, 5)
})

test('rejected native graph edits neither change desired state nor persist them', () => {
  const h = harness()
  h.request('audio.setEq', { preampDb: -2 })
  h.reject()
  const response = h.request('audio.setEq', { preampDb: -8 })
  assert.equal(response.ok, false)
  assert.equal(response.error.message, 'IR missing')
  assert.equal(h.request('audio.getEq', {}, 'query').value.preampDb, -2)
  assert.equal(h.stored.eqConfig.preampDb, -2)
})

test('unsupported or duplicate DSP processors are rejected before the native port', () => {
  const h = harness()
  const config = h.request('audio.getEq', {}, 'query').value
  config.dsp.nodes = [{ id: 'vst', type: 'vst3Plugin', enabled: true, params: {} }]
  assert.equal(h.request('audio.setEq', config).ok, false)
  config.dsp.nodes = ['a', 'b'].map(id => ({ id, type: 'crossfeed', enabled: true, params: {} }))
  assert.equal(h.request('audio.setEq', config).ok, false)
})

test('playback projects measured native state rather than requested preferences', () => {
  const h = harness()
  const playback = h.request('core.getSnapshot', {}, 'query').value.playback
  assert.equal(playback.outputPerfect, false)
  assert.equal(playback.gaplessActive, false)
  assert.equal(playback.preloadReady, false)
  assert.equal(playback.dspActive, true)
  assert.equal(playback.crossfadeMixActive, true)
  assert.equal(playback.crossfadeEffectiveSeconds, 2.3)
  assert.equal(playback.perfectReasonCode, 'shared_mixer')
})
