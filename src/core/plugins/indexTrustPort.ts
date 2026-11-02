import type { PortableBuffer } from '../../shared/portableBytes.ts'
import type {
  TwilightPluginIndexLoadedFrom,
  TwilightPluginPublisherSignature,
  TwilightPluginVerification
} from './types.ts'
export type { OFFICIAL_PLUGIN_INDEX_URL } from '../../shared/pluginDistribution.ts'
export interface TrustedPluginPublisherKey {
  keyId: string
  publisher: string
  algorithm: 'ed25519'
  publicKeyPem: string
  status?: 'active' | 'revoked'
  notBefore?: string
  notAfter?: string
}
export interface TrustedPluginPublisherRegistryFile {
  schemaVersion: 1
  keys: TrustedPluginPublisherKey[]
  revokedKeyIds?: string[]
}
export interface NormalizedTrustedPublisherKey extends TrustedPluginPublisherKey {
  status: 'active' | 'revoked'
  keyObject: unknown
  fingerprintSha256: string
  notBeforeMs: number | null
  notAfterMs: number | null
}
export interface TrustedPluginPublisherRegistry {
  keys: ReadonlyMap<string, NormalizedTrustedPublisherKey>
  revokedKeyIds: ReadonlySet<string>
  error: string | null
}
export interface PluginIndexTrustContext {
  indexOrigin: string
  loadedFrom: TwilightPluginIndexLoadedFrom
  stale: boolean
  expired: boolean
  originVerified: boolean
}
export declare function loadTrustedPluginPublisherRegistry(
  registryPath: string
): TrustedPluginPublisherRegistry
export declare function createTrustedPluginPublisherRegistry(
  raw: unknown
): TrustedPluginPublisherRegistry
export declare function createPluginIndexSignaturePayload(
  entry: Record<string, unknown>,
  indexOrigin: string
): PortableBuffer
export declare function createPluginIndexEntryFingerprint(
  entry: Record<string, unknown>,
  indexOrigin: string
): string
export declare function verifyPluginIndexEntry(
  entry: Record<string, unknown>,
  context: PluginIndexTrustContext,
  registry: TrustedPluginPublisherRegistry,
  now: Date
): {
  signature?: TwilightPluginPublisherSignature
  verification: TwilightPluginVerification
}
