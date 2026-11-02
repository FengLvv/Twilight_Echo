interface AnalysisCacheOptions<Identity, Analysis> {
  key: (identity: Identity) => string
  isAnalysis: (value: unknown, identity: Identity) => value is Analysis
  prune?: (entries: Record<string, Analysis>) => void
}
/** Shared version-1 storage; adapters own identity, validation and eviction rules. */
export declare class FileAnalysisCache<Identity, Analysis> {
  constructor(cachePath: string, options: AnalysisCacheOptions<Identity, Analysis>)
  get(identity: Identity): Promise<Analysis | null>
  set(identity: Identity, analysis: Analysis): Promise<void>
  deleteIfMatches(identity: Identity, analysis: Analysis): Promise<boolean>
  getSize(): Promise<number>
  clear(): Promise<number>
}
export type {}
