import type {
  BpmAnalysisCache,
  BpmAnalysisCacheIdentity,
  BpmAnalysisResult
} from './bpmCachePort.ts'
import type { FileAnalysisManager } from './fileAnalysisManagerPort.ts'
export interface BpmAnalysisRequest {
  trackId: string
  filePath: string
  referenceBpm?: number
  priority?: number
}
export type BpmAnalysisRequestResult =
  | {
      status: 'completed'
      analysis: BpmAnalysisResult
    }
  | {
      status: 'cached'
      analysis: BpmAnalysisResult
    }
  | {
      status: 'skipped'
      reason: string
    }
  | {
      status: 'failed'
      reason: string
    }
export interface BpmAnalysisManagerOptions {
  cache: BpmAnalysisCache
  analyzeFile: (request: BpmAnalysisRequest) => Promise<BpmAnalysisResult | null>
  cancelFile?: (filePath?: string) => void
  failureCooldownMs?: number
  now?: () => number
  onComplete?: (event: { trackId: string; filePath: string; analysis: BpmAnalysisResult }) => void
}
export declare class BpmAnalysisManager extends FileAnalysisManager<
  BpmAnalysisRequest,
  BpmAnalysisResult,
  BpmAnalysisCacheIdentity
> {
  constructor(options: BpmAnalysisManagerOptions)
}
