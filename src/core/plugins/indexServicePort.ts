import type { TrustedPluginPublisherRegistry } from './indexTrustPort.ts'
import type {
  TwilightPluginDescriptor,
  TwilightPluginIndexEntry,
  TwilightPluginIndexLoadedFrom,
  TwilightPluginIndexSourceKind,
  TwilightPluginIndexStatus,
  TwilightPluginInstallEvidence
} from './types'
export interface PluginIndexServiceOptions {
  appVersion: string
  localIndexPath: string
  remoteIndexUrl?: string
  cacheIndexPath?: string
  bundledPluginIds?: string[]
  fetchImpl?: typeof fetch
  indexSizeLimitBytes?: number
  packageSizeLimitBytes?: number
  /** Request deadline; an explicit value also applies to packages unless overridden. */
  timeoutMs?: number
  packageTimeoutMs?: number
  cacheTtlMs?: number
  now?: () => Date
  trustedPublisherRegistry?: TrustedPluginPublisherRegistry
  trustedPublisherRegistryPath?: string
  /**
   * Parent directory for downloaded .tep staging directories. Production passes a
   * path below Electron userData so downloads and the plugin install target stay
   * on the same volume.
   */
  packageStagingDir?: string
}
export type PluginIndexSourceKind = TwilightPluginIndexSourceKind
export type PluginIndexLoadedFrom = TwilightPluginIndexLoadedFrom
export type PluginIndexStatus = TwilightPluginIndexStatus
export interface DownloadedPluginPackage {
  entry: TwilightPluginIndexEntry
  packagePath: string
  evidence: TwilightPluginInstallEvidence
  cleanup: () => Promise<void>
}
export declare const DEFAULT_PLUGIN_INDEX_URL = 'https://plugins.aaapi.fun/plugins.json'
export declare class PluginIndexService {
  constructor(options: PluginIndexServiceOptions)
  list(forceRefresh?: boolean): Promise<TwilightPluginIndexEntry[]>
  refresh(): Promise<TwilightPluginIndexEntry[]>
  getStatus(): TwilightPluginIndexStatus
  downloadPackage(id: string): Promise<DownloadedPluginPackage>
  describeInstallState(
    entry: TwilightPluginIndexEntry,
    installed: TwilightPluginDescriptor[]
  ): 'not-installed' | 'installed' | 'update-available' | 'incompatible' | 'built-in-blocked'
}
export declare function resolvePluginIndexUrl(value?: string): string
