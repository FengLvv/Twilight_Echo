import { createMarketplaceDomain } from '../../../core/plugins/marketplaceDomain.ts'
import { PluginIndexService } from '../../adapters/plugins/indexService.ts'

export const { CorePluginMarketplace } = createMarketplaceDomain({ PluginIndexService })
export type * from '../../../core/plugins/marketplaceContract.ts'

export type CorePluginMarketplace =
  import('../../../core/plugins/marketplaceContract.ts').CorePluginMarketplace
