import { computed } from 'vue'
import { useCoreConnection } from './coreConnection.ts'
import { createCorePlayerStore } from './player/corePlayerStore.ts'
import { createPlayerSystemIntegrations } from './player/playerSystemIntegrations.ts'
import { useSettingsStore } from './useSettingsStore.ts'
import { configurePlayerStoreHmr } from './playerStoreHmr.ts'

let player: ReturnType<typeof createCorePlayerStore> | null = null
let systemIntegrations: ReturnType<typeof createPlayerSystemIntegrations> | null = null

/** A window attaches to Core; rebuilding this view never restores or reloads playback. */
export function useCorePlayerStore() {
  if (!player) {
    const core = useCoreConnection()
    const settingsStore = useSettingsStore()
    const store = createCorePlayerStore(core, {
      useCoverTheme: () => settingsStore.settings.value.useCoverTheme
    })
    const integrations = createPlayerSystemIntegrations({
      currentTrack: store.currentTrack,
      coverUrl: store.themeCoverUrl,
      isPlaying: store.isPlaying,
      currentTime: store.currentTime,
      duration: store.duration,
      playbackRate: store.playbackRate,
      mediaEnabled: computed(() => Boolean(settingsStore.settings.value?.smtcEnabled)),
      commands: {
        togglePlay: () => store.togglePlay(),
        previous: () => store.prev().then(() => {}),
        next: () => store.next().then(() => {}),
        seek: (time: number) => store.seek(time).then(() => {})
      },
      getNativeStatus: () =>
        window.api?.systemMedia?.getNativeStatus
          ? window.api.systemMedia.getNativeStatus()
          : Promise.resolve({ active: false }),
      mediaSession: typeof navigator !== 'undefined' ? navigator.mediaSession : undefined,
      requiresMediaSentinel: computed(
        () =>
          settingsStore.platform.value === 'linux' ||
          (typeof navigator !== 'undefined' && /\blinux\b/i.test(navigator.userAgent))
      ),
      createMetadata:
        typeof MediaMetadata !== 'undefined' ? (init) => new MediaMetadata(init) : undefined
    })
    integrations.start()
    player = store
    systemIntegrations = integrations
  }
  return player
}

export function disposeCorePlayerStore(): void {
  systemIntegrations?.dispose()
  systemIntegrations = null
  player?.dispose()
  player = null
}

configurePlayerStoreHmr(import.meta.hot, () => window.location.reload(), disposeCorePlayerStore)
