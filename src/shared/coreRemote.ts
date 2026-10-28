import type { RemoteControlStatus } from './remoteControl.ts'

export interface CoreRemoteCommands {
  'remote.setEnabled': { enabled: boolean }
  'remote.rotatePin': Record<string, never>
  'remote.decidePairing': { requestId: string; allow: boolean }
  'remote.revokeDevice': { id: string }
}
export interface CoreRemoteQueries {
  'remote.status': { input: Record<string, never>; output: RemoteControlStatus }
}
export function validCoreRemotePayload(name: string, value: Record<string, unknown>): boolean {
  if (name === 'remote.decidePairing') return Object.keys(value).length === 2 &&
    typeof value.requestId === 'string' && /^[a-f0-9-]{36}$/.test(value.requestId) && typeof value.allow === 'boolean'
  if (name === 'remote.revokeDevice') return Object.keys(value).length === 1 &&
    typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id)
  if (name === 'remote.setEnabled')
    return Object.keys(value).length === 1 && typeof value.enabled === 'boolean'
  return (name === 'remote.status' || name === 'remote.rotatePin') && !Object.keys(value).length
}
