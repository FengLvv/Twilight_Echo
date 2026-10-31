import {
  findDesktopLyricsActiveIndex,
  type DesktopLyricsSession,
  type RhythmicLyricScore
} from '../desktopLyrics.ts'
import type { StudyLyricsProjection, StudyResult } from '../musicStudy.ts'
import { inferChordKey, parseKey } from './chordDegrees.ts'

/** Each view gets the same native layout with row-local, stable note identities. */
export function rhythmicLyricScore(
  melody: StudyResult['melody'],
  lineId: number,
  text: string
): RhythmicLyricScore | undefined {
  const score = melody?.scores?.find((s) => s.lineId === lineId && s.text.trim() === text.trim())
  if (!score || !melody) return undefined
  const selected = melody.notes.flatMap((note, index) =>
    note.lineId === lineId ? [{ note, index }] : []
  )
  if (!selected.length) return undefined
  const indices = new Map(selected.map((n, i) => [n.index, i]))
  let valid = true
  const svg = score.svg.replace(/data-note="(\d+)"/g, (_match, index) => {
    const local = indices.get(Number(index))
    if (local === undefined) {
      valid = false
      return ''
    }
    return `data-note="${local}"`
  })
  return valid ? { svg, text, notes: selected.map((n) => n.note) } : undefined
}

/** Send a small look-ahead window to the satellite; keep the complete score in Core/Main. */
export function projectDesktopAnalysis(
  base: DesktopLyricsSession,
  analysis: StudyLyricsProjection | undefined,
  position: number
): DesktopLyricsSession {
  if (!analysis) return base
  const inferred = inferChordKey(analysis.chords) ?? analysis.melody?.key ?? null
  const header = {
    display: analysis.display,
    key: parseKey(analysis.display.key) ?? inferred,
    inferred,
    melodyBusy: analysis.melodyBusy,
    chordsBusy: analysis.chordsBusy,
    error: analysis.error
  }
  if (!base.lines.length && analysis.display.chordsVisible && analysis.chords.length) {
    return {
      ...base,
      status: 'ready',
      analysis: header,
      lines: analysis.chords.map((chord, index) => ({
        id: `music:${index}`,
        text: '',
        startMs: Math.round(chord.start * 1000) + base.lyricOffsetMs,
        endMs: Math.round(chord.end * 1000) + base.lyricOffsetMs,
        chords: [chord]
      }))
    }
  }
  const focus = Math.max(
    0,
    findDesktopLyricsActiveIndex(base.lines, position * 1000 + base.lyricOffsetMs)
  )
  return {
    ...base,
    analysis: header,
    lines: base.lines.map((line, index) => {
      if (index < focus - 1 || index > focus + 3) return line
      const sourceIndex = Number(line.id.split(':')[0])
      const start = line.startMs === null ? undefined : (line.startMs - base.lyricOffsetMs) / 1000
      const end = line.endMs === null ? undefined : (line.endMs - base.lyricOffsetMs) / 1000
      const chords =
        analysis.display.chordsVisible && start !== undefined && end !== undefined
          ? analysis.chords.filter((c) => c.start < end && c.end > start)
          : undefined
      return {
        ...line,
        chords,
        score: analysis.display.notationVisible
          ? rhythmicLyricScore(analysis.melody, sourceIndex, line.text)
          : undefined
      }
    })
  }
}
