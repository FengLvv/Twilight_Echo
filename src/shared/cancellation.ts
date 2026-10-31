/** Expected request cancellation is control flow, while other failures stay visible. */
export function isRequestCancelled(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; name?: unknown }
  return value.code === 'CANCELLED' || value.name === 'AbortError'
}
