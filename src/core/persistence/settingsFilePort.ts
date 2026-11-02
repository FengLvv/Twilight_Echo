export type SettingsFileLoadIssue =
  | {
      kind: 'recovered'
      filePath: string
      corruptCopyPath: string | null
      restoreError: string | null
    }
  | {
      kind: 'corrupt'
      filePath: string
      backupPath: string
      primaryError: string
      backupError: string
      corruptCopyPath: string | null
      corruptBackupCopyPath: string | null
    }
export interface SettingsFileLoadResult<T> {
  settings: T
  issue: SettingsFileLoadIssue | null
}
export declare function loadSettingsFile<T extends object>(
  filePath: string,
  defaults: T,
  normalize: (settings: Partial<T>) => T
): SettingsFileLoadResult<T>
export declare function writeSettingsFile<T extends object>(filePath: string, settings: T): void
