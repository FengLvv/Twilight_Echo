import type { PluginIndexServiceOptions } from './indexServicePort.ts'
import type { TwilightPluginManager } from './managerPort.ts'
/** Market metadata and installs share the same manager as the running plugin hosts. */
export declare class CorePluginMarketplace {
  constructor(
    options: PluginIndexServiceOptions,
    plugins: Pick<TwilightPluginManager, 'list' | 'installFromPath'>
  )
  list(refresh?: boolean): Promise<
    {
      installState:
        | 'incompatible'
        | 'installed'
        | 'not-installed'
        | 'update-available'
        | 'built-in-blocked'
      installedVersion: string | undefined
      sourceUrl: string
      checksumSha256: string
      tags?: string[]
      publisherSignature?: import('./types.ts').TwilightPluginPublisherSignature
      verified?: boolean
      verification: import('./types.ts').TwilightPluginVerification
      id: string
      name: string
      version: string
      description: string
      author: string
      license: string
      type: import('./types.ts').TwilightPluginType[]
      main?: string
      binary?: Record<string, string>
      dependencies?: Record<string, string>
      engines: {
        twilightEcho: string
      }
      apiVersion: number
      permissions: import('./types.ts').TwilightPluginPermission[]
      contributes?: unknown
      homepage?: string
      repository?: string
      icon?: string
      signature?: unknown
      androidRuntime?: import('./types.ts').TwilightAndroidPluginRuntime
    }[]
  >
  status(): import('./types.ts').TwilightPluginIndexStatus
  install(id: string): Promise<import('./types.ts').TwilightPluginInstallResult>
}
