import { computed, onScopeDispose, ref, watch } from 'vue'
import type {
  MediaProviderPlaylistSummary,
  MediaProviderPlaylistSubscriptionState
} from '../../../../shared/providerSearch.ts'
import { friendlyStreamingError } from './friendlyStreamingError.ts'

export interface PlaylistSubscriptionControl {
  subscribed: boolean
  busy: boolean
  error: string
  retry: boolean
}

export function usePlaylistSubscription(options: {
  playlist: () => MediaProviderPlaylistSummary | null
  enabled: () => boolean
  scope: () => unknown
  captureSession: () => () => boolean
  fetchState: (id: number | string) => Promise<MediaProviderPlaylistSubscriptionState>
  subscribe: (playlist: MediaProviderPlaylistSummary, subscribe: boolean) => Promise<void>
}) {
  const state = ref<MediaProviderPlaylistSubscriptionState | null>(null)
  const reading = ref(false)
  const writing = ref(false)
  const error = ref('')
  let generation = 0

  const control = computed<PlaylistSubscriptionControl | undefined>(() =>
    options.enabled() &&
    options.playlist() &&
    options.playlist()?.owned !== true &&
    !state.value?.owned
      ? {
          subscribed: state.value?.subscribed ?? false,
          busy: reading.value || writing.value,
          error: error.value,
          retry: !state.value && !!error.value
        }
      : undefined
  )

  async function refresh() {
    const ticket = ++generation
    state.value = null
    error.value = ''
    reading.value = false
    writing.value = false
    const playlist = options.playlist()
    if (!options.enabled() || !playlist || playlist.owned === true) return
    const currentSession = options.captureSession()
    const current = () => generation === ticket && currentSession()
    reading.value = true
    try {
      const value = await options.fetchState(playlist.id)
      if (!current()) return
      if (typeof value?.owned !== 'boolean' || typeof value?.subscribed !== 'boolean')
        throw new Error('无法确认歌单收藏状态，请重试')
      state.value = value
    } catch (cause) {
      if (current()) error.value = friendlyStreamingError(cause, '读取歌单收藏状态失败')
    } finally {
      if (current()) reading.value = false
    }
  }

  async function toggle() {
    const playlist = options.playlist()
    if (!control.value || reading.value || writing.value || !playlist) return
    if (!state.value) {
      await refresh()
      return
    }
    const ticket = generation,
      currentSession = options.captureSession()
    const current = () => generation === ticket && currentSession()
    const subscribed = !state.value.subscribed
    writing.value = true
    error.value = ''
    try {
      await options.subscribe(playlist, subscribed)
      if (current()) state.value = { owned: false, subscribed }
    } catch (cause) {
      if (current())
        error.value = friendlyStreamingError(
          cause,
          subscribed ? '收藏歌单失败' : '取消收藏歌单失败'
        )
    } finally {
      if (current()) writing.value = false
    }
  }

  watch([options.playlist, options.enabled, options.scope], refresh, {
    immediate: true,
    flush: 'sync'
  })
  onScopeDispose(() => {
    generation++
  })
  return { control, toggle }
}
