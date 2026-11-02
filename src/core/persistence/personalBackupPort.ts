import type { PersonalLibraryDatabase } from '../../shared/coreBackup.ts'
import type { LocalMusicLibraryDocument } from '../../shared/localLibrary.ts'
import type { MusicPersonalBackupRevision } from '../../shared/musicPersonalBackup.ts'
import type {
  PersonalBackup,
  PersonalBackupExportOptions,
  PersonalBackupPreview,
  PersonalData,
  PersonalDomain,
  PersonalRestoreOptions
} from '../../shared/personalBackup.ts'
import type { Playlist } from '../../shared/playlists.ts'
export type { PersonalLibraryDatabase } from '../../shared/coreBackup.ts'
type LibraryReadOptions = {
  library: LocalMusicLibraryDocument | null
  playlists?: Playlist[]
}
export declare function checkRestoreOptions(value: unknown): asserts value is PersonalRestoreOptions
/** Core supplies SQLite; only the temporary main compatibility adapter supplies a legacy JSON reader. */
export declare function createPersonalBackupRepository(
  readLegacyLibrary?: (path: string) => LocalMusicLibraryDocument
): {
  parsePersonalBackup: (text: string) => PersonalBackup
  readPersonalData: (
    root: string,
    options?: LibraryReadOptions,
    domains?: readonly PersonalDomain[]
  ) => PersonalData
  createPersonalBackup: (
    root: string,
    rendererData: PersonalData,
    options?: LibraryReadOptions
  ) => PersonalBackup
  stagePersonalRestore: (
    root: string,
    backup: PersonalBackup,
    options: PersonalRestoreOptions,
    authorizedRoots?: string[],
    current?: PersonalData,
    libraryBackend?: 'sqlite',
    musicExpectedRevision?: MusicPersonalBackupRevision
  ) => void
  buildRestoreData: (
    backup: PersonalBackup,
    options: PersonalRestoreOptions,
    current: PersonalData
  ) => PersonalData
  previewRestore: (
    root: string,
    backup: PersonalBackup,
    rendererData: PersonalData,
    options?: LibraryReadOptions
  ) => PersonalBackupPreview
  applyPendingPersonalRestore: (root: string, beforeWrite?: (name: string) => void) => void
  createPersonalBackupFromDatabase: (
    root: string,
    rendererData: PersonalData,
    database: PersonalLibraryDatabase,
    options?: PersonalBackupExportOptions
  ) => Promise<PersonalBackup>
  createPersonalBackupV1FromDatabase: (
    root: string,
    rendererData: PersonalData,
    database: PersonalLibraryDatabase
  ) => Promise<PersonalBackup>
  previewRestoreFromDatabase: (
    root: string,
    backup: PersonalBackup,
    rendererData: PersonalData,
    database: PersonalLibraryDatabase,
    options?: PersonalRestoreOptions
  ) => Promise<PersonalBackupPreview>
  stagePersonalRestoreFromDatabase: (
    root: string,
    backup: PersonalBackup,
    options: PersonalRestoreOptions,
    authorizedRoots: string[],
    database: PersonalLibraryDatabase,
    personalData?: PersonalData,
    expectedRevision?: MusicPersonalBackupRevision
  ) => Promise<void>
  applyPendingPersonalRestoreFromDatabase: (
    root: string,
    database: PersonalLibraryDatabase,
    beforeWrite?: (name: string) => void | Promise<void>
  ) => Promise<void>
  readRendererRestore: (root: string) => unknown
  acknowledgeRendererRestore: (root: string, id: string) => void
  deferStalePersonalRestore: (root: string) => string | null
  personalRestoreNeedsReview: (root: string) => boolean
  readPersonalRestoreReview: (root: string) => PersonalBackup | null
  acknowledgePersonalRestoreReview: (root: string) => void
  readBackupFile: (path: string) => PersonalBackup
  writePersonalBackupFile: (path: string, backup: PersonalBackup) => void
}
