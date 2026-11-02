import { createNetworkLibraryDomain } from '../../../core/network/networkLibraryDomain.ts'
import { createNetworkLibraryPersistence } from '../../adapters/network/networkLibraryPersistence.ts'

export const { createNetworkLibrary } = createNetworkLibraryDomain({
  createNetworkLibraryPersistence
})
export type * from '../../../core/network/networkLibraryContract.ts'
