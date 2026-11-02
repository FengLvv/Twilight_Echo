import { createServiceDomain } from '../../../core/network/serviceDomain.ts'
import { clearUnpinnedCache, getDirectorySize } from '../../adapters/network/networkCache.ts'
import { readCoverDataUrl } from '../../adapters/network/networkCover.ts'
import { createNetworkSourcesManager } from './sourcesManager.ts'

export const { CoreNetworkService } = createServiceDomain({
  createNetworkSourcesManager,
  readCoverDataUrl,
  getDirectorySize,
  clearUnpinnedCache
})
export type * from '../../../core/network/serviceContract.ts'

export type CoreNetworkService =
  import('../../../core/network/serviceContract.ts').CoreNetworkService
