import type {
  BpmAnalysisResult,
  LoudnormStatus,
  PlaybackInfo
} from '../../shared/audioEngineTypes.ts'
import type { LibraryDatabaseApi } from '../../shared/libraryDatabase.ts'
import type { TrackData } from '../../shared/track.ts'
import type {
  BpmAnalysisManagerOptions,
  BpmAnalysisRequestResult
} from './bpmAnalysisManagerPort.ts'
import type {
  LoudnessAnalysisManager,
  LoudnessAnalysisManagerOptions,
  LoudnessAnalysisRequestResult
} from './loudnessAnalysisManagerPort.ts'
interface Options {
  root: string
  database: Pick<
    LibraryDatabaseApi,
    'getTracksByIds' | 'lookupTracksByPaths' | 'patchTracks' | 'queryTracks'
  >
  enabled(): boolean
  authorize(path: string): Promise<string>
  bpm: Pick<BpmAnalysisManagerOptions, 'analyzeFile' | 'cancelFile'>
  loudness: Pick<LoudnessAnalysisManagerOptions, 'analyzeFile' | 'cancelFile'>
  engine: {
    setLoudnessAnalysisManager(manager: LoudnessAnalysisManager | null): void
    notifyLoudnessCacheCleared(): Promise<void>
    getLoudnormStatus(): {
      status: LoudnormStatus
      source: string | null
    }
  }
  applyBpm(track: TrackData, analysis: BpmAnalysisResult): void
  clearBpm(): void
  changed(): void
  failed(error: unknown): void
}
/** Playback observation, analysis caches and library commits have one Core lifetime. */
export declare class CoreAnalysisService {
  constructor(options: Options)
  activate(): void
  observe(track: TrackData | null, info: Pick<PlaybackInfo, 'state'>): void
  request(input: {
    kind: 'bpm' | 'loudness'
    id: string
    version: number
  }): Promise<BpmAnalysisRequestResult | LoudnessAnalysisRequestResult>
  cacheSize(kind: 'bpm' | 'loudness'): Promise<number>
  status(): {
    status: LoudnormStatus
  }
  clearCache(kind: 'bpm' | 'loudness'): Promise<number>
  /** Stop both decoder work and result publication before changing source bytes. */
  maintain<T>(action: () => Promise<T>): Promise<T>
  shutdown(): Promise<void>
}
export type {}
