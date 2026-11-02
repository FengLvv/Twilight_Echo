import { computed, onScopeDispose, ref, watch } from 'vue'
import { friendlyStreamingError } from './friendlyStreamingError.ts'

export interface MediaSubscriptionState {
  owned: boolean
  subscribed: boolean
}

export interface MediaSubscriptionControl {
  subscribed: boolean
  busy: boolean
  error: string
  retry: boolean
}

export function useMediaSubscription<T extends { id: number | string; owned?: boolean }>(options: {
  label: string
  target: () => T | null
  enabled: () => boolean
  scope: () => unknown
  captureSession: () => () => boolean
  fetchState: (id: number | string) => Promise<MediaSubscriptionState>
  subscribe: (target: T, subscribe: boolean) => Promise<void>
}) {
  const state = ref<MediaSubscriptionState | null>(null)
  const reading = ref(false)
  const writing = ref(false)
  const error = ref('')
  let generation = 0

  const control = computed<MediaSubscriptionControl | undefined>(() =>
    options.enabled() &&
    options.target() &&
    options.target()?.owned !== true &&
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
    const target = options.target()
    if (!options.enabled() || !target || target.owned === true) return
    const currentSession = options.captureSession()
    const current = () => generation === ticket && currentSession()
    reading.value = true
    try {
      const value = await options.fetchState(target.id)
      if (!current()) return
      if (typeof value?.owned !== 'boolean' || typeof value?.subscribed !== 'boolean')
        throw new Error(`无法确认${options.label}收藏状态，请重试`)
      state.value = value
    } catch (cause) {
      if (current()) error.value = friendlyStreamingError(cause, `读取${options.label}收藏状态失败`)
    } finally {
      if (current()) reading.value = false
    }
  }

  async function toggle() {
    const target = options.target()
    if (!control.value || reading.value || writing.value || !target) return
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
      await options.subscribe(target, subscribed)
      if (current()) state.value = { owned: false, subscribed }
    } catch (cause) {
      if (current())
        error.value = friendlyStreamingError(
          cause,
          subscribed ? `收藏${options.label}失败` : `取消收藏${options.label}失败`
        )
    } finally {
      if (current()) writing.value = false
    }
  }

  watch([options.target, options.enabled, options.scope], refresh, {
    immediate: true,
    flush: 'sync'
  })
  onScopeDispose(() => {
    generation++
  })
  return { control, toggle }
}
