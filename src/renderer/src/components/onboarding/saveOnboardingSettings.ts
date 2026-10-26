import type { CoreAudioOutput, CoreAudioOutputEdit } from '../../../../shared/coreAudio.ts'
import type { CoreSettingsPatch } from '../../../../shared/coreSettings.ts'
import type { OnboardingSettingsPatch } from './useOnboardingFlow.ts'

/** Audio preferences must commit through the output transaction, not settings.edit. */
export async function saveOnboardingSettings(
  patch: OnboardingSettingsPatch,
  api: {
    core: {
      query(name: 'audio.output', payload: Record<string, never>): Promise<CoreAudioOutput>
      command(name: 'audio.output.edit', payload: CoreAudioOutputEdit): Promise<unknown>
    }
    updateSettings(patch: CoreSettingsPatch): Promise<unknown>
  }
): Promise<void> {
  const { audioExclusiveMode, ...preferences } = patch
  if (audioExclusiveMode !== undefined) {
    const { revision, output } = await api.core.query('audio.output', {})
    if (output.exclusiveMode !== audioExclusiveMode) {
      await api.core.command('audio.output.edit', {
        revision,
        edit: { kind: 'exclusive', enabled: audioExclusiveMode }
      })
    }
  }
  // Mark onboarding complete only after the requested audio mode is acknowledged.
  await api.updateSettings(preferences)
}
