/** One rate budget for every upstream call. Playback may take the next token;
 * a bounded burst of priority calls still leaves room for background work. */
export function createRequestScheduler({
  capacity = 5,
  refillPerMs = 5 / 1000,
  now = () => Date.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (timer) => clearTimeout(timer)
} = {}) {
  let tokens = capacity, refilledAt = now(), timer, playbackRun = 0
  const playback = [], normal = []
  const aborted = (signal) => signal?.reason instanceof Error
    ? signal.reason : new Error('Provider request was cancelled')
  function drain() {
    if (timer !== undefined) { cancel(timer); timer = undefined }
    const time = now()
    if (time >= refilledAt) tokens = Math.min(capacity, tokens + (time - refilledAt) * refillPerMs)
    refilledAt = time
    while (tokens >= 1 && (playback.length || normal.length)) {
      const priority = playback.length && (!normal.length || playbackRun < 4)
      const item = (priority ? playback : normal).shift()
      playbackRun = priority && normal.length ? playbackRun + 1 : 0
      item.signal?.removeEventListener('abort', item.abort)
      tokens -= 1
      item.resolve()
    }
    if (playback.length || normal.length)
      timer = schedule(() => { timer = undefined; drain() }, Math.max(5, Math.ceil((1 - tokens) / refillPerMs)))
  }
  return {
    acquire(priority = 'normal', signal) {
      if (signal?.aborted) return Promise.reject(aborted(signal))
      return new Promise((resolve, reject) => {
        const queue = priority === 'playback' ? playback : normal
        const item = { resolve, reject, signal, abort: undefined }
        item.abort = () => {
          const index = queue.indexOf(item)
          if (index < 0) return
          queue.splice(index, 1)
          signal.removeEventListener('abort', item.abort)
          reject(aborted(signal))
          drain()
        }
        queue.push(item)
        signal?.addEventListener('abort', item.abort, { once: true })
        drain()
      })
    },
    reset() {
      if (timer !== undefined) { cancel(timer); timer = undefined }
      for (const item of [...playback, ...normal]) {
        item.signal?.removeEventListener('abort', item.abort)
        item.reject(new Error('Provider session changed'))
      }
      playback.length = normal.length = 0
      tokens = capacity
      refilledAt = now()
      playbackRun = 0
    }
  }
}
