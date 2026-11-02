import type {
  CorePersonalBackupPreview,
  CorePersonalRestore,
  CorePersonalRestoreApi,
  PersonalLibraryDatabase
} from '../../shared/coreBackup.ts'
import type { PersonalBackupExportOptions, PersonalData } from '../../shared/personalBackup.ts'
interface Options {
  root: string
  database: PersonalLibraryDatabase & CorePersonalRestoreApi
  flush(): Promise<void>
  personalData(): PersonalData
  chooseFile(kind: 'import' | 'export', signal?: AbortSignal): Promise<string | null>
  chooseFolder(signal?: AbortSignal): Promise<string | null>
  authorizeRoots(roots: string[]): Promise<string[]>
  newId(): string
}
/** Portable file format and redo journal; every domain is read from Core owners. */
export declare class CorePersonalBackupService {
  constructor(options: Options)
  initialize(): Promise<void>
  export(signal?: AbortSignal): Promise<boolean>
  export(options: PersonalBackupExportOptions, signal?: AbortSignal): Promise<boolean>
  preview(signal?: AbortSignal): Promise<CorePersonalBackupPreview | null>
  recoveryAvailable(): boolean
  recoverPreview(signal?: AbortSignal): Promise<CorePersonalBackupPreview | null>
  repreview(request: CorePersonalRestore, signal?: AbortSignal): Promise<CorePersonalBackupPreview>
  stage(
    request: CorePersonalRestore,
    signal?: AbortSignal
  ): Promise<{
    restartRequired: true
  }>
  chooseFolder(signal?: AbortSignal): Promise<string | null>
  shutdown(): Promise<void>
}
export type {}
