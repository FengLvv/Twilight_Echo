import type { ChordKey } from './chordDegrees.ts'

/** One register for the whole vocal part; playback and source MIDI stay absolute. */
export function numberedOctaveShift(
  notes: readonly { midi: number; start: number; end: number }[],
  key: ChordKey | null
): number {
  const weights = Array<number>(128).fill(0)
  for (const note of notes)
    if (Number.isInteger(note.midi) && note.midi >= 0 && note.midi < 128)
      weights[note.midi] += Math.max(0, note.end - note.start)
  let remaining = weights.reduce((sum, weight) => sum + weight, 0) / 2
  if (!remaining) return 0
  const tonic = key ? (key.tonic + (key.mode === 'minor' ? 3 : 0)) % 12 : 0
  for (let midi = 0; midi < weights.length; midi++) {
    remaining -= weights[midi]
    if (remaining <= 0) return -12 * Math.floor((midi - 60 - tonic) / 12)
  }
  return 0
}
