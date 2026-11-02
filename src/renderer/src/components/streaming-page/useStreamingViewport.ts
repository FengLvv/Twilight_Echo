import { onBeforeUnmount, type Ref } from 'vue'

/** View-local navigation memory; never part of the music library or persistent cache. */
export function useStreamingViewport(element: Ref<HTMLElement | null>, key: () => string) {
  const positions = new Map<string, number>()
  function saveStreamingScrollPosition(): void {
    if (!element.value) return
    positions.delete(key())
    positions.set(key(), element.value.scrollTop)
    while (positions.size > 32) positions.delete(positions.keys().next().value!)
  }
  function restoreStreamingScrollPosition(): void {
    const saved = positions.get(key())
    if (saved == null) return
    positions.delete(key())
    if (element.value) element.value.scrollTop = saved
  }
  onBeforeUnmount(() => positions.clear())
  return { saveStreamingScrollPosition, restoreStreamingScrollPosition }
}
