<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStudyComponents } from '../stores/studyComponents.ts'
import NativeDialogTransition from './NativeDialogTransition.vue'
import StudyComponentConsentDialog from './StudyComponentConsentDialog.vue'
const components = useStudyComponents(), hidden = ref(new Set<string>())
const request = computed(() => components.state.value?.requests.find(item => item.interactive && !hidden.value.has(item.owner)))
watch(() => components.state.value?.requests.map(item => item.owner) ?? [], owners => {
  hidden.value = new Set([...hidden.value].filter(owner => owners.includes(owner)))
})
function close() {
  if (components.selected.value) components.selected.value = null
  else if (request.value) hidden.value = new Set([...hidden.value, request.value.owner])
}
</script>

<template>
  <NativeDialogTransition>
    <StudyComponentConsentDialog v-if="components.selected.value || request" :plan="components.selected.value || request!.plan" :owner="components.selected.value ? undefined : request?.owner" :title="components.selected.value ? undefined : request?.title" @close="close" />
  </NativeDialogTransition>
</template>
