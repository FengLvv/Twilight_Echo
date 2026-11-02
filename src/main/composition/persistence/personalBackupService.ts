import { createPersonalBackupServiceDomain } from '../../../core/persistence/personalBackupServiceDomain.ts'
import {
  checkRestoreOptions,
  createPersonalBackupRepository
} from '../../adapters/persistence/personalBackup.ts'

export const { CorePersonalBackupService } = createPersonalBackupServiceDomain({
  createPersonalBackupRepository,
  checkRestoreOptions
})
export type * from '../../../core/persistence/personalBackupServiceContract.ts'

export type CorePersonalBackupService =
  import('../../../core/persistence/personalBackupServiceContract.ts').CorePersonalBackupService
