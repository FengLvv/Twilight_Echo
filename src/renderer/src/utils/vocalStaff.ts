import type { VocalNote } from './numberedNotes.ts'
import type { ChordKey } from './chordDegrees.ts'

const major = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const minor = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']
const majorFifths = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]
const minorFifths = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2]
const letters = 'CDEFGAB'
const naturals = [0, 2, 4, 5, 7, 9, 11]

function keySignature(fifths: number) {
  const signature = Array<number>(7).fill(0)
  const order = fifths < 0 ? 'BEADGCF' : 'FCGDAEB'
  for (const letter of order.slice(0, Math.abs(fifths)))
    signature[letters.indexOf(letter)] = Math.sign(fifths)
  return signature
}

function spell(midi: number, fifths: number, signature: readonly number[]) {
  const pc = ((midi % 12) + 12) % 12
  const choices = naturals
    .flatMap((natural, degree) =>
      [-1, 0, 1]
        .filter((a) => (natural + a + 12) % 12 === pc)
        .map((accidental) => ({
          degree,
          accidental,
          cost:
            Math.abs(accidental - signature[degree]) * 4 +
            Math.abs(accidental) +
            (accidental && Math.sign(accidental) !== Math.sign(fifths || 1) ? 0.1 : 0)
        }))
    )
    .sort((a, b) => a.cost - b.cost)
  const { degree, accidental } = choices[0]
  const octave = (midi - naturals[degree] - accidental) / 12 - 1
  const letter = octave >= 5 ? letters[degree].toLowerCase() : letters[degree]
  return {
    accidental,
    degree,
    octave,
    pitch: `${letter}${
      octave < 4 ? ','.repeat(4 - octave) : octave > 5 ? "'".repeat(octave - 5) : ''
    }`
  }
}

/** Serialize cached quantized beats; audio seconds and note identities stay untouched. */
export function vocalStaffAbc(notes: readonly VocalNote[], tonalKey: ChordKey | null) {
  const key = tonalKey ?? { tonic: 0, mode: 'major' as const }
  const fifths = (key.mode === 'minor' ? minorFifths : majorFifths)[key.tonic]
  const name = (key.mode === 'minor' ? minor : major)[key.tonic]
  const signature = keySignature(fifths)
  const accidentals = new Map<string, number>()
  const clef =
    notes.length &&
    [...notes].sort((a, b) => a.midi - b.midi)[Math.floor(notes.length / 2)].midi < 57
      ? 'bass'
      : 'treble'
  let abc = `X:1\nM:4/4\nL:1/8\nK:${name} clef=${clef}\n`
  const events: Array<{ startChar: number; index: number }> = []
  const words: string[] = []
  const firstBeat = notes[0]?.beat ?? (notes[0]?.start ?? 0) * 2
  const base = Math.floor(firstBeat / 4) * 32
  // Keep the global bar phase for ties/accidentals, beginning on the first attack.
  // The short first measure is a pickup; it needs no fabricated leading rests.
  let cursor = Math.max(0, Math.round(firstBeat * 8) - base)
  function emit(note: ReturnType<typeof spell> | null, ticks: number, index?: number, lyric = '') {
    let remaining = ticks,
      first = true
    while (remaining > 0) {
      const room = 32 - (cursor % 32)
      const length = [32, 24, 16, 12, 8, 6, 4, 3, 2, 1].find((n) => n <= Math.min(room, remaining))!
      if (cursor % 8 === 0 || !note) abc += ' '
      if (index !== undefined) events.push({ startChar: abc.length, index })
      let pitch = 'z'
      if (note) {
        const identity = `${note.degree}:${note.octave}`
        const current = accidentals.get(identity) ?? signature[note.degree]
        // A tied continuation carries its original pitch across a bar without
        // establishing an accidental for later attacks in the new bar.
        const prefix =
          first && current !== note.accidental
            ? note.accidental < 0
              ? '_'
              : note.accidental > 0
                ? '^'
                : '='
            : ''
        if (first) accidentals.set(identity, note.accidental)
        pitch = prefix + note.pitch
      }
      abc += pitch + (length === 4 ? '' : length % 4 === 0 ? length / 4 : `${length}/4`)
      remaining -= length
      if (remaining && note) abc += '-'
      if (index !== undefined) {
        words.push(
          first && lyric
            ? lyric
                .replace(/[\r\n\\]/g, '')
                .replace(/[-_*|~]/g, '\\$&')
                .trim()
                .replace(/\s+/g, '~') || '*'
            : '*'
        )
      }
      first = false
      cursor += length
      if (cursor % 32 === 0) {
        abc += ' | '
        accidentals.clear()
      }
    }
  }
  notes.forEach((note, index) => {
    const start = Math.max(cursor, Math.round((note.beat ?? note.start * 2) * 8) - base)
    if (start > cursor) emit(null, start - cursor)
    emit(
      spell(note.midi, fifths, signature),
      Math.max(1, Math.round((note.durationBeats ?? (note.end - note.start) * 2) * 8)),
      index,
      note.lyric
    )
  })
  abc += ` |]\nw: ${words.join(' ')}\n`
  return { abc, events }
}
