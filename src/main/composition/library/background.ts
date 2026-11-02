import { createBackgroundDomain } from '../../../core/library/backgroundDomain.ts'
import { createLibraryWatchers } from '../../adapters/library/watcher.ts'

export const { CoreLibraryBackground } = createBackgroundDomain({ createLibraryWatchers })
export type * from '../../../core/library/backgroundContract.ts'

export type CoreLibraryBackground =
  import('../../../core/library/backgroundContract.ts').CoreLibraryBackground
