import type {
  CoreLoudnessPage,
  CoreLoudnessPlanRequest,
  CoreLoudnessResult,
  CoreLoudnessState
} from '../../shared/coreAnalysis.ts'
import type { LibraryDatabaseApi } from '../../shared/libraryDatabase.ts'
import type { LoudnessGroupMeasurement, LoudnessInputGroup } from '../../shared/libraryLoudness.ts'
import type { LibrarySelectionApi } from '../../shared/librarySelection.ts'
interface Options {
  root: string
  database: LibrarySelectionApi &
    Pick<LibraryDatabaseApi, 'queryTracks' | 'queryCollections' | 'getMetadata'>
  authorizePath(path: string): Promise<string>
  analyze(group: LoudnessInputGroup): Promise<LoudnessGroupMeasurement>
  cancelWork(): void
  newId(): string
  changed(): void
}
/** Only SQL-owned selections form plans; cached album identity remains unchanged. */
export declare class CoreLibraryLoudnessService {
  constructor(options: Options)
  state(): CoreLoudnessState | null
  prepare(input: CoreLoudnessPlanRequest, signal?: AbortSignal): Promise<CoreLoudnessState>
  start(id: string): Promise<CoreLoudnessState>
  cancel(id: string): Promise<CoreLoudnessState>
  page(id: string, offset?: number, limit?: number): CoreLoudnessPage
  result(id: string, index: number): Promise<CoreLoudnessResult>
  clear(id: string): void
  maintain<T>(action: () => Promise<T>): Promise<T>
  shutdown(): Promise<void>
}
export type {}
