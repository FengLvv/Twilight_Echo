import type { LibraryMetadata } from '../../shared/libraryDatabase.ts'
import type { CoreScanService } from './scanService.ts'
import type { LibraryWatcherOptions } from './watcherPort.ts'
export interface CoreLibraryBackgroundOptions {
  database: {
    getMetadata(): Promise<LibraryMetadata>
  }
  scan: Pick<CoreScanService, 'startup' | 'poll' | 'enqueueDirectories'>
  enabled(): boolean
  authorizeDirectory(path: string): Promise<string>
  pathKey(path: string): string
  directoryOf(path: string): string
  platform: string
  now(): Date
  failed(error: unknown): void
  watch?: LibraryWatcherOptions['watch']
}
/** Core owns library startup and file monitoring independently of connected windows. */
export declare class CoreLibraryBackground {
  constructor(options: CoreLibraryBackgroundOptions)
  activate(): void
  configure(): Promise<void>
  snapshot(): {
    enabled: boolean
    folders: import('./watcherPort.ts').LibraryWatcherFolderStatus[]
  }
  shutdown(): Promise<void>
}
