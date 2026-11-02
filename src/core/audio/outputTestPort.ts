import type { OutputConfig } from '../../shared/audioEngineTypes.ts'
import type { PortableBuffer } from '../../shared/portableBytes.ts'
export declare const OUTPUT_TEST_DURATION_MS = 1800
/** Quiet, faded PCM notes: left channel first, then right. */
export declare function createOutputTestWav(): PortableBuffer
export interface OutputTestContext {
  backend: string
  device: string
  volume: number
  outputConfig: OutputConfig
  playing: boolean
}
export interface OutputTestService {
  callAsync: (method: string, args: unknown[]) => Promise<unknown>
  destroy: () => void | Promise<void>
}
export interface OutputTestDependencies {
  temporaryDirectory: string
  timers: {
    setTimeout(callback: () => void, delay: number): unknown
    clearTimeout(handle: unknown): void
  }
  context: (exclusive: boolean) => Promise<OutputTestContext>
  createService: () => OutputTestService
  durationMs?: number
}
/** A separate native service leaves the user's queue, position and stats alone. */
export declare class OutputTest {
  constructor(dependencies: OutputTestDependencies)
  stop(): Promise<void>
  play(exclusive: boolean): Promise<{
    cancelled: boolean
  }>
}
