import type { PortableBuffer } from '../../shared/portableBytes.ts'
import type {
  TwilightMediaProviderMethod,
  TwilightPluginInstallEvidence,
  TwilightPluginManifest
} from './types.ts'

/** The manager owns plugin state; main only starts the registered host and shows UI. */
export interface PluginHostProcess {
  on(event: string | symbol, listener: (...args: any[]) => void): this
  once(event: string | symbol, listener: (...args: any[]) => void): this
  off(event: string | symbol, listener: (...args: any[]) => void): this
  removeListener?(event: string | symbol, listener: (...args: any[]) => void): this
  removeAllListeners?(event?: string | symbol): this
  emit(event: string | symbol, ...args: any[]): boolean
  postMessage(message: unknown): void
  kill(): unknown
  terminate?(): Promise<void>
  stdout?: { on(event: 'data', listener: (chunk: PortableBuffer) => void): unknown } | null
  stderr?: { on(event: 'data', listener: (chunk: PortableBuffer) => void): unknown } | null
}

export interface PluginManagerPlatform {
  userData: string
  launchHost(pluginId: string): PluginHostProcess
  prepareDisable?(id: string): Promise<void>
  chooseInstallSource(kind: 'package' | 'directory'): Promise<string | null>
  confirmInstall(
    manifest: TwilightPluginManifest,
    evidence: TwilightPluginInstallEvidence
  ): Promise<boolean>
  showLog(path: string): Promise<void> | void
  notifyStateIssue(type: 'warning' | 'error', detail: string): Promise<void>
  log(
    pluginId: string,
    level: string,
    message: string
  ): {
    timestamp: string
    eventId: string
    text: string
  }
  protectProviderResult(
    value: unknown,
    method: TwilightMediaProviderMethod
  ): Promise<unknown> | unknown
}
