import assert from 'node:assert/strict'
import test from 'node:test'
import { metadataConfiguration } from './metadataConfiguration.ts'
import { metadataPolicyView } from '../../core/library/entityMetadataProvider.ts'
import { PublicArtworkProvider } from '../../core/library/publicArtworkProvider.ts'
import { PublicMusicSource } from '../../core/library/publicMusicSources.ts'
import { PlatformMetadataProvider } from '../../core/library/platformMetadataProvider.ts'

test('a release without environment configuration exposes public identity, biographies and licensed artist portraits', () => {
  const config = metadataConfiguration({ NODE_ENV: 'production' })
  assert.deepEqual(metadataPolicyView(config.entityPolicy), {
    enabled: true,
    identity: true,
    introduction: true,
    reason: null
  })
  const artwork = new PublicArtworkProvider(() => config.publicArtworkPolicy)
  assert.equal(artwork.blockedReason('artist'), null)
  assert.equal(artwork.blockedReason('release'), 'caa_artwork_cache_not_approved')
  assert.equal(config.publicMusicPolicy.audioDbKey, '')
  assert.equal(config.publicMusicPolicy.discogsToken, '')
  assert.deepEqual(config.publicMusicPolicy.artwork, {})
  assert.equal(
    new PublicMusicSource('vocadb', () => config.publicMusicPolicy).blockedReason('artist'),
    null
  )
  assert.equal(
    new PublicMusicSource('theaudiodb', () => config.publicMusicPolicy).blockedReason('artist'),
    'theaudiodb_key_required'
  )
})

test('release NCM fallback supports both fields, persists no export permission, and can be disabled per profile', () => {
  const config = metadataConfiguration({})
  const usage = { display: true, cache: true, crossSource: true, export: false }
  assert.deepEqual(config.platformTextUsage().ncm, usage)
  assert.deepEqual(config.platformArtworkUsage().ncm, usage)
  assert.deepEqual(config.platformTextUsage(false), {})
  assert.deepEqual(config.platformArtworkUsage(false), {})
  assert.equal(config.platformTextUsage().qq, undefined)
  let local = true
  const provider = new PlatformMetadataProvider('ncm', {
    inventory: () => [
      {
        id: 'ncm',
        enabled: true,
        supportedMethods: ['fetchArtistMetadata'],
        configuration: 'stable'
      }
    ],
    usage: (id) => config.platformTextUsage(local)[id] ?? null,
    artworkUsage: (id) => config.platformArtworkUsage(local)[id] ?? null,
    call: async () => {
      assert.fail('reading permissions must not fetch')
    }
  })
  assert.equal(provider.blockedReason('artist'), null)
  assert.equal(provider.supportsArtwork('artist'), true)
  const before = provider.context()
  local = false
  assert.equal(provider.blockedReason('artist'), 'platform_metadata_cache_not_approved')
  assert.equal(provider.supportsArtwork('artist'), false)
  assert.notEqual(
    provider.context(),
    before,
    'revocation invalidates old projections and in-flight work'
  )
})

test('explicit deployment restrictions and field denials still override the shipped defaults', () => {
  const disabled = metadataConfiguration({ TWILIGHT_METADATA_ENABLED: '0' })
  assert.equal(metadataPolicyView(disabled.entityPolicy).reason, 'metadata_disabled')
  assert.equal(
    metadataPolicyView(
      metadataConfiguration({ TWILIGHT_METADATA_PUBLIC_SERVICE_APPROVED: '0' }).entityPolicy
    ).reason,
    'public_service_not_approved'
  )
  assert.equal(
    metadataConfiguration({ TWILIGHT_METADATA_WIKIPEDIA_TEXT: '0' }).entityPolicy.wikipediaText,
    false
  )
  assert.equal(
    new PublicArtworkProvider(
      () => metadataConfiguration({ TWILIGHT_METADATA_COMMONS_IMAGES: '0' }).publicArtworkPolicy
    ).blockedReason('artist'),
    'commons_images_not_permitted'
  )
  assert.deepEqual(
    metadataConfiguration({ TWILIGHT_METADATA_NCM_LOCAL_FALLBACK: '0' }).platformTextUsage(true),
    {}
  )
  const denied = metadataConfiguration({
    TWILIGHT_METADATA_PLATFORM_ARTWORK_USAGE: JSON.stringify({
      ncm: { display: true, cache: false, crossSource: true, export: true }
    })
  })
  assert.equal(denied.platformArtworkUsage().ncm.cache, false)
  assert.equal(denied.platformArtworkUsage().ncm.export, false)
})

test('development test keys do not enter release defaults; explicitly supplied Core keys retain their contract', () => {
  assert.equal(
    metadataConfiguration({ NODE_ENV: 'development' }).publicMusicPolicy.audioDbKey,
    '123'
  )
  const config = metadataConfiguration({
    NODE_ENV: 'production',
    TWILIGHT_METADATA_THEAUDIODB_KEY: 'fixture-key',
    TWILIGHT_METADATA_DISCOGS_TOKEN: 'fixture-token'
  })
  assert.equal(config.publicMusicPolicy.audioDbKey, 'fixture-key')
  assert.equal(config.publicMusicPolicy.discogsToken, 'fixture-token')
})
