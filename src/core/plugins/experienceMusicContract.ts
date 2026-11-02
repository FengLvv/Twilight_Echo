import type { LegacyMusicTaskClient } from '../../shared/legacyMusicTasks.ts'
import type { MusicAlbum } from '../../shared/rhineMusic.ts'
import type { createExperienceDocuments } from './experienceDocumentsPort.ts'
import type { TwilightPluginManager } from './managerPort.ts'
export interface ExperienceMusicAlbum extends MusicAlbum {
  /** Core-only source snapshot; not supplied by the experience view. */
  collectionId?: string
  contentRevision?: number
}
export declare function createExperienceMusic(
  plugins: Pick<TwilightPluginManager, 'list'>,
  experienceDocument: ReturnType<typeof createExperienceDocuments>,
  tasks?: LegacyMusicTaskClient
): ((
  pluginId: string,
  operation: string,
  rawAlbums: ExperienceMusicAlbum[],
  args: Record<string, unknown>
) => Promise<
  | import('../../shared/legacyMusicMetadata.ts').LegacyMusicDocument
  | import('../../shared/legacyMusicMetadata.ts').LegacyMusicInventory
  | import('../../shared/legacyMusicMetadata.ts').LegacyMusicProvenancePage
  | {
      total: number
      revisions: number[]
    }
  | {
      revision: number
      item: import('../../shared/legacyMusicMetadata.ts').LegacyMusicProvenanceItem
    }
  | {
      running: boolean
      completed: number
      total: number
      updated: number
      failed: number
      notFound: number
      currentAlbum?: string
      error?: string
    }
  | import('./rhine-vendor/album-introduction-exchangePort.ts').IntroductionTask
  | {
      result: unknown
      rebound: number
      unresolved: Array<{
        id: string
        reason: string
      }>
    }
  | import('./rhine-vendor/album-introduction-exchangePort.ts').IntroductionPreview
  | {
      migration: {
        migration: import('../../shared/legacyMusicMetadata.ts').LegacyMusicMigration | null
        error: string | null
      }
      credits?: import('../../shared/legacyMusicTasks.ts').LegacyMusicTaskStatus | null | undefined
      introductions?:
        | import('../../shared/legacyMusicTasks.ts').LegacyMusicTaskStatus
        | null
        | undefined
      enrich?: import('../../shared/legacyMusicTasks.ts').LegacyMusicTaskStatus | null | undefined
    }
  | {
      imported: number
      backup: string
      canApply: boolean
      counts: {
        add: number
        replace: number
        skip: number
        conflict: number
      }
      entries: Array<{
        id: string
        action: string
        description: string
        sources: NonNullable<MusicAlbum['descriptionSource']>[]
      }>
    }
  | null
  | undefined
>) & {
  running: () => boolean
  shutdown: () => Promise<void>
}
