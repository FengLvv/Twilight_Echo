import assert from 'node:assert/strict'
import test from 'node:test'
import { LeasedLru } from './leasedLru.ts'

test('200 sequential results plateau; current and export leases survive eviction', () => {
  const evicted: string[] = []
  const cache = new LeasedLru<string, number>({ bytes: 12, entries: 3 }, id => evicted.push(id))
  const current = cache.retain('current'), exporting = cache.retain('export')
  cache.set('current', 1, 4); cache.set('export', 2, 4)
  for (let i = 0; i < 200; i++) cache.set('song-' + i, i, 4)
  assert.equal(cache.get('current'), 1); assert.equal(cache.get('export'), 2)
  assert.equal(cache.metrics().entries, 3); assert.equal(cache.metrics().estimatedBytes, 12)
  assert.equal(evicted.length, 199)
  current(); exporting()
  cache.set('last', 4, 12)
  assert.equal(cache.metrics().entries, 1); assert.equal(cache.metrics().overBudget, false)
})
test('over-budget pinned results are reclaimed only after final idempotent release', () => {
  const cache = new LeasedLru<string, object>({ bytes: 1, entries: 1 })
  const scope = cache.scope(); scope.retain('large'); scope.retain('large')
  cache.set('large', {}, 100)
  assert.equal(cache.metrics().protectedBytes, 100); assert(cache.metrics().overBudget)
  scope.dispose(); scope.dispose()
  assert.equal(cache.metrics().entries, 0)
})
