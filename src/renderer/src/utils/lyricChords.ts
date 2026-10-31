import type { StudyChord } from '../../../shared/musicStudy.ts'
import type { LyricTimelineEntry } from './lyricTimeline.ts'

/** Chords stay on the audio clock; lyric offset only changes which row owns them. */
export function chordsForLyric(
  segments: readonly StudyChord[],
  line: LyricTimelineEntry,
  offset: number
): StudyChord[] {
  if (line.time === null || line.endTime === null) return []
  const start = line.time - offset,
    end = line.endTime - offset
  return segments.filter((chord) => chord.start < end && chord.end > start)
}
export function activeChord(
  segments: readonly StudyChord[],
  position: number
): StudyChord | undefined {
  return segments.find((chord) => position >= chord.start && position < chord.end)
}

/** Row membership and slot widths depend on the score and lyric timings, never on playback. */
export function buildLyricChordRows(
  segments: readonly StudyChord[],
  lines: readonly LyricTimelineEntry[],
  offset: number
) {
  return lines.map((line) => ({
    start: line.time === null ? undefined : line.time - offset,
    end: line.endTime === null ? undefined : line.endTime - offset,
    chords: chordsForLyric(segments, line, offset)
  }))
}
