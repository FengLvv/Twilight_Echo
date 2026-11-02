import type { DownloadPreferences } from '../../shared/downloadPreferences.ts'
import type {
  ProviderDownloadCreateInput,
  ProviderDownloadTaskSnapshot
} from '../../shared/providerDownloads.ts'
import type { TwilightPluginManager } from '../plugins/managerPort.ts'
import type { FetchDownloadCover, prepareDownloadedMetadata } from './downloadMetadataPort.ts'
export interface ProviderDownloadManagerOptions {
  getPreferences?: () => DownloadPreferences
  pluginManager: Pick<TwilightPluginManager, 'callProvider'>
  authorizedRoots: () => Promise<{
    libraryRoots: string[]
    downloadRoot: string | null
  }>
  indexer?: () => ((path: string) => void | Promise<void>) | null
  grant: (path: string) => Promise<string>
  fetchCover?: FetchDownloadCover
  prepareMetadata?: typeof prepareDownloadedMetadata
  onChanged: () => void
  log?: (taskId: string, previous: string, patch: Partial<ProviderDownloadTaskSnapshot>) => void
  fetch?: typeof globalThis.fetch
  now?: () => Date
}
export declare class ProviderDownloadManager {
  constructor(options: ProviderDownloadManagerOptions)
  list(): ProviderDownloadTaskSnapshot[]
  page(offset: number, limit: number): ProviderDownloadTaskSnapshot[]
  get(id: string): ProviderDownloadTaskSnapshot
  counts(): {
    total: number
    active: number
  }
  completedResult(taskId: string, addToLibrary?: boolean): Promise<string>
  create(input: ProviderDownloadCreateInput): Promise<ProviderDownloadTaskSnapshot>
  cancel(taskId: string): Promise<void>
  retry(taskId: string): Promise<ProviderDownloadTaskSnapshot>
  shutdown(): Promise<void>
}
