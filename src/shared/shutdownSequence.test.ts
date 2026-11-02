import assert from 'node:assert/strict'
import test from 'node:test'
import { ShutdownSequence } from './shutdownSequence.ts'

test('concurrent shutdown joins; a failed process owner retains downstream storage and resumes explicitly', async () => {
  const calls: string[] = []
  let confirmed = false
  const lifecycle = new ShutdownSequence([
    { name: 'requests', close: () => { calls.push('requests') } },
    { name: 'worker', close: async () => { calls.push('worker'); if (!confirmed) throw new Error('unconfirmed') } },
    { name: 'database', close: () => { calls.push('database') } }
  ])
  const first = lifecycle.close()
  assert.equal(lifecycle.close(), first)
  await assert.rejects(first, /unconfirmed/)
  assert.equal(lifecycle.current, 'worker')
  assert.deepEqual(calls, ['requests', 'worker'])
  confirmed = true
  await lifecycle.close()
  await lifecycle.close()
  assert.equal(lifecycle.current, null)
  assert.deepEqual(calls, ['requests', 'worker', 'worker', 'database'])
})
