import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  LYRICS_FONT_FAMILY_STACKS,
  type LyricsAppearanceFontFamily
} from '../../../shared/lyricsAppearance.ts'

export interface LyricsFontOption {
  /** Stable key for `v-for`. */
  key: string
  label: string
  /** CSS font stack used to render the option in its own face. */
  preview: string
  builtin: LyricsAppearanceFontFamily | null
  /** Family name to store when this is a locally installed font. */
  familyName: string | null
}

const BUILTIN_FONT_LABELS: Array<{ value: LyricsAppearanceFontFamily; label: string }> = [
  { value: 'inherit', label: '跟随界面' },
  { value: 'system', label: '系统默认' },
  { value: 'inter', label: 'Inter / Roboto' },
  { value: 'lxgw', label: '霞鹜文楷' },
  { value: 'sarasa', label: '更纱黑体' },
  { value: 'comic', label: 'Comic Sans' }
]

export const BUILTIN_FONT_OPTIONS: readonly LyricsFontOption[] = BUILTIN_FONT_LABELS.map(
  (entry) => ({
    key: `builtin:${entry.value}`,
    label: entry.label,
    preview:
      LYRICS_FONT_FAMILY_STACKS[entry.value as Exclude<LyricsAppearanceFontFamily, 'custom'>],
    builtin: entry.value,
    familyName: null
  })
)

export interface LyricsFontPicker {
  installed: Ref<string[]>
  loading: Ref<boolean>
  query: Ref<string>
  builtinMatches: ComputedRef<LyricsFontOption[]>
  installedMatches: ComputedRef<LyricsFontOption[]>
  load: () => Promise<void>
  isFontAvailable: (family: string) => boolean
}

/**
 * The installed-font list has to come from main: the session denies every
 * permission, so the renderer's own `queryLocalFonts()` can never resolve.
 */
export function useLyricsFontPicker(): LyricsFontPicker {
  const installed = ref<string[]>([])
  const loading = ref(false)
  const query = ref('')
  let loaded = false

  async function load(): Promise<void> {
    if (loaded || loading.value) return
    loading.value = true
    try {
      installed.value = (await window.api.fonts.listInstalled()) ?? []
      loaded = true
    } catch {
      // A font list is a convenience; the free-text field still works without it.
      installed.value = []
    } finally {
      loading.value = false
    }
  }

  const normalizedQuery = computed(() => query.value.trim().toLowerCase())

  const builtinMatches = computed(() =>
    BUILTIN_FONT_OPTIONS.filter(
      (option) =>
        !normalizedQuery.value || option.label.toLowerCase().includes(normalizedQuery.value)
    )
  )

  const installedMatches = computed<LyricsFontOption[]>(() =>
    installed.value
      .filter(
        (family) => !normalizedQuery.value || family.toLowerCase().includes(normalizedQuery.value)
      )
      .map((family) => ({
        key: `installed:${family}`,
        label: family,
        preview: `${JSON.stringify(family)}, sans-serif`,
        builtin: null,
        familyName: family
      }))
  )

  /**
   * `document.fonts.check` needs a size to parse the shorthand, and it reports
   * true for a family the browser can substitute, so treat a hit in the
   * installed list as the stronger signal when we have one.
   */
  function isFontAvailable(family: string): boolean {
    const name = family.trim()
    if (!name) return true
    if (installed.value.some((entry) => entry.toLowerCase() === name.toLowerCase())) return true
    if (typeof document === 'undefined' || !document.fonts?.check) return true
    try {
      return document.fonts.check(`16px ${JSON.stringify(name)}`)
    } catch {
      return true
    }
  }

  return { installed, loading, query, builtinMatches, installedMatches, load, isFontAvailable }
}
