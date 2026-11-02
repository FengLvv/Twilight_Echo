import { createOutputTestServiceDomain } from '../../../core/audio/outputTestServiceDomain.ts'
import { OutputTest } from '../../adapters/audio/outputTest.ts'

export const { CoreOutputTestService } = createOutputTestServiceDomain({ OutputTest })
export type * from '../../../core/audio/outputTestServiceContract.ts'

export type CoreOutputTestService =
  import('../../../core/audio/outputTestServiceContract.ts').CoreOutputTestService
