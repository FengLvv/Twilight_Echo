import type { LoudnessGroupMeasurement } from '../../shared/libraryLoudness.ts'
export declare function loudnessDigest(value: string): string
export declare class LibraryLoudnessCache {
  constructor(directory: string)
  get(id: string, fingerprint: string): LoudnessGroupMeasurement | null
  set(id: string, fingerprint: string, measurement: LoudnessGroupMeasurement): void
  clear(ids: readonly string[]): void
}
