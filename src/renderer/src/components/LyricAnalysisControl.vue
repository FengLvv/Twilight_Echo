<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

const props = defineProps<{
  label: string
  enabled: boolean
  busy?: boolean
  error?: string
  format: string
  formats: ReadonlyArray<{ value: string; label: string }>
}>()
const emit = defineEmits<{ toggle: []; format: [value: string] }>()
const hovered = ref(false),
  focused = ref(false),
  dismissed = ref(false)
const root = ref<HTMLElement | null>(null)
const showFormats = computed(() => (hovered.value || focused.value) && !dismissed.value)
function enterPointer() {
  hovered.value = true
  dismissed.value = false
}
function enterFocus(event: FocusEvent) {
  if ((event.target as HTMLElement).matches(':focus-visible')) {
    focused.value = true
    dismissed.value = false
  }
}
function leaveFocus(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    focused.value = false
  }
}
async function focusFormats() {
  dismissed.value = false
  focused.value = true
  await nextTick()
  root.value?.querySelector<HTMLElement>('[role="group"] button')?.focus()
}
function select(value: string) {
  emit('format', value)
  dismissed.value = true
}
</script>

<template>
  <div
    ref="root"
    class="lyric-analysis-control"
    @pointerenter="enterPointer"
    @pointerleave="hovered = false"
    @focusin="enterFocus"
    @focusout="leaveFocus"
    @keydown.esc.stop.prevent="dismissed = true"
  >
    <button
      type="button"
      class="ghost-button lyric-analysis-toggle"
      :aria-label="label"
      :aria-pressed="enabled"
      :aria-busy="enabled && !!busy"
      :title="error || `${enabled ? '隐藏' : '显示'}${label}`"
      @click="emit('toggle')"
      @keydown.down.stop.prevent="focusFormats"
    >
      <i v-if="enabled && busy" class="pi pi-spin pi-spinner" aria-hidden="true" />{{ label }}
    </button>
    <div
      v-show="showFormats"
      class="lyric-analysis-formats"
      data-te-material="popover"
      role="group"
      :aria-label="`${label}格式`"
    >
      <button
        v-for="option in props.formats"
        :key="option.value"
        type="button"
        class="ghost-button"
        :aria-pressed="format === option.value"
        @click="select(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.lyric-analysis-control {
  position: relative;
  flex: none;
  padding-block-end: 10px;
  margin-block-end: -10px;
  font-size: calc(var(--te-font-size-body, 14px) * 12 / 14);
}
.lyric-analysis-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: 4px 12px;
  border: 1px solid currentColor;
  border-radius: 16px;
  background: transparent;
  color: var(--te-playback-control-text, rgba(255, 255, 255, 0.7));
  font: inherit;
  cursor: pointer;
}
.lyric-analysis-toggle[aria-pressed='true'] {
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: var(--te-playback-page-text, #f4f7fb);
}
.lyric-analysis-formats {
  position: absolute;
  inset-block-start: 100%;
  inset-inline-start: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  width: max-content;
  max-width: calc(100vw - 24px);
  padding: 4px;
  gap: 4px;
  border: 1px solid var(--te-card-border);
  border-radius: var(--te-control-radius-md, 12px);
  background: var(--te-material-background, var(--te-control-bg, var(--te-card-bg)));
  color: var(--te-material-ink, var(--te-control-fg, var(--te-settings-text, #17212b)));
}
.lyric-analysis-formats button {
  min-height: 36px;
  padding: 6px 12px;
  border: 0;
  border-radius: var(--te-control-radius-sm, 8px);
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
}
.lyric-analysis-formats button[aria-pressed='true'],
.lyric-analysis-formats button:hover {
  background: var(--te-subtle-bg);
  color: var(--te-primary-500);
}
button:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
</style>
