import type { AppSettings } from '../../shared/appSettings.ts'
import type {
  AudioOutputState,
  AudioProcessingSettings,
  OutputConfig,
  OutputConfigApplyStatus,
  PlaybackInfo
} from '../../shared/audioEngineTypes.ts'
import type {
  AudioDiagnosticEnvironment,
  AudioDiagnosticReport
} from '../../shared/coreAudioDiagnostics.ts'
import type { DspGraphStatus, DspSceneState } from '../../shared/dspGraph.ts'
import type { AppLocale } from '../../shared/i18n/locale.ts'
export interface CoreAudioDiagnosticsEngine {
  on(event: string, listener: (...args: any[]) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  getPlaybackInfo(): Promise<PlaybackInfo>
  getAudioOutputState(): Promise<AudioOutputState>
  getOutputConfig(): OutputConfig
  getEffectiveOutputConfig(): OutputConfig
  getOutputConfigApplyStatus(): OutputConfigApplyStatus
  getAudioProcessing(): AudioProcessingSettings
  getDspSceneState(): DspSceneState
  getDspGraphStatus(): Promise<DspGraphStatus>
  getNativeRuntimeIdentity(): Record<string, string> | null
  readEngineDiagnosticLog(cursor: number): Promise<string | null>
}
export interface CoreAudioDiagnosticsOptions {
  engine: CoreAudioDiagnosticsEngine
  settings(): AppSettings
  directory: string
  environment: AudioDiagnosticEnvironment
  failed(error: unknown): void
}
/** Durable audio evidence belongs to Core, not to the presence of a settings page. */
export declare class CoreAudioDiagnosticsService {
  constructor(options: CoreAudioDiagnosticsOptions)
  report(locale: AppLocale): Promise<AudioDiagnosticReport>
  shutdown(): Promise<void>
}
