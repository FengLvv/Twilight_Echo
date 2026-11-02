import { createSourcesManagerDomain } from '../../../core/network/sourcesManagerDomain.ts'
import { downloadEntryToCache } from '../../adapters/network/networkCache.ts'
import { enrichNetworkEntry } from '../../adapters/network/networkMetadata.ts'

export const { createNetworkSourcesManager } = createSourcesManagerDomain({
  downloadEntryToCache,
  enrichNetworkEntry
})
export type * from '../../../core/network/sourcesManagerContract.ts'
