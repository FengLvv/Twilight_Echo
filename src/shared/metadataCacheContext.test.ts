import assert from 'node:assert/strict'
import test from 'node:test'
import { metadataCacheContextMatches, NCM_PUBLIC_METADATA_CONFIGURATION, ncmMetadataMethods } from './metadataCacheContext.ts'

const usage = { display: true, cache: true, crossSource: true, export: false }
const methods = ['searchSongs', 'fetchAlbumMetadata', 'getPlaybackUrl', 'fetchArtistIntro', 'fetchArtistMetadata']
const context = (configuration: string, permissions = usage, enabled = true, capabilities = methods) =>
  JSON.stringify([configuration, enabled, capabilities, permissions, usage, 'ncm-exact-link-v1'])
const legacy = (version = '1.0.0', account = 'absent') =>
  JSON.stringify(['public-metadata-v2', JSON.stringify(['com.twilightecho.provider.ncm', version, account])])

test('public NCM v2 caches survive plugin/account epochs and unrelated method changes', () => {
  const current = context(NCM_PUBLIC_METADATA_CONFIGURATION, usage, true, ncmMetadataMethods(methods))
  for (const version of ['1.0.0', '1.1.0']) for (const account of ['absent', '["old-filesystem-epoch"]'])
    assert.equal(metadataCacheContextMatches('ncm', context(legacy(version, account)), current), true)
  assert.equal(metadataCacheContextMatches('platform.ncm', context(legacy()), current), true)
  assert.deepEqual(ncmMetadataMethods([...methods].reverse()), ['fetchArtistMetadata', 'fetchAlbumMetadata'])
})

test('public cache compatibility retains permissions, enablement and identity/capability boundaries', () => {
  const saved = context(legacy())
  const current = context(NCM_PUBLIC_METADATA_CONFIGURATION)
  for (const key of ['display', 'cache', 'crossSource', 'export'] as const)
    assert.equal(metadataCacheContextMatches('ncm', saved,
      context(NCM_PUBLIC_METADATA_CONFIGURATION, { ...usage, [key]: !usage[key] })), false)
  assert.equal(metadataCacheContextMatches('ncm', saved, context(NCM_PUBLIC_METADATA_CONFIGURATION, usage, false)), false)
  assert.equal(metadataCacheContextMatches('ncm', saved, context(NCM_PUBLIC_METADATA_CONFIGURATION, usage, true, ['fetchArtistIntro'])), false)
  const changed = JSON.parse(current); changed[5] = 'different-identity-contract'
  assert.equal(metadataCacheContextMatches('ncm', saved, JSON.stringify(changed)), false)
  assert.equal(metadataCacheContextMatches('ncm', saved, undefined), false)
  assert.equal(metadataCacheContextMatches('ncm', saved, current), true)
})

test('private contexts, other providers and malformed v2 records retain exact matching', () => {
  const current = context(NCM_PUBLIC_METADATA_CONFIGURATION)
  for (const saved of ['{}', 'bad json', context('account-a'), context(JSON.stringify(['public-metadata-v1', 'old'])),
    context(JSON.stringify(['public-metadata-v2', JSON.stringify(['another-plugin', '1.0.0', 'absent'])]))])
    assert.equal(metadataCacheContextMatches('ncm', saved, current), false)
  assert.equal(metadataCacheContextMatches('bili', context(legacy()), current), false)
  assert.equal(metadataCacheContextMatches('ncm', 'account-a', 'account-a'), true)
  assert.equal(metadataCacheContextMatches('ncm', 'account-a', 'account-b'), false)
})
