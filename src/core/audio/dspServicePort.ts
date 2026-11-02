import type { AppSettings } from '../../shared/appSettings.ts'
import type {
  AudioProcessingSettings,
  ConvolverInfo,
  PlaybackInfo
} from '../../shared/audioEngineTypes.ts'
import type {
  CoreDspEdit,
  CoreDspImport,
  CoreDspState,
  CoreVst3Edit,
  CoreVst3Page,
  CoreVst3Parameters
} from '../../shared/coreDsp.ts'
import type { CorePlatformOperations } from '../../shared/corePlatform.ts'
import type { CoreStateApi } from '../../shared/coreState.ts'
import type {
  DspGraphStatus,
  DspOutputStageConfig,
  DspScene,
  DspSceneState,
  DspStereoImageConfig
} from '../../shared/dspGraph.ts'
import type { CoreSettingsRepository } from '../persistence/settingsRepositoryContract.ts'
import type { DspAssetLibrary } from './dspAssetLibraryPort.ts'
import type { CoreAudioOutputService } from './outputService.ts'
import type { Vst3CatalogService } from './vst3CatalogPort.ts'
export interface CoreDspEngine {
  configureDsp<T>(operation: (configuration: CoreDspConfiguration) => Promise<T>): Promise<T>
  getAudioProcessing(): AudioProcessingSettings
  setAudioProcessing(settings: Partial<AudioProcessingSettings>): Promise<AudioProcessingSettings>
  getDspSceneState(): DspSceneState
  setDspScenes(scenes: DspScene[], pin: string | null): Promise<DspSceneState>
  setOutputStage(settings: Partial<DspOutputStageConfig>): Promise<DspSceneState>
  setStereoImage(settings: Partial<DspStereoImageConfig>): Promise<DspSceneState>
  applyDspScene(id: string | null, confirm?: boolean): Promise<DspSceneState>
  getDspGraphStatus(): Promise<DspGraphStatus>
  getConvolverInfo(): ConvolverInfo
  refreshDspGraph(): void
  clearVst3RecoveryBypass(id: string): void
  stop(): Promise<void>
}
export type CoreDspConfiguration = Pick<
  CoreDspEngine,
  | 'getAudioProcessing'
  | 'setAudioProcessing'
  | 'getDspSceneState'
  | 'setDspScenes'
  | 'setOutputStage'
  | 'setStereoImage'
  | 'applyDspScene'
> & {
  checkpointConfiguration(): () => Promise<void>
}
export interface CoreDspPlatform {
  call<K extends keyof CorePlatformOperations>(
    name: K,
    payload: CorePlatformOperations[K]['input'],
    signal?: AbortSignal
  ): Promise<CorePlatformOperations[K]['output']>
}
/** Owns DSP configuration and repositories; native retains graph compilation/rendering. */
export declare class CoreDspService {
  constructor(options: {
    engine: CoreDspEngine
    configuration: CoreAudioOutputService
    settings: CoreSettingsRepository
    preferences: Pick<CoreStateApi, 'coreStateRead'>
    assets: DspAssetLibrary
    catalog: Vst3CatalogService
    platform: CoreDspPlatform
    temporaryDirectory: string
    now(): number
    newId(): string
    failed(error: unknown): void
  })
  initialize(): Promise<void>
  /** Browser import must finish before its EQ preference becomes effective. */
  activate(): Promise<void>
  observePlayback(info: PlaybackInfo): void
  state(): Promise<CoreDspState>
  status(): Promise<DspGraphStatus>
  /** Settings import shares the output lane; authorization precedes every native mutation. */
  prepareSettingsRestore(next: AppSettings, signal: AbortSignal): Promise<AppSettings>
  restoreSettings(next: AppSettings): Promise<Partial<AppSettings>>
  edit(request: CoreDspEdit, signal: AbortSignal): Promise<void>
  assets(
    offset?: number,
    limit?: number
  ): Promise<{
    revision: number
    total: number
    items: import('../../shared/dspGraph.ts').DspAsset[]
  }>
  correction(id: string): Promise<import('../../shared/dspGraph.ts').DspCorrectionProfile>
  removeAsset(revision: number, id: string, signal: AbortSignal): Promise<void>
  import(request: CoreDspImport, signal: AbortSignal): Promise<unknown>
  export(revision: number, name: string, signal: AbortSignal): Promise<unknown>
  vst3(offset?: number, limit?: number): Promise<CoreVst3Page>
  parameters(
    id: string,
    revision: number,
    offset?: number,
    limit?: number
  ): Promise<CoreVst3Parameters>
  chooseDirectory(signal: AbortSignal): Promise<string | null>
  editVst3(request: CoreVst3Edit, signal: AbortSignal): Promise<void>
  quarantineActive(reason: string): Promise<void>
  flush(): Promise<void>
  shutdown(): Promise<void>
}
