import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useCoreConnection } from './coreConnection.ts'
import type {
  StudyProject,
  StudyState,
  StudyLyricDisplay,
  StudyLyricDisplayPatch
} from '../../../shared/musicStudy.ts'
import { isRequestCancelled } from '../../../shared/cancellation.ts'

export function createMusicStudyStore(core: ReturnType<typeof useCoreConnection>) {
  const state = shallowRef<StudyState | null>(null)
  const songs = shallowRef<Record<string, StudyProject | null>>({})
  const displays = shallowRef<Record<string, StudyLyricDisplay>>({})
  const failure = ref('')
  const page = ref(0)
  const readers = new Map<string, number>()
  const versions = new Map<string, number>()
  let users = 0,
    timer: ReturnType<typeof setTimeout> | undefined
  let refreshing: Promise<void> | null = null,
    abort: AbortController | null = null
  async function readSong(songId: string, signal?: AbortSignal) {
    if (!songId) return
    const version = (versions.get(songId) ?? 0) + 1
    versions.set(songId, version)
    const [project, display] = await Promise.all([
      core.query('study.song', { songId }, signal),
      core.query('study.lyricsDisplay', { songId }, signal)
    ])
    if (versions.get(songId) !== version) return songs.value[songId]
    songs.value = { ...songs.value, [songId]: project }
    displays.value = { ...displays.value, [songId]: display }
    return project
  }
  async function setDisplay(patch: StudyLyricDisplayPatch) {
    const display = (await core.command('study.setLyricsDisplay', patch)) as StudyLyricDisplay
    displays.value = { ...displays.value, [patch.songId]: display }
    await readSong(patch.songId)
    return display
  }
  watch(
    () => core.state.value?.studyRevision,
    () => {
      if (users && core.state.value?.phase === 'ready') void refresh()
    }
  )
  function refresh() {
    if (core.state.value?.phase !== 'ready') return Promise.resolve()
    return (refreshing ??= (async () => {
      abort = new AbortController()
      try {
        const snapshot = await core.query(
          'study.state',
          { offset: page.value * 50, limit: 50 },
          abort.signal
        )
        state.value = snapshot
        await Promise.all([...readers.keys()].map((id) => readSong(id, abort!.signal)))
        failure.value = ''
      } catch (error) {
        if (!isRequestCancelled(error))
          failure.value = error instanceof Error ? error.message : String(error)
      } finally {
        refreshing = null
      }
    })())
  }
  async function poll() {
    await refresh()
    if (users) timer = setTimeout(poll, state.value?.activeCount ? 700 : 2500)
  }
  function retain(songId?: string) {
    if (songId) readers.set(songId, (readers.get(songId) ?? 0) + 1)
    if (++users === 1) void poll()
    else void refresh()
    return () => {
      if (songId) {
        const n = (readers.get(songId) ?? 1) - 1
        if (n) readers.set(songId, n)
        else readers.delete(songId)
      }
      if (!--users) {
        clearTimeout(timer)
        abort?.abort()
      }
    }
  }
  return {
    state,
    songs,
    displays,
    setDisplay,
    failure,
    page,
    readSong,
    refresh,
    retain,
    activeCount: computed(() => state.value?.activeCount ?? 0),
    core
  }
}
let singleton: ReturnType<typeof createMusicStudyStore> | undefined
export function useMusicStudyStore() {
  return (singleton ??= createMusicStudyStore(useCoreConnection()))
}
export function useMusicStudyProgress() {
  const store = useMusicStudyStore()
  let release: (() => void) | undefined
  onMounted(() => {
    release = store.retain()
  })
  onBeforeUnmount(() => release?.())
  return store
}
