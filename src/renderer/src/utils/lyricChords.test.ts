import test from 'node:test'
import assert from 'node:assert/strict'
import { chordsForLyric, activeChord, buildLyricChordRows } from './lyricChords.ts'
import type { StudyChord } from '../../../shared/musicStudy.ts'
const chords: StudyChord[] = [
  { start: 0, end: 4, label: 'C', confidence: 'unrated', candidates: [] },
  { start: 4, end: 6, label: 'Am', confidence: 'unrated', candidates: [] },
  { start: 6, end: 10, label: 'G', confidence: 'unrated', candidates: [] }
]
test('lyric rows include continuing chords, all changes and exact boundaries', () => {
  const row = { index: 0, time: 2, endTime: 6, timed: true }
  assert.deepEqual(
    chordsForLyric(chords, row, 0).map((c) => c.label),
    ['C', 'Am']
  )
  assert.deepEqual(
    chordsForLyric(chords, { ...row, time: 6, endTime: 9 }, 0).map((c) => c.label),
    ['G']
  )
  assert.equal(activeChord(chords, 4)?.label, 'Am')
  assert.equal(activeChord(chords, 10), undefined)
})
test('lyric offset moves row ownership while chord highlighting stays on audio time', () => {
  const row = { index: 0, time: 4, endTime: 6, timed: true }
  assert.deepEqual(
    chordsForLyric(chords, row, 2).map((c) => c.label),
    ['C']
  )
  assert.equal(activeChord(chords, 4)?.label, 'Am')
  assert.deepEqual(
    chordsForLyric(chords, { ...row, time: null, endTime: null, timed: false }, 0),
    []
  )
})

test('playback only changes the active chord, never the fixed lyric row slots', () => {
  const rows = buildLyricChordRows(
    chords,
    [
      { index: 0, time: 2, endTime: 6, timed: true },
      { index: 1, time: 6, endTime: 10, timed: true }
    ],
    0
  )
  const layout = JSON.stringify(rows)
  const labels: Array<string | undefined> = []
  for (const time of [2, 3, 4, 5, 6, 8, 9]) {
    labels.push(activeChord(chords, time)?.label)
    assert.equal(JSON.stringify(rows), layout)
  }
  assert.deepEqual(labels, ['C', 'C', 'Am', 'Am', 'G', 'G', 'G'])
  assert.deepEqual(
    rows[0].chords.map((chord) => chord.start),
    [0, 4]
  )
})
