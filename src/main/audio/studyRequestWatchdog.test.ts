import assert from 'node:assert/strict'
import test from 'node:test'
import { StudyRequestWatchdog, STUDY_WATCHDOG } from './studyRequestWatchdog.ts'

test('heartbeat liveness cannot disguise stalled executor or child progress', () => {
  const clock = new StudyRequestWatchdog(0, 'analyze', 10, true)
  for (let now = 0; now < 180000; now += 2000) {
    clock.heartbeat(now, 1); clock.progress(now, 1, 'child')
    assert.equal(clock.expired(now), null)
  }
  clock.heartbeat(180000, 1); clock.progress(180000, 1, 'child')
  assert.match(clock.expired(180000)!, /没有进展/)
})
test('duration-scaled CPU work, cancellation grace and resume use separate clocks', () => {
  const cpu = new StudyRequestWatchdog(0, 'analyze', 180, false)
  assert.equal(cpu.budgetMs, 5400000)
  cpu.heartbeat(0); assert.match(cpu.expired(30000)!, /心跳/)
  cpu.resume(40000); assert.equal(cpu.expired(40000), null)
  cpu.cancel(40000); cpu.heartbeat(44999); assert.equal(cpu.expired(44999), null)
  assert.match(cpu.expired(45000)!, /取消/)
  const cold = new StudyRequestWatchdog(0, 'warm', 0, true)
  assert.equal(cold.budgetMs, STUDY_WATCHDOG.warmupMs)
  assert.match(cold.expired(180000)!, /启动/)
})

test('a healthy parent cannot hide a silent owned vocal child', () => {
  const clock = new StudyRequestWatchdog(0, 'analyze', 180, true)
  clock.childStarted(0, 42)
  clock.childHeartbeat(2000, 42, 1)
  for (let now = 2000; now <= 30000; now += 2000) {
    clock.heartbeat(now, now)
    assert.equal(clock.expired(now), null)
  }
  clock.heartbeat(32000, 32000)
  assert.match(clock.expired(32000)!, /人声/)
  clock.childFinished(42)
  assert.equal(clock.expired(32000), null)
})
