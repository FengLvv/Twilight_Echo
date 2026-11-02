import type { NetworkEntry } from '../../shared/networkSources.ts'
import type { NetworkLibraryPersistence } from './networkLibraryPersistencePort.ts'
export interface NetworkLibraryIndex {
  addEntries(
    profileId: string,
    root: string,
    entries: NetworkEntry[]
  ): Promise<{
    added: number
    total: number
  }>
  listEntries(profileId: string, query?: string): Promise<NetworkEntry[]>
  searchEntries(
    profileIds: readonly string[],
    query?: string
  ): Promise<
    Array<{
      profileId: string
      entry: NetworkEntry
    }>
  >
  updateEntries(profileId: string, entries: NetworkEntry[]): Promise<void>
  removeEntry(profileId: string, entryId: string): Promise<void>
  removeProfile(profileId: string): Promise<void>
}
/**
 * 网络源虚拟媒体库索引：只记录远程条目（不拷贝文件），支持根目录重扫替换。
 * 条目 id 为协议+profile+路径的稳定哈希，重扫不会产生重复。
 */
export declare function createNetworkLibrary(deps: {
  filePath: string
  persistence?: NetworkLibraryPersistence
}): NetworkLibraryIndex
