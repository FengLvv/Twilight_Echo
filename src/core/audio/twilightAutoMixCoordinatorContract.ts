import type { AudioEngineQueueItem, PlaybackInfo } from '../../shared/audioEngineTypes.ts'
import type {
  AutoMixAnalysisResult,
  AutoMixMode,
  AutoMixSelection
} from '../../shared/twilightAutoMix.ts'
import type {
  identifyTwilightAutoMixFile,
  TwilightAutoMixWindowCache
} from './twilightAutoMixCachePort.ts'
export interface TwilightAutoMixContext {
  queueToken: string
  current: AudioEngineQueueItem
  next: AudioEngineQueueItem
  info: PlaybackInfo
}
export type AutoMixPrepareStage =
  | 'source'
  | 'analysis'
  | 'cache'
  | 'selection'
  | 'stems'
  | 'decode'
  | 'prepare'
  | 'submit'
export interface AutoMixDiagnosticEntry {
  stage: AutoMixPrepareStage
  outcome: 'ok' | 'retry' | 'fallback' | 'failed'
  reason: string
  elapsedMs: number
  attempt: number
}
export interface TwilightAutoMixCoordinatorDependencies {
  context(): TwilightAutoMixContext | null
  authorize(source: string): Promise<string>
  analyze(
    source: string,
    options: string,
    priority: 'boundary' | 'background',
    signal?: AbortSignal
  ): Promise<AutoMixAnalysisResult>
  cancelAnalysis(source: string): void
  scopedCancellation?: boolean
  select?(request: string): Promise<AutoMixSelection>
  releaseMaterials?(selection?: AutoMixSelection): Promise<void>
  stems?(
    selection: AutoMixSelection,
    request: string,
    signal: AbortSignal
  ): Promise<Record<string, unknown> | null>
  prepare(request: string): Promise<boolean>
  submit(planId: number): Promise<boolean>
  cancel(): Promise<boolean>
  status(): Promise<PlaybackInfo>
  cache: TwilightAutoMixWindowCache
  useSources?<T>(action: () => Promise<T>): Promise<T>
  identify?: typeof identifyTwilightAutoMixFile
  sourceRevision?(source: string): string
  assertSource?(source: string): void
  onState?(state: 'preparing' | 'ready' | 'degraded' | 'off', reason: string): void
  onDiagnostic?(entry: AutoMixDiagnosticEntry): void
  onNativePreparation?(): void
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}
export declare function autoMixFailureReason(error: unknown, stage: AutoMixPrepareStage): string
export declare function autoMixBoundaryStarts(
  duration: number,
  mode: AutoMixMode,
  deck: number
): number[]
export declare class TwilightAutoMixCoordinator {
  reason: string
  readonly diagnostics: AutoMixDiagnosticEntry[]
  constructor(d: TwilightAutoMixCoordinatorDependencies)
  setMode(mode: AutoMixMode): void
  invalidate(reason: string): void
  destroy(): void
  shutdown(): Promise<void>
  suspend(): Promise<void>
  resume(): void
  observe(): void
  idle(): Promise<void>
}
