import { createLibraryLoudnessServiceDomain } from '../../../core/audio/libraryLoudnessServiceDomain.ts'
import { LibraryLoudnessCache } from '../../adapters/audio/libraryLoudnessCache.ts'
import { LibraryLoudnessManager } from '../../adapters/audio/libraryLoudnessManager.ts'

export const { CoreLibraryLoudnessService } = createLibraryLoudnessServiceDomain({
  LibraryLoudnessManager,
  LibraryLoudnessCache
})
export type * from '../../../core/audio/libraryLoudnessServiceContract.ts'

export type CoreLibraryLoudnessService =
  import('../../../core/audio/libraryLoudnessServiceContract.ts').CoreLibraryLoudnessService
