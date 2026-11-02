import { createAutoMixServiceDomain } from '../../../core/audio/autoMixServiceDomain.ts'
import { AutoMixStemDetector } from '../../adapters/audio/autoMixStemCapabilities.ts'
import { AutoMixStemService } from '../../adapters/audio/autoMixStemService.ts'
import { TwilightAutoMixWindowCache } from '../../adapters/audio/twilightAutoMixCache.ts'
import { TwilightAutoMixCoordinator } from './twilightAutoMixCoordinator.ts'

export const { CoreAutoMixService } = createAutoMixServiceDomain({
  TwilightAutoMixCoordinator,
  TwilightAutoMixWindowCache,
  AutoMixStemDetector,
  AutoMixStemService
})
export type * from '../../../core/audio/autoMixServiceContract.ts'

export type CoreAutoMixService =
  import('../../../core/audio/autoMixServiceContract.ts').CoreAutoMixService
