import type { LegacyMusicTaskClient } from '../../shared/legacyMusicTasks.ts'
import type { LibraryDatabaseApi } from '../../shared/libraryDatabase.ts'
import type { InstalledExperience } from '../../shared/pluginExperience.ts'
import type { MusicAlbum } from '../../shared/rhineMusic.ts'
import type { createExperienceDocuments } from './experienceDocumentsPort.ts'
import type { LegacyMusicAuthorityDatabase } from './legacyMusicAuthority.ts'
import type { TwilightPluginManager } from './managerPort.ts'
/** Package authorization and long-running metadata jobs survive every UI window. */
export declare class CorePluginExperiences {
  readonly document: ReturnType<typeof createExperienceDocuments>
  constructor(
    plugins: Pick<TwilightPluginManager, 'list' | 'listExtensions'>,
    database: Pick<LibraryDatabaseApi, 'queryCollections' | 'queryTracks'>,
    isScanning: () => boolean,
    exportFile: (
      name: string,
      content: string
    ) => Promise<{
      saved: boolean
    }>,
    metadataDatabase?: LegacyMusicAuthorityDatabase,
    tasks?: LegacyMusicTaskClient
  )
  list(): Promise<InstalledExperience[]>
  resource(rawUrl: string): Promise<{
    path: string
  } | null>
  stylesheet(pluginId: string, themeId: string): Promise<string>
  preferences(pluginId: string, value?: Record<string, unknown>): Promise<unknown>
  export(
    pluginId: string,
    name: string,
    content: string
  ): Promise<{
    saved: boolean
  }>
  flush(): Promise<void>
  shutdown(): Promise<void>
  music(
    pluginId: string,
    operation: string,
    args: Record<string, unknown>
  ): Promise<
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
        credits?:
          | import('../../shared/legacyMusicTasks.ts').LegacyMusicTaskStatus
          | null
          | undefined
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
  >
}
