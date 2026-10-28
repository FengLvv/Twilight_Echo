import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemoteDevicePairing, type RemoteTrustDocument } from '../../core/cast/devicePairing.ts'

/** Stored in the application profile. Only token verifiers are written, never bearer tokens. */
export function createPersistentDevicePairing(root: string): RemoteDevicePairing {
  const path = join(root, 'remote-devices.json')
  let document: RemoteTrustDocument | undefined
  if (existsSync(path)) {
    const value = JSON.parse(readFileSync(path, 'utf8')) as RemoteTrustDocument
    if (!/^[a-f0-9-]{36}$/.test(value.serverId) || !Array.isArray(value.devices) || value.devices.length > 16 ||
      value.devices.some(d => typeof d.id !== 'string' || typeof d.name !== 'string' ||
        !Number.isSafeInteger(d.createdAt) || !/^[a-f0-9]{64}$/.test(d.tokenHash)))
      throw new Error('Invalid remote device trust file')
    document = value
  }
  const save = (value: RemoteTrustDocument) => {
    writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }
  const pairing = new RemoteDevicePairing({ document, save })
  if (!document) save({ serverId: pairing.serverId, devices: [] })
  return pairing
}
