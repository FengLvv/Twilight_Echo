import { createDiagnosticsServiceDomain } from '../../../core/audio/diagnosticsServiceDomain.ts'
import {
  AudioDiagnosticRecorder,
  collectDsdPcmBlockers,
  createPlaybackDiagnosticEvent
} from '../../adapters/audio/audioDiagnostics.ts'

export const { CoreAudioDiagnosticsService } = createDiagnosticsServiceDomain({
  AudioDiagnosticRecorder,
  createPlaybackDiagnosticEvent,
  collectDsdPcmBlockers
})
export type * from '../../../core/audio/diagnosticsServiceContract.ts'

export type CoreAudioDiagnosticsService =
  import('../../../core/audio/diagnosticsServiceContract.ts').CoreAudioDiagnosticsService
