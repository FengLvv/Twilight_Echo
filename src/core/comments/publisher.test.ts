import assert from 'node:assert/strict'
import test from 'node:test'
import { NativeCommentPublisher } from './publisher.ts'
import { NcmClient } from './client.mjs'
import { validCommentPublish } from '../../shared/ncmComments.ts'

const request = {
  songId: '42',
  content: '  喜欢这首歌 🎵\n一直在听  ',
  submissionId: 'send-1',
  accountContext: 'account-1'
}
function fixture(
  response: unknown = {
    code: 200,
    comment: { commentId: 77, content: '喜欢这首歌', user: { nickname: 'User' } }
  }
) {
  const calls: { path: string; cookie: string }[] = []
  let context = 'account-1',
    loggedIn = true
  const publisher = new NativeCommentPublisher({
    context: () => context,
    session: async () => ({ loggedIn, cookie: loggedIn ? 'MUSIC_U=test-only' : undefined }),
    request: async (path, cookie) => {
      calls.push({ path, cookie })
      return response
    },
    now: () => 1234
  })
  return {
    publisher,
    calls,
    changeAccount() {
      context = 'account-2'
    },
    logout() {
      loggedIn = false
    }
  }
}
test('authenticated publish uses the fixed song-add endpoint and normalizes the accepted comment', async () => {
  const f = fixture()
  assert.deepEqual(await f.publisher.account(), { loggedIn: true, context: 'account-1' })
  const result = await f.publisher.publish(request)
  assert.equal(result.status, 'published')
  if (result.status === 'published') assert.equal(result.comment?.id, '77')
  const url = new URL(f.calls[0].path, 'https://local.invalid')
  assert.equal(url.pathname, '/comment')
  assert.equal(url.searchParams.get('t'), '1')
  assert.equal(url.searchParams.get('type'), '0')
  assert.equal(url.searchParams.get('id'), '42')
  assert.equal(url.searchParams.get('content'), request.content.trim())
  assert.equal(f.calls[0].cookie, 'MUSIC_U=test-only')
  assert.ok(!JSON.stringify(result).includes('MUSIC_U'))
})
test('parallel and completed duplicate submissions perform only one external write', async () => {
  const f = fixture()
  const results = await Promise.all([f.publisher.publish(request), f.publisher.publish(request)])
  assert.deepEqual(results[0], results[1])
  await f.publisher.publish(request)
  assert.equal(f.calls.length, 1)
  await assert.rejects(f.publisher.publish({ ...request, content: 'Different' }), /重新确认/)
  assert.equal(f.calls.length, 1)
})
test('unknown network outcomes remain unknown without automatic or duplicate replay', async () => {
  for (const response of [{ code: -1 }, null, { code: 'invalid' }]) {
    const f = fixture(response)
    assert.equal((await f.publisher.publish(request)).status, 'unknown')
    assert.equal((await f.publisher.publish(request)).status, 'unknown')
    assert.equal(f.calls.length, 1)
  }
})
test('logged-out, changed-account and expired sessions reject without sending as another account', async () => {
  const signedOut = fixture()
  signedOut.logout()
  assert.equal((await signedOut.publisher.publish(request)).status, 'rejected')
  assert.equal(signedOut.calls.length, 0)
  const changed = fixture()
  changed.changeAccount()
  assert.equal((await changed.publisher.publish(request)).status, 'rejected')
  assert.equal(changed.calls.length, 0)
  const expired = fixture({ code: 301 })
  assert.equal((await expired.publisher.publish(request)).status, 'rejected')
  assert.equal(expired.calls.length, 1)
})
test('cancellation before dispatch and account change during verification do not post', async () => {
  const aborted = new AbortController()
  aborted.abort()
  const f = fixture()
  await assert.rejects(async () => f.publisher.publish(request, aborted.signal), {
    name: 'AbortError'
  })
  assert.equal(f.calls.length, 0)
  let context = 'account-1',
    calls = 0
  const publisher = new NativeCommentPublisher({
    context: () => context,
    session: async () => {
      context = 'account-2'
      return { loggedIn: true, cookie: 'test' }
    },
    request: async () => {
      calls++
      return { code: 200 }
    }
  })
  assert.equal((await publisher.publish(request)).status, 'rejected')
  assert.equal(calls, 0)
})
test('publication bounds reject whitespace, invalid IDs, excess code points and arbitrary API/cookie fields', () => {
  assert.equal(validCommentPublish({ ...request, content: '🎵'.repeat(140) }), true)
  for (const patch of [
    { content: ' ' },
    { content: '🎵'.repeat(141) },
    { content: '\0x' },
    { songId: '42&delete=1' },
    { submissionId: '' },
    { accountContext: '' },
    { cookie: 'secret' },
    { t: '0' },
    { path: '/like' }
  ]) {
    assert.equal(validCommentPublish({ ...request, ...patch }), false)
  }
})
test('publication invalidation bypasses cached comment pages', async () => {
  let calls = 0
  const client = new NcmClient({
    fetcher: async () => {
      calls++
      return new Response(JSON.stringify({ code: 200, comments: [], total: calls }))
    }
  })
  const signal = new AbortController().signal
  assert.equal((await client.comments('42', 'latest', 0, signal)).total, 1)
  assert.equal((await client.comments('42', 'latest', 0, signal)).total, 1)
  client.invalidateComments('42')
  assert.equal((await client.comments('42', 'latest', 0, signal)).total, 2)
  client.close()
})

test('publication invalidation cancels stale reads without poisoning a fresh page', async () => {
  let finish!: (response: Response) => void
  let calls = 0
  const client = new NcmClient({
    fetcher: async () => {
      calls++
      if (calls === 1)
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      return new Response(JSON.stringify({ code: 200, comments: [], total: 2 }))
    }
  })
  const signal = new AbortController().signal
  const old = client.comments('42', 'latest', 0, signal)
  const rejected = assert.rejects(old, /取消/)
  await new Promise((resolve) => setImmediate(resolve))
  client.invalidateComments('42')
  await rejected
  assert.equal((await client.comments('42', 'latest', 0, signal)).total, 2)
  finish(new Response(JSON.stringify({ code: 200, comments: [], total: 1 })))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await client.comments('42', 'latest', 0, signal)).total, 2)
  client.close()
})
