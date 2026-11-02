import { onBeforeUnmount } from 'vue'
import type { HistoryCommandRouter } from './historyNavigation.ts'

/** Late startup continuations cannot install listeners after their window unmounts. */
export function useAppWindowLifecycle(options: {
  navigate: Parameters<typeof window.api.app.onNavigate>[0]
  history: HistoryCommandRouter
  flush(): void
  back(event: KeyboardEvent): void
}) {
  const disposers: Array<() => void> = []
  let disposed = false
  function navigation(): void {
    if (disposed) return
    disposers.push(
      window.api.app.onNavigate((target) => {
        options.navigate(target)
        void window.api.app.consumePendingNavigation()
      }),
      window.api.app.onHistoryCommand(options.history.run)
    )
    window.addEventListener('mouseup', options.history.handleMouseUp, true)
    disposers.push(() => window.removeEventListener('mouseup', options.history.handleMouseUp, true))
  }
  function persistence(): void {
    if (!disposed) disposers.push(window.api.app.onSavePlaybackSession(async () => options.flush()))
  }
  function pageEvents(): void {
    if (disposed) return
    window.addEventListener('beforeunload', options.flush)
    window.addEventListener('pagehide', options.flush)
    window.addEventListener('keydown', options.back)
    disposers.push(() => {
      window.removeEventListener('beforeunload', options.flush)
      window.removeEventListener('pagehide', options.flush)
      window.removeEventListener('keydown', options.back)
    })
  }
  onBeforeUnmount(() => {
    disposed = true
    for (const dispose of disposers.splice(0).reverse()) dispose()
  })
  return { navigation, persistence, pageEvents }
}
