import type { EntityMetadataResult } from '../../shared/entityMetadata.ts'
import type { LegacyMusicTaskWork } from '../../shared/legacyMusicTasks.ts'
import type { TwilightPluginManager } from './managerPort.ts'
export interface LegacyMusicLookupProvider {
  blockedReason(work: LegacyMusicTaskWork): Promise<string | null>
  lookup(
    work: LegacyMusicTaskWork,
    attempts: number,
    signal: AbortSignal
  ): Promise<
    Extract<
      EntityMetadataResult,
      {
        state: 'legacy_result'
      }
    >
  >
}
interface Options {
  plugins: Pick<TwilightPluginManager, 'list'>
  /** A deployment can disable an old capability, without making an omitted
   * new automatic-enrichment setting a prerequisite for existing manual use. */
  disabled?(operation: LegacyMusicTaskWork['operation']): string | null
  fetcher?: typeof fetch
  now?: () => number
}
export declare function createLegacyMusicLookupProvider(options: Options): LegacyMusicLookupProvider
export type {}
