import type { LoudnessAnalysisResult } from '../../shared/audioEngineTypes.ts'
import type { FileAnalysisCache } from './fileAnalysisCachePort.ts'
export type { LoudnessAnalysisResult }
export declare const LOUDNESS_ANALYSIS_ALGORITHM_VERSION = 2
export declare const LOUDNORM_DEFAULT_TARGET_LUFS = -23
export declare const LOUDNORM_DEFAULT_TRUE_PEAK_CEILING_DB = -1
/** Soft cap on cached identities; oldest analyzedAt entries are evicted first. */
export declare const LOUDNESS_ANALYSIS_CACHE_MAX_ENTRIES = 512
export interface LoudnessAnalysisCacheIdentity {
  filePath: string
  size: number
  mtimeMs: number
  algorithmVersion?: number
  targetLufs?: number
  truePeakCeilingDb?: number
}
export declare function buildLoudnessAnalysisCacheKey(
  identity: LoudnessAnalysisCacheIdentity
): string
export declare class LoudnessAnalysisCache extends FileAnalysisCache<
  LoudnessAnalysisCacheIdentity,
  LoudnessAnalysisResult
> {
  constructor(cachePath: string, maxEntries?: number)
  getEntryCount(): Promise<number>
}
/** Evict oldest analyzedAt entries until at or under maxEntries. */
export declare function pruneLoudnessCacheEntries(
  entries: Record<string, LoudnessAnalysisResult>,
  maxEntries: number
): void
export declare function isLoudnessAnalysisResult(value: unknown): value is LoudnessAnalysisResult
