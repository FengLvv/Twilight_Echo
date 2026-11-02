import { computed, onMounted, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useCoreConnection } from './coreConnection.ts'
import type {
  StudyProject,
  StudyState,
  StudyLyricDisplay,
  StudyLyricDisplayPatch
} from '../../../shared/musicStudy.ts'
import { isRequestCancelled } from '../../../shared/cancellation.ts'
import { LeasedLru, estimateResultBytes } from '../../../shared/leasedLru.ts'

export function createMusicStudyStore(core: ReturnType<typeof useCoreConnection>) {
  const state = shallowRef<StudyState | null>(null)
  const songs = shallowRef<Record<string, StudyProject | null>>({})
  const displays = shallowRef<Record<string, StudyLyricDisplay>>({})
  const failure = ref('')
  const page = ref(0)
  const readers = new Map<string, number>()
  const demands = new Map<string, number>()
  const projectKeys = new Map<string, string>()
  const displayKeys = new Map<string, string>()
  const reads = new Map<string, Promise<StudyProject | null | undefined>>()
  const results = new LeasedLru<string, StudyProject | null>(
    { bytes: 48 * 1024 ** 2, entries: 16 },
    (id) => {
      const { [id]: _song, ...remaining } = songs.value
      songs.value = remaining
      const { [id]: _display, ...remainingDisplays } = displays.value
      displays.value = remainingDisplays
      projectKeys.delete(id)
      displayKeys.delete(id)
      demands.delete(id)
    },
    (id) => reads.has(id)
  )
  let disposed = false
  const domain = () =>
    !disposed && core.state.value?.phase === 'ready'
      ? `${core.state.value.epoch}:${core.state.value.studyRevision}`
      : ''
  let snapshotDomain = '',
    appliedRefresh = '',
    readersRevision = 0
  let users = 0,
    timer: ReturnType<typeof setTimeout> | undefined
  let refreshing: Promise<void> | null = null,
    abort: AbortController | null = null
  function readSong(
    songId: string,
    signal?: AbortSignal,
    force = true
  ): Promise<StudyProject | null | undefined> {
    if (!songId || !domain()) return Promise.resolve(undefined)
    if (force) demands.set(songId, (demands.get(songId) ?? 0) + 1)
    if (!force && displayKeys.get(songId) === domain()) {
      results.get(songId)
      return Promise.resolve(songs.value[songId])
    }
    if (reads.has(songId)) return reads.get(songId)!
    const work = (async () => {
      const key = () => `${domain()}:${demands.get(songId) ?? 0}`
      let requested: string
      do {
        requested = key()
        const version = domain(),
          epoch = core.state.value?.epoch
        const listed =
          !force && snapshotDomain === version
            ? state.value?.projects.find((project) => project.songId === songId)
            : undefined
        const summary = listed ?? (await core.query('study.songSummary', { songId }, signal))
        if (requested !== key()) continue
        const projectKey = `${epoch}:${summary?.id ?? ''}:${summary?.artifactRevision ?? ''}`
        const project =
          projectKeys.get(songId) === projectKey
            ? songs.value[songId]
            : summary
              ? await core.query('study.song', { songId }, signal)
              : null
        const display =
          summary?.lyricDisplay ?? (await core.query('study.lyricsDisplay', { songId }, signal))
        if (requested !== key()) continue
        if (projectKeys.get(songId) !== projectKey) {
          songs.value = { ...songs.value, [songId]: project ?? null }
          projectKeys.set(songId, projectKey)
          results.set(songId, project ?? null, estimateResultBytes(project?.result ?? null))
        } else if (summary && summary.revision !== songs.value[songId]?.revision) {
          songs.value = {
            ...songs.value,
            [songId]: { ...summary, result: songs.value[songId]?.result }
          }
        }
        results.get(songId)
        if (JSON.stringify(displays.value[songId]) !== JSON.stringify(display))
          displays.value = { ...displays.value, [songId]: display }
        displayKeys.set(songId, version)
        return project
      } while (domain())
      return songs.value[songId]
    })().finally(() => {
      reads.delete(songId)
      results.trim()
    })
    reads.set(songId, work)
    return work
  }
  async function setDisplay(patch: StudyLyricDisplayPatch) {
    const display = (await core.command('study.setLyricsDisplay', patch)) as StudyLyricDisplay
    displays.value = { ...displays.value, [patch.songId]: display }
    await readSong(patch.songId)
    return display
  }
  let memoryEpoch = core.state.value?.epoch
  const stop = watch(
    [
      () => core.state.value?.epoch,
      () => core.state.value?.studyRevision,
      () => core.state.value?.phase
    ],
    () => {
      if (memoryEpoch !== core.state.value?.epoch) {
        memoryEpoch = core.state.value?.epoch
        abort?.abort()
        results.clear()
        state.value = null
        songs.value = {}
        displays.value = {}
        projectKeys.clear()
        displayKeys.clear()
        demands.clear()
        snapshotDomain = appliedRefresh = ''
      }
      if (users && core.state.value?.phase === 'ready') void refresh()
    }
  )
  function refresh() {
    if (core.state.value?.phase !== 'ready') return Promise.resolve()
    const version = () => `${domain()}:${page.value}:${readersRevision}`
    if (appliedRefresh === version()) return Promise.resolve()
    return (refreshing ??= (async () => {
      let requested: string
      do {
        requested = version()
        abort = new AbortController()
        try {
          const snapshot = await core.query(
            'study.state',
            { offset: page.value * 50, limit: 50 },
            abort.signal
          )
          if (requested !== version()) continue
          state.value = snapshot
          snapshotDomain = domain()
          await Promise.all([...readers.keys()].map((id) => readSong(id, abort!.signal, false)))
          if (requested !== version()) continue
          appliedRefresh = requested
          failure.value = ''
        } catch (error) {
          if (!isRequestCancelled(error))
            failure.value = error instanceof Error ? error.message : String(error)
        }
      } while (users && core.state.value?.phase === 'ready' && requested !== version())
    })().finally(() => {
      refreshing = null
    }))
  }
  async function poll() {
    await refresh()
    if (users) timer = setTimeout(poll, state.value?.activeCount ? 700 : 2500)
  }
  function retain(songId?: string) {
    const unpin = songId ? results.retain(songId) : undefined
    let released = false
    if (songId) {
      if (!readers.has(songId)) readersRevision++
      readers.set(songId, (readers.get(songId) ?? 0) + 1)
    }
    if (++users === 1) void poll()
    else void refresh()
    return () => {
      if (released) return
      released = true
      if (songId) {
        const n = (readers.get(songId) ?? 1) - 1
        if (n) readers.set(songId, n)
        else {
          readers.delete(songId)
          readersRevision++
        }
      }
      if (!--users) {
        clearTimeout(timer)
        abort?.abort()
      }
      unpin?.()
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
    cacheMetrics: () => results.metrics(),
    dispose: () => {
      disposed = true
      clearTimeout(timer)
      abort?.abort()
      stop()
      results.clear()
    },
    activeCount: computed(() => state.value?.activeCount ?? 0),
    core
  }
}
let singleton: ReturnType<typeof createMusicStudyStore> | undefined
export function useMusicStudyStore() {
  const core = useCoreConnection()
  if (!singleton || singleton.core !== core) {
    singleton?.dispose()
    singleton = createMusicStudyStore(core)
  }
  return singleton
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
