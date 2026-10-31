import test from 'node:test'
import assert from 'node:assert/strict'
import ABC from 'abcjs'
import { vocalStaffAbc } from './vocalStaff.ts'
import type { VocalNote } from './numberedNotes.ts'
import { validStudyPayload } from '../../../shared/musicStudy.ts'

const note = (midi: number, beat: number, durationBeats: number, lyric = ''): VocalNote => ({
  midi,
  beat,
  durationBeats,
  start: beat / 2,
  end: (beat + durationBeats) / 2,
  lyric
})

test('staff keys preserve concert pitches, octave boundaries and exact quantized durations', () => {
  for (const mode of ['major', 'minor'] as const)
    for (let tonic = 0; tonic < 12; tonic++) {
      const notes = [
        note(47, 0, 1),
        note(59, 1, 0.5),
        note(60, 1.5, 0.5),
        note(61, 2, 1),
        note(72, 3, 1)
      ]
      const original = structuredClone(notes)
      const { abc, events } = vocalStaffAbc(notes, { tonic, mode })
      const [tune] = ABC.parseOnly(abc)
      assert(!tune.warnings?.length, tune.warnings?.join('\n'))
      const audio = tune
        .setUpAudio({})
        .tracks.flat()
        .filter((event) => event.cmd === 'note')
      assert.deepEqual(
        audio.map((event) => event.pitch),
        notes.map((n) => n.midi),
        `${tonic}:${mode}`
      )
      assert.deepEqual(
        audio.map((event) => event.duration),
        notes.map((n) => n.durationBeats! / 4)
      )
      assert(events.every((event) => tune.getElementFromChar(event.startChar)?.el_type === 'note'))
      assert.deepEqual(notes, original)
    }
})

test('phrase staff begins on the pickup, preserves cross-bar ties and one lyric per note', () => {
  const { abc, events } = vocalStaffAbc([note(61, 17, 1, '青花'), note(63, 18, 3, '瓷')], {
    tonic: 1,
    mode: 'major'
  })
  assert.match(abc, /K:Db/)
  assert.match(abc, / E4- \|/)
  assert.doesNotMatch(abc, /_E/)
  const [tune] = ABC.parseOnly(abc)
  const audio = tune
    .setUpAudio({})
    .tracks.flat()
    .filter((event) => event.cmd === 'note')
  assert.deepEqual(
    audio.map((event) => [event.pitch, event.start, event.duration]),
    [
      [61, 0, 0.25],
      [63, 0.25, 0.75]
    ]
  )
  assert.deepEqual(
    events.map((event) => event.index),
    [0, 1, 1]
  )
  const words = tune.lines
    .flatMap((line) => line.staff ?? [])
    .flatMap((staff) => staff.voices ?? [])
    .flat()
    .flatMap(
      (item) =>
        (item as { lyric?: Array<{ syllable: string }> }).lyric?.map((word) => word.syllable) ?? []
    )
    .filter(Boolean)
  assert.deepEqual(words, ['青花', '瓷'])
  assert.doesNotMatch(abc.split('\n')[4],/z/)
})

test('phrase staff omits edge padding but retains real interior rests and raw audio timing',()=>{
  const notes=[note(60,78.5,.5,'素'),note(62,79.5,.5,'胚'),note(64,80,1,'花')]
  const before=structuredClone(notes)
  const {abc}=vocalStaffAbc(notes,null)
  const [tune]=ABC.parseOnly(abc)
  const audio=tune.setUpAudio({}).tracks.flat().filter(e=>e.cmd==='note')
  assert.equal(audio[0].start,0)
  assert.equal(audio[1].start,.25)
  assert.deepEqual(audio.map(e=>e.duration),[.125,.125,.25])
  assert.match(abc.split('\n')[4],/z/)
  assert.deepEqual(notes,before)
})

test('notation mode payload accepts the two supported formats and rejects arbitrary values', () => {
  assert(validStudyPayload('study.setLyricsDisplay', { songId: 'ncm:1', notationMode: 'staff' }))
  assert(validStudyPayload('study.setLyricsDisplay', { songId: 'ncm:1', notationMode: 'numbered' }))
  assert(!validStudyPayload('study.setLyricsDisplay', { songId: 'ncm:1', notationMode: 'tab' }))
})

test('staff lyric escaping preserves punctuation and does not create lyric commands', () => {
  const words = ["I'm", 'rock-n-roll', 'A_B', 'a*b']
  const { abc } = vocalStaffAbc(
    words.map((word, i) => note(60 + i, i, 1, word)),
    null
  )
  const [tune] = ABC.parseOnly(abc)
  const rendered = tune.lines
    .flatMap((line) => line.staff ?? [])
    .flatMap((staff) => staff.voices ?? [])
    .flat()
    .flatMap(
      (item) =>
        (item as { lyric?: Array<{ syllable: string }> }).lyric?.map((word) => word.syllable) ?? []
    )
  assert.deepEqual(rendered, words)
})

test('all 24 diatonic scales use the key signature without redundant note accidentals', () => {
  for (const mode of ['major', 'minor'] as const)
    for (let tonic = 0; tonic < 12; tonic++) {
      const scale = mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
      const notes = scale.map((step, i) => note(60 + tonic + step, i / 2, 0.5))
      const { abc } = vocalStaffAbc(notes, { tonic, mode })
      const [tune] = ABC.parseOnly(abc)
      const music = abc.split('\n').slice(4, 5).join('')
      assert.doesNotMatch(music, /[\^_=]/, `${tonic}:${mode}`)
      const audio = tune
        .setUpAudio({})
        .tracks.flat()
        .filter((event) => event.cmd === 'note')
      assert.deepEqual(
        audio.map((event) => event.pitch),
        notes.map((note) => note.midi)
      )
    }
})

test('temporary accidentals cancel, restore and reset at barlines, with separate octave scope', () => {
  const { abc } = vocalStaffAbc(
    [66, 65, 65, 66, 66, 65, 66, 66].map((midi, i) => note(midi, i, 1)),
    { tonic: 7, mode: 'major' }
  )
  assert.match(abc, / F2 =F2 F2 \^F2 \|  F2 =F2 \^F2 F2/)
  const octave = vocalStaffAbc(
    [66, 77, 65, 78].map((midi, i) => note(midi, i, 1)),
    null
  ).abc
  assert.match(octave, / \^F2 f2 =F2 \^f2/)
  for (const input of [abc, octave]) {
    const [tune] = ABC.parseOnly(input)
    const expected = input === abc ? [66, 65, 65, 66, 66, 65, 66, 66] : [66, 77, 65, 78]
    assert.deepEqual(
      tune
        .setUpAudio({})
        .tracks.flat()
        .filter((event) => event.cmd === 'note')
        .map((event) => event.pitch),
      expected
    )
  }
})

test('chromatic ties carry pitch across a bar without repeating the accidental or changing later notes', () => {
  const { abc } = vocalStaffAbc([note(66, 3, 2), note(65, 5, 1)], null)
  assert.match(abc, /\^F2- \|  F2 F2/)
  const [tune] = ABC.parseOnly(abc)
  assert.deepEqual(
    tune
      .setUpAudio({})
      .tracks.flat()
      .filter((event) => event.cmd === 'note')
      .map((event) => [event.pitch, event.duration]),
    [
      [66, 0.5],
      [65, 0.25]
    ]
  )
})
