import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import Bonjour from 'bonjour-service'
import { CoreDiscoveryAdvertisement } from './coreDiscovery.ts'

test('DNS-SD advertises a resolvable Core endpoint and a stable identity without secrets', { timeout: 20000 }, async t => {
  const advertiser = new CoreDiscoveryAdvertisement()
  const browser = new Bonjour()
  t.after(async () => { await advertiser.stop(); browser.destroy() })
  const id = randomUUID()
  const discovered = new Promise<{ port: number; txt: Record<string, string>; addresses: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS-SD Core not found')), 12000)
    const search = browser.find({ type: 'twilight-core', protocol: 'tcp' }, service => {
      if (service.txt?.id === id) { clearTimeout(timer); search.stop(); resolve(service as never) }
    })
    t.after(() => { clearTimeout(timer); search.stop() })
  })
  await advertiser.start({ serverId: id, name: '书房电脑', port: 18492 })
  const service = await discovered
  assert.equal(service.port, 18492)
  assert.equal(service.txt.name, '书房电脑')
  assert.deepEqual(Object.keys(service.txt).sort(), ['bridge', 'id', 'name', 'pair', 'v'])
  assert.ok(service.addresses.length)
})
