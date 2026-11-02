import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'
import type { ProviderInfo } from '../../stores/useProviderStore.ts'
import { useStreamingHomeEntries } from './useStreamingHomeEntries.ts'
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
function fixture() {
  const scope = effectScope(),
    enabled = ref(true)
  const provider = ref<ProviderInfo>({
    id: 'ncm',
    name: 'NCM',
    capabilities: ['login'],
    supportedMethods: [
      'fetchRecommendSongs',
      'fetchIntelligenceList',
      'fetchLikedTracksPage',
      'fetchUserLibrary',
      'fetchPersonalFm',
      'fetchPrivateContent'
    ]
  })
  const calls: Array<{ name: string; payload: unknown; signal?: AbortSignal }> = []
  const state = { loggedIn: true, daily: 0, login: '', blocked: null as Promise<void> | null }
  const home = scope.run(() =>
    useStreamingHomeEntries({
      provider,
      enabled,
      checkLogin: async () => ({ loggedIn: state.loggedIn, profile: null }),
      login: (id) => {
        state.login = id
      },
      openDaily: async () => {
        state.daily++
      },
      command: async (name, payload, signal) => {
        calls.push({ name, payload, signal })
        if (state.blocked) await state.blocked
      }
    })
  )!
  return { scope, enabled, provider, calls, state, home }
}
test('recommendation entry construction performs no eager playback or FM requests', () => {
  const f = fixture()
  assert.deepEqual(
    f.home.entries.value.map((entry) => entry.id),
    ['daily', 'heart', 'radar', 'fm']
  )
  assert.deepEqual(f.calls, [])
  f.provider.value = { ...f.provider.value, id: 'other' }
  assert.deepEqual(f.home.entries.value, [])
  f.scope.stop()
})
test('signed-out entries request login and do not open private details or replace the queue', async () => {
  const f = fixture()
  f.state.loggedIn = false
  await f.home.open('heart')
  await f.home.open('daily')
  assert.equal(f.state.login, 'ncm')
  assert.equal(f.state.daily, 0)
  assert.deepEqual(f.calls, [])
  f.scope.stop()
})
test('daily uses the existing detail view; heart, radar and FM use Core-owned sessions', async () => {
  const f = fixture()
  await f.home.open('daily')
  assert.equal(f.state.daily, 1)
  assert.deepEqual(f.calls, [])
  await f.home.open('heart')
  await f.home.open('radar')
  await f.home.open('fm')
  assert.deepEqual(
    f.calls.map(({ name, payload }) => ({ name, payload })),
    [
      { name: 'liked.play', payload: { mode: 'heart', play: true } },
      { name: 'personalized.start', payload: { key: 'radar', providerId: 'ncm', play: true } },
      { name: 'personalized.start', payload: { key: 'fm', providerId: 'ncm', play: true } }
    ]
  )
  f.scope.stop()
})
test('a pending entry cannot be submitted twice and source changes cancel its request', async () => {
  const f = fixture()
  let finish!: () => void
  f.state.blocked = new Promise<void>((resolve) => {
    finish = resolve
  })
  const first = f.home.open('fm')
  await tick()
  await f.home.open('fm')
  assert.equal(f.calls.length, 1)
  f.provider.value = { ...f.provider.value, id: 'other' }
  assert.equal(f.calls[0].signal?.aborted, true)
  finish()
  await first
  assert.equal(f.home.pending.value, null)
  assert.equal(f.home.error.value, '')
  f.scope.stop()
})
test('leaving the recommendation page cancels pending work without replaying it on return', async () => {
  const f = fixture()
  let finish!: () => void
  f.state.blocked = new Promise<void>((resolve) => {
    finish = resolve
  })
  const first = f.home.open('heart')
  await tick()
  f.enabled.value = false
  assert.equal(f.calls[0].signal?.aborted, true)
  finish()
  await first
  f.enabled.value = true
  assert.equal(f.calls.length, 1)
  f.scope.stop()
})
