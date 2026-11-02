import type { PluginIndexService, PluginIndexServiceOptions } from './indexServicePort.ts'

import type { TwilightPluginManager } from './managerPort.ts'
import type * as Contract from './marketplaceContract.ts'

export interface MarketplaceCapabilities {
  PluginIndexService: typeof import('./indexServicePort.ts').PluginIndexService
}

export function createMarketplaceDomain(capabilities: MarketplaceCapabilities): {
  CorePluginMarketplace: typeof Contract.CorePluginMarketplace
} {
  /** Market metadata and installs share the same manager as the running plugin hosts. */
  class CorePluginMarketplace {
    private readonly index: PluginIndexService
    private readonly plugins: Pick<TwilightPluginManager, 'list' | 'installFromPath'>
    constructor(
      options: PluginIndexServiceOptions,
      plugins: Pick<TwilightPluginManager, 'list' | 'installFromPath'>
    ) {
      this.index = new capabilities.PluginIndexService(options)
      this.plugins = plugins
    }
    async list(refresh = false) {
      const [entries, installed] = await Promise.all([
        refresh ? this.index.refresh() : this.index.list(),
        this.plugins.list()
      ])
      return entries.map((entry) => ({
        ...entry,
        installState: this.index.describeInstallState(entry, installed),
        installedVersion: installed.find((plugin) => plugin.id === entry.id)?.version
      }))
    }
    status() {
      return this.index.getStatus()
    }
    async install(id: string) {
      const downloaded = await this.index.downloadPackage(id)
      try {
        return await this.plugins.installFromPath(downloaded.packagePath, {
          source: 'index',
          sourceLabel: downloaded.entry.sourceUrl,
          evidence: downloaded.evidence
        })
      } finally {
        await downloaded.cleanup()
      }
    }
  }
  return { CorePluginMarketplace }
}
