<script setup lang="ts">
import { computed, ref } from 'vue'
import AppearancePopover from './AppearancePopover.vue'
import { KEY_ROOT_NAMES, keyName, parseKey, type ChordKey } from '../utils/chordDegrees.ts'

const props = defineProps<{ selectedKey: string; inferred: ChordKey | null }>()
const emit = defineEmits<{ change: [value: string] }>()
const activeKey = computed(() => parseKey(props.selectedKey) ?? props.inferred)
const label = computed(() => (activeKey.value ? keyName(activeKey.value) : '调性 —'))
const open = ref(false),
  anchor = ref<HTMLElement | null>(null)
function selectKey(event: Event) {
  emit('change', (event.target as HTMLSelectElement).value)
  open.value = false
}
</script>
<template>
  <button
    ref="anchor"
    type="button"
    class="ghost-button song-tonal-key"
    :aria-label="`调性：${activeKey ? keyName(activeKey) : '未识别'}`"
    :aria-expanded="open"
    aria-haspopup="dialog"
    :title="selectedKey === 'auto' ? '自动识别调性' : '手动指定调性'"
    @click.stop="open = !open"
  >
    {{ label }}
  </button>
  <AppearancePopover :open="open" :anchor="anchor" label="调性" @close="open = false">
    <select
      :value="selectedKey"
      aria-label="选择调性"
      @change="selectKey"
    >
      <option value="auto">{{ inferred ? `自动 · ${keyName(inferred)}` : '自动识别' }}</option>
      <template v-for="(root, index) in KEY_ROOT_NAMES" :key="root">
        <option :value="`${index}:major`">{{ root }} 大调</option>
        <option :value="`${index}:minor`">{{ root }} 小调</option>
      </template>
    </select>
  </AppearancePopover>
</template>
<style scoped>
.song-tonal-key {
  flex: none;
  min-height: 32px;
  padding: 4px 8px;
  border: 0;
  border-radius: var(--te-control-radius-sm, 8px);
  background: transparent;
  color: var(--te-playback-control-text, rgba(255, 255, 255, 0.7));
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.song-tonal-key:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
select {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--te-card-border);
  border-radius: var(--te-control-radius-md);
  background: var(--te-card-bg);
  color: inherit;
  font: inherit;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
</style>
