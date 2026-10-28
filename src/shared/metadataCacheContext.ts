import { validMetadataUsage, type MetadataUsage } from './musicMetadata.ts'

/** Anonymous NCM details have their own data contract, not a login or plugin-build epoch. */
export const NCM_PUBLIC_METADATA_CONFIGURATION = 'public-ncm-metadata-v3'

export function ncmMetadataMethods(methods: readonly string[]): string[] {
  return [
    ...(methods.includes('fetchArtistMetadata') ? ['fetchArtistMetadata']
      : methods.includes('fetchArtistIntro') ? ['fetchArtistIntro'] : []),
    ...(methods.includes('fetchAlbumMetadata') ? ['fetchAlbumMetadata'] : [])
  ]
}

const usageKey = (usage: MetadataUsage | null) => usage === null ? null : [
  usage.display, usage.cache, usage.crossSource, usage.export, usage.expiresAt ?? null
]

function publicNcmContext(context: string): string | null {
  try {
    const value: unknown = JSON.parse(context)
    if (!Array.isArray(value) || value.length !== 6 || typeof value[1] !== 'boolean' ||
      !Array.isArray(value[2]) || !value[2].every(method => typeof method === 'string') ||
      !(value[3] === null || validMetadataUsage(value[3])) ||
      !(value[4] === null || validMetadataUsage(value[4])) || value[5] !== 'ncm-exact-link-v1') return null
    if (value[0] !== NCM_PUBLIC_METADATA_CONFIGURATION) {
      // v2 already used cookie-free requests. Only that official, explicitly public
      // cache may shed its unrelated build/account epoch; other providers stay exact.
      const configuration: unknown = JSON.parse(value[0])
      if (!Array.isArray(configuration) || configuration.length !== 2 || configuration[0] !== 'public-metadata-v2') return null
      const owner: unknown = JSON.parse(configuration[1])
      if (!Array.isArray(owner) || owner.length !== 3 || owner[0] !== 'com.twilightecho.provider.ncm' ||
        typeof owner[1] !== 'string' || typeof owner[2] !== 'string') return null
    }
    return JSON.stringify([value[1], ncmMetadataMethods(value[2]), usageKey(value[3]), usageKey(value[4]), value[5]])
  } catch { return null }
}

/** Read compatibility only. Jobs and late commits retain exact generation/context fences. */
export function metadataCacheContextMatches(
  provider: string, saved: string | undefined, current: string | undefined
): boolean {
  if (!saved || !current) return false
  if (saved === current) return true
  if (provider !== 'ncm' && provider !== 'platform.ncm') return false
  const before = publicNcmContext(saved), after = publicNcmContext(current)
  return before !== null && after !== null && before === after
}
