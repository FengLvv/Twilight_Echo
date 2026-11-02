import type { NetworkEntry } from '../../shared/networkSources.ts'
interface LibraryProfileIndex {
  roots: string[]
  entries: NetworkEntry[]
}
export type NetworkLibraryDocument = Record<string, LibraryProfileIndex>
export interface NetworkLibraryPersistence {
  load(): Promise<NetworkLibraryDocument>
  save(document: NetworkLibraryDocument): Promise<void>
}
/** One in-flight read, no retained document cache or stale-file TTL. */
export declare function createNetworkLibraryPersistence(filePath: string): NetworkLibraryPersistence
export type {}
