import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMusicStudyStore } from '../stores/musicStudy.ts'
import { studyReady, type StudyMix, type StudyProject } from '../../../shared/musicStudy.ts'
import { isRequestCancelled } from '../../../shared/cancellation.ts'

export function useSongAnalysis(songId: () => string) {
  const store = useMusicStudyStore(),
    core = store.core
  const project = computed(() => store.songs.value[songId()] ?? null)
  const open = ref(false),
    error = ref(''),
    starting = ref(false),
    leaving = ref(false)
  const mode = ref<StudyMix['mode']>('instruments')
  const tracks = ref<StudyMix['tracks']>({})
  const sixReady = computed(() => studyReady(project.value?.result, 'six'))
  const chordsReady = computed(() => studyReady(project.value?.result, 'chords'))
  const melodyEnabled = ref(false),
    melodyStarting = ref(false),
    melodyRequestError = ref('')
  const melodyReady = computed(() => studyReady(project.value?.result, 'melody'))
  const melodyVisible = computed(() => melodyEnabled.value && melodyReady.value)
  const melodyBusy = computed(
    () =>
      melodyStarting.value ||
      (!melodyReady.value && ['queued', 'running'].includes(project.value?.status ?? ''))
  )
  const melodyError = computed(
    () => melodyRequestError.value || project.value?.stages?.melody?.error || ''
  )
  let melodyGeneration = 0,
    melodyRequest: Promise<void> | null = null
  function toggleMelody() {
    melodyEnabled.value = !melodyEnabled.value
    if (melodyRequest) return melodyRequest
    const id = songId(),
      token = melodyGeneration
    if (!id) return
    melodyStarting.value = true
    melodyRequestError.value = ''
    const work = (async () => {
      try {
        let applied: boolean
        do {
          applied = melodyEnabled.value
          await store.setDisplay({ songId: id, notationVisible: applied })
          if (token !== melodyGeneration || songId() !== id) return
        } while (applied !== melodyEnabled.value)
        await store.readSong(id)
        void store.refresh()
      } catch (e) {
        if (token === melodyGeneration && !isRequestCancelled(e))
          melodyRequestError.value = e instanceof Error ? e.message : String(e)
      } finally {
        if (token === melodyGeneration) melodyStarting.value = false
      }
    })()
    melodyRequest = work
    void work.finally(() => {
      if (melodyRequest === work) {
        melodyRequest = null
        if (token === melodyGeneration)
          melodyEnabled.value = store.displays.value[id]?.notationVisible ?? melodyEnabled.value
      }
    })
    return work
  }
  watch(
    () => store.displays.value[songId()]?.notationVisible,
    (value) => {
      if (value !== undefined && !melodyRequest) melodyEnabled.value = value
    }
  )
  const chordsVisible = computed(() => chordsReady.value && project.value?.chordsVisible !== false)
  const chordsBusy = computed(
    () =>
      starting.value ||
      (!chordsReady.value && ['queued', 'running'].includes(project.value?.status ?? ''))
  )
  let release: (() => void) | undefined,
    generation = 0,
    binding = '',
    initialized = '',
    activated = ''
  let desiredVoice: 'leadBacking' | 'twoSingers' | null = null
  let mixWork: Promise<void> = Promise.resolve(),
    mixScheduled = false
  const occurrence = () => core.state.value?.queue?.occurrenceId ?? ''
  const report = (e: unknown) => {
    if (!isRequestCancelled(e)) error.value = e instanceof Error ? e.message : String(e)
  }
  function changeMix() {
    if (!open.value || starting.value || !sixReady.value || !project.value || mixScheduled)
      return mixWork
    const token = generation
    mixScheduled = true
    mixWork = mixWork
      .catch(() => {})
      .then(async () => {
        mixScheduled = false
        if (token !== generation || !open.value || binding !== occurrence() || !project.value)
          return
        const id = project.value.id
        await core.command('study.mix', {
          id,
          mode: mode.value,
          tracks: JSON.parse(JSON.stringify(tracks.value)),
          occurrenceId: binding
        })
        if (token === generation) {
          activated = id
          error.value = ''
        }
      })
      .catch(report)
    return mixWork
  }
  async function analyze() {
    if (leaving.value) return
    return startAnalysis()
  }
  async function toggle() {
    if (leaving.value) return
    return open.value ? back() : analyze()
  }
  async function startAnalysis() {
    if (starting.value) return
    const id = songId()
    if (!id) return
    open.value = true
    starting.value = true
    error.value = ''
    binding = occurrence()
    const token = ++generation
    try {
      const value = (await core.command('study.analyze', { songId: id })) as StudyProject | null
      if (token !== generation || songId() !== id) return
      if (value) store.songs.value = { ...store.songs.value, [id]: value }
      if (value) {
        await core.command('study.chordsVisible', { id: value.id, visible: true })
        if (token !== generation || songId() !== id) return
      }
      await store.readSong(id)
      if (token !== generation || songId() !== id) return
      starting.value = false
      await activate()
      void store.refresh()
    } catch (e) {
      if (token === generation) report(e)
    } finally {
      if (token === generation) starting.value = false
    }
  }
  async function activate() {
    const value = project.value
    if (!open.value || starting.value || !value || !sixReady.value || binding !== occurrence())
      return
    if (initialized !== value.id) {
      initialized = value.id
      mode.value = value.mix?.mode ?? 'instruments'
      tracks.value = structuredClone(value.mix?.tracks ?? {})
    }
    if (
      mode.value === 'original' ||
      (mode.value === 'leadBacking' && !studyReady(value.result, 'leadBacking')) ||
      (mode.value === 'twoSingers' && !studyReady(value.result, 'twoSingers'))
    )
      mode.value = 'instruments'
    if (desiredVoice && studyReady(value.result, desiredVoice)) {
      mode.value = desiredVoice
      desiredVoice = null
      await changeMix()
    } else if (activated !== value.id) await changeMix()
  }
  async function back() {
    if (leaving.value) return
    open.value = false
    starting.value = false
    leaving.value = true
    const token = ++generation
    desiredVoice = null
    try {
      await mixWork.catch(() => {})
      if (token !== generation) return
      if (project.value)
        await core
          .command('study.transport', { id: project.value.id, action: 'exit' })
          .catch(report)
      if (token === generation) activated = ''
    } finally {
      if (token === generation) leaving.value = false
    }
  }
  async function split(kind: 'leadBacking' | 'twoSingers') {
    if (!project.value) return
    desiredVoice = kind
    error.value = ''
    try {
      await core.command('study.splitVocals', { id: project.value.id, kind })
      await store.readSong(songId())
      await activate()
      void store.refresh()
    } catch (e) {
      desiredVoice = null
      report(e)
    }
  }
  function family(value: StudyMix['mode']) {
    desiredVoice = null
    mode.value = value
    void changeMix()
  }
  watch(
    () => project.value?.revision,
    () => {
      void activate()
    }
  )
  watch(
    [songId, occurrence],
    ([id]) => {
      ++melodyGeneration
      melodyEnabled.value = false
      melodyStarting.value = false
      melodyRequestError.value = ''
      melodyRequest = null
      open.value = false
      ++generation
      activated = ''
      initialized = ''
      desiredVoice = null
      error.value = ''
      starting.value = false
      leaving.value = false
      release?.()
      release = id ? store.retain(id) : undefined
      if (id) {
        const token = melodyGeneration
        void store
          .readSong(id)
          .then(() => {
            if (token === melodyGeneration && !melodyRequest)
              melodyEnabled.value = store.displays.value[id]?.notationVisible ?? false
          })
          .catch(report)
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    void back()
    release?.()
  })
  return {
    project,
    open,
    error,
    starting,
    leaving,
    mode,
    tracks,
    sixReady,
    chordsReady,
    chordsVisible,
    chordsBusy,
    melodyEnabled,
    melodyReady,
    melodyVisible,
    melodyBusy,
    melodyError,
    toggleMelody,
    analyze,
    toggle,
    back,
    split,
    family,
    changeMix,
    store
  }
}
