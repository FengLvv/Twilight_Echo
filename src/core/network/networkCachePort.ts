import type { NetworkEntry } from '../../shared/networkSources.ts'
import type { NetworkSourceSession } from './adapters/types.ts'
/**
 * 把远程条目下载到 network-cache。
 * 缓存键使用条目稳定 id（协议+profile+路径哈希），文件名不信任远程名。
 */
type Download = {
  session: NetworkSourceSession
  entry: NetworkEntry
  cacheRoot: string
  signal?: AbortSignal
}
export declare function downloadEntryToCache(deps: Download): Promise<string>
export declare function networkCacheDir(musicCacheRoot: string): string
export declare function getDirectorySize(directory: string): Promise<number>
export declare function clearDirectory(directory: string): Promise<void>
/** Native keeps its current/preloaded files; writers must be joined by the owner. */
export declare function clearUnpinnedCache(
  directory: string,
  sources: readonly string[],
  signal?: AbortSignal
): Promise<void>
export type {}
