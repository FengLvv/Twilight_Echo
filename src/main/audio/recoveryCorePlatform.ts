import { dialog } from 'electron'
import { runtime } from '../core/runtime.ts'
import { mainLocale } from '../core/locale.ts'
import { translate } from '../../shared/i18n/translate.ts'
import { restartWindowsAudioServices } from './windowsAudioServices.ts'

export function createAudioRecoveryCorePlatform() {
  return {
    'audio.confirmWindowsRestart': async (_input: Record<string, never>, signal: AbortSignal): Promise<boolean> => {
      if (process.platform !== 'win32') return false
      signal.throwIfAborted()
      const locale = mainLocale()
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: translate(locale, 'audioRecovery.windows.title'),
        message: translate(locale, 'audioRecovery.windows.confirm'),
        detail: translate(locale, 'audioRecovery.windows.impact'),
        buttons: [translate(locale, 'audioRecovery.windows.action'), translate(locale, 'audioRecovery.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        signal
      }
      const parent = runtime.mainWindow
      const result = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      signal.throwIfAborted()
      return result.response === 0
    },
    'audio.restartWindowsServices': async (): Promise<void> => {
      try {
        await restartWindowsAudioServices()
      } catch (error) {
        const code = (error as { code?: string })?.code ?? 'AUDIO_SERVICES_FAILED'
        const key = code === 'CANCELLED' ? 'cancelled'
          : code === 'AUDIO_SERVICES_TIMEOUT' ? 'timeout' : 'failed'
        throw Object.assign(new Error(translate(mainLocale(), `audioRecovery.windows.${key}`)), { code })
      }
    }
  }
}
