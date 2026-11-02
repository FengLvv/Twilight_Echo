import type { VersionedDataEnvelope } from '../../shared/versionedPersistence.ts'
import type { JsonFileLoadResult } from './jsonFilePort.ts'
export interface VersionedDataStoreOptions<T> {
  filePath: string
  label: string
  maxBytes: number
  isData: (value: unknown) => value is T
  isLegacy: (value: unknown) => value is T
  now?: () => string
  onRecovery?: (
    result: Extract<
      JsonFileLoadResult<VersionedDataEnvelope<T> | T>,
      {
        status: 'recovered'
      }
    >
  ) => void
}
/**
 * Serializes one persistence domain.  Every operation reads the authoritative
 * revision inside the queue, so callers cannot win a stale read/write race.
 */
export declare class VersionedDataStore<T> {
  constructor(config: VersionedDataStoreOptions<T>)
  load(): Promise<VersionedDataEnvelope<T> | null>
  loadBackup(): Promise<VersionedDataEnvelope<T> | null>
  removeFiles(): Promise<void>
  save(data: T, expectedRevision: number): Promise<VersionedDataEnvelope<T>>
}
