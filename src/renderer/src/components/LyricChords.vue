<script setup lang="ts">
import { computed } from 'vue'
import type { StudyChord } from '../../../shared/musicStudy.ts'
const props = defineProps<{
  chords: readonly StudyChord[]
  position: number
  start?: number
  end?: number
  formatLabel?: (label: string) => string
}>()
const slots = computed(() =>
  props.chords
    .map(
      (chord) =>
        Math.max(
          0.01,
          Math.min(chord.end, props.end ?? chord.end) -
            Math.max(chord.start, props.start ?? chord.start)
        ) + 'fr'
    )
    .join(' ')
)
</script>
<template>
  <span
    v-if="chords.some((chord) => chord.label !== 'N')"
    class="lyric-chords"
    :style="{ gridTemplateColumns: slots }"
    aria-label="和弦"
  >
    <span
      v-for="chord in chords"
      :key="`${chord.start}:${chord.end}`"
      :data-chord-start="chord.start"
      :aria-current="
        position >= chord.start && position < chord.end && chord.label !== 'N' ? 'true' : undefined
      "
      :class="{
        'chord-active': position >= chord.start && position < chord.end && chord.label !== 'N'
      }"
      :title="`${chord.label} · ${chord.start.toFixed(2)}–${chord.end.toFixed(2)} 秒`"
      >{{ chord.label === 'N' ? '' : (formatLabel?.(chord.label) ?? chord.label) }}</span
    >
  </span>
</template>
<style scoped>
.lyric-chords {
  display: grid;
  align-items: center;
  gap: 0.25em;
  width: 100%;
  min-height: 1.5em;
  margin-bottom: 0.22em;
  font-size: clamp(12px, 0.36em, 20px);
  line-height: 1.5;
  font-weight: 500;
  font-family: 'Inter', var(--lyric-score-font-family, var(--te-font-sans));
  font-style: normal;
  font-variant-numeric: lining-nums tabular-nums;
  letter-spacing: 0.02em;
  color: inherit;
  opacity: 0.72;
  white-space: nowrap;
  overflow: hidden;
  text-align: center;
}
.lyric-chords > span {
  transition:
    opacity 0.12s,
    color 0.12s;
  opacity: 0.6;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 4px;
  border-bottom: 2px solid transparent;
}
.lyric-chords > .chord-active {
  opacity: 1;
  color: var(--te-playback-lyric-active-text, #fff);
  border-bottom-color: currentColor;
  background: color-mix(in srgb, currentColor 8%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .lyric-chords > span {
    transition: none;
  }
}
</style>
