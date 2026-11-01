import test from 'node:test'
import assert from 'node:assert/strict'
import { StudyRuntimeResidency, STUDY_GPU_IDLE_MS } from './studyRuntimeResidency.ts'

test('DirectML-only and duet-only activity also arms idle reclamation', async () => {
  for (const model of ['tifa', 'game', 'duet']) {
    const f = fixture()
    f.invoke(method => Promise.resolve({ devices: { six: 'cuda', chords: 'cpu', [model]: method === 'standby' ? 'cpu' : model === 'duet' ? 'cuda' : 'dml' } }))
    await f.residency.run('analyze', {})
    await f.advance(STUDY_GPU_IDLE_MS)
    assert.equal(f.calls.at(-1), 'standby')
    await f.advance(STUDY_GPU_IDLE_MS)
    assert.equal(f.calls.length, 2)
  }
})

function fixture() {
  let now = 0, alive = true
  const timers = new Map<() => void, number>(), calls: string[] = [], states: any[] = [], failures: unknown[] = []
  let invoke = async (method: string, _signal?: AbortSignal): Promise<any> => ({ devices: { six: 'cuda', chords: method === 'standby' ? 'cpu' : 'cuda' } })
  const residency = new StudyRuntimeResidency({
    call: (method, _params, signal) => { calls.push(method); return invoke(method, signal) },
    alive: () => alive, changed: value => states.push(value), failed: error => failures.push(error),
    schedule: (callback, delay) => { timers.set(callback, now + delay); return () => { timers.delete(callback) } }
  })
  const settle = async () => { await new Promise<void>(done => setImmediate(done)) }
  const advance = async (milliseconds: number) => {
    now += milliseconds
    for (const [callback, due] of [...timers]) if (due <= now) { timers.delete(callback); callback() }
    await settle()
  }
  return { residency, calls, states, failures, advance, settle, invoke: (value: typeof invoke) => { invoke = value }, alive: (value: boolean) => { alive = value } }
}

test('idle placement changes only after 30 seconds, keeping six on CUDA', async () => {
  const f = fixture()
  await f.residency.run('warm', {})
  await f.advance(STUDY_GPU_IDLE_MS - 1); assert.deepEqual(f.calls, ['warm'])
  await f.advance(1); assert.deepEqual(f.calls, ['warm', 'standby'])
  assert.deepEqual(f.states.at(-1).devices, { six: 'cuda', chords: 'cpu' })
  await f.advance(STUDY_GPU_IDLE_MS * 10); assert.equal(f.calls.length, 2)
})

test('Core queue demand and downloads hold placement through gaps between RPC calls', async () => {
  const f = fixture()
  f.residency.setDemand(true)
  await f.residency.run('warm', {})
  await f.advance(120000); assert.deepEqual(f.calls, ['warm'])
  const release = f.residency.retain()
  f.residency.setDemand(false)
  await f.advance(120000); assert.deepEqual(f.calls, ['warm'])
  release(); release()
  await f.advance(29999); assert.equal(f.calls.length, 1)
  await f.advance(1); assert.equal(f.calls.at(-1), 'standby')
})

test('a long inference cannot be offloaded and a successful new task resets the deadline', async () => {
  const f = fixture()
  await f.residency.run('warm', {})
  let done!: (value: unknown) => void
  f.invoke(method => method === 'analyze' ? new Promise(resolve => { done = resolve }) : Promise.resolve({ devices: { six: 'cuda', chords: 'cpu' } }))
  const analysis = f.residency.run('analyze', {})
  await f.advance(90000); assert.deepEqual(f.calls, ['warm', 'analyze'])
  done({}); await analysis
  await f.advance(29999); assert.equal(f.calls.length, 2)
  await f.advance(1); assert.equal(f.calls.at(-1), 'standby')
})

test('new foreground work cancels a queued offload without cancelling the analysis', async () => {
  const f = fixture()
  await f.residency.run('warm', {})
  let standbySignal: AbortSignal | undefined
  f.invoke((method, signal) => {
    if (method !== 'standby') { assert(!signal?.aborted); return Promise.resolve({ devices: { six: 'cuda', chords: 'cuda' } }) }
    standbySignal = signal
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  })
  await f.advance(30000)
  f.residency.setDemand(true)
  await f.residency.run('analyze', {}, new AbortController().signal)
  assert(standbySignal?.aborted)
  assert.deepEqual(f.failures, [])
  assert.equal(f.states.at(-1).devices.chords, 'cuda')
})

test('shutdown fences a late standby result and never starts a replacement process', async () => {
  const f = fixture()
  await f.residency.run('warm', {})
  let done!: (value: unknown) => void
  f.invoke(() => new Promise(resolve => { done = resolve }))
  await f.advance(30000)
  const count = f.states.length
  f.residency.suspend(); f.alive(false)
  done({ devices: { six: 'cuda', chords: 'cpu' } }); await f.settle()
  assert.equal(f.states.length, count)
  f.residency.resume(); await f.advance(90000)
  assert.deepEqual(f.calls, ['warm', 'standby'])
})

test('CPU-only models do not create an idle CUDA maintenance loop', async () => {
  const f = fixture()
  f.invoke(async () => ({ devices: { six: 'cpu', chords: 'cpu' } }))
  await f.residency.run('warm', {})
  await f.advance(90000); assert.deepEqual(f.calls, ['warm'])
})
