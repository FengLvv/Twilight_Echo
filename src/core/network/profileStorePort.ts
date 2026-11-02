import type {
  NetworkSourceProfile,
  NetworkSourceProfileInput,
  NetworkSourceProfileSummary
} from '../../shared/networkSources.ts'
import type { NetworkAuth } from './adapters/types.ts'
export type { NetworkSourceProfileInput } from '../../shared/networkSources.ts'
/** 凭据加密接缝：生产用 secureStorage，测试注入假 codec。 */
export interface CredentialCodec {
  encrypt(plain: string): string | Promise<string>
  decrypt(encrypted: string): string | Promise<string>
}
export interface NetworkProfileStore {
  listProfiles(): Promise<NetworkSourceProfileSummary[]>
  getProfile(id: string): Promise<NetworkSourceProfile>
  createProfile(input: NetworkSourceProfileInput): Promise<NetworkSourceProfileSummary>
  updateProfile(
    id: string,
    patch: Partial<NetworkSourceProfileInput>
  ): Promise<NetworkSourceProfileSummary>
  deleteProfile(id: string): Promise<void>
  resolveAuth(id: string): Promise<NetworkAuth>
}
export declare function validateProfileInput(input: NetworkSourceProfileInput): void
export declare function createNetworkProfileStore(deps: {
  filePath: string
  codec: CredentialCodec
  now?: () => number
  newId?: () => string
}): NetworkProfileStore
