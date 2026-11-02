import type {
  LibraryLoudnessResult,
  LoudnessBatchItem,
  LoudnessBatchProgress,
  LoudnessBatchSnapshot,
  LoudnessGroupMeasurement,
  LoudnessInputGroup
} from '../../shared/libraryLoudness.ts'
import type { LibraryLoudnessCache } from './libraryLoudnessCachePort.ts'
interface LibraryLoudnessManagerOptions {
  cache: Pick<LibraryLoudnessCache, 'get' | 'set' | 'clear'>
  authorizePath: (path: string) => Promise<string>
  analyze: (group: LoudnessInputGroup) => Promise<LoudnessGroupMeasurement>
  cancelWork: () => void
  onProgress?: (progress: LoudnessBatchProgress) => void
}
export declare class LibraryLoudnessManager {
  constructor(options: LibraryLoudnessManagerOptions)
  snapshot(): LoudnessBatchSnapshot
  summary(): LoudnessBatchProgress['status']
  page(offset: number, limit: number): LoudnessBatchItem[]
  start(groups: LoudnessInputGroup[]): LoudnessBatchSnapshot
  cancel(jobId?: string | null): Promise<void>
  results(groups: LoudnessInputGroup[]): Promise<LibraryLoudnessResult[]>
  clear(ids: string[]): void
}
export type {}
