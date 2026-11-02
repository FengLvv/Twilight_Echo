import { createLegacyMusicLookupProviderDomain } from '../../../core/plugins/legacyMusicLookupProviderDomain.ts'
import { AlbumIntroductionProvider } from '../../adapters/plugins/rhine-vendor/album-introductions.mjs'
import { QQCreditsProvider } from '../../adapters/plugins/rhine-vendor/qq-credits.mjs'

export const { createLegacyMusicLookupProvider } = createLegacyMusicLookupProviderDomain({
  QQCreditsProvider,
  AlbumIntroductionProvider
})
export type * from '../../../core/plugins/legacyMusicLookupProviderContract.ts'
