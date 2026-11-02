import type { SecureValueEnvelope } from '../../shared/secureValue.ts'
export interface PluginSettingsCryptography {
  protect(value: unknown, scope: string): Promise<SecureValueEnvelope> | SecureValueEnvelope
  unprotect(value: SecureValueEnvelope, scope: string): Promise<unknown> | unknown
}
export declare const pluginSettingsPath: (storagePath: string) => string
/** One writer for each plugin, including read-triggered legacy credential migration. */
export declare class PluginSettingsRepository {
  constructor(crypto: PluginSettingsCryptography)
  /** Stable across Core restarts, changes with the persisted account/config.
   * Inspect only filesystem metadata, never decrypt or fingerprint credentials. */
  identityContext(storagePath: string): string
  get(storagePath: string, key?: string): Promise<unknown>
  set(storagePath: string, key: string, value: unknown): Promise<void>
  delete(storagePath: string, key: string): Promise<void>
  flush(): Promise<void>
}
