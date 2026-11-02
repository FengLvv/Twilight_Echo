import { createExperienceMusicDomain } from '../../../core/plugins/experienceMusicDomain.ts'
import {
  createIntroductionTask,
  introductionEditionRevision,
  introductionRevision,
  previewIntroductionImport,
  reconcileIntroductionResult
} from '../../adapters/plugins/rhine-vendor/album-introduction-exchange.mjs'
import { AlbumIntroductionProvider } from '../../adapters/plugins/rhine-vendor/album-introductions.mjs'
import { QQCreditsProvider } from '../../adapters/plugins/rhine-vendor/qq-credits.mjs'

export const { createExperienceMusic } = createExperienceMusicDomain({
  createIntroductionTask,
  introductionRevision,
  introductionEditionRevision,
  reconcileIntroductionResult,
  previewIntroductionImport,
  QQCreditsProvider,
  AlbumIntroductionProvider
})
export type * from '../../../core/plugins/experienceMusicContract.ts'
