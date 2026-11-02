import type { CoreCastSafetyTarget } from '../../shared/coreCast.ts'
import type { CastDevice, CastLoadRequest, CastSample } from './castBackend.ts'
export interface CoreCastBackend {
  discover(): Promise<CastDevice[]>
  load(device: CastDevice, request: CastLoadRequest, signal: AbortSignal): Promise<void>
  control(
    device: CastDevice,
    command: 'play' | 'pause' | 'stop' | 'seek' | 'volume',
    value?: number
  ): Promise<void>
  sample(device: CastDevice, signal: AbortSignal): Promise<CastSample>
}
/** Reuse both existing wire protocols. Only discovered endpoints reach here. */
export declare function createCastBackend(safety: {
  arm(target: CoreCastSafetyTarget): Promise<void>
  disarm(deviceId: string): Promise<void>
}): CoreCastBackend
