export interface JsonFileOptions<T> {
  label: string
  maxBytes: number
  validate: (value: unknown) => value is T
}
export type JsonFileLoadResult<T> =
  | {
      status: 'missing'
    }
  | {
      status: 'loaded'
      value: T
    }
  | {
      status: 'recovered'
      value: T
      corruptCopyPath: string | null
      restoreError: string | null
    }
export type JsonCandidate<T> =
  | {
      status: 'missing'
    }
  | {
      status: 'loaded'
      value: T
    }
  | {
      status: 'invalid'
      error: string
    }
export declare class PersistentJsonFileError extends Error {
  readonly code = 'ERR_PERSISTENT_JSON_CORRUPT'
  readonly filePath: string
  readonly backupPath: string
  readonly primaryError: string
  readonly backupError: string
  readonly corruptCopyPath: string | null
  readonly corruptBackupCopyPath: string | null
  constructor(
    filePath: string,
    options: JsonFileOptions<unknown>,
    primaryError: string,
    backupError: string,
    corruptCopyPath: string | null,
    corruptBackupCopyPath: string | null
  )
}
export declare function loadJsonFileWithBackup<T>(
  filePath: string,
  options: JsonFileOptions<T>
): JsonFileLoadResult<T>
export declare function writeJsonFileAtomic<T>(
  filePath: string,
  json: string,
  options: JsonFileOptions<T>,
  value?: T
): void
/**
 * Serialize an already validated value without parsing the same large JSON
 * document again. JSON.stringify provides the syntax guarantee; the nesting
 * scan preserves the persisted-file safety limit.
 */
export declare function writeJsonValueAtomic<T>(
  filePath: string,
  value: T,
  options: JsonFileOptions<T>
): void
export declare function clearJsonFileArtifacts(filePath: string): void
export declare function backupPathFor(filePath: string): string
export declare function corruptPathFor(filePath: string): string
export declare function readJsonCandidate<T>(
  filePath: string,
  options: JsonFileOptions<T>
): JsonCandidate<T>
