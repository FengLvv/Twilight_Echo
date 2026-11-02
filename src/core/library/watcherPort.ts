import type {
  LibraryWatcherFolderStatus,
  LocalLibraryWatchChange
} from '../../shared/localLibraryScan.ts'
import type { LIBRARY_WATCH_EXTENSIONS } from './watcherExtensionsPort.ts'
export type {
  LibraryWatcherFolderStatus,
  LibraryWatcherMode,
  LibraryWatcherState
} from '../../shared/localLibraryScan.ts'
export type { LIBRARY_WATCH_EXTENSIONS }
interface ChangeSink {
  enqueueWatcherChanges(changes: LocalLibraryWatchChange[]): void
}
export interface DirectoryWatchHandle {
  on(event: 'error', listener: (error: Error) => void): unknown
  close(): void
}
export type WatchDirectory = (
  directory: string,
  options: { recursive: boolean },
  listener: (event: string, filename: string | null) => void
) => DirectoryWatchHandle
export interface LibraryWatcherOptions {
  watch?: WatchDirectory
  platform: string
  now(): Date
  debounceMs(): number
  database():
    | (ChangeSink & {
        poll(directory: string): Promise<boolean | undefined>
      })
    | null
  coordinator(): ChangeSink | null
  isExcluded(path: string): boolean
  isMutating(path: string): boolean
  changed(change?: { kind: 'add' | 'remove' | 'unknown'; path?: string }): void
}
/** One set of native handles and polling timers per business owner. */
export declare function createLibraryWatchers(options: LibraryWatcherOptions): {
  apply: (folders: string[], enabled: boolean) => void
  status: () => LibraryWatcherFolderStatus[]
  snapshot: (
    folders: string[],
    enabled: boolean
  ) => {
    enabled: boolean
    folders: LibraryWatcherFolderStatus[]
  }
  close: () => Promise<void>
}
