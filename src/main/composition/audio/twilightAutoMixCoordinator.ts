import { createTwilightAutoMixCoordinatorDomain } from '../../../core/audio/twilightAutoMixCoordinatorDomain.ts'
import {
  identifyTwilightAutoMixFile,
  isTwilightAutoMixWindowResult
} from '../../adapters/audio/twilightAutoMixCache.ts'

export const { autoMixFailureReason, autoMixBoundaryStarts, TwilightAutoMixCoordinator } =
  createTwilightAutoMixCoordinatorDomain({
    identifyTwilightAutoMixFile,
    isTwilightAutoMixWindowResult
  })
export type * from '../../../core/audio/twilightAutoMixCoordinatorContract.ts'

export type TwilightAutoMixCoordinator =
  import('../../../core/audio/twilightAutoMixCoordinatorContract.ts').TwilightAutoMixCoordinator
