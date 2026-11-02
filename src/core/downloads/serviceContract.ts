import type {
  CoreDownloadCreate,
  CoreDownloadTask,
  CoreDownloadsPage,
  CoreDownloadsQuery,
  CoreDownloadsState
} from '../../shared/coreDownloads.ts'
import type { TrackData } from '../../shared/track.ts'
import type { ProviderDownloadManagerOptions } from './providerDownloadManagerPort.ts'
/** One owner outlives every UI attachment; public operations use task identities. */
export declare class CoreDownloadsService {
  constructor(
    options: Omit<ProviderDownloadManagerOptions, 'onChanged'> & {
      changed(): void
      indexed?(path: string): Promise<boolean>
      reveal?(path: string): Promise<void>
    }
  )
  state(): CoreDownloadsState
  page(query: CoreDownloadsQuery): CoreDownloadsPage
  create(input: CoreDownloadCreate): Promise<CoreDownloadTask>
  cancel(id: string): Promise<void>
  retry(id: string): Promise<CoreDownloadTask>
  result(id: string, addToLibrary: boolean): Promise<void>
  indexed(id: string): Promise<{
    indexed: boolean
  }>
  reveal(id: string): Promise<void>
  /** Private playback source, never returned to a renderer or remote. */
  playbackTrack(id: string): Promise<TrackData>
  shutdown(): Promise<void>
}
