import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../StreamingPage.vue', import.meta.url), 'utf8')
const start = source.indexOf('async function toggleCurrentDetailFollow(): Promise<void> {')
const end = source.indexOf('\nfunction goBack()', start)
assert(start >= 0 && end > start)
const implementation = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function fixture() {
  const account = { value: 1 }
  const makeDetail = (id: number) => ({ type: 'artist', artist: { id } })
  const controls = {
    calls: [] as Array<[number, boolean]>,
    write: async (_id: number, _value: boolean) => {},
    read: async (): Promise<boolean | null> => true
  }
  const context = {
    currentDetail: { value: makeDetail(1) },
    showDetailFollowButton: { value: true },
    followActionLoading: { value: false },
    followActionError: { value: '' },
    artistFollowed: { value: false as boolean | null },
    detailFollowState: { value: false },
    detailProviderId: { value: 'ncm' },
    NCM_PROVIDER_ID: 'ncm',
    mediaProviders: { getGeneration: () => 1 },
    captureNcmSession: () => { const id = account.value; return () => id === account.value },
    fetchArtistFollowState: () => controls.read(),
    followArtist: async (id: number, value: boolean) => { controls.calls.push([id, value]); await controls.write(id, value) },
    followUser: async () => {},
    friendlyStreamingError: (error: Error) => error.message
  }
  const toggle = new Function(...Object.keys(context), implementation + ';return toggleCurrentDetailFollow;')(...Object.values(context)) as () => Promise<void>
  return { ...context, controls, account, makeDetail, toggle }
}

test('follow actions await acknowledgement, block repeat clicks and show rejection without flipping state', async () => {
  const f = fixture()
  let reject!: (error: Error) => void
  f.controls.write = () => new Promise<void>((_resolve, no) => { reject = no })
  const write = f.toggle()
  assert.equal(f.followActionLoading.value, true)
  assert.equal(f.artistFollowed.value, false)
  await f.toggle(); assert.deepEqual(f.controls.calls, [[1, true]])
  reject(Error('权限不足')); await write
  assert.equal(f.artistFollowed.value, false)
  assert.equal(f.followActionError.value, '权限不足')
  assert.equal(f.followActionLoading.value, false)
})

test('late follow success or failure cannot touch a different artist or account', async () => {
  for (const change of ['artist', 'account']) {
    for (const failed of [false, true]) {
      const f = fixture()
      let finish!: () => void
      f.controls.write = () => new Promise<void>(resolve => { finish = resolve }).then(() => { if (failed) throw Error('旧请求失败') })
      const write = f.toggle()
      if (change === 'artist') f.currentDetail.value = f.makeDetail(2)
      else f.account.value = 2
      f.followActionError.value = '新页面状态'
      f.followActionLoading.value = false
      finish(); await write
      assert.equal(f.artistFollowed.value, false)
      assert.equal(f.followActionError.value, '新页面状态')
      assert.equal(f.followActionLoading.value, false)
    }
  }
})

test('an unknown follow state only retries the read and never guesses an account mutation', async () => {
  const f = fixture()
  f.artistFollowed.value = null; f.controls.read = async () => null
  await f.toggle()
  assert.deepEqual(f.controls.calls, [])
  assert.match(f.followActionError.value, /无法确认/)
  f.controls.read = async () => true
  await f.toggle()
  assert.equal(f.artistFollowed.value, true)
  assert.deepEqual(f.controls.calls, [])
})
