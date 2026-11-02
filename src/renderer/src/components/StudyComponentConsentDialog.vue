<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNativeDialog } from '../composables/useNativeDialog.ts'
import { useStudyComponents, componentSize } from '../stores/studyComponents.ts'
import type { StudyComponentPlan } from '../../../shared/studyComponents.ts'
const props = defineProps<{ plan: StudyComponentPlan; owner?: string; title?: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null), busy = ref(false), error = ref('')
useNativeDialog(dialog)
const components = useStudyComponents()
const rows = computed(() => components.state.value?.catalog.components.filter(item => props.plan.ids.includes(item.id)) ?? [])
async function confirm() {
  busy.value = true
  try { await components.install(props.plan.features); emit('close') }
  catch (e) { error.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
async function cancel() {
  if (busy.value) return
  try {
    if (props.owner) {
      await components.dismiss(props.owner)
    }
    emit('close')
  } catch (e) { error.value = e instanceof Error ? e.message : String(e) }
}
</script>

<template>
  <dialog ref="dialog" class="study-component-consent" aria-labelledby="study-component-consent-title" @cancel.prevent="cancel">
    <form @submit.prevent="confirm">
      <h2 id="study-component-consent-title">安装分析组件</h2>
      <p v-if="title" class="consent-title">{{ title }}</p>
      <dl class="consent-sizes"><div><dt>下载</dt><dd>{{ componentSize(plan.downloadBytes) }}</dd></div><div><dt>安装占用</dt><dd>{{ componentSize(plan.installedBytes) }}</dd></div></dl>
      <ul class="consent-components"><li v-for="item in rows" :key="item.id"><span>{{ item.title }}</span><span>{{ componentSize(item.parts.reduce((n, part) => n + part.bytes, 0)) }}</span></li></ul>
      <p class="consent-location">{{ plan.directory }}</p>
      <p v-if="error" role="alert" class="consent-error">{{ error }}</p>
      <div class="consent-actions"><button type="button" class="preset-btn" :disabled="busy" @click="cancel">取消</button><button type="submit" class="preset-btn active" :disabled="busy">下载并继续</button></div>
    </form>
  </dialog>
</template>

<style scoped>
.study-component-consent { box-sizing: border-box; width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; margin: auto; padding: 24px; border: 1px solid var(--te-card-border); border-radius: var(--te-dialog-radius, 12px); background: var(--te-card-bg); color: var(--te-settings-text); }
.study-component-consent::backdrop { background: rgb(0 0 0 / 38%); }
h2 { margin: 0; font-size: 20px; }
.consent-title { margin: 10px 0 0; overflow-wrap: anywhere; }
.consent-sizes { display: flex; justify-content: space-between; gap: 16px; margin: 24px 0 16px; }
.consent-sizes div { display: grid; gap: 6px; }
dt { font-size: 13px; } dd { margin: 0; font-size: 20px; font-variant-numeric: tabular-nums; }
.consent-components { display: grid; gap: 12px; padding: 16px 0; margin: 0; list-style: none; border-block: 1px solid var(--te-card-border); }
.consent-components li { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
.consent-components li span:last-child { flex: none; font-variant-numeric: tabular-nums; }
.consent-location { margin: 16px 0; font-size: 12px; overflow-wrap: anywhere; }
.consent-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.consent-actions button { min-height: 38px; padding: 8px 16px; border: 1px solid var(--te-card-border); border-radius: 8px; color: var(--te-settings-text); background: var(--te-settings-control-bg); font: inherit; cursor: pointer; }
.consent-actions button:hover { background: var(--te-neutral-100); }
.consent-actions button.active { background: var(--te-settings-text); color: var(--te-card-bg); border-color: transparent; }
.consent-actions button:disabled { opacity: 0.6; cursor: wait; }
.consent-error { color: var(--te-primary-500); overflow-wrap: anywhere; font-size: 13px; }
button:focus-visible { outline: 2px solid var(--te-primary-500); outline-offset: 3px; }
</style>
