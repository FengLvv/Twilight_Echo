import type { DynamicIslandConfig } from '../../shared/dynamicIsland.ts'
import type { PlaylistImportApplyResult } from '../../shared/playlists.ts'
import type { PluginPlaylistImportNotice } from '../../shared/pluginPlaylistImport.ts'
import type { EventEmitter } from '../../shared/portableEvents.ts'
import type { RemoteProviderSession } from '../../shared/remoteCoreBridge.ts'
import type { PluginManagerPlatform } from './platform.ts'
import type { PluginSettingsRepository } from './settingsRepositoryPort.ts'
import type {
  TwilightMediaProviderMethod,
  TwilightMediaProviderRegistration,
  TwilightPluginDescriptor,
  TwilightPluginExtensionContribution,
  TwilightPluginInstallEvidence,
  TwilightPluginInstallResult,
  TwilightPluginSource,
  TwilightPluginUninstallOptions
} from './types'
type LocalPluginInstallSourceKind = 'package' | 'directory'
export interface TwilightPluginManagerOptions {
  appVersion: string
  platform: PluginManagerPlatform
  settings: PluginSettingsRepository
  recordPlaybackIdentity(
    providerId: string,
    trackId: string,
    quality: string,
    result: unknown
  ): void
  bundledPlugins?: Array<{
    id: string
    sourcePath: string
    defaultEnabled?: boolean
  }>
  ncm?: {
    request: (
      path: string,
      cookie?: string,
      options?: {
        signal?: AbortSignal
        idempotencyKey?: string
      }
    ) => Promise<unknown>
    officialLogin: () => Promise<string>
    getCachedSong: (songId: number) => Promise<string | null>
    cacheSong: (songId: number, url: string, fileName?: string) => Promise<string | null>
    prepareAutoMixSong?: (
      songId: number,
      url: string,
      fileName: string | undefined,
      options: {
        signal?: AbortSignal
        expiresAt?: number | null
        expectedBytes?: number | null
      }
    ) => Promise<string | null>
  }
  importPlaylists?: (notice: PluginPlaylistImportNotice) => Promise<PlaylistImportApplyResult[]>
  autoMixEnabled?: () => boolean
  getPlaybackInfo: () => Promise<unknown> | unknown
  applyNativeDspPluginChain: (chainJson: string) => Promise<void> | void
  player: {
    play: () => Promise<void> | void
    pause: () => Promise<void> | void
    togglePause: () => Promise<void> | void
    stop: () => Promise<void> | void
    next: () => Promise<void> | void
    previous: () => Promise<void> | void
    /** Optional v4 extensions; the manager reports a clear error when absent. */
    playTracks?: (ids: string[], startIndex: number) => Promise<void> | void
    setVolume?: (volume: number) => Promise<void> | void
    seek?: (position: number) => Promise<void> | void
    setPlayMode?: (mode: 'sequential' | 'listLoop' | 'repeat' | 'shuffle') => Promise<void> | void
  }
  /**
   * Library access for plugin background code (`twilight.library`), gated by
   * `library:read` / `library:write`. Provided by the process that owns the
   * library database and playlist service.
   */
  libraryApi?: {
    queryTracks: (query: Record<string, unknown>) => Promise<unknown>
    getTracksByIds: (ids: string[]) => Promise<unknown>
    patchTracks: (
      patches: Array<{
        id: string
        expectedVersion: number
        patch: Record<string, unknown>
      }>
    ) => Promise<unknown>
    getCover: (trackId: string) => Promise<unknown>
    listPlaylists: () => Promise<unknown>
    createPlaylist: (name: string) => Promise<unknown>
    addTracksToPlaylist: (playlistId: string, trackIds: string[]) => Promise<unknown>
    removeTracksFromPlaylist: (playlistId: string, trackIds: string[]) => Promise<unknown>
  }
  /** Application settings access (`twilight.appSettings`), gated by `app:settings`. */
  appSettingsApi?: {
    get: () => Promise<unknown> | unknown
    update: (patch: Record<string, unknown>) => Promise<unknown>
  }
  /** Main-window screenshot capture (`twilight.host.captureScreenshot`), gated by `app:settings`. */
  hostCaptureApi?: {
    captureScreenshot: () => Promise<unknown>
  }
  /**
   * Host-owned dynamic island window bridge. Plugins reach it through
   * `twilight.overlay` and must declare the `ui:inject` permission. Only one
   * plugin may own the island at a time.
   */
  dynamicIsland?: {
    show: (pluginId: string) => Promise<void> | void
    configure: (
      pluginId: string,
      config: unknown
    ) => Promise<DynamicIslandConfig> | DynamicIslandConfig
    hide: (pluginId: string) => Promise<void> | void
    isOwner: (pluginId: string) => Promise<boolean> | boolean
  }
  /**
   * Pure provider hosts that have had no provider call, UI command, or subscribed
   * event for this long are hibernated (their utility process is stopped)
   * and transparently re-activated by the next call. Hosts that have issued
   * local playback proxy URLs stay resident. 0 disables hibernation.
   */
  hostIdleTimeoutMs?: number
}
interface InstallFromPathOptions {
  source?: TwilightPluginSource
  sourceLabel?: string
  evidence?: TwilightPluginInstallEvidence
}
export interface TwilightProviderCallOptions {
  /** Main-only playback preparation: retain expiry without exposing the provider envelope. */
  playbackExpiry?: boolean
  /** Reuse this key when retrying one user-initiated write after an unknown outcome. */
  idempotencyKey?: string
  /** Cancels queued or active plugin RPC work and propagates cancellation to the provider host. */
  signal?: AbortSignal
}
export declare class TwilightPluginManager extends EventEmitter {
  constructor(options: TwilightPluginManagerOptions)
  get roots(): {
    plugins: string
    staging: string
    data: string
    logs: string
    stateFile: string
    contributionsFile: string
  }
  initialize(): Promise<void>
  list(): Promise<TwilightPluginDescriptor[]>
  installFromPath(
    sourcePath: string,
    options?: InstallFromPathOptions
  ): Promise<TwilightPluginInstallResult>
  chooseAndInstall(kind?: LocalPluginInstallSourceKind): Promise<TwilightPluginInstallResult | null>
  enable(id: string): Promise<TwilightPluginDescriptor>
  disable(id: string): Promise<TwilightPluginDescriptor>
  uninstall(id: string, options?: TwilightPluginUninstallOptions): Promise<void>
  openLog(id: string): Promise<void>
  getLog(id: string): Promise<string>
  handleNativeDspHostCrash(reason: string): Promise<void>
  setNativeDspPluginParameters(
    id: string,
    parameters: Record<string, number>
  ): Promise<TwilightPluginDescriptor>
  broadcastEvent(name: string, payload: unknown): Promise<void>
  listProviders(): TwilightMediaProviderRegistration[]
  /** Host-only credential export for the authenticated, encrypted remote bridge. */
  readNcmSession(): Promise<RemoteProviderSession>
  /** Opaque session context; never derives a key from cookies or other credentials. */
  providerIdentityContext(providerId: string): string
  /** Persistent text caches use the stored account/config epoch; RPC sharing
   * still uses providerIdentityContext's in-session registration revision. */
  providerMetadataContext(providerId: string): string
  /** Whether a plugin's host is currently hibernated (contributions kept, process stopped). */
  isHibernated(id: string): boolean
  listExtensions(): Promise<TwilightPluginExtensionContribution[]>
  executeUiCommand(command: string, args?: unknown[]): Promise<unknown>
  callProvider(
    providerId: string,
    method: TwilightMediaProviderMethod,
    args: unknown[],
    options?: TwilightProviderCallOptions
  ): Promise<unknown>
  destroy(): Promise<void>
  /**
   * Relays one experience iframe RPC into the owning plugin's background code
   * (`twilight.experience.onRequest`). Long timeouts on purpose: agent loops
   * and batch jobs legitimately run for minutes while streaming progress
   * through `experience-event` messages.
   */
  callExperienceRequest(pluginId: string, request: unknown): Promise<unknown>
}
export type {}
