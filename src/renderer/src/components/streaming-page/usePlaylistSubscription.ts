import type { MediaProviderPlaylistSummary, MediaProviderPlaylistSubscriptionState } from '../../../../shared/providerSearch.ts'
import { useMediaSubscription, type MediaSubscriptionControl } from './useMediaSubscription.ts'

export type PlaylistSubscriptionControl = MediaSubscriptionControl

export function usePlaylistSubscription(options: {
  playlist: () => MediaProviderPlaylistSummary | null
  enabled: () => boolean
  scope: () => unknown
  captureSession: () => () => boolean
  fetchState: (id: number | string) => Promise<MediaProviderPlaylistSubscriptionState>
  subscribe: (playlist: MediaProviderPlaylistSummary, subscribe: boolean) => Promise<void>
}) {
  const { playlist, ...rest } = options
  return useMediaSubscription({ ...rest, target: playlist, label: '歌单' })
}
