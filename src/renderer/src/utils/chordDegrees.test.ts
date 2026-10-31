import test from 'node:test'
import assert from 'node:assert/strict'
import { romanChord, inferChordKey, parseKey } from './chordDegrees.ts'
import type { StudyChord } from '../../../shared/musicStudy.ts'
const C = { tonic: 0, mode: 'major' } as const,
  A = { tonic: 9, mode: 'minor' } as const
const progression = (labels: string[]): StudyChord[] =>
  labels.map((label, i) => ({
    start: i * 4,
    end: (i + 1) * 4,
    label,
    confidence: 'unrated',
    candidates: []
  }))
test('roman degrees preserve chord quality and transpose with the tonic', () => {
  assert.deepEqual(
    ['C', 'Am', 'F', 'G7'].map((c) => romanChord(c, C)),
    ['I', 'vi', 'IV', 'V7']
  )
  assert.deepEqual(
    ['E', 'C#m', 'A', 'B7'].map((c) => romanChord(c, { tonic: 4, mode: 'major' })),
    ['I', 'vi', 'IV', 'V7']
  )
  assert.deepEqual(
    ['Am', 'Dm', 'E7', 'C', 'G#dim'].map((c) => romanChord(c, A)),
    ['i', 'iv', 'V7', 'III', '♯vii°']
  )
})
test('borrowed chords, sevenths, suspensions and inversion bass retain their meaning', () => {
  for (const [name, degree] of [
    ['Bb7', '♭VII7'],
    ['F#dim', '♯iv°'],
    ['Bm7b5', 'viiø7'],
    ['Cmaj7', 'Imaj7'],
    ['Csus4', 'Isus4'],
    ['C7sus4', 'I7sus4'],
    ['C/E', 'I⁶'],
    ['G7/B', 'V⁶₅'],
    ['Dm7/A', 'ii⁴₃'],
    ['C/Bb', 'I/Bb']
  ])
    assert.equal(romanChord(name, C), degree, name)
  assert.equal(romanChord('AmMaj7', A), 'iMaj7')
  assert.equal(romanChord('N', C), 'N')
  assert.equal(romanChord('X', C), 'X')
  assert.equal(romanChord('G7', null), 'G7')
})
test('whole-song tonal estimation is transposition invariant and handles silence', () => {
  assert.deepEqual(inferChordKey(progression(['C', 'Am', 'F', 'G', 'C'])), C)
  assert.deepEqual(inferChordKey(progression(['E', 'C#m', 'A', 'B', 'E'])), {
    tonic: 4,
    mode: 'major'
  })
  assert.deepEqual(inferChordKey(progression(['Am', 'Dm', 'E7', 'Am'])), A)
  assert.equal(inferChordKey(progression(['N', 'N'])), null)
  assert.equal(inferChordKey([]), null)
})
test('display transformations never rewrite analysis results and key inputs are bounded', () => {
  const chords = progression(['C', 'Am', 'F', 'G7']),
    before = JSON.stringify(chords)
  for (const chord of chords) romanChord(chord.label, inferChordKey(chords))
  assert.equal(JSON.stringify(chords), before)
  assert.deepEqual(parseKey('0:major'), C)
  assert.deepEqual(parseKey('9:minor'), A)
  for (const value of ['12:major', '-1:minor', '0:dorian', '0:major:any', 'NaN:minor'])
    assert.equal(parseKey(value), null)
})
