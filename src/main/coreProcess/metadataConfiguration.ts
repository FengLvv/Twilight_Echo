import type { EntityMetadataPolicy } from '../../shared/entityMetadata.ts'
import {
  publicArtworkApprovals,
  type PublicMusicPolicy
} from '../../core/library/publicMusicSources.ts'
import {
  artworkUsageApproval,
  type PublicArtworkPolicy
} from '../../core/library/publicArtworkProvider.ts'
import {
  ncmLocalFallbackApprovals,
  platformMetadataApprovals
} from '../../core/library/platformMetadataProvider.ts'

/** Shipped public-service policy. Private credentials and extra usage rights stay in Core's environment. */
export function metadataConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = (key: string) => env[key] === undefined || env[key] === '1'
  const entityPolicy: EntityMetadataPolicy = {
    enabled: enabled('TWILIGHT_METADATA_ENABLED'),
    publicServiceApproved: enabled('TWILIGHT_METADATA_PUBLIC_SERVICE_APPROVED'),
    wikipediaText: enabled('TWILIGHT_METADATA_WIKIPEDIA_TEXT'),
    contact: env.TWILIGHT_METADATA_CONTACT ?? 'https://github.com/Px-asen/Twilight_Echo'
  }
  const publicArtworkPolicy: PublicArtworkPolicy = {
    ...entityPolicy,
    commonsImages: enabled('TWILIGHT_METADATA_COMMONS_IMAGES'),
    caaUsage: artworkUsageApproval(env.TWILIGHT_METADATA_CAA_USAGE)
  }
  const publicMusicPolicy: PublicMusicPolicy = {
    enabled: entityPolicy.enabled,
    contact: entityPolicy.contact,
    musicbrainzApproved: entityPolicy.publicServiceApproved,
    vocadb: env.TWILIGHT_METADATA_VOCADB !== '0',
    theaudiodb: env.TWILIGHT_METADATA_THEAUDIODB !== '0',
    audioDbKey:
      env.TWILIGHT_METADATA_THEAUDIODB_KEY ?? (env.NODE_ENV === 'development' ? '123' : ''),
    discogs: env.TWILIGHT_METADATA_DISCOGS !== '0',
    discogsToken: env.TWILIGHT_METADATA_DISCOGS_TOKEN ?? '',
    artwork: publicArtworkApprovals(env.TWILIGHT_METADATA_PUBLIC_ARTWORK_USAGE)
  }
  const textUsage = platformMetadataApprovals(env.TWILIGHT_METADATA_PLATFORM_USAGE)
  const artworkUsage = platformMetadataApprovals(
    env.TWILIGHT_METADATA_PLATFORM_ARTWORK_USAGE,
    'TWILIGHT_METADATA_PLATFORM_ARTWORK_USAGE'
  )
  // A profile can opt into local use without changing the startup environment.
  // Explicit deployment configuration still takes precedence over that choice.
  const ncmLocalFallback = (local: boolean) =>
    env.TWILIGHT_METADATA_NCM_LOCAL_FALLBACK === undefined
      ? local
      : env.TWILIGHT_METADATA_NCM_LOCAL_FALLBACK === '1'
  return {
    entityPolicy,
    publicArtworkPolicy,
    publicMusicPolicy,
    platformTextUsage: (local = true) =>
      ncmLocalFallbackApprovals(ncmLocalFallback(local), textUsage),
    platformArtworkUsage: (local = true) =>
      ncmLocalFallbackApprovals(ncmLocalFallback(local), artworkUsage)
  }
}
