import type { AutoMixFeatures } from '../../shared/twilightAutoMix.ts'
/** Host supplies the actual content/resolution identity, including online quality.
 * Song IDs and URLs alone are never analysis cache identities. */
export interface TwilightAutoMixWindowIdentity {
  sourceIdentity: string
  sourceStartSeconds: number
  sourceEndSeconds: number
  modelVersion: string
  parametersSha256: string
  windowStartSeconds: number
  windowEndSeconds: number
}
export declare function twilightAutoMixWindowKey(i: TwilightAutoMixWindowIdentity): string
export declare function isTwilightAutoMixWindowResult(
  identity: TwilightAutoMixWindowIdentity,
  features: unknown
): features is AutoMixFeatures
export declare class TwilightAutoMixWindowCache {
  constructor(file: string, limit?: number)
  get(identity: TwilightAutoMixWindowIdentity): Promise<AutoMixFeatures | null>
  set(identity: TwilightAutoMixWindowIdentity, features: AutoMixFeatures): Promise<void>
  /** Union coverage is reported separately; no single window is relabelled complete. */
  coverage(
    identity: Omit<TwilightAutoMixWindowIdentity, 'windowStartSeconds' | 'windowEndSeconds'>
  ): Promise<{
    complete: boolean
    ranges: [number, number][]
  }>
  clear(): Promise<void>
}
/** Worker/control path only. Caller must first resolve the existing authorization.
 * Hash the actual open file and reject replacement/mutation during the read. */
export declare function identifyTwilightAutoMixFile(
  authorizedPath: string,
  signal?: AbortSignal
): Promise<string>
