<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import AppearancePopover from './AppearancePopover.vue'
import { KEY_ROOT_NAMES, keyName, parseKey, type ChordKey } from '../utils/chordDegrees.ts'
const props = defineProps<{
  mode: 'names' | 'degrees'
  selectedKey: string
  inferred: ChordKey | null
  notationVisible?: boolean
  notationMode?: 'numbered' | 'staff'
}>()
const activeKey = computed(() => parseKey(props.selectedKey) ?? props.inferred)
const notationLabel = computed(() =>
  props.notationMode === 'staff'
    ? `${KEY_ROOT_NAMES[activeKey.value?.tonic ?? 0]}${activeKey.value?.mode === 'minor' ? 'm' : ''}`
    : `1=${KEY_ROOT_NAMES[activeKey.value ? (activeKey.value.tonic + (activeKey.value.mode === 'minor' ? 3 : 0)) % 12 : 0]}`
)
const degreeLabel = computed(() =>
  activeKey.value
    ? `级数 · ${KEY_ROOT_NAMES[activeKey.value.tonic]}${activeKey.value.mode === 'minor' ? 'm' : ''}`
    : '级数'
)
const emit = defineEmits<{
  mode: [value: 'names' | 'degrees']
  key: [value: string]
  open: [value: boolean]
  notationMode: [value: 'numbered' | 'staff']
}>()
const open = ref(false),
  anchor = ref<HTMLElement | null>(null)
watch(open, (value) => emit('open', value))
onBeforeUnmount(() => {
  if (open.value) emit('open', false)
})
function select(mode: 'names' | 'degrees') {
  emit('mode', mode)
  if (mode === 'names') open.value = false
}
</script>
<template>
  <button
    ref="anchor"
    type="button"
    class="ghost-button chord-display-button"
    :aria-expanded="open"
    aria-haspopup="dialog"
    aria-label="和弦显示方式"
    :title="mode === 'degrees' && activeKey ? keyName(activeKey) : '和弦显示方式'"
    @click="open = !open"
  >
    {{ mode === 'names' ? (notationVisible ? notationLabel : '名称') : degreeLabel
    }}<i class="ph ph-caret-down" aria-hidden="true" />
  </button>
  <AppearancePopover :open="open" :anchor="anchor" label="和弦显示方式" @close="open = false"
    ><div class="chord-display-options">
      <div v-if="notationVisible" role="group" aria-label="乐谱样式">
        <button
          type="button"
          class="ghost-button"
          :aria-pressed="notationMode !== 'staff'"
          @click="emit('notationMode', 'numbered')"
        >
          简谱
        </button>
        <button
          type="button"
          class="ghost-button"
          :aria-pressed="notationMode === 'staff'"
          @click="emit('notationMode', 'staff')"
        >
          五线谱
        </button>
      </div>
      <div role="group" aria-label="和弦显示">
        <button
          type="button"
          class="ghost-button"
          :aria-pressed="mode === 'names'"
          @click="select('names')"
        >
          和弦名称</button
        ><button
          type="button"
          class="ghost-button"
          :aria-pressed="mode === 'degrees'"
          @click="select('degrees')"
        >
          罗马级数
        </button>
      </div>
      <select
        v-if="mode === 'degrees' || notationVisible"
        :value="selectedKey"
        aria-label="调性"
        :title="selectedKey === 'auto' ? '根据整首和弦推断主调，可手动校正' : '手动指定主调'"
        @change="emit('key', ($event.target as HTMLSelectElement).value)"
      >
        <option value="auto">
          {{ inferred ? `自动 · ${keyName(inferred)}` : '自动 · 选择主调' }}
        </option>
        <template v-for="(root, index) in KEY_ROOT_NAMES" :key="root"
          ><option :value="`${index}:major`">{{ root }} 大调</option>
          <option :value="`${index}:minor`">{{ root }} 小调</option></template
        >
      </select>
    </div></AppearancePopover
  >
</template>
<style scoped>
.chord-display-button {
  border: 0;
  background: transparent;
  color: var(--te-playback-control-text, rgba(255, 255, 255, 0.7));
  padding: 6px 8px;
  min-height: 34px;
  gap: 5px;
  white-space: nowrap;
  font-size: 12px;
}
.chord-display-options {
  display: grid;
  gap: 12px;
}
.chord-display-options > div {
  display: flex;
  gap: 6px;
}
.chord-display-options button {
  flex: 1;
  min-height: 36px;
  background: transparent;
  color: inherit;
  border: 0;
}
.chord-display-options button[aria-pressed='true'] {
  background: var(--te-subtle-bg);
  color: var(--te-primary-500);
}
select {
  width: 100%;
  font: inherit;
  color: inherit;
  background: var(--te-card-bg);
  border: 1px solid var(--te-card-border);
  border-radius: var(--te-control-radius-md);
  padding: 8px;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 3px;
}
</style>
