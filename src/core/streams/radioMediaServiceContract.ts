import type {
  PodcastEpisode,
  PodcastSubscription,
  PodcastSubscriptionsDocument
} from '../../shared/podcastSubscriptions.ts'
import type { RadioStation, RadioStationsDocument } from '../../shared/radioStations.ts'
import type { ImportedRadioEntry } from './playlistImport.ts'
export interface PodcastFeedRequest {
  ifNoneMatch?: string | null
  ifModifiedSince?: string | null
  signal?: AbortSignal
}
export interface PodcastFeedResponse {
  body: string
  status: number
  etag?: string | null
  lastModified?: string | null
}
export interface RadioMediaServiceOptions {
  userDataPath: string
  newId?: () => string
  now?: () => string
  fetchText?: (url: string) => Promise<string>
  fetchFeed?: (url: string, request?: PodcastFeedRequest) => Promise<PodcastFeedResponse>
  refreshIntervalMs?: number
}
export declare class RadioMediaService {
  constructor(options: RadioMediaServiceOptions)
  startScheduledRefresh(): void
  stopScheduledRefresh(): void
  loadRadioStations(): Promise<
    import('../../shared/versionedPersistence.ts').VersionedDataEnvelope<RadioStationsDocument>
  >
  saveRadioStations(
    document: RadioStationsDocument,
    expectedRevision: number
  ): Promise<
    import('../../shared/versionedPersistence.ts').VersionedDataEnvelope<RadioStationsDocument>
  >
  loadPodcastSubscriptions(): Promise<
    import('../../shared/versionedPersistence.ts').VersionedDataEnvelope<PodcastSubscriptionsDocument>
  >
  savePodcastSubscriptions(
    document: PodcastSubscriptionsDocument,
    expectedRevision: number
  ): Promise<
    import('../../shared/versionedPersistence.ts').VersionedDataEnvelope<PodcastSubscriptionsDocument>
  >
  createStationInput(input: {
    name: string
    streamUrl: string
    homepage?: string
    favicon?: string
    tags?: string[]
    allowInsecureHttp?: boolean
  }): RadioStation
  importPlaylistEntries(
    text: string,
    options?: {
      fileNameHint?: string
      allowInsecureHttp?: boolean
    }
  ): RadioStation[]
  subscribePodcast(feedUrl: string): Promise<{
    subscription: PodcastSubscription
    document: PodcastSubscriptionsDocument
    revision: number
  }>
  refreshSubscription(subscriptionId: string): Promise<{
    subscription: PodcastSubscription
    document: PodcastSubscriptionsDocument
    revision: number
  }>
  refreshAllSubscriptions(): Promise<PodcastSubscriptionsDocument>
  /**
   * Resolve an episode that belongs to a saved subscription.
   */
  resolveSubscribedEpisode(
    subscriptionId: string,
    episodeGuid: string
  ): Promise<{
    subscription: PodcastSubscription
    episode: PodcastEpisode
    trackId: string
  }>
  buildSubscriptionFromFeed(
    feedUrl: string,
    previous?: PodcastSubscription,
    signal?: AbortSignal
  ): Promise<PodcastSubscription>
}
export type { ImportedRadioEntry }
