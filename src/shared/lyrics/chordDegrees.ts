import type { StudyChord } from '../musicStudy.ts'

export interface ChordKey {
  tonic: number
  mode: 'major' | 'minor'
}
const pitches: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
export const KEY_ROOT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
const mod = (n: number) => ((n % 12) + 12) % 12
function pitch(note: string) {
  const match = /^([A-G])([#b♯♭]{0,2})$/.exec(note)
  return match
    ? mod(
        pitches[match[1]] + [...match[2]].reduce((n, c) => n + (c === '#' || c === '♯' ? 1 : -1), 0)
      )
    : null
}
function parse(label: string) {
  const match = /^([A-G][#b♯♭]{0,2})([^/]*)(?:\/([A-G][#b♯♭]{0,2}))?$/.exec(label)
  if (!match) return null
  const root = pitch(match[1])
  if (root === null) return null
  const quality = match[2],
    diminished = /^(dim|°)/.test(quality),
    halfDim = /^(m7b5|ø)/.test(quality)
  const minor = /^m(?!aj)/.test(quality) || diminished || halfDim
  return {
    root,
    quality,
    minor,
    diminished,
    halfDim,
    bass: match[3] ? pitch(match[3]) : null,
    bassName: match[3]
  }
}
export const keyId = (key: ChordKey) => `${key.tonic}:${key.mode}`
export function parseKey(value: string): ChordKey | null {
  const match = /^(\d|1[01]):(major|minor)$/.exec(value)
  return match ? { tonic: Number(match[1]), mode: match[2] as ChordKey['mode'] } : null
}
export const keyName = (key: ChordKey) =>
  `${KEY_ROOT_NAMES[key.tonic]} ${key.mode === 'major' ? '大调' : '小调'}`

const majorDegrees = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII']
const minorDegrees = ['I', '♭II', 'II', 'III', '♯III', 'IV', '♯IV', 'V', 'VI', '♯VI', 'VII', '♯VII']
export function romanChord(label: string, key: ChordKey | null): string {
  if (!key || label === 'N') return label
  const chord = parse(label)
  if (!chord) return label
  let degree = (key.mode === 'major' ? majorDegrees : minorDegrees)[mod(chord.root - key.tonic)]
  if (chord.minor) degree = degree.toLowerCase()
  let suffix = chord.quality
  if (chord.halfDim) suffix = 'ø7'
  else if (chord.diminished) suffix = '°' + suffix.replace(/^(dim|°)/, '')
  else if (suffix.startsWith('m') && !suffix.startsWith('maj')) suffix = suffix.slice(1)
  else if (suffix.startsWith('aug')) suffix = '+' + suffix.slice(3)
  if (chord.bass !== null && chord.bass !== chord.root) {
    const interval = mod(chord.bass - chord.root),
      third = chord.minor ? 3 : 4
    const fifth = chord.diminished || chord.halfDim ? 6 : /^(aug|\+)/.test(chord.quality) ? 8 : 7
    const seventh = /7/.test(chord.quality),
      simple = /^(m|maj)?7$|^(dim7|m7b5|ø7)$/.test(chord.quality)
    let figure = ''
    if (seventh && simple) {
      if (interval === third) figure = '⁶₅'
      else if (interval === fifth) figure = '⁴₃'
      else if ([9, 10, 11].includes(interval)) figure = '⁴₂'
    } else if (!suffix || suffix === '°' || suffix === '+') {
      if (interval === third) figure = '⁶'
      else if (interval === fifth) figure = '⁶₄'
    }
    if (figure) {
      suffix = seventh ? suffix.replace(/7$/, '') + figure : suffix + figure
    } else suffix += '/' + chord.bassName
  }
  return degree + suffix
}

const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** A whole-song tonal estimate from duration-weighted chord tones, never from the playhead. */
export function inferChordKey(chords: readonly StudyChord[]): ChordKey | null {
  const chroma = Array<number>(12).fill(0),
    support = Array.from({ length: 12 }, () => [0, 0])
  let total = 0,
    last: ReturnType<typeof parse> = null
  for (const segment of chords) {
    const chord = parse(segment.label),
      duration = Math.max(0, segment.end - segment.start)
    if (!chord || !duration) continue
    total += duration
    last = chord
    support[chord.root][chord.minor ? 1 : 0] += duration
    const third = /sus2/.test(chord.quality)
      ? 2
      : /sus4/.test(chord.quality)
        ? 5
        : chord.minor
          ? 3
          : 4
    const fifth = chord.diminished || chord.halfDim ? 6 : /^(aug|\+)/.test(chord.quality) ? 8 : 7
    for (const [interval, weight] of [
      [0, 1.5],
      [third, 1],
      [fifth, 0.75]
    ])
      chroma[mod(chord.root + interval)] += duration * weight
    if (/7/.test(chord.quality))
      chroma[
        mod(chord.root + (/Maj7|maj7/.test(chord.quality) ? 11 : chord.diminished ? 9 : 10))
      ] += duration * 0.45
    if (chord.bass !== null) chroma[chord.bass] += duration * 0.3
  }
  if (!total) return null
  const mean = chroma.reduce((a, b) => a + b, 0) / 12,
    variance = chroma.reduce((a, b) => a + (b - mean) ** 2, 0)
  if (variance < 1e-9) return null
  let best: ChordKey | null = null,
    bestScore = -Infinity
  for (const mode of ['major', 'minor'] as const)
    for (let tonic = 0; tonic < 12; tonic++) {
      const profile = mode === 'major' ? majorProfile : minorProfile,
        average = profile.reduce((a, b) => a + b, 0) / 12
      let covariance = 0,
        energy = 0
      for (let i = 0; i < 12; i++) {
        const target = profile[mod(i - tonic)] - average
        covariance += (chroma[i] - mean) * target
        energy += target * target
      }
      const score =
        covariance / Math.sqrt(variance * energy) +
        (0.3 * support[tonic][mode === 'minor' ? 1 : 0]) / total +
        (0.08 * support[mod(tonic + 7)][0]) / total +
        (last?.root === tonic && last.minor === (mode === 'minor') ? 0.1 : 0)
      if (score > bestScore) {
        bestScore = score
        best = { tonic, mode }
      }
    }
  return best
}
