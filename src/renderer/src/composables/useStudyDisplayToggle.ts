import { ref, watch } from 'vue'
import type { StudyLyricDisplayPatch } from '../../../shared/musicStudy.ts'
import { isRequestCancelled } from '../../../shared/cancellation.ts'
import type { useMusicStudyStore } from '../stores/musicStudy.ts'

/** Serialize display intent while allowing another click during preparation. */
export function useStudyDisplayToggle(
  store: ReturnType<typeof useMusicStudyStore>,
  songId: () => string,
  occurrence: () => string,
  field: 'chordsVisible' | 'notationVisible'
) {
  const enabled = ref(false),
    starting = ref(false),
    error = ref('')
  let generation = 0,
    revision = 0,
    work: Promise<void> | null = null
  const remote = () =>
    store.displays.value[songId()]?.[field] ??
    (field === 'chordsVisible' ? (store.songs.value[songId()]?.chordsVisible ?? false) : false)

  watch(
    [songId, occurrence],
    () => {
      ++generation
      ++revision
      work = null
      starting.value = false
      error.value = ''
      enabled.value = remote()
    },
    { immediate: true }
  )
  watch(remote, (value) => {
    if (!work) enabled.value = value
  })

  function set(value: boolean) {
    ++revision
    enabled.value = value
    if (work) return work
    const id = songId(),
      token = generation
    if (!id) return Promise.resolve()
    starting.value = true
    error.value = ''
    const current = () => token === generation && songId() === id
    const pending = (async () => {
      try {
        let applied: boolean
        do {
          applied = enabled.value
          const patch: StudyLyricDisplayPatch = { songId: id }
          patch[field] = applied
          await store.setDisplay(patch)
          if (!current()) return
        } while (applied !== enabled.value)
        void store.refresh()
      } catch (cause) {
        if (current() && !isRequestCancelled(cause))
          error.value = cause instanceof Error ? cause.message : String(cause)
      } finally {
        if (current()) {
          starting.value = false
          enabled.value = remote()
        }
      }
    })()
    work = pending
    void pending.finally(() => {
      if (work === pending) work = null
    })
    return pending
  }
  return {
    enabled,
    starting,
    error,
    set,
    toggle: () => set(!enabled.value),
    intent: () => revision
  }
}
