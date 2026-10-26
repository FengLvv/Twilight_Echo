export function deferMacrotask(callback: () => void): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0)
}

export function clearDeferredMacrotask(handle: ReturnType<typeof setTimeout>): void {
  clearTimeout(handle)
}

export interface PortableDelayOptions {
  signal?: AbortSignal
}

export function delay<T = void>(
  ms: number,
  value?: T,
  options?: PortableDelayOptions
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const signal = options?.signal
    if (signal?.aborted) {
      const abortErr = new Error('The operation was aborted')
      abortErr.name = 'AbortError'
      reject(abortErr)
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const onAbort = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      const abortErr = new Error('The operation was aborted')
      abortErr.name = 'AbortError'
      reject(abortErr)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(value as T)
    }, Math.max(0, ms))
  })
}

export function isDeepStrictEqual(a: unknown, b: unknown, seen = new Map<object, object>()): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) {
    if (!(a instanceof Uint8Array && b instanceof Uint8Array)) {
      return false
    }
  }
  if (seen.get(a) === b) return true
  seen.set(a, b)

  if (a instanceof Date && b instanceof Date) {
    return Object.is(a.getTime(), b.getTime())
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.source === b.source && a.flags === b.flags && a.lastIndex === b.lastIndex
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false
    for (let i = 0; i < a.byteLength; i += 1) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    if (a.byteLength !== b.byteLength) return false
    const viewA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    const viewB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    for (let i = 0; i < viewA.byteLength; i += 1) {
      if (viewA[i] !== viewB[i]) return false
    }
    return true
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [k, v] of a.entries()) {
      if (!b.has(k) || !isDeepStrictEqual(v, b.get(k), seen)) return false
    }
    return true
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const v of a.values()) {
      if (!b.has(v)) return false
    }
    return true
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!(i in a) !== !(i in b)) return false
      if (!isDeepStrictEqual(a[i], b[i], seen)) return false
    }
    return true
  }

  const keysA = Reflect.ownKeys(a)
  const keysB = Reflect.ownKeys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (
      !isDeepStrictEqual(
        (a as Record<PropertyKey, unknown>)[key],
        (b as Record<PropertyKey, unknown>)[key],
        seen
      )
    ) {
      return false
    }
  }
  return true
}
