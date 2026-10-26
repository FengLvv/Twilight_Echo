import { shallowRef } from 'vue'
import type { EntityMetadataPolicyView } from '../../../shared/entityMetadata.ts'
import {
  musicMetadataSetupChoice,
  type MusicIdentificationSettings
} from '../../../shared/musicIdentificationSchedule.ts'

/** The dialog only saves preferences. Core's durable scheduler owns all enrichment. */
export function createMusicMetadataSetup(api: {
  current(): MusicIdentificationSettings
  hasMusic(): Promise<boolean>
  policy(): Promise<EntityMetadataPolicyView>
  save(settings: MusicIdentificationSettings): Promise<unknown>
}) {
  const state = shallowRef({ visible: false, saving: false, error: '' })
  let generation = 0
  let disposed = false
  return {
    state,
    async refresh(ready: boolean) {
      const request = ++generation
      if (!ready || disposed || api.current().setup !== 'pending') {
        state.value = { ...state.value, visible: false }
        return
      }
      if (state.value.visible || state.value.saving) return
      try {
        const hasMusic = await api.hasMusic()
        if (!disposed && generation === request && api.current().setup === 'pending')
          state.value = { ...state.value, visible: hasMusic }
      } catch {
        // A later library/Core revision retries this read; no preference has changed.
      }
    },
    async choose(enabled: boolean) {
      if (disposed || state.value.saving) return
      state.value = { ...state.value, saving: true, error: '' }
      try {
        const policy = enabled ? await api.policy() : null
        if (disposed) return
        await api.save(
          musicMetadataSetupChoice(
            api.current(),
            enabled,
            policy?.sources?.map((source) => source.provider) ?? []
          )
        )
        if (!disposed) state.value = { visible: false, saving: false, error: '' }
      } catch (error) {
        if (!disposed)
          state.value = {
            ...state.value,
            saving: false,
            error: `未能保存，请重试：${error instanceof Error ? error.message : String(error)}`
          }
      }
    },
    dispose() {
      disposed = true
      generation++
    }
  }
}
