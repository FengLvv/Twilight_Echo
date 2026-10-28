import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteDevicePairing, type RemoteTrustDocument } from './devicePairing.ts'
import { RemoteHttpServer } from './httpServer.ts'
import { createPersistentDevicePairing } from '../../main/remote/deviceTrust.ts'

test('only a desktop approval plus the private claim secret yields a device credential', () => {
  let now = 1000
  let saved: RemoteTrustDocument | undefined
  const pairing = new RemoteDevicePairing({ now: () => now, save: value => { saved = value } })
  const ticket = pairing.request('我的手机', '192.168.1.2')
  assert.equal(pairing.authorize(ticket.claimSecret), false)
  assert.equal(pairing.claim(ticket.requestId, 'wrong'), null)
  assert.deepEqual(pairing.claim(ticket.requestId, ticket.claimSecret), { state: 'pending' })
  assert.equal('claimSecret' in pairing.pending()[0], false)
  assert.equal(pairing.decide(ticket.requestId, true), true)
  const claim = pairing.claim(ticket.requestId, ticket.claimSecret)!
  assert.equal(pairing.authorize(claim.token!), true)
  assert.equal(JSON.stringify(saved).includes(claim.token!), false)
  assert.deepEqual(Object.keys(pairing.devices()[0]).sort(), ['createdAt', 'id', 'name'])
  const again = new RemoteDevicePairing({ document: saved })
  assert.equal(again.serverId, pairing.serverId)
  assert.equal(again.authorize(claim.token!), true)
  const second = pairing.request('平板', '192.168.1.3')
  pairing.decide(second.requestId, true)
  const secondToken = pairing.claim(second.requestId, second.claimSecret)!.token!
  pairing.revoke(ticket.requestId)
  assert.equal(pairing.authorize(claim.token!), false)
  assert.equal(pairing.authorize(secondToken), true)
  const denied = pairing.request('陌生设备', '192.168.1.4')
  pairing.decide(denied.requestId, false)
  assert.deepEqual(pairing.claim(denied.requestId, denied.claimSecret), { state: 'rejected' })
  now += 120001
  assert.equal(pairing.claim(second.requestId, second.claimSecret), null)
  assert.equal(pairing.decide(second.requestId, true), false)
})

test('pair requests validate names and have bounded lifetime and capacity', () => {
  const pairing = new RemoteDevicePairing()
  for (const name of ['', 'x\nspoof', 'x'.repeat(81), 123]) assert.throws(() => pairing.request(name, '127.0.0.1'))
  for (let i = 0; i < 4; i++) pairing.request(`Phone ${i}`, '127.0.0.1')
  assert.throws(() => pairing.request('Fifth', '127.0.0.1'), /too_many/)
  pairing.clearPending()
  assert.equal(pairing.pending().length, 0)
})

test('persistent trust keeps server identity and only revokes the selected phone', async t => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-device-trust-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = createPersistentDevicePairing(root)
  const ticket = first.request('Phone', '127.0.0.1')
  first.decide(ticket.requestId, true)
  const token = first.claim(ticket.requestId, ticket.claimSecret)!.token!
  assert.equal((await readFile(join(root, 'remote-devices.json'), 'utf8')).includes(token), false)
  const restarted = createPersistentDevicePairing(root)
  assert.equal(restarted.serverId, first.serverId)
  assert.equal(restarted.authorize(token), true)
  restarted.revoke(ticket.requestId)
  assert.equal(createPersistentDevicePairing(root).authorize(token), false)
})

test('pending approvals reserve capacity so concurrent requests cannot exceed the device limit', () => {
  const document: RemoteTrustDocument = { serverId: 'test-server', devices: Array.from({ length: 15 }, (_, index) => ({
    id: `device-${index}`, name: 'Phone', createdAt: 1, tokenHash: '0'.repeat(64)
  })) }
  const pairing = new RemoteDevicePairing({ document })
  const last = pairing.request('Last phone', '127.0.0.1')
  assert.throws(() => pairing.request('Extra phone', '127.0.0.1'), /too_many_pair_requests/)
  pairing.decide(last.requestId, false)
  const replacement = pairing.request('Replacement', '127.0.0.1')
  pairing.decide(replacement.requestId, true)
  assert.equal(pairing.devices().length, 16)
  assert.throws(() => pairing.request('Extra phone', '127.0.0.1'), /too_many_pair_requests/)
})

test('real HTTP approval, rejection, revocation and discovery lifecycle preserve PIN clients', async t => {
  const advertising: string[] = []
  const remote = new RemoteHttpServer({ staticRoot: '', addresses: () => ['127.0.0.1'],
    onCoreRpc: async () => ({ ok: true }),
    discovery: { start: async info => { advertising.push(`start:${info.port}`) }, stop: async () => { advertising.push('stop') } } })
  t.after(() => remote.stop())
  const started = await remote.start(0)
  const base = `http://127.0.0.1:${started.port}`
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(started.discovery, 'advertising')
  const status = await (await fetch(base + '/api/status')).json() as { serverId: string; pairingMode: string }
  assert.equal(status.pairingMode, 'approval-v1')
  assert.equal(status.serverId, started.serverId)
  const ticket = await (await post('/api/pair/requests', { deviceName: 'Phone' })).json() as { requestId: string; claimSecret: string }
  assert.equal((await fetch(base + '/api/state')).status, 401)
  assert.equal((await post('/api/pair/claim', { ...ticket, claimSecret: 'wrong' })).status, 404)
  remote.decidePairing(ticket.requestId, true)
  const claim = await (await post('/api/pair/claim', ticket)).json() as { token: string }
  const auth = { authorization: `Bearer ${claim.token}` }
  assert.equal((await fetch(base + '/api/state', { headers: auth })).status, 200)
  const events = await fetch(base + '/api/core/events', { headers: auth })
  const reader = events.body!.getReader()
  await reader.read()
  remote.revokeDevice(ticket.requestId)
  assert.match(new TextDecoder().decode((await reader.read()).value), /event: auth/)
  await reader.cancel()
  assert.equal((await fetch(base + '/api/state', { headers: auth })).status, 401)
  const cancel = await (await post('/api/pair/requests', { deviceName: 'Cancel me' })).json()
  assert.equal((await post('/api/pair/cancel', cancel)).status, 200)
  assert.equal(((await (await post('/api/pair/claim', cancel)).json()) as { state: string }).state, 'rejected')
  const legacy = await (await post('/api/pair', { pin: started.pin })).json() as { token: string }
  assert.equal((await fetch(base + '/api/state', { headers: { authorization: `Bearer ${legacy.token}` } })).status, 200)
  await remote.start(0, { mode: 'mediaOnly' })
  assert.equal((await post('/api/pair/requests', { deviceName: 'Hidden' })).status, 404)
  assert.equal(remote.getStatus().discovery, 'off')
  assert.deepEqual(advertising, [`start:${started.port}`, 'stop'])
})
