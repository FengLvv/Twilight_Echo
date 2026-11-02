import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { setImmediate as settle } from 'node:timers/promises'
import { usePlaylistSubscription } from './usePlaylistSubscription.ts'
import type {
  MediaProviderPlaylistSummary,
  MediaProviderPlaylistSubscriptionState
} from '../../../../shared/providerSearch.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { resolve, reject, promise }
}
function fixture() {
  const scope = effectScope()
  const playlist = ref<MediaProviderPlaylistSummary | null>({
    id: 7,
    name: '歌单',
    cover: null,
    trackCount: 5
  })
  const enabled = ref(true),
    account = ref(1)
  let fetchState = async (
    _id: number | string
  ): Promise<MediaProviderPlaylistSubscriptionState> => ({ owned: false, subscribed: false })
  let subscribe = async (_playlist: MediaProviderPlaylistSummary, _value: boolean) => {}
  const controller = scope.run(() =>
    usePlaylistSubscription({
      playlist: () => playlist.value,
      enabled: () => enabled.value,
      scope: () => account.value,
      captureSession: () => {
        const id = account.value
        return () => id === account.value
      },
      fetchState: (id) => fetchState(id),
      subscribe: (playlist, value) => subscribe(playlist, value)
    })
  )!
  return {
    controller,
    playlist,
    enabled,
    account,
    stop: () => scope.stop(),
    fetch: (value: typeof fetchState) => {
      fetchState = value
    },
    write: (value: typeof subscribe) => {
      subscribe = value
    }
  }
}

test('playlist toggle waits for the cloud, blocks repeated clicks and retains state on rejection', async (t) => {
  const f = fixture()
  t.after(f.stop)
  await settle()
  const pending = deferred<void>(),
    calls: boolean[] = []
  f.write(async (_, value) => {
    calls.push(value)
    await pending.promise
  })
  const operation = f.controller.toggle()
  assert.equal(f.controller.control.value?.busy, true)
  assert.equal(f.controller.control.value?.subscribed, false)
  await f.controller.toggle()
  assert.deepEqual(calls, [true])
  pending.resolve()
  await operation
  assert.equal(f.controller.control.value?.subscribed, true)
  f.write(async (_, value) => {
    assert.equal(value, false)
    throw Error('请求被拒绝')
  })
  await f.controller.toggle()
  assert.equal(f.controller.control.value?.subscribed, true)
  assert.match(f.controller.control.value!.error, /请求被拒绝/)
})

test('own playlists and signed-out providers have no subscription control', async (t) => {
  const f = fixture()
  t.after(f.stop)
  await settle()
  f.playlist.value = { ...f.playlist.value!, id: 8, owned: true }
  assert.equal(f.controller.control.value, undefined)
  f.playlist.value = { ...f.playlist.value!, id: 9, owned: undefined }
  f.fetch(async () => ({ owned: true, subscribed: false }))
  f.playlist.value = { ...f.playlist.value!, id: 10 }
  await settle()
  assert.equal(f.controller.control.value, undefined)
  f.enabled.value = false
  assert.equal(f.controller.control.value, undefined)
})

test('late reads and writes cannot affect a different playlist or account', async (t) => {
  const f = fixture()
  t.after(f.stop)
  await settle()
  const oldRead = deferred<MediaProviderPlaylistSubscriptionState>()
  f.fetch(async (id) => (id === 8 ? oldRead.promise : { owned: false, subscribed: true }))
  f.playlist.value = { ...f.playlist.value!, id: 8 }
  f.playlist.value = { ...f.playlist.value!, id: 9 }
  await settle()
  oldRead.resolve({ owned: false, subscribed: false })
  await settle()
  assert.equal(f.controller.control.value?.subscribed, true)
  const oldWrite = deferred<void>()
  f.write(async () => oldWrite.promise)
  const operation = f.controller.toggle()
  f.account.value = 2
  await settle()
  oldWrite.resolve()
  await operation
  assert.equal(f.controller.control.value?.subscribed, true)
  assert.equal(f.controller.control.value?.busy, false)
})

test('unknown cloud state is retried before a write, and unmount fences pending reads', async (t) => {
  const f = fixture()
  t.after(f.stop)
  await settle()
  let writes = 0
  f.write(async () => {
    writes++
  })
  f.fetch(async () => {
    throw Error('网络故障')
  })
  f.playlist.value = { ...f.playlist.value!, id: 8 }
  await settle()
  assert.equal(f.controller.control.value?.retry, true)
  f.fetch(async () => ({ owned: false, subscribed: true }))
  await f.controller.toggle()
  assert.equal(writes, 0)
  assert.equal(f.controller.control.value?.subscribed, true)
  const pending = deferred<MediaProviderPlaylistSubscriptionState>()
  f.fetch(async () => pending.promise)
  f.playlist.value = { ...f.playlist.value!, id: 9 }
  f.stop()
  pending.resolve({ owned: false, subscribed: true })
  await settle()
  assert.equal(f.controller.control.value?.subscribed, false)
})
