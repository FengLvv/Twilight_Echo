const assert = require('node:assert/strict')
const test = require('node:test')
const { PortError, createEmbeddedHarness, createFakePlatform } = require('./portable-embedded-harness.cjs')

async function harness() {
  let rejected = false
  const platform = createFakePlatform({
    'audioEngine.setDspConfig': ({ configJson }) => {
      if (rejected) throw new PortError('FAILED', 'IR missing')
      platform.appliedDsp = JSON.parse(configJson)
      return true
    }
  })
  Object.assign(platform.audio, {
    state: 'playing', actualSampleRate: 48000, actualBitDepth: 32, actualChannels: 2,
    outputPerfect: false, dspActive: true, gaplessActive: false, preloadReady: false,
    crossfadeMixActive: true, crossfadeEffectiveSeconds: 2.3, perfectReasonCode: 'shared_mixer'
  })
  let h = createEmbeddedHarness({ platform })
  await h.boot({ epoch: 'dsp-test' })
  return {
    // A restart is a fresh engine evaluating the same bundle over the same platform store.
    async boot() {
      h = createEmbeddedHarness({ platform })
      await h.boot({ epoch: 'dsp-test' })
    },
    request: (name, payload = {}, kind = 'command') => h.request(name, payload, kind),
    reject() { rejected = true },
    get applied() { return platform.appliedDsp },
    get stored() { return JSON.parse(platform.stored) }
  }
}

test('embedded DSP edits survive EQ-only legacy patches and a runtime restart', async () => {
  const h = await harness()
  const config = (await h.request('audio.getEq', {}, 'query')).value
  config.dsp.nodes = [{ id: 'cf', type: 'crossfeed', enabled: true, params: { strength: 0.42 } }]
  config.dsp.eqMode = 'parametric'
  config.dsp.crossfadeSeconds = 5
  assert.equal((await h.request('audio.setEq', config)).ok, true)
  assert.equal((await h.request('audio.setEq', { enabled: true, preampDb: -4 })).ok, true)
  assert.equal(h.applied.dsp.nodes[0].params.strength, 0.42)
  await h.boot()
  assert.equal(h.applied.preampDb, -4)
  assert.equal(h.applied.dsp.eqMode, 'parametric')
  assert.equal(h.applied.dsp.crossfadeSeconds, 5)
})

test('rejected native graph edits neither change desired state nor persist them', async () => {
  const h = await harness()
  await h.request('audio.setEq', { preampDb: -2 })
  h.reject()
  const response = await h.request('audio.setEq', { preampDb: -8 })
  assert.equal(response.ok, false)
  assert.equal(response.error.message, 'IR missing')
  assert.equal((await h.request('audio.getEq', {}, 'query')).value.preampDb, -2)
  assert.equal(h.stored.eqConfig.preampDb, -2)
})

test('unsupported or duplicate DSP processors are rejected before the native port', async () => {
  const h = await harness()
  const config = (await h.request('audio.getEq', {}, 'query')).value
  config.dsp.nodes = [{ id: 'vst', type: 'vst3Plugin', enabled: true, params: {} }]
  assert.equal((await h.request('audio.setEq', config)).ok, false)
  config.dsp.nodes = ['a', 'b'].map(id => ({ id, type: 'crossfeed', enabled: true, params: {} }))
  assert.equal((await h.request('audio.setEq', config)).ok, false)
})

test('playback projects measured native state rather than requested preferences', async () => {
  const h = await harness()
  const playback = (await h.request('core.getSnapshot', {}, 'query')).value.playback
  assert.equal(playback.outputPerfect, false)
  assert.equal(playback.gaplessActive, false)
  assert.equal(playback.preloadReady, false)
  assert.equal(playback.dspActive, true)
  assert.equal(playback.crossfadeMixActive, true)
  assert.equal(playback.crossfadeEffectiveSeconds, 2.3)
  assert.equal(playback.perfectReasonCode, 'shared_mixer')
})
