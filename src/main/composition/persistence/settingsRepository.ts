import { createSettingsRepositoryDomain } from '../../../core/persistence/settingsRepositoryDomain.ts'
import { loadSettingsFile, writeSettingsFile } from '../../adapters/persistence/settingsFile.ts'

export const { CoreSettingsRepository } = createSettingsRepositoryDomain({
  loadSettingsFile,
  writeSettingsFile
})
export type * from '../../../core/persistence/settingsRepositoryContract.ts'

export type CoreSettingsRepository =
  import('../../../core/persistence/settingsRepositoryContract.ts').CoreSettingsRepository
