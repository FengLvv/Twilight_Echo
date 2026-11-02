import type { CoreOutputTestState } from '../../shared/coreAudio.ts'
import type { CoreAudioOutputService } from './outputService.ts'
import type { OutputTestDependencies } from './outputTestPort.ts'
/** Test audio has its own supervised service, never the music queue or history. */
export declare class CoreOutputTestService {
  constructor(
    options: OutputTestDependencies & {
      configuration: CoreAudioOutputService
    }
  )
  state(): CoreOutputTestState
  play(
    revision: number,
    exclusive: boolean,
    signal: AbortSignal
  ): Promise<{
    cancelled: boolean
  }>
  /** Every accepted native transport finishes test-service exit before dispatch. */
  withTransport<T>(action: () => Promise<T>): Promise<T>
  stop(): Promise<void>
}
