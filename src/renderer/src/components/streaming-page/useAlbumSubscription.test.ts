import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, ref } from 'vue'
import { setImmediate as settle } from 'node:timers/promises'
import { useAlbumSubscription } from './useAlbumSubscription.ts'
import type { MediaProviderAlbumSummary } from '../../../../shared/providerSearch.ts'

test('album subscription fences account/navigation changes and only updates after acknowledgement', async t => {
  const scope = effectScope(); t.after(() => scope.stop())
  const album = ref<MediaProviderAlbumSummary>({ id: 123, name: 'A', cover: null, trackCount: 3 })
  const account = ref(1), enabled = ref(true), writes: Array<[number | string, boolean]> = []
  let reject = false, finish!: () => void
  const control = scope.run(() => useAlbumSubscription({ album: () => album.value,
    enabled: () => enabled.value, scope: () => account.value,
    captureSession: () => { const id = account.value; return () => id === account.value },
    fetchState: async () => ({ subscribed: false }),
    subscribe: async (item, value) => { writes.push([item.id, value]); await new Promise<void>(r => { finish = r }); if (reject) throw Error('拒绝收藏') }
  }))!
  await settle()
  const first = control.toggle()
  assert.equal(control.control.value?.busy, true)
  assert.equal(control.control.value?.subscribed, false)
  await control.toggle(); assert.deepEqual(writes, [[123,true]])
  finish(); await first; assert.equal(control.control.value?.subscribed, true)
  reject = true
  const failure = control.toggle(); finish(); await failure
  assert.equal(control.control.value?.subscribed, true)
  assert.match(control.control.value?.error ?? '', /拒绝收藏/)
  reject = false
  const old = control.toggle(); account.value = 2; album.value = { ...album.value, id: 456 }
  finish(); await old; await settle()
  assert.equal(control.control.value?.subscribed, false)
  assert.equal(control.control.value?.busy, false)
  enabled.value = false; assert.equal(control.control.value, undefined)
})

test('album state failure becomes retry and cannot submit a guessed subscribe state', async t => {
  const scope = effectScope(); t.after(() => scope.stop())
  let readable = false, writes = 0
  const album = { id: 123, name: 'A', cover: null, trackCount: 3 }
  const control = scope.run(() => useAlbumSubscription({ album: () => album,
    enabled: () => true, scope: () => 1, captureSession: () => () => true,
    fetchState: async () => { if (!readable) throw Error('读取失败'); return { subscribed: true } },
    subscribe: async () => { writes++ }
  }))!
  await settle(); assert.equal(control.control.value?.retry, true)
  readable = true; await control.toggle()
  assert.equal(writes, 0)
  assert.equal(control.control.value?.subscribed, true)
  assert.equal(control.control.value?.retry, false)
})
