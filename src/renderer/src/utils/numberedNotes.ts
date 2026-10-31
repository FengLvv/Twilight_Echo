import type { StudyResult } from '../../../shared/musicStudy.ts'
import type { ChordKey } from './chordDegrees.ts'
import type { LyricTimelineEntry } from './lyricTimeline.ts'
export type VocalNote = NonNullable<StudyResult['melody']>['notes'][number]

export function numberedNote(midi: number, key: ChordKey | null) {
  // Numbered notation uses the relative major's do (minor melodies resolve to 6).
  const tonic = key ? (key.tonic + (key.mode === 'minor' ? 3 : 0)) % 12 : 0
  const relative = midi - (60 + tonic)
  const pitch = ((relative % 12) + 12) % 12
  const labels = ['1', '♯1', '2', '♭3', '3', '4', '♯4', '5', '♭6', '6', '♭7', '7']
  return { label: labels[pitch], octave: Math.floor(relative / 12) }
}
export function activeVocalNote(notes: readonly VocalNote[], position: number) {
  let low = 0,
    high = notes.length - 1
  while (low <= high) {
    const mid = (low + high) >>> 1,
      note = notes[mid]
    if (position < note.start) high = mid - 1
    else if (position >= note.end) low = mid + 1
    else return note
  }
  return undefined
}
export function buildLyricNoteRows(
  notes: readonly VocalNote[],
  lines: readonly LyricTimelineEntry[],
  offset: number
) {
  return lines.map((line) => {
    const start = line.time === null ? undefined : line.time - offset
    const end = line.endTime === null ? undefined : line.endTime - offset
    return {
      start,
      end,
      notes:
        start === undefined || end === undefined
          ? []
          : notes.filter((n) => n.lineId !== undefined ? n.lineId === line.index : n.start < end && n.end > start)
    }
  })
}
