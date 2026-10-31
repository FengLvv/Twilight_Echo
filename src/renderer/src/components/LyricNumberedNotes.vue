<script setup lang="ts">
import { computed } from 'vue'
import { numberedNote, type VocalNote } from '../utils/numberedNotes.ts'
import type { ChordKey } from '../utils/chordDegrees.ts'
const noteName = (midi: number) =>
  ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][midi % 12] +
  (Math.floor(midi / 12) - 1)
const props = defineProps<{
  notes: readonly VocalNote[]
  position: number
  start?: number
  end?: number
  tonalKey: ChordKey | null
}>()
const slots = computed(() => {
  const slots: Array<{ start: number; end: number; note?: VocalNote }> = []
  let cursor = props.start ?? props.notes[0]?.start ?? 0
  for (const note of props.notes) {
    const start = Math.max(cursor, note.start),
      end = Math.min(props.end ?? note.end, note.end)
    if (start > cursor) slots.push({ start: cursor, end: start })
    if (end > start) slots.push({ start, end, note })
    cursor = Math.max(cursor, end)
  }
  if (props.end !== undefined && cursor < props.end) slots.push({ start: cursor, end: props.end })
  return slots.map((slot) => ({
    ...slot,
    pitch: slot.note ? numberedNote(slot.note.midi, props.tonalKey) : null
  }))
})
</script>
<template>
  <span
    v-if="notes.length"
    class="lyric-numbered-notes"
    aria-label="人声简谱"
    :style="{
      gridTemplateColumns: slots.map((s) => `${Math.max(0.01, s.end - s.start)}fr`).join(' ')
    }"
  >
    <span
      v-for="slot in slots"
      :key="slot.start"
      :data-note-start="slot.note?.start"
      :aria-current="
        slot.note && position >= slot.note.start && position < slot.note.end ? 'true' : undefined
      "
      :title="
        slot.note
          ? `${noteName(slot.note.midi)} · ${slot.note.start.toFixed(2)}–${slot.note.end.toFixed(2)} 秒`
          : undefined
      "
    >
      <template v-if="slot.pitch"
        ><span class="octave-dots">{{
          slot.pitch.octave > 0 ? '·'.repeat(Math.min(4, slot.pitch.octave)) : ''
        }}</span
        ><span class="note-number">{{ slot.pitch.label }}</span
        ><span class="octave-dots">{{
          slot.pitch.octave < 0 ? '·'.repeat(Math.min(4, -slot.pitch.octave)) : ''
        }}</span></template
      >
    </span>
  </span>
</template>
<style scoped>
.lyric-numbered-notes {
  display: grid;
  align-items: center;
  width: 100%;
  margin-bottom: 0.25em;
  font-size: clamp(12px, 0.36em, 20px);
  line-height: 1;
  color: inherit;
  opacity: 0.8;
  font-weight: 600;
  text-align: center;
}
.lyric-numbered-notes > span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: 4px;
  opacity: 0.6;
}
.lyric-numbered-notes > span[aria-current='true'] {
  opacity: 1;
  color: var(--te-playback-lyric-active-text, #fff);
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.octave-dots {
  height: 0.5em;
  line-height: 0.5em;
  letter-spacing: 0.06em;
}
.note-number {
  font-family: 'Inter', 'Segoe UI Symbol', var(--te-font-sans);
  font-style: normal;
  font-weight: 500;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
}
</style>
