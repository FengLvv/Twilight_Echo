import test from 'node:test'
import assert from 'node:assert/strict'
import { projectDesktopAnalysis, rhythmicLyricScore } from './lyricAnalysis.ts'
import type { DesktopLyricsSession } from '../desktopLyrics.ts'
import type { StudyLyricsProjection } from '../musicStudy.ts'

const base: DesktopLyricsSession = {
  schemaVersion: 1,
  sessionId: 'song-occurrence',
  contentRevision: 1,
  track: { id: 'local:song', title: 'Song', artist: 'Artist' },
  status: 'ready',
  lyricOffsetMs: 1000,
  lines: Array.from({ length: 20 }, (_, i) => ({
    id: `${i}:${i * 3000}`,
    startMs: i * 3000,
    endMs: (i + 1) * 3000,
    text: `原词${i}`
  }))
}
const analysis: StudyLyricsProjection = {
  display: { notationVisible: true, chordsVisible: true, mode: 'degrees', key: '2:major' },
  melodyBusy: false,
  chordsBusy: false,
  chords: [{ start: 14, end: 17, label: 'D', confidence: 'unrated', candidates: [] }],
  melody: {
    algorithm: 'vocal2midi-tifa-game-medium-rhythm-v1',
    source: 'vocals',
    key: { tonic: 0, mode: 'major' },
    notes: Array.from({ length: 20 }, (_, i) => ({
      start: i * 3 - 1,
      end: i * 3 + 1,
      midi: 60 + (i % 12),
      lineId: i,
      lyric: `原词${i}`,
      durationBeats: 1
    })),
    scores: Array.from({ length: 20 }, (_, i) => ({
      lineId: i,
      text: `原词${i}`,
      svg: `<svg><g data-note="${i}"><text>1</text></g></svg>`
    }))
  }
}

test('desktop projection sends only nearby score rows and keeps raw audio time with lyric offsets', () => {
  const value = projectDesktopAnalysis(base, analysis, 15)
  assert.equal(value.analysis?.display.mode, 'degrees')
  assert.deepEqual(value.analysis?.key, { tonic: 2, mode: 'major' })
  assert.equal(value.lines.filter((l) => l.score).length, 5)
  assert.deepEqual(
    value.lines.flatMap((l, i) => (l.score ? [i] : [])),
    [4, 5, 6, 7, 8]
  )
  assert.equal(value.lines[5].score?.notes[0].start, 14)
  assert.match(value.lines[5].score!.svg, /data-note="0"/)
  assert.deepEqual(value.lines[5].chords, analysis.chords)
  assert.equal(base.lines[5].score, undefined)
  assert.equal(analysis.melody!.notes[5].start, 14)
})
test('score identity follows the original row and text; malformed note references never reach the view', () => {
  assert.equal(rhythmicLyricScore(analysis.melody, 5, '改过的词'), undefined)
  assert(rhythmicLyricScore(analysis.melody, 5, ' 原词5 '))
  const bad = structuredClone(analysis.melody!)
  bad.scores![5].svg = '<svg><g data-note="99"/></svg>'
  assert.equal(rhythmicLyricScore(bad, 5, '原词5'), undefined)
})
test('toggles remove their annotation data, while seeking selects a fresh window', () => {
  const off = structuredClone(analysis)
  off.display.notationVisible = false
  off.display.chordsVisible = false
  assert(projectDesktopAnalysis(base, off, 15).lines.every((l) => !l.score && !l.chords))
  const end = projectDesktopAnalysis(base, analysis, 55)
  assert(end.lines[18].score)
  assert(!end.lines[5].score)
  assert.deepEqual(projectDesktopAnalysis(base, undefined, 55), base)
})
test('instrumental tracks can show timed chords without creating fake lyrics', () => {
  const value = projectDesktopAnalysis({ ...base, lines: [], status: 'empty' }, analysis, 15)
  assert.equal(value.status, 'ready')
  assert.equal(value.lines[0].text, '')
  assert.equal(value.lines[0].startMs, 15000)
  assert.deepEqual(value.lines[0].chords, analysis.chords)
  assert(!value.lines[0].score)
})
