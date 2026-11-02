import type {
  LegacyMusicProvenanceOptions,
  LegacyMusicProvenanceReview
} from '../../shared/legacyMusicMetadata.ts'
import type { createLegacyMusicAuthority } from './legacyMusicAuthority.ts'
import type { TwilightPluginManager } from './managerPort.ts'
export interface ExperienceDocument {
  revision: number
  value: Record<string, unknown>
}
export declare function createExperienceDocuments(
  plugins: Pick<TwilightPluginManager, 'list'>,
  authority?: ReturnType<typeof createLegacyMusicAuthority>
): ((
  pluginId: string,
  update?: ExperienceDocument,
  restoreRevision?: number,
  automatic?: boolean
) => Promise<ExperienceDocument>) & {
  automatic: (pluginId: string, update: ExperienceDocument) => Promise<ExperienceDocument>
  inventory: (
    pluginId: string,
    offset?: number,
    limit?: number
  ) => Promise<import('../../shared/legacyMusicMetadata.ts').LegacyMusicInventory>
  history: (
    pluginId: string,
    offset?: number,
    limit?: number
  ) => Promise<{
    total: number
    revisions: number[]
  }>
  historyRead: (
    pluginId: string,
    revision: number
  ) => Promise<import('../../shared/legacyMusicMetadata.ts').LegacyMusicDocument | null>
  provenanceList: (
    pluginId: string,
    options?: LegacyMusicProvenanceOptions
  ) => Promise<import('../../shared/legacyMusicMetadata.ts').LegacyMusicProvenancePage>
  provenanceRead: (
    pluginId: string,
    albumId: string,
    snapshotRevision: number
  ) => Promise<{
    revision: number
    item: import('../../shared/legacyMusicMetadata.ts').LegacyMusicProvenanceItem
  }>
  provenanceReview: (
    pluginId: string,
    request: LegacyMusicProvenanceReview
  ) => Promise<import('../../shared/legacyMusicMetadata.ts').LegacyMusicProvenancePage>
  restore: (
    pluginId: string,
    revision: number,
    expectedRevision: number
  ) => Promise<ExperienceDocument>
  migrationStatus: (pluginId: string) => Promise<{
    migration: import('../../shared/legacyMusicMetadata.ts').LegacyMusicMigration | null
    error: string | null
  }>
  flush: () => Promise<void>
}
