import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequestScheduler } from './request-scheduler.mjs'

function clock() {
  let time=1000, next=0
  const timers=new Map()
  const scheduler=createRequestScheduler({now:()=>time,
    schedule:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:time+delay});return id},
    cancel:id=>timers.delete(id)})
  return {scheduler,timers,set:at=>{time=at},tick(ms){
    const end=time+ms
    for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0]
      if(!due)break
      time=due[1].at;timers.delete(due[0]);due[1].fn()}
    time=end
  }}
}

test('a click gets the next shared token ahead of queued background work without increasing the rate',async()=>{
  const c=clock(),order=[]
  await Promise.all(Array.from({length:5},()=>c.scheduler.acquire()))
  const background=Array.from({length:20},(_,i)=>c.scheduler.acquire().then(()=>order.push('background'+i)))
  const play=c.scheduler.acquire('playback').then(()=>order.push('play'))
  c.tick(199);await Promise.resolve();assert.deepEqual(order,[])
  c.tick(1);await play;assert.deepEqual(order,['play'])
  c.tick(4000);await Promise.all(background)
  assert.equal(order.length,21)
  assert.equal(c.timers.size,0)
})

test('sustained playback requests still yield to background work after four priority tokens',async()=>{
  const c=clock(),order=[]
  await Promise.all(Array.from({length:5},()=>c.scheduler.acquire()))
  const jobs=[c.scheduler.acquire().then(()=>order.push('normal')),
    ...Array.from({length:8},()=>c.scheduler.acquire('playback').then(()=>order.push('play')))]
  c.tick(1800);await Promise.all(jobs)
  assert.deepEqual(order.slice(0,5),['play','play','play','play','normal'])
})

test('cancelling a queued request removes it immediately and spends no token',async()=>{
  const c=clock(),controller=new AbortController()
  await Promise.all(Array.from({length:5},()=>c.scheduler.acquire()))
  const cancelled=c.scheduler.acquire('normal',controller.signal)
  const check=assert.rejects(cancelled,/cancelled/)
  controller.abort(new Error('cancelled'));await check
  assert.equal(c.timers.size,0)
  const play=c.scheduler.acquire('playback');c.tick(200);await play
})

test('session reset rejects queued credentials, removes timers and restores the burst budget',async()=>{
  const c=clock()
  await Promise.all(Array.from({length:5},()=>c.scheduler.acquire()))
  const wait=c.scheduler.acquire(),check=assert.rejects(wait,/session changed/)
  c.scheduler.reset();await check;assert.equal(c.timers.size,0)
  await Promise.all(Array.from({length:5},()=>c.scheduler.acquire()))
})

test('a backward wall clock cannot strand a queued playback request',async()=>{
  const c=clock()
  await Promise.all(Array.from({length:5},()=>c.scheduler.acquire()))
  c.set(500)
  const play=c.scheduler.acquire('playback');c.tick(200);await play
  assert.equal(c.timers.size,0)
})
