import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { CoreCommandName, CoreCommands } from '../../../../shared/coreProtocol.ts'
import type { ProviderInfo, ProviderLoginState } from '../../stores/useProviderStore.ts'
import { isRequestCancelled } from '../../../../shared/cancellation.ts'
import { friendlyStreamingError } from './friendlyStreamingError.ts'

export type StreamingHomeEntry = 'daily' | 'heart' | 'radar' | 'fm'
export function useStreamingHomeEntries(options: {
  provider: Readonly<Ref<ProviderInfo | null | undefined>>
  enabled: Readonly<Ref<boolean>>
  checkLogin: (id: string) => Promise<ProviderLoginState>
  login: (id: string) => void
  openDaily: () => Promise<void>
  command: <K extends CoreCommandName>(
    name: K,
    payload: CoreCommands[K],
    signal?: AbortSignal
  ) => Promise<unknown>
}) {
  const pending = ref<StreamingHomeEntry | null>(null)
  const error = ref('')
  let generation = 0
  let controller: AbortController | undefined
  const entries = computed(() => {
    const source = options.provider.value
    if (source?.id !== 'ncm') return []
    const supports = (method: string) => source.supportedMethods.includes(method)
    return (
      [
        {
          id: 'daily',
          title: '每日推荐',
          icon: 'pi pi-calendar',
          enabled: supports('fetchRecommendSongs')
        },
        {
          id: 'heart',
          title: '心动模式',
          icon: 'pi pi-heart',
          enabled: ['fetchIntelligenceList', 'fetchLikedTracksPage', 'fetchUserLibrary'].every(
            supports
          )
        },
        {
          id: 'radar',
          title: '私人雷达',
          icon: 'pi pi-send',
          enabled: supports('fetchPrivateContent')
        },
        { id: 'fm', title: '私人漫游', icon: 'pi pi-compass', enabled: supports('fetchPersonalFm') }
      ] as const
    ).filter((entry) => entry.enabled)
  })
  function cancel() {
    generation++
    controller?.abort()
    controller = undefined
    pending.value = null
    error.value = ''
  }
  async function open(entry: StreamingHomeEntry) {
    const source = options.provider.value
    if (
      !options.enabled.value ||
      !source ||
      !entries.value.some((item) => item.id === entry) ||
      pending.value
    )
      return
    cancel()
    const version = generation
    const request = new AbortController()
    controller = request
    const current = () =>
      version === generation && !request.signal.aborted && source.id === options.provider.value?.id
    pending.value = entry
    try {
      const state = await options.checkLogin(source.id)
      if (!current()) return
      if (!state.loggedIn) {
        options.login(source.id)
        return
      }
      if (entry === 'daily') await options.openDaily()
      else if (entry === 'heart')
        await options.command('liked.play', { mode: 'heart', play: true }, request.signal)
      else
        await options.command(
          'personalized.start',
          { key: entry, providerId: source.id, play: true },
          request.signal
        )
    } catch (cause) {
      if (current() && !isRequestCancelled(cause))
        error.value = friendlyStreamingError(cause, '暂时无法播放，请重试')
    } finally {
      if (current()) {
        pending.value = null
        controller = undefined
      }
    }
  }
  watch(() => [options.provider.value?.id, options.enabled.value], cancel, { flush: 'sync' })
  onScopeDispose(cancel)
  return { entries, pending, error, open }
}
