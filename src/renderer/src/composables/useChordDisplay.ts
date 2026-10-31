import { computed } from 'vue'
import type { StudyProject } from '../../../shared/musicStudy.ts'
import { inferChordKey, keyId, parseKey, romanChord } from '../utils/chordDegrees.ts'
import { useMusicStudyStore } from '../stores/musicStudy.ts'

export function useChordDisplay(project: () => StudyProject | null, songId: () => string) {
  const store = useMusicStudyStore()
  const display = computed(() => store.displays.value[songId()] ?? project()?.lyricDisplay)
  const mode = computed(() => display.value?.mode ?? 'names')
  const notationMode = computed(() => display.value?.notationMode ?? 'numbered')
  const override = computed(() => display.value?.key ?? 'auto')
  const inferred = computed(
    () =>
      inferChordKey(project()?.result?.chords.segments ?? []) ??
      project()?.result?.melody?.key ??
      null
  )
  const key = computed(() => parseKey(override.value) ?? inferred.value)
  function setMode(value: 'names' | 'degrees') {
    void store.setDisplay({ songId: songId(), mode: value }).catch((e) => {
      store.failure.value = String(e)
    })
  }
  function setKey(value: string) {
    void store.setDisplay({ songId: songId(), key: value }).catch((e) => {
      store.failure.value = String(e)
    })
  }
  function setNotationMode(value: 'numbered' | 'staff') {
    void store.setDisplay({ songId: songId(), notationMode: value }).catch((e) => {
      store.failure.value = String(e)
    })
  }
  const label = (value: string) => (mode.value === 'degrees' ? romanChord(value, key.value) : value)
  return {
    mode,
    notationMode,
    override,
    inferred,
    key,
    label,
    setMode,
    setNotationMode,
    setKey,
    keyId
  }
}
