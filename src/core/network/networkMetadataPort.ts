import type { NetworkEntry } from '../../shared/networkSources.ts'
import type { NetworkSourceSession } from './adapters/types.ts'
export declare function saveEntryCover(
  entryId: string,
  cover: Uint8Array | undefined,
  coverMime: string | undefined,
  coverCacheRoot: string
): Promise<string | undefined>
/** 下载条目到缓存并解析标签/封面，返回带 metadata 的条目（解析失败返回原条目）。 */
export declare function enrichNetworkEntry(deps: {
  session: NetworkSourceSession
  entry: NetworkEntry
  cacheRoot: string
  coverCacheRoot: string
  signal?: AbortSignal
}): Promise<NetworkEntry>
