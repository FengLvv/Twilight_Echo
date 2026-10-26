<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useCoreConnection } from '../../stores/coreConnection.ts'
import { useSettingsStore } from '../../stores/useSettingsStore.ts'
import { createMusicMetadataSetup } from '../../app/musicMetadataSetup.ts'
import MusicMetadataSetupDialog from './MusicMetadataSetupDialog.vue'
import NativeDialogTransition from '../NativeDialogTransition.vue'

const props = defineProps<{ suspended: boolean }>()
const core = useCoreConnection()
const { settings, loaded, updateSettings } = useSettingsStore()
const model = createMusicMetadataSetup({
  current: () => settings.value.musicIdentification,
  hasMusic: async () =>
    (await core.query('catalog.query', { kind: 'recording', limit: 1 })).total > 0,
  policy: () => core.query('metadata.entity.policy', {}),
  save: (musicIdentification) => updateSettings({ musicIdentification })
})
const state = model.state
watch(
  [
    () => props.suspended,
    loaded,
    () => settings.value.musicIdentification.setup,
    () => core.state.value?.epoch,
    () => core.state.value?.phase,
    () => core.state.value?.libraryRevision,
    () => core.state.value?.catalogRevision,
    () => core.state.value?.scan?.phase,
    () => core.state.value?.migrationRequired
  ],
  () =>
    void model.refresh(
      loaded.value &&
        !props.suspended &&
        core.state.value?.phase === 'ready' &&
        !core.state.value.migrationRequired &&
        (!core.state.value.scan || core.state.value.scan.phase === 'idle')
    ),
  { immediate: true }
)
onBeforeUnmount(model.dispose)
</script>

<template>
  <NativeDialogTransition>
    <MusicMetadataSetupDialog
      v-if="state.visible"
      :saving="state.saving"
      :error="state.error"
      @choose="model.choose"
    />
  </NativeDialogTransition>
</template>
