import { computed, onBeforeUnmount, watch, type Ref, type WatchSource } from 'vue'
import type { GridItem } from './types.ts'
import {
  availableCollectionLetters,
  collectionIndexLetter,
  collectionLetterAtScroll,
  firstCollectionIndexForLetter
} from '../../utils/libraryCollectionView.ts'

export function useCollectionAlphabet(options: {
  items(): GridItem[]
  database(): boolean
  enabled(): boolean
  letters(): Record<string, number>
  category(): string
  scrollTop(): number
  offset(): number
  stride(): number
  columns(): number
  range: WatchSource<unknown>
  active: Ref<string | null>
  renderThrough(index: number): void
  onScroll(event: Event): void
}) {
  const availableIndexLetters = computed(() =>
    options.database()
      ? new Set(Object.keys(options.letters()))
      : availableCollectionLetters(options.items())
  )
  const collectionLetterDisabled = (letter: string) => !availableIndexLetters.value.has(letter)
  function jumpToCollectionLetter(letter: string): void {
    if (!options.enabled() || collectionLetterDisabled(letter)) return
    const index = options.database()
      ? options.letters()[letter]
      : firstCollectionIndexForLetter(options.items(), letter)
    if (index === undefined || index < 0) return
    options.active.value = letter
    options.renderThrough(index)
  }
  function updateActiveCollectionLetter(): void {
    if (!options.enabled()) return
    const index =
      Math.max(
        0,
        Math.floor((options.scrollTop() + 104 - options.offset()) / Math.max(1, options.stride()))
      ) * Math.max(1, options.columns())
    const next = options.database()
      ? (Object.entries(options.letters())
          .filter(([, offset]) => offset <= index)
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null)
      : (collectionLetterAtScroll(
          options.items(),
          options.scrollTop(),
          options.offset(),
          options.columns(),
          options.stride()
        ) ?? collectionIndexLetter(options.items()[0]?.name ?? ''))
    if (next !== options.active.value) options.active.value = next
  }
  let frame: number | null = null
  function onSongListScroll(event: Event): void {
    options.onScroll(event)
    if (frame !== null) return
    frame = window.requestAnimationFrame(() => {
      frame = null
      updateActiveCollectionLetter()
    })
  }
  onBeforeUnmount(() => {
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
  })
  watch([options.items, options.category], updateActiveCollectionLetter)
  watch([options.scrollTop, options.range], updateActiveCollectionLetter)
  return {
    availableIndexLetters,
    collectionLetterDisabled,
    jumpToCollectionLetter,
    onSongListScroll
  }
}
