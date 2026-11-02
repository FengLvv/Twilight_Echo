import type {
  NetworkEntry,
  NetworkPlaybackPlan,
  NetworkSourceErrorCode,
  NetworkSourceProfile,
  NetworkSourceProfileSummary
} from '../../shared/networkSources.ts'
import type { NetworkSourceAdapter } from './adapters/types.ts'
import type { NetworkLibraryIndex } from './networkLibraryContract.ts'
import type { NetworkProfileStore, NetworkSourceProfileInput } from './profileStorePort.ts'
export interface NetworkSourcesManager {
  listProfiles(): Promise<NetworkSourceProfileSummary[]>
  createProfile(input: NetworkSourceProfileInput): Promise<NetworkSourceProfileSummary>
  updateProfile(
    id: string,
    patch: Partial<NetworkSourceProfileInput>
  ): Promise<NetworkSourceProfileSummary>
  deleteProfile(id: string): Promise<void>
  listDirectory(
    profileId: string,
    remotePath: string,
    signal?: AbortSignal
  ): Promise<NetworkEntry[]>
  testConnection(
    profileId: string,
    signal?: AbortSignal
  ): Promise<{
    ok: boolean
    errorCode?: NetworkSourceErrorCode
  }>
  resolvePlayback(
    profileId: string,
    entry: NetworkEntry,
    signal?: AbortSignal
  ): Promise<NetworkPlaybackPlan>
  scanDirectory(
    profileId: string,
    dirPath: string,
    signal?: AbortSignal
  ): Promise<{
    added: number
    total: number
  }>
  listLibrary(profileId: string, query?: string): Promise<NetworkEntry[]>
  removeLibraryEntry(profileId: string, entryId: string): Promise<void>
  enrichLibrary(
    profileId: string,
    signal?: AbortSignal
  ): Promise<{
    enriched: number
    failed: number
  }>
  searchLibrary(query?: string): Promise<
    Array<{
      profileId: string
      profileName: string
      entry: NetworkEntry
    }>
  >
}
export type NetworkDirectoryOption = string | (() => string)
export declare function createNetworkSourcesManager(deps: {
  store: NetworkProfileStore
  cacheRoot: NetworkDirectoryOption
  coverCacheRoot: NetworkDirectoryOption
  getAdapter: (protocol: NetworkSourceProfile['protocol']) => Promise<NetworkSourceAdapter | null>
  library: NetworkLibraryIndex
  commit?<T>(profileId: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T>
}): NetworkSourcesManager
