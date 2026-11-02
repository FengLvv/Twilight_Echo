import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, shallowRef } from 'vue'
import { createCoreMusicStore } from './library/coreMusicStore.ts'
import { createMusicStudyStore } from './musicStudy.ts'
import type { useCoreConnection } from './coreConnection.ts'
import type { StudyLyricDisplay, StudyProject, StudyState } from '../../../shared/musicStudy.ts'

const settle = async () => {
  await nextTick()
  await new Promise<void>((resolve) => setImmediate(resolve))
  await nextTick()
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture() {
  const state = shallowRef({
    epoch: 'one',
    phase: 'ready',
    studyRevision: 1,
    metadataEnrichmentRevision: 0,
    libraryRevision: 0,
    playlistsRevision: 0,
    sequence: 0
  })
  const queries: string[] = []
  let handler: (name: string, payload: any) => Promise<unknown> = async (name) => {
    if (name === 'playlists.state') return { revision: 0 }
    if (name === 'playlists.catalog') return { items: [], total: 0 }
    return null
  }
  const core = {
    state,
    query: async (name: string, payload: unknown) => {
      queries.push(name)
      return handler(name, payload)
    },
    command: async () => {},
    attach: async () => {},
    subscribe: () => () => {}
  } as unknown as ReturnType<typeof useCoreConnection>
  return {
    core,
    state,
    queries,
    handle: (next: typeof handler) => {
      handler = next
    }
  }
}

test('metadata status follows its own revision, coalesces in-flight changes, and drops disposed reads', async () => {
  const f = fixture(),
    gate = deferred<unknown>()
  let reads = 0
  f.handle(async (name) => {
    if (name === 'playlists.state') return { revision: 0 }
    if (name === 'playlists.catalog') return { items: [], total: 0 }
    if (name === 'metadata.status')
      return ++reads === 2 ? gate.promise : { completed: f.state.value.metadataEnrichmentRevision }
    return null
  })
  const store = createCoreMusicStore(f.core)
  try {
    await settle()
    const initial = store.libraryMetadataEnrichmentStatus.value
    for (let sequence = 1; sequence <= 100; sequence++) {
      f.state.value = { ...f.state.value, sequence }
      await nextTick()
    }
    assert.equal(reads, 1)
    assert.equal(store.libraryMetadataEnrichmentStatus.value, initial)
    f.state.value = { ...f.state.value, metadataEnrichmentRevision: 1 }
    await settle()
    f.state.value = { ...f.state.value, metadataEnrichmentRevision: 2 }
    await settle()
    assert.equal(reads, 2)
    gate.resolve({ completed: -1 })
    await settle()
    assert.equal(reads, 3)
    assert.equal(store.libraryMetadataEnrichmentStatus.value?.completed, 2)
    const obsolete = deferred<unknown>()
    f.handle(async (name) => name === 'metadata.status' ? obsolete.promise : null)
    f.state.value = { ...f.state.value, metadataEnrichmentRevision: 3 }
    await settle()
    const retained = store.libraryMetadataEnrichmentStatus.value
    store.dispose()
    obsolete.resolve({ completed: 999 })
    await settle()
    assert.equal(store.libraryMetadataEnrichmentStatus.value, retained)
  } finally {
    store.dispose()
  }
})

function studyFixture(t: test.TestContext) {
  const f = fixture(),
    scope = effectScope()
  let display: StudyLyricDisplay = {
    mode: 'names',
    notationMode: 'numbered',
    key: 'auto',
    chordsVisible: false,
    notationVisible: true
  }
  let project = {
    id: 'project',
    songId: 'song',
    revision: 1,
    artifactRevision: 1,
    title: 'Song',
    status: 'completed',
    lyricDisplay: display,
    result: { melody: { scores: [{ svg: '<svg>large immutable score</svg>' }] } }
  } as unknown as StudyProject
  let listed = true
  let details: (() => Promise<StudyProject>) | undefined
  f.handle(async (name) => {
    const { result: _result, ...summary } = project
    if (name === 'study.state')
      return {
        total: 1,
        activeCount: 0,
        projects: listed ? [summary] : [],
        environment: { ready: true },
        audition: null
      } as unknown as StudyState
    if (name === 'study.songSummary') return { ...summary, lyricDisplay: display }
    if (name === 'study.song') return details ? details() : structuredClone(project)
    if (name === 'study.lyricsDisplay') return structuredClone(display)
    throw Error(name)
  })
  const store = scope.run(() => createMusicStudyStore(f.core))!
  const release = store.retain('song')
  t.after(() => {
    release()
    scope.stop()
  })
  return {
    ...f,
    store,
    changeDisplay() {
      display = { ...display, mode: 'degrees' }
      project = { ...project, lyricDisplay: display }
    },
    changeProject() {
      project = { ...project, revision: project.revision + 1, artifactRevision: project.artifactRevision + 1 }
    },
    changeProgress(sequence: number) { project = { ...project, revision: project.revision + 1, progress: sequence / 100, mix: { id: project.id, mode: 'instruments', tracks: { vocals: { gain: sequence / 100, mute: false, solo: false } } } } },
    offPage() {
      listed = false
    },
    details(next: () => Promise<StudyProject>) {
      details = next
    },
    project: () => project
  }
}

test('study clock updates and idle refreshes preserve full score identity; display-only edits fetch no score', async (t) => {
  const f = studyFixture(t)
  await settle()
  const original = f.store.songs.value.song
  const count = f.queries.length
  for (let sequence = 1; sequence <= 100; sequence++) {
    f.state.value = { ...f.state.value, sequence }
    await nextTick()
  }
  await f.store.refresh()
  assert.equal(f.queries.length, count)
  assert.equal(f.store.songs.value.song, original)
  f.changeDisplay()
  f.state.value = { ...f.state.value, studyRevision: 2 }
  await settle()
  assert.equal(f.store.displays.value.song.mode, 'degrees')
  assert.equal(f.queries.filter((name) => name === 'study.song').length, 1)
  assert.equal(f.store.songs.value.song, original)
  f.changeProject()
  f.state.value = { ...f.state.value, studyRevision: 3 }
  await settle()
  assert.equal(f.queries.filter((name) => name === 'study.song').length, 2)
})

test('off-page readers compare a small song summary instead of reloading unchanged SVG results', async (t) => {
  const f = studyFixture(t)
  await settle()
  f.offPage()
  const original = f.store.songs.value.song
  f.state.value = { ...f.state.value, studyRevision: 2 }
  await settle()
  assert.equal(f.queries.filter((name) => name === 'study.songSummary').length, 1)
  assert.equal(f.queries.filter((name) => name === 'study.song').length, 1)
  assert.equal(f.store.songs.value.song, original)
})

test('100 progress and mix changes update metadata without retransmitting or replacing notation', async t => {
  const f = studyFixture(t); await settle()
  const result = f.store.songs.value.song!.result
  for (let i = 1; i <= 100; i++) {
    f.changeProgress(i); f.state.value = { ...f.state.value, studyRevision: i + 1 }; await settle()
    assert.equal(f.store.songs.value.song!.result, result)
  }
  assert.equal(f.queries.filter(name => name === 'study.song').length, 1)
  assert.equal(f.store.songs.value.song!.progress, 1)
})

test('an old Core epoch cannot overwrite an analysis reader after its full-score query finishes', async (t) => {
  const f = studyFixture(t)
  await settle()
  const gate = deferred<StudyProject>(),
    old = structuredClone(f.project())
  let reads = 0
  f.details(async () => (++reads === 1 ? gate.promise : structuredClone(f.project())))
  f.changeProject()
  const reading = f.store.readSong('song')
  await settle()
  f.state.value = { ...f.state.value, epoch: 'two' }
  await settle()
  gate.resolve(old)
  await reading
  await settle()
  assert.equal(f.store.songs.value.song?.revision, 2)
  assert.equal(reads, 2)
})

test('browsing 200 song results bounds renderer memory while the current song stays pinned and evicted scores reload', async t => {
  const f = fixture(), scope = effectScope()
  const display = { mode: 'names', notationMode: 'numbered', key: 'auto', chordsVisible: true, notationVisible: true }
  f.handle(async (name, payload) => {
    if (name === 'study.state') return { projects: [], total: 201, activeCount: 0, environment: {}, audition: null }
    const project = { id: 'project-' + payload.songId, songId: payload.songId, revision: 1, artifactRevision: 1, title: payload.songId,
      status: 'completed', lyricDisplay: display, result: { melody: { scores: [{ svg: '<svg>' + 'x'.repeat(300000) + '</svg>' }] } } }
    if (name === 'study.song') return project
    if (name === 'study.lyricsDisplay') return display
    if (name === 'study.songSummary') { const { result: _result, ...summary } = project; return summary }
    throw new Error(name)
  })
  const store = scope.run(() => createMusicStudyStore(f.core))!
  const release = store.retain('current')
  t.after(() => { release(); store.dispose(); scope.stop() })
  await settle()
  const current = store.songs.value.current
  for (let i = 0; i < 200; i++) await store.readSong('song-' + i)
  assert.ok(store.cacheMetrics().entries <= 16)
  assert.ok(store.cacheMetrics().estimatedBytes <= 48 * 1024 ** 2)
  assert.equal(store.songs.value.current, current)
  assert.equal(store.songs.value['song-0'], undefined)
  const reads = f.queries.filter(name => name === 'study.song').length
  await store.readSong('song-0')
  assert.equal(f.queries.filter(name => name === 'study.song').length, reads + 1)
})
