import type {
  AudioDiagnosticBlocker,
  AudioDiagnosticEnvironment,
  AudioDiagnosticEvent,
  AudioDiagnosticReport,
  AudioDiagnosticSnapshot
} from '../../shared/coreAudioDiagnostics.ts'
import type { DspSceneState } from '../../shared/dspGraph.ts'
import type {
  AudioOutputState,
  AudioProcessingSettings,
  OutputConfig,
  PlaybackInfo
} from './audioEngineTypes.ts'
export type {
  AudioDiagnosticBlocker,
  AudioDiagnosticEnvironment,
  AudioDiagnosticEvent,
  AudioDiagnosticReport,
  AudioDiagnosticSnapshot
} from '../../shared/coreAudioDiagnostics.ts'
export interface AudioDiagnosticRecorderOptions {
  directory: string
  environment: AudioDiagnosticEnvironment
  maxLogBytes?: number
  writeDiagnostic?(
    event: string,
    details: unknown,
    level: 'info' | 'warn' | 'error'
  ): {
    eventId: string
  } | null
}
export declare class AudioDiagnosticRecorder {
  readonly sessionId: `${string}-${string}-${string}-${string}-${string}`
  constructor(options: AudioDiagnosticRecorderOptions)
  record(event: string, details?: unknown, level?: AudioDiagnosticEvent['level']): void
  /**
   * Assemble the report without writing it.
   *
   * Split out from {@link exportReport} so the human-readable renderer can work
   * from the same object the JSON is serialized from — the prose report and the
   * machine report must never describe different states. The renderer lives in
   * `diagnosticReport.ts`, which imports these types, so composing the two
   * happens at the call site rather than here (a direct import would be a cycle).
   */
  buildReport(snapshot: AudioDiagnosticSnapshot, locale?: string): Promise<AudioDiagnosticReport>
  exportReport(
    filePath: string,
    snapshot: AudioDiagnosticSnapshot,
    locale?: string
  ): Promise<AudioDiagnosticReport>
  flush(): Promise<void>
}
export declare function summarizeAudioSource(source: string): {
  kind: 'local-file' | 'remote-url' | 'custom-url' | 'unknown'
  extension: string
  fingerprint: string
}
export declare function redactAudioDiagnosticValue(value: unknown, key?: string): unknown
export declare function redactSensitiveText(value: string): string
export declare function collectDsdPcmBlockers(input: {
  playback: Pick<PlaybackInfo, 'volume' | 'playbackRate'>
  processing: AudioProcessingSettings
  outputConfig: OutputConfig
  sceneState: DspSceneState
}): AudioDiagnosticBlocker[]
export declare function createPlaybackDiagnosticEvent(input: {
  playback: PlaybackInfo
  processing: AudioProcessingSettings
  outputConfig: OutputConfig
  sceneState: DspSceneState
  selectedOutput?: Pick<AudioOutputState, 'output' | 'device' | 'exclusiveMode'>
}): Record<string, unknown>
