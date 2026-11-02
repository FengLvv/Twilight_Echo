import type { AppSettings } from '../../shared/appSettings.ts'
import type { SettingsEnvironment } from '../settings/normalization.ts'
import type { SettingsFileLoadIssue } from './settingsFilePort.ts'
/** The existing flat settings.json, with synchronous atomic commits for audio transactions. */
export declare class CoreSettingsRepository {
  readonly issue: SettingsFileLoadIssue | null
  constructor(options: {
    filePath: string
    environment: SettingsEnvironment
    initial?: Partial<AppSettings>
    changed(patch: Partial<AppSettings>): void
  })
  read(): AppSettings
  getRevision(): number
  normalize(patch: Partial<AppSettings>): AppSettings
  update(patch: Partial<AppSettings>): AppSettings
}
