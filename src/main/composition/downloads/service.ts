import { createServiceDomain } from '../../../core/downloads/serviceDomain.ts'
import { ProviderDownloadManager } from '../../adapters/downloads/providerDownloadManager.ts'

export const { CoreDownloadsService } = createServiceDomain({ ProviderDownloadManager })
export type * from '../../../core/downloads/serviceContract.ts'

export type CoreDownloadsService =
  import('../../../core/downloads/serviceContract.ts').CoreDownloadsService
