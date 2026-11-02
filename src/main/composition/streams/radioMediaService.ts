import { createRadioMediaServiceDomain } from '../../../core/streams/radioMediaServiceDomain.ts'
import { VersionedDataStore } from '../../adapters/persistence/versionedDataStore.ts'

export const { RadioMediaService } = createRadioMediaServiceDomain({ VersionedDataStore })
export type * from '../../../core/streams/radioMediaServiceContract.ts'

export type RadioMediaService =
  import('../../../core/streams/radioMediaServiceContract.ts').RadioMediaService
