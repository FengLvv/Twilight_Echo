import { createThemeLibraryRepositoryDomain } from '../../../core/persistence/themeLibraryRepositoryDomain.ts'
import { VersionedDataStore } from '../../adapters/persistence/versionedDataStore.ts'

export const { ThemeLibraryRepository } = createThemeLibraryRepositoryDomain({ VersionedDataStore })
export type * from '../../../core/persistence/themeLibraryRepositoryContract.ts'

export type ThemeLibraryRepository =
  import('../../../core/persistence/themeLibraryRepositoryContract.ts').ThemeLibraryRepository
