import test from 'node:test'
import assert from 'node:assert/strict'
import { NcmClient, RequestPool } from '../lib/client.mjs'
const json = (data) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('comment pagination uses upstream count and offsets, not parsed count', async () => {
  const urls = []
  const client = new NcmClient({
    fetcher: async (url) => {
      urls.push(url)
      return json({
        code: 200,
        total: 50,
        more: true,
        comments: [{ commentId: 1, content: 'one' }, { bad: true }]
      })
    }
  })
  const page = await client.comments('1', 'latest', 20)
  assert.equal(page.nextOffset, 22)
  assert.equal(page.items.length, 1)
  assert.equal(page.hasMore, true)
  assert.match(urls[0], /offset=20/)
  client.close()
})

test('invalid JSON, upstream error, malformed lists and HTTP failures are explicit', async () => {
  for (const [response, pattern] of [
    [new Response('<html>bad</html>'), /非 JSON/],
    [json({ code: 301 }), /301/],
    [json({ code: 200, comments: {} }), /无效的评论/],
    [new Response('', { status: 503 }), /503/]
  ]) {
    const client = new NcmClient({ fetcher: async () => response })
    await assert.rejects(client.comments('1', 'latest'), pattern)
    client.close()
  }
})

test('pool shares work, caches it, and honours force refresh', async () => {
  let calls = 0,
    now = 0
  const pool = new RequestPool({ now: () => now })
  const work = async () => ++calls
  assert.deepEqual(
    await Promise.all([
      pool.request('key', work, { ttl: 100 }),
      pool.request('key', work, { ttl: 100 })
    ]),
    [1, 1]
  )
  await tick()
  assert.equal(await pool.request('key', work, { ttl: 100 }), 1)
  assert.equal(await pool.request('key', work, { force: true, ttl: 100 }), 2)
  await tick()
  now = 101
  assert.equal(await pool.request('key', work, { ttl: 100 }), 3)
  pool.close()
})

test('pool caps concurrency at two and cancels queued and active subscribers', async () => {
  const pool = new RequestPool()
  let active = 0,
    maximum = 0
  const releases = []
  const work = (signal) =>
    new Promise((resolve, reject) => {
      active++
      maximum = Math.max(maximum, active)
      const finish = () => {
        active--
        resolve('ok')
      }
      releases.push(finish)
      signal.addEventListener(
        'abort',
        () => {
          active--
          reject(signal.reason)
        },
        { once: true }
      )
    })
  const first = new AbortController(),
    queued = new AbortController()
  const one = pool.request('one', work, { signal: first.signal })
  const two = pool.request('two', work)
  const three = pool.request('three', work, { signal: queued.signal })
  const rejectedOne = assert.rejects(one, /取消/),
    rejectedThree = assert.rejects(three, /取消/)
  await tick()
  queued.abort()
  first.abort()
  await Promise.all([rejectedOne, rejectedThree])
  releases[1]()
  await two
  assert.equal(maximum, 2)
  assert.equal(releases.length, 2)
  pool.close()
})

test('a shared request survives one subscriber leaving, but times out', async () => {
  const pool = new RequestPool({ timeout: 20 })
  const controller = new AbortController()
  const work = () => new Promise(() => {})
  const one = pool.request('shared', work, { signal: controller.signal })
  const two = pool.request('shared', work)
  const rejectOne = assert.rejects(one, /取消/),
    rejectTwo = assert.rejects(two, /超时/)
  controller.abort()
  await Promise.all([rejectOne, rejectTwo])
  pool.close()
})

test('avatars are bounded, allowlisted data images; image/jpg is accepted', async () => {
  let count = 0
  const client = new NcmClient({
    fetcher: async () => {
      count++
      return new Response('image', { headers: { 'content-type': 'image/jpg' } })
    }
  })
  assert.equal(await client.image('https://example.test/private'), null)
  assert.equal(count, 0)
  assert.match(await client.image('http://p1.music.126.net/x.jpg'), /^data:image\/jpeg;base64,/)
  const large = new NcmClient({
    fetcher: async () =>
      new Response('x'.repeat(100000), { headers: { 'content-type': 'image/jpeg' } })
  })
  await assert.rejects(large.image('https://p1.music.126.net/x.jpg'), /响应过大/)
  client.close()
  large.close()
})
