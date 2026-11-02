import type {
  CoreNetworkEntry,
  CoreNetworkJobCommand,
  CoreNetworkPage,
  CoreNetworkPageQuery,
  CoreNetworkPlayback,
  CoreNetworkProfileEdit,
  CoreNetworkState
} from '../../shared/coreNetwork.ts'
import type {
  NetworkEntry,
  NetworkSourceProfile,
  NetworkSourceProfileSummary
} from '../../shared/networkSources.ts'
import type { TrackData } from '../../shared/track.ts'
import type { ResolvedSource } from '../playback/sourceResolver.ts'
import type { NetworkSourceAdapter } from './adapters/types.ts'
import type { NetworkLibraryIndex } from './networkLibraryContract.ts'
import type { NetworkProfileStore } from './profileStorePort.ts'
import type { NetworkDirectoryOption } from './sourcesManagerContract.ts'
interface Options {
  store: NetworkProfileStore
  library: NetworkLibraryIndex
  getAdapter(protocol: NetworkSourceProfile['protocol']): Promise<NetworkSourceAdapter | null>
  cacheRoot: NetworkDirectoryOption
  coverCacheRoot: NetworkDirectoryOption
  newId(): string
  now(): number
  changed(): void
}
/** One source owner; long IO never runs in the short profile/index commit lane. */
export declare class CoreNetworkService {
  constructor(options: Options)
  initialize(): Promise<void>
  state(): CoreNetworkState
  /** Private search identities; remote paths never cross the public search projection. */
  searchTracks(
    query: string,
    signal: AbortSignal
  ): Promise<
    {
      profileId: string
      profileName: string
      entry: NetworkEntry
    }[]
  >
  assertRevision(revision: number): void
  listProfiles(query: CoreNetworkPageQuery): CoreNetworkPage<NetworkSourceProfileSummary>
  profileIds(): ReadonlySet<string>
  edit(
    command: CoreNetworkProfileEdit,
    signal?: AbortSignal
  ): Promise<{
    state: CoreNetworkState
    profile?: NetworkSourceProfileSummary
  }>
  directory(
    query: CoreNetworkPageQuery & {
      profileId: string
      path: string
      token?: string
    },
    signal?: AbortSignal
  ): Promise<
    CoreNetworkPage<CoreNetworkEntry> & {
      token: string
    }
  >
  library(
    query: CoreNetworkPageQuery & {
      profileId?: string
      query?: string
    }
  ): Promise<
    CoreNetworkPage<
      CoreNetworkEntry & {
        profileName: string
      }
    >
  >
  test(
    id: string,
    signal?: AbortSignal
  ): Promise<{
    ok: boolean
    errorCode?: import('../../shared/networkSources.ts').NetworkSourceErrorCode
  }>
  removeEntry(
    command: {
      revision: number
      profileId: string
      entryId: string
    },
    signal?: AbortSignal
  ): Promise<CoreNetworkState>
  job(command: CoreNetworkJobCommand): CoreNetworkState
  playback(command: CoreNetworkPlayback, signal?: AbortSignal): Promise<TrackData>
  /** A persisted queue supplies identity, not a stale URL or a caller-owned entry. */
  resolve(track: TrackData, signal?: AbortSignal): Promise<ResolvedSource | null>
  cover(profileId: string, entryId: string): Promise<string | null>
  cacheInfo(): Promise<{
    sizeBytes: number
  }>
  clearCache(
    maintainSources: <T>(action: (sources: readonly string[]) => Promise<T>) => Promise<T>,
    signal?: AbortSignal
  ): Promise<{
    sizeBytes: number
  }>
  /** Aggregate cache ownership reuses the same real reader/writer drain without
   * recursively acquiring playback's source-maintenance lease. */
  maintainCache<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T>
  flush(): Promise<void>
  shutdown(): Promise<void>
}
export type {}
