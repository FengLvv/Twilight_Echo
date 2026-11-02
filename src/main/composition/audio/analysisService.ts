import { createAnalysisServiceDomain } from '../../../core/audio/analysisServiceDomain.ts'
import { BpmAnalysisManager } from '../../adapters/audio/bpmAnalysisManager.ts'
import { BpmAnalysisCache } from '../../adapters/audio/bpmCache.ts'
import { LoudnessAnalysisManager } from '../../adapters/audio/loudnessAnalysisManager.ts'
import { LoudnessAnalysisCache } from '../../adapters/audio/loudnessCache.ts'

export const { CoreAnalysisService } = createAnalysisServiceDomain({
  BpmAnalysisCache,
  LoudnessAnalysisCache,
  BpmAnalysisManager,
  LoudnessAnalysisManager
})
export type * from '../../../core/audio/analysisServiceContract.ts'

export type CoreAnalysisService =
  import('../../../core/audio/analysisServiceContract.ts').CoreAnalysisService
