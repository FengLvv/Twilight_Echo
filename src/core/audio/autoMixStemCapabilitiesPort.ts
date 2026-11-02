import type { AutoMixStemCapabilities, AutoMixStemDevice } from '../../shared/twilightAutoMix.ts'
export interface StemRuntimeProbe {
  cpu: boolean
  gpu: boolean
  gpuName?: string
}
export type StemRuntimeProbeFunction = (
  directory: string,
  workerDirectory: string
) => Promise<StemRuntimeProbe>
export declare class AutoMixStemDetector {
  constructor(
    candidates: () => string[],
    workerDirectory: () => string,
    probe: StemRuntimeProbeFunction
  )
  get(refresh?: boolean): Promise<AutoMixStemCapabilities>
  resolveDevice(device: AutoMixStemDevice): Promise<string | null>
}
