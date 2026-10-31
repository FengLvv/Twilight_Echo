import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAgentBridge } from './bridge.ts'
import { listCoreOperations } from '../../shared/coreProtocol.ts'

async function fixture(t: test.TestContext) {
  const profile = await mkdtemp(join(tmpdir(),'twilight-agent-'))
  let calls = 0
  const bridge = await startAgentBridge({profile,version:'test',executable:process.execPath,manifest:{operations:[]},
    snapshot:()=>({phase:'ready'}),request:async(name,payload)=>({name,payload,calls:++calls}),
    custom:{'agent.test':{kind:'command',description:'test',inputSchema:{type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false},run:async(payload)=>({payload,calls:++calls})}}})
  const endpoint = JSON.parse(await readFile(bridge.discovery,'utf8'))
  t.after(async()=>{await bridge.stop();await rm(profile,{recursive:true,force:true})})
  const request = async(route: string, body?: unknown, headers: Record<string,string>={}) => {
    const response = await fetch(endpoint.url+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+endpoint.token,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})
    return {status:response.status,...await response.json() as object}
  }
  return {profile,bridge,endpoint,request,calls:()=>calls}
}
test('authenticated introspection contains every actual registered operation',async t=>{
  const f=await fixture(t)
  const result=await f.request('/capabilities') as any
  assert.equal(result.status,200)
  assert.equal(result.value.operations.length,listCoreOperations().length+1)
  assert(!JSON.stringify(result).includes(f.endpoint.token))
  assert.equal((await f.request('/status') as any).value.snapshot.phase,'ready')
  assert.equal((await f.request('/describe?name=study.submit') as any).value.kind,'command')
})
test('rejects credentials, browser origins, unknown operations and malformed envelopes',async t=>{
  const f=await fixture(t)
  assert.equal((await f.request('/status',undefined,{authorization:'Bearer wrong'})).status,401)
  assert.equal((await f.request('/status',undefined,{origin:'https://example.com'})).status,403)
  assert.equal((await f.request('/rpc',{id:'x',operation:'not.real',payload:{}})).status,404)
  assert.equal((await f.request('/rpc',{id:'x',operation:'study.state',payload:[]})).status,400)
  assert.equal(f.calls(),0)
})
test('commands are idempotent by request id while queries remain fresh',async t=>{
  const f=await fixture(t)
  const command={id:'same',operation:'agent.test',payload:{name:'one'}}
  const [a,b]=await Promise.all([f.request('/rpc',command),f.request('/rpc',command)])
  assert.deepEqual(a,b)
  assert.equal(f.calls(),1)
  assert.equal((await f.request('/rpc',{...command,payload:{name:'two'}})).status,409)
  const query={id:'q',operation:'study.state',payload:{}}
  await f.request('/rpc',query);await f.request('/rpc',query)
  assert.equal(f.calls(),3)
})
test('custom schemas reject unknown fields and wrong types before executing',async t=>{
  const f=await fixture(t)
  for (const payload of [{},{name:4},{name:'ok',unexpected:true}]) {
    const response=await f.request('/rpc',{id:Math.random().toString(),operation:'agent.test',payload}) as any
    assert.equal(response.error.code,'INVALID_INPUT')
  }
  assert.equal(f.calls(),0)
})
test('shutdown removes only the discovery file owned by this instance',async t=>{
  const f=await fixture(t)
  await writeFile(f.bridge.discovery,JSON.stringify({...f.endpoint,instance:'newer'}))
  await f.bridge.stop()
  assert.equal(JSON.parse(await readFile(f.bridge.discovery,'utf8')).instance,'newer')
})
