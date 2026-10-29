import test from 'node:test'
import assert from 'node:assert/strict'
import { CommentsController } from '../ui/controller.js'
const track = (id) => ({ id, title: id, artist: 'artist', album: 'album', duration: 100 })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))
const page = (ids) => ({
  items: ids.map((id) => ({ id })),
  total: 10,
  nextOffset: 2,
  hasMore: true
})

test('rapid track switches discard stale resolutions and comment pages', async () => {
  const old = deferred()
  const controller = new CommentsController(async (op, args) => {
    if (op === 'resolve')
      return args.track.id === 'old'
        ? old.promise
        : { track: args.track, kind: 'explicit', song: { id: args.track.id } }
    if (op === 'comments') return page([args.songId])
  })
  const first = controller.setTrack(track('old'))
  await tick()
  await controller.setTrack(track('new'))
  old.resolve({ track: track('old'), song: { id: 'old' } })
  await first
  assert.equal(controller.state.track.id, 'new')
  assert.deepEqual(
    controller.state.items.map((item) => item.id),
    ['new']
  )
  const late = deferred()
  controller.call = async (op) => (op === 'comments' ? late.promise : null)
  const pending = controller.load(true)
  await tick()
  controller.dispose()
  late.resolve(page(['late']))
  await pending
  assert.deepEqual(
    controller.state.items.map((item) => item.id),
    ['new']
  )
})

test('failed next page preserves loaded comments and retry deduplicates', async () => {
  let attempt = 0
  const controller = new CommentsController(async (op) => {
    if (op !== 'comments') return null
    if (++attempt === 1) throw new Error('offline')
    return page(['1', '2'])
  })
  Object.assign(controller.state, {
    track: track('x'),
    association: { song: { id: '1' } },
    items: [{ id: '1' }],
    offset: 1
  })
  await controller.load(true)
  assert.equal(controller.state.error, 'offline')
  assert.equal(controller.state.items.length, 1)
  await controller.load(true)
  assert.deepEqual(
    controller.state.items.map((item) => item.id),
    ['1', '2']
  )
})

test('changing sort fences the prior pending page', async () => {
  const old = deferred()
  const controller = new CommentsController(async (op, args) =>
    op === 'comments' ? (args.sort === 'hot' ? old.promise : page(['latest'])) : null
  )
  controller.state.association = { song: { id: '1' } }
  const loading = controller.load()
  await tick()
  await controller.tab('latest')
  old.resolve(page(['hot']))
  await loading
  assert.equal(controller.state.tab, 'latest')
  assert.deepEqual(
    controller.state.items.map((item) => item.id),
    ['latest']
  )
})

test('retrying a failed refresh starts at page one while keeping the old list visible', async () => {
  const offsets = []
  const controller = new CommentsController(async (operation, args) => {
    if (operation !== 'comments') return null
    offsets.push(args.offset)
    if (offsets.length === 1) throw new Error('refresh failed')
    return page(['fresh'])
  })
  Object.assign(controller.state, {
    association: { song: { id: '1' } },
    items: [{ id: 'old' }],
    offset: 20
  })
  await controller.load(false, true)
  assert.deepEqual(
    controller.state.items.map((item) => item.id),
    ['old']
  )
  assert.equal(controller.state.retryMore, false)
  await controller.load(controller.state.retryMore, true)
  assert.deepEqual(offsets, [0, 0])
  assert.deepEqual(
    controller.state.items.map((item) => item.id),
    ['fresh']
  )
})
