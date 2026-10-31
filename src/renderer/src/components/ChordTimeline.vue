<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { StudyChord } from '../../../shared/musicStudy.ts'
import { activeChord } from '../utils/lyricChords.ts'
const props = defineProps<{
  chords: readonly StudyChord[]
  position: number
  formatLabel?: (label: string) => string
}>()
const emit = defineEmits<{ seek: [position: number] }>()
const root = ref<HTMLElement>(),
  active = computed(() => activeChord(props.chords, props.position)?.start)
watch(
  active,
  async () => {
    await nextTick()
    const row = root.value?.querySelector<HTMLElement>('[aria-current="true"]')
    if (row && root.value)
      root.value.scrollTo({
        top: row.offsetTop - root.value.clientHeight / 2 + row.clientHeight / 2,
        behavior: 'instant'
      })
  },
  { immediate: true }
)
</script>
<template>
  <div ref="root" class="chord-timeline" aria-label="同步和弦" @wheel.stop @touchmove.stop>
    <button
      v-for="chord in chords"
      :key="chord.start"
      :aria-current="active === chord.start ? 'true' : undefined"
      @click="emit('seek', chord.start)"
    >
      <small
        >{{ Math.floor(chord.start / 60) }}:{{
          Math.floor(chord.start % 60)
            .toString()
            .padStart(2, '0')
        }}</small
      >{{ formatLabel?.(chord.label) ?? chord.label }}
    </button>
  </div>
</template>
<style scoped>
.chord-timeline {
  height: 100%;
  overflow: auto;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 30vh 10px;
  box-sizing: border-box;
  scrollbar-width: none;
}
button {
  font: inherit;
  font-size: 32px;
  background: none;
  border: 0;
  color: inherit;
  opacity: 0.35;
  cursor: pointer;
  flex: none;
}
button[aria-current='true'] {
  opacity: 1;
  color: var(--te-primary-500);
}
small {
  font-size: 12px;
  margin-right: 18px;
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
}
button:focus-visible {
  outline: 2px solid var(--te-primary-500);
  outline-offset: 4px;
}
</style>
