import type { AutoMixSelection } from '../../shared/twilightAutoMix.ts'
export declare function validateStemMaterial(
  path: string,
  length: number,
  digest: string,
  signal: AbortSignal
): Promise<void>
export declare const STEM_CHECKPOINT_SHA256 =
  '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4'
export declare const STEM_MODEL_VERSION = 'demucs-4.0.1:955717e8'
export declare function stemResultMatchesRun(
  result: {
    runId?: unknown
    stemMaterials?: {
      selectionId?: unknown
      version?: unknown
      modelVersion?: unknown
      arrangementVersion?: unknown
    }
  },
  selection: AutoMixSelection,
  runId: string
): boolean
export declare function stemBudgetMs(selectionStart: number, position: number): number
export declare function findAutoMixStemPack(candidates: string[]): string | null
export declare class AutoMixStemService {
  constructor(options: {
    cacheDirectory: string
    pack: () => string | null | Promise<string | null>
    enabled: () => boolean
    reportResources?: (resources: Record<string, unknown>) => void
    cacheMiB: () => unknown
    workerDirectory: () => string
    device: () => unknown
    temporaryDirectory: string
    runWorker: (
      pack: string,
      worker: string,
      request: string,
      budget: number,
      signal: AbortSignal
    ) => Promise<void>
  })
  select(
    request: string,
    select: (request: string) => Promise<AutoMixSelection>
  ): Promise<AutoMixSelection>
  prepare(
    selection: AutoMixSelection,
    position: () => number,
    signal: AbortSignal
  ): Promise<Record<string, unknown> | null>
  release(selection?: AutoMixSelection): Promise<void>
}
