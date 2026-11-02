export type FileAnalysisRequestResult<Analysis, Unavailable = never> =
  | {
      status: 'completed'
      analysis: Analysis
    }
  | {
      status: 'cached'
      analysis: Analysis
    }
  | {
      status: 'skipped'
      reason: string
    }
  | {
      status: 'failed'
      reason: string
    }
  | Unavailable
interface FileAnalysisRequest {
  trackId: string
  filePath: string
}
interface AnalysisCache<Identity, Analysis> {
  get: (identity: Identity) => Promise<Analysis | null>
  set: (identity: Identity, analysis: Analysis) => Promise<void>
  deleteIfMatches: (identity: Identity, analysis: Analysis) => Promise<boolean>
}
interface FileAnalysisManagerOptions<
  Request extends FileAnalysisRequest,
  Analysis,
  Identity,
  Unavailable
> {
  cache: AnalysisCache<Identity, Analysis>
  analyzeFile: (request: Request) => Promise<Analysis | null>
  cancelFile?: (filePath?: string) => void
  failureCooldownMs?: number
  now?: () => number
  onComplete?: (event: { trackId: string; filePath: string; analysis: Analysis }) => void
  buildIdentity: (request: Request, size: number, mtimeMs: number) => Identity
  rejectAnalysis?: (analysis: Analysis) => Unavailable | null
}
/** One owner for deduplication, cooldown, cancellation and cache rollback. */
export declare class FileAnalysisManager<
  Request extends FileAnalysisRequest,
  Analysis,
  Identity,
  Unavailable = never
> {
  constructor(options: FileAnalysisManagerOptions<Request, Analysis, Identity, Unavailable>)
  requestAnalysis(request: Request): Promise<FileAnalysisRequestResult<Analysis, Unavailable>>
  cancel(filePath?: string): void
  /** Join cache writes/rollback as well as the worker, before maintenance or exit. */
  join(): Promise<void>
  suspend(): void
  resume(): void
}
export type {}
