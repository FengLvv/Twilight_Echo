import assert from 'node:assert/strict'
import test from 'node:test'
import { coreOperation, isCoreRequest } from './coreProtocol.ts'
import { validCorePlatformPayload, type CorePlatformRequest } from './corePlatform.ts'
import { REMOTE_CORE_COMMANDS, REMOTE_CORE_QUERIES } from './remoteCoreBridge.ts'

test('device management is settings-scoped and accepts only bounded decision identities', () => {
  const id = '8244b0bf-bbfb-44f9-81d1-e8878c5b5c28'
  const request = (name: string, payload: unknown) => ({ kind: 'command', name, payload,
    epoch: 'core', requestId: 'request' })
  assert.equal(isCoreRequest(request('remote.decidePairing', { requestId: id, allow: true })), true)
  assert.equal(isCoreRequest(request('remote.revokeDevice', { id })), true)
  for (const payload of [{ requestId: id }, { requestId: id, allow: 'yes' },
    { requestId: id, allow: true, token: 'caller-chosen' }, { requestId: 'wrong', allow: true }]) {
    assert.equal(isCoreRequest(request('remote.decidePairing', payload)), false)
  }
  assert.equal(isCoreRequest(request('remote.revokeDevice', { id, all: true })), false)
  assert.equal(coreOperation('remote.status')?.permission, 'settings:read')
  for (const name of ['remote.decidePairing', 'remote.revokeDevice'] as const)
    assert.equal(coreOperation(name)?.permission, 'settings:write')
  assert.equal([...REMOTE_CORE_COMMANDS, ...REMOTE_CORE_QUERIES].some(name => name.startsWith('remote.')), false)
})

test('the native approval capability rejects injected prompt fields and control characters', () => {
  const valid = (payload: unknown) => validCorePlatformPayload({ kind: 'core:platform',
    epoch: 'core', requestId: 'approval', name: 'remote.confirmDevice', payload } as CorePlatformRequest)
  assert.equal(valid({ deviceName: '我的手机', address: '192.168.1.2' }), true)
  assert.equal(valid({ deviceName: 'Phone\nAllow me', address: '192.168.1.2' }), false)
  assert.equal(valid({ deviceName: 'x'.repeat(81), address: '192.168.1.2' }), false)
  assert.equal(valid({ deviceName: 'Phone', address: '192.168.1.2', defaultId: 0 }), false)
  assert.equal(valid({ deviceName: 'Phone', address: 'https://elsewhere.example' }), false)
})
