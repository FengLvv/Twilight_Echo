import { computed, onBeforeUnmount, ref, watch, type Ref, type WatchSource } from 'vue'
import { primaryLyricScore, rhythmicLyricScore } from '../../../shared/lyrics/lyricAnalysis.ts'
import { activeChord, buildLyricChordRows } from '../utils/lyricChords.ts'
import { activeVocalNote, buildLyricNoteRows } from '../utils/numberedNotes.ts'
import type { LyricLine } from '../utils/lyrics.ts'
import type { LyricTimelineEntry } from '../utils/lyricTimeline.ts'
import { useChordDisplay } from './useChordDisplay.ts'
import { useSongAnalysis } from './useSongAnalysis.ts'

/** Playback clock updates only the cursor. Artifact identity owns score layout. */
export function usePlayingNotation(options: {
  songId(): string
  playing: Ref<boolean>
  clock: WatchSource<unknown>
  position(): number
  timeline(): LyricTimelineEntry[]
  offset(): number
  lines(): LyricLine[]
}) {
  const analysis = useSongAnalysis(options.songId)
  const chordDisplay = useChordDisplay(() => analysis.project.value, options.songId)
  const chordPosition = ref(0)
  let frame: number | undefined
  const stopClock = () => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }
  function updateClock(): void {
    chordPosition.value = options.position()
    if ((analysis.chordsVisible.value || analysis.melodyVisible.value) && options.playing.value)
      frame = requestAnimationFrame(updateClock)
  }
  watch(
    [analysis.chordsVisible, analysis.melodyVisible, options.playing, options.clock],
    () => {
      stopClock()
      updateClock()
    },
    { immediate: true }
  )
  onBeforeUnmount(stopClock)
  const result = computed(() => analysis.project.value?.result)
  const lyricChordRows = computed(() =>
    buildLyricChordRows(result.value?.chords.segments ?? [], options.timeline(), options.offset())
  )
  const lyricNoteRows = computed(() =>
    buildLyricNoteRows(result.value?.melody?.notes ?? [], options.timeline(), options.offset())
  )
  const interludeChord = computed(() =>
    activeChord(result.value?.chords.segments ?? [], chordPosition.value)
  )
  const currentVocalNote = computed(() =>
    activeVocalNote(result.value?.melody?.notes ?? [], chordPosition.value)
  )
  const vocalScores = computed(() => {
    const melody = result.value?.melody
    return new Map(
      melody?.scores?.map((score) => [
        score.lineId,
        rhythmicLyricScore(melody, score.lineId, score.text, chordDisplay.key.value)
      ])
    )
  })
  function lineScore(index: number, text: string) {
    const line = options.lines()[index]
    return analysis.melodyVisible.value && line?.text === text
      ? primaryLyricScore(vocalScores.value.get(index), line)
      : undefined
  }
  return {
    analysis,
    chordDisplay,
    chordPosition,
    lyricChordRows,
    lyricNoteRows,
    interludeChord,
    currentVocalNote,
    lineScore,
    lineChords: (index: number) => lyricChordRows.value[index]?.chords ?? []
  }
}
