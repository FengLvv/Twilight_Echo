import type { BpmAnalysisResult, BpmTempoSegment } from '../../shared/audioEngineTypes.ts'
import type { FileAnalysisCache } from './fileAnalysisCachePort.ts'
export type { BpmAnalysisResult, BpmTempoSegment }
export declare const BPM_ANALYSIS_ALGORITHM_VERSION = 1
export interface BpmAnalysisCacheIdentity {
  filePath: string
  size: number
  mtimeMs: number
  algorithmVersion?: number
}
export declare function buildBpmAnalysisCacheKey(identity: BpmAnalysisCacheIdentity): string
export declare class BpmAnalysisCache extends FileAnalysisCache<
  BpmAnalysisCacheIdentity,
  BpmAnalysisResult
> {
  constructor(cachePath: string)
}
export declare function isBpmAnalysisResult(value: unknown): value is BpmAnalysisResult
