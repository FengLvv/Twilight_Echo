import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, h, nextTick, ref, shallowRef } from 'vue'
import { createSongAnalysis } from './useSongAnalysis.ts'
import type { useMusicStudyStore } from '../stores/musicStudy.ts'
import type {
  StudyLyricDisplay,
  StudyLyricDisplayPatch,
  StudyProject
} from '../../../shared/musicStudy.ts'

function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  const song = ref('a'),
    state = shallowRef({ queue: { occurrenceId: 'one' } })
  const makeProject = (id: string) =>
    ({
      id: 'project-' + id,
      status: 'completed',
      revision: 1,
      chordsVisible: false,
      result: { ready: ['six', 'chords'] },
      mix: { mode: 'instruments', tracks: {} }
    }) as unknown as StudyProject
  const songs = shallowRef<Record<string, StudyProject>>({
    a: makeProject('a'),
    b: makeProject('b')
  })
  const empty = (): StudyLyricDisplay => ({
    mode: 'names',
    notationMode: 'numbered',
    key: 'auto',
    chordsVisible: false,
    notationVisible: false
  })
  const displays = shallowRef<Record<string, StudyLyricDisplay>>({ a: empty(), b: empty() })
  const commands: string[] = [],
    patches: StudyLyricDisplayPatch[] = []
  const controls = {
    displayGate: null as ReturnType<typeof gate> | null,
    analyzeGate: null as ReturnType<typeof gate> | null,
    fail: false
  }
  const store = {
    songs,
    displays,
    retain: () => () => {},
    readSong: async () => {},
    refresh: async () => {},
    setDisplay: async (patch: StudyLyricDisplayPatch) => {
      patches.push(patch)
      const blocked = controls.displayGate
      controls.displayGate = null
      if (blocked) await blocked.promise
      if (controls.fail) throw new Error('Display failed')
      displays.value = {
        ...displays.value,
        [patch.songId]: { ...displays.value[patch.songId], ...patch }
      }
      return displays.value[patch.songId]
    },
    core: {
      state,
      command: async (name: string) => {
        commands.push(name)
        if (name === 'study.analyze') {
          const blocked = controls.analyzeGate
          controls.analyzeGate = null
          if (blocked) await blocked.promise
          return songs.value[song.value]
        }
        return undefined
      }
    }
  }
  const renderer = createRenderer<Record<string, unknown>, Record<string, unknown>>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText() {},
    setElementText() {},
    parentNode: () => null,
    nextSibling: () => null,
    insert() {},
    remove() {},
    patchProp() {}
  })
  let analysis!: ReturnType<typeof createSongAnalysis>
  const app = renderer.createApp({
    setup() {
      analysis = createSongAnalysis(
        () => song.value,
        store as unknown as ReturnType<typeof useMusicStudyStore>
      )
      return () => h('div')
    }
  })
  app.mount({})
  return { analysis, app, song, state, songs, displays, controls, commands, patches }
}

test('chords toggle without opening the mixer or switching audio', async () => {
  const f = fixture()
  try {
    await f.analysis.toggleChords()
    assert.equal(f.analysis.chordsVisible.value, true)
    await f.analysis.toggleChords()
    assert.equal(f.analysis.chordsVisible.value, false)
    assert.equal(f.analysis.open.value, false)
    assert.deepEqual(
      f.patches.map((p) => p.chordsVisible),
      [true, false]
    )
    assert.deepEqual(f.commands, [])
  } finally {
    f.app.unmount()
  }
})
test('hiding chords keeps an open mixer and its audio intact', async () => {
  const f = fixture()
  try {
    await f.analysis.toggle()
    assert.equal(f.analysis.open.value, true)
    const calls = [...f.commands]
    await f.analysis.toggleChords()
    assert.equal(f.analysis.chordsVisible.value, false)
    assert.equal(f.analysis.open.value, true)
    assert.deepEqual(f.commands, calls)
  } finally {
    f.app.unmount()
  }
})
test('another click during chord preparation wins over a pending acknowledgement', async () => {
  const f = fixture(),
    first = gate()
  try {
    f.controls.displayGate = first
    const work = f.analysis.toggleChords()
    assert.equal(f.analysis.chordsEnabled.value, true)
    const off = f.analysis.toggleChords()
    assert.equal(f.analysis.chordsEnabled.value, false)
    first.resolve()
    await Promise.all([work, off])
    assert.deepEqual(
      f.patches.map((p) => p.chordsVisible),
      [true, false]
    )
    assert.equal(f.analysis.chordsVisible.value, false)
    assert.equal(f.analysis.open.value, false)
  } finally {
    first.resolve()
    f.app.unmount()
  }
})
test('an old song response cannot clear the next song pending toggle', async () => {
  const f = fixture(),
    old = gate(),
    current = gate()
  try {
    f.controls.displayGate = old
    const first = f.analysis.toggleChords()
    f.song.value = 'b'
    await nextTick()
    f.controls.displayGate = current
    const second = f.analysis.toggleChords()
    old.resolve()
    await first
    assert.equal(f.analysis.chordsEnabled.value, true)
    assert.equal(f.analysis.chordsBusy.value, true)
    current.resolve()
    await second
    assert.equal(f.analysis.chordsVisible.value, true)
    assert.equal(f.displays.value.b.chordsVisible, true)
  } finally {
    old.resolve()
    current.resolve()
    f.app.unmount()
  }
})
test('analysis setup does not overwrite a later explicit chord off', async () => {
  const f = fixture(),
    blocked = gate()
  try {
    f.controls.analyzeGate = blocked
    const entering = f.analysis.toggle()
    await f.analysis.toggleChords()
    await f.analysis.toggleChords()
    blocked.resolve()
    await entering
    assert.equal(f.analysis.open.value, true)
    assert.equal(f.analysis.chordsVisible.value, false)
    assert.deepEqual(
      f.patches.map((p) => p.chordsVisible),
      [true, false]
    )
  } finally {
    blocked.resolve()
    f.app.unmount()
  }
})
test('a display failure rolls back the button and permits retry', async () => {
  const f = fixture()
  try {
    f.controls.fail = true
    await f.analysis.toggleChords()
    assert.equal(f.analysis.chordsEnabled.value, false)
    assert.equal(f.analysis.chordsError.value, 'Display failed')
    f.controls.fail = false
    await f.analysis.toggleChords()
    assert.equal(f.analysis.chordsEnabled.value, true)
    assert.equal(f.analysis.chordsError.value, '')
  } finally {
    f.app.unmount()
  }
})
test('desktop or remote visibility changes update the song button', async () => {
  const f = fixture()
  try {
    f.displays.value = { ...f.displays.value, a: { ...f.displays.value.a, chordsVisible: true } }
    await nextTick()
    assert.equal(f.analysis.chordsVisible.value, true)
    f.displays.value = { ...f.displays.value, a: { ...f.displays.value.a, chordsVisible: false } }
    await nextTick()
    assert.equal(f.analysis.chordsVisible.value, false)
  } finally {
    f.app.unmount()
  }
})
test('melody display remains independent of chords and the mixer', async () => {
  const f = fixture()
  try {
    await f.analysis.toggleMelody()
    assert.equal(f.analysis.melodyEnabled.value, true)
    assert.equal(f.analysis.chordsEnabled.value, false)
    assert.equal(f.analysis.open.value, false)
    await f.analysis.toggleMelody()
    assert.equal(f.analysis.melodyEnabled.value, false)
  } finally {
    f.app.unmount()
  }
})


test('mixer changes replace parent-owned settings and keep other tracks intact', async () => {
  const f = fixture()
  try {
    await f.analysis.toggle()
    const initial = { gain: 1, mute: false, solo: false }
    f.analysis.tracks.value = { vocals: initial, drums: { ...initial } }
    await f.analysis.changeTrack('vocals', { gain: 0.6, mute: true, solo: false })
    assert.deepEqual(initial, { gain: 1, mute: false, solo: false })
    assert.equal(f.analysis.tracks.value.vocals?.gain, 0.6)
    assert.equal(f.analysis.tracks.value.vocals?.mute, true)
    assert.deepEqual(f.analysis.tracks.value.drums, initial)
    await f.analysis.changeTrack('lead', { gain: 1, mute: false, solo: true })
    assert.equal(f.analysis.tracks.value.lead?.solo, true)
    assert.equal(f.commands.at(-1), 'study.mix')
  } finally {
    f.app.unmount()
  }
})
