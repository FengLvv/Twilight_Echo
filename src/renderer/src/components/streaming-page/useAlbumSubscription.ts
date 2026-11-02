import type { MediaProviderAlbumSummary, MediaProviderAlbumSubscriptionState } from '../../../../shared/providerSearch.ts'
import { useMediaSubscription } from './useMediaSubscription.ts'

export function useAlbumSubscription(options: {
  album: () => MediaProviderAlbumSummary | null
  enabled: () => boolean
  scope: () => unknown
  captureSession: () => () => boolean
  fetchState: (id: number | string) => Promise<MediaProviderAlbumSubscriptionState>
  subscribe: (album: MediaProviderAlbumSummary, subscribe: boolean) => Promise<void>
}) {
  const { album, fetchState, ...rest } = options
  return useMediaSubscription({ ...rest, target: album, label: '专辑',
    fetchState: async id => ({ owned: false, subscribed: (await fetchState(id)).subscribed }) })
}
