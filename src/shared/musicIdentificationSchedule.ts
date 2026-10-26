import type { CatalogKind } from './musicCatalog.ts'
import { validMetadataLanguage, type EntityMetadataLanguage } from './entityMetadata.ts'

/** Scope switches apply only to automatic work; local-use permission also covers explicit updates. */
export interface MusicIdentificationSettings {
  newImports: boolean
  history: boolean
  sources: string[]
  language?: EntityMetadataLanguage
  /** Personal local display/cache opt-in, not an open license or export permission. */
  ncmLocalFallback?: boolean
  /** Absent on already-configured profiles; pending prompts after the first import. */
  setup?: 'pending' | 'accepted' | 'declined'
}
export const defaultMusicIdentificationSettings = (): MusicIdentificationSettings => ({
  newImports: false,
  history: false,
  sources: ['musicbrainz', 'vocadb', 'theaudiodb', 'discogs', 'platform.ncm'],
  ncmLocalFallback: true,
  setup: 'pending'
})
export function normalizeMusicIdentificationSettings(raw: unknown): MusicIdentificationSettings {
  // Missing preferences are new/legacy installs. An existing object retains its
  // original opt-in semantics, including explicit false and an empty source list.
  if (raw === undefined) return defaultMusicIdentificationSettings()
  const v = raw && typeof raw === 'object' ? (raw as Partial<MusicIdentificationSettings>) : {}
  return {
    newImports: v.newImports === true,
    history: v.history === true,
    ...(validMetadataLanguage(v.language) ? { language: v.language } : {}),
    ...(typeof v.ncmLocalFallback === 'boolean' ? { ncmLocalFallback: v.ncmLocalFallback } : {}),
    ...(['pending', 'accepted', 'declined'].includes(v.setup ?? '') ? { setup: v.setup } : {}),
    sources: Array.isArray(v.sources)
      ? [
          ...new Set(
            v.sources.filter(
              (s): s is string =>
                typeof s === 'string' &&
                /^(musicbrainz|vocadb|theaudiodb|discogs|platform\.[a-z0-9][a-z0-9._-]{0,118})$/.test(
                  s
                )
            )
          )
        ].slice(0, 16)
      : defaultMusicIdentificationSettings().sources
  }
}

/** One choice enables all registered sources, including ones awaiting an API key. */
export function musicMetadataSetupChoice(
  current: MusicIdentificationSettings,
  enabled: boolean,
  providers: string[] = []
): MusicIdentificationSettings {
  return normalizeMusicIdentificationSettings({
    ...current,
    setup: enabled ? 'accepted' : 'declined',
    newImports: enabled,
    history: enabled,
    ...(enabled
      ? {
          ncmLocalFallback: true,
          sources: [...new Set([...defaultMusicIdentificationSettings().sources, ...providers])]
        }
      : {})
  })
}
export interface IdentificationScheduleRequest {
  enabled: boolean
  newImports: boolean
  history: boolean
  providers: Array<{ id: string; matcherVersion: string; kinds: CatalogKind[] }>
  enrichment?: {
    language: EntityMetadataLanguage
    providers: Array<{ id: string; context: string; kinds: CatalogKind[] }>
  }
}
export interface IdentificationScheduleStatus {
  pending: number
  history: { cursor: number; horizon: number | null }
}
export interface IdentificationScheduleResult extends IdentificationScheduleStatus {
  processed: number
  more: boolean
}
export interface IdentificationScheduleDatabaseApi {
  identificationSchedule(
    request: IdentificationScheduleRequest,
    now: number
  ): Promise<IdentificationScheduleResult>
  identificationScheduleStatus(): Promise<IdentificationScheduleStatus>
}
