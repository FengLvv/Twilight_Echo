import type { FileAnalysisManager } from './fileAnalysisManagerPort.ts'
import type {
  LoudnessAnalysisCache,
  LoudnessAnalysisCacheIdentity,
  LoudnessAnalysisResult
} from './loudnessCachePort.ts'
export interface LoudnessAnalysisRequest {
  trackId: string
  filePath: string
  targetLufs?: number
  truePeakCeilingDb?: number
  priority?: number
}
export type LoudnessAnalysisRequestResult =
  | {
      status: 'completed'
      analysis: LoudnessAnalysisResult
    }
  | {
      status: 'cached'
      analysis: LoudnessAnalysisResult
    }
  | {
      status: 'skipped'
      reason: string
    }
  | {
      status: 'failed'
      reason: string
    }
  | {
      status: 'unavailable'
      reason: string
    }
export interface LoudnessAnalysisManagerOptions {
  cache: LoudnessAnalysisCache
  analyzeFile: (request: LoudnessAnalysisRequest) => Promise<LoudnessAnalysisResult | null>
  cancelFile?: (filePath?: string) => void
  failureCooldownMs?: number
  now?: () => number
  onComplete?: (event: {
    trackId: string
    filePath: string
    analysis: LoudnessAnalysisResult
  }) => void
}
export declare class LoudnessAnalysisManager extends FileAnalysisManager<
  LoudnessAnalysisRequest,
  LoudnessAnalysisResult,
  LoudnessAnalysisCacheIdentity,
  {
    status: 'unavailable'
    reason: string
  }
> {
  constructor(options: LoudnessAnalysisManagerOptions)
  peekCached(request: LoudnessAnalysisRequest): Promise<LoudnessAnalysisResult | null>
  clearFailures(): void
}
