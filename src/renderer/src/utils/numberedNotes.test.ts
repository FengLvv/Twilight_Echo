import test from 'node:test'
import assert from 'node:assert/strict'
import { numberedNote, activeVocalNote, buildLyricNoteRows } from './numberedNotes.ts'
test('numbered notation keeps accidentals and octaves and uses relative-major do for minor', () => {
  assert.deepEqual(numberedNote(60, { tonic: 0, mode: 'major' }), { label: '1', octave: 0 })
  assert.deepEqual(numberedNote(72, null), { label: '1', octave: 1 })
  assert.deepEqual(numberedNote(59, null), { label: '7', octave: -1 })
  assert.deepEqual(numberedNote(61, null), { label: '♯1', octave: 0 })
  assert.deepEqual(numberedNote(69, { tonic: 9, mode: 'minor' }), { label: '6', octave: 0 })
  assert.deepEqual(numberedNote(67, { tonic: 7, mode: 'major' }), { label: '1', octave: 0 })
})
test('notes use half-open audio intervals and keep fixed row membership across lyric offsets', () => {
  const notes = [
    { start: 1, end: 3, midi: 60 },
    { start: 4, end: 6, midi: 62 }
  ]
  assert.equal(activeVocalNote(notes, 3), undefined)
  assert.equal(activeVocalNote(notes, 4)?.midi, 62)
  assert.equal(activeVocalNote(notes, 6), undefined)
  const rows = buildLyricNoteRows(notes, [{ index: 0, time: 4, endTime: 6, timed: true }], 2)
  assert.deepEqual(rows[0], { start: 2, end: 4, notes: [notes[0]] })
})
