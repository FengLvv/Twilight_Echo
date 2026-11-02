export interface CacheBudget {
  bytes: number
  entries: number
}
export interface CacheMetrics {
  entries: number
  estimatedBytes: number
  protectedBytes: number
  evictions: number
  hits: number
  misses: number
  overBudget: boolean
}

/** A lease protects ownership, independently of whether its value has arrived yet. */
export class LeasedLru<K, V> {
  private entries = new Map<K, { value: V; bytes: number }>()
  private leases = new Map<K, number>()
  private bytes = 0
  private evictions = 0
  private hits = 0
  private misses = 0
  readonly budget: CacheBudget
  private readonly evicted: (key: K, value: V) => void
  private readonly protectedKey: (key: K) => boolean
  constructor(
    budget: CacheBudget,
    evicted: (key: K, value: V) => void = () => {},
    protectedKey: (key: K) => boolean = () => false
  ) {
    this.budget = budget
    this.evicted = evicted
    this.protectedKey = protectedKey
  }
  private pinned(key: K) {
    return !!this.leases.get(key) || this.protectedKey(key)
  }
  get(key: K): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }
    this.hits++
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }
  set(key: K, value: V, bytes: number) {
    const old = this.entries.get(key)
    this.bytes += Math.max(0, bytes) - (old?.bytes ?? 0)
    this.entries.delete(key)
    this.entries.set(key, { value, bytes: Math.max(0, bytes) })
    this.trim()
  }
  delete(key: K, force = false) {
    if (!force && this.pinned(key)) return false
    const entry = this.entries.get(key)
    if (!entry) return true
    this.entries.delete(key)
    this.bytes -= entry.bytes
    this.evictions++
    this.evicted(key, entry.value)
    return true
  }
  trim() {
    for (const key of this.entries.keys()) {
      if (this.bytes <= this.budget.bytes && this.entries.size <= this.budget.entries) break
      this.delete(key)
    }
  }
  retain(key: K): () => void {
    this.leases.set(key, (this.leases.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.leases.get(key) ?? 1) - 1
      if (count) this.leases.set(key, count)
      else this.leases.delete(key)
      this.trim()
    }
  }
  scope() {
    const releases = new Map<K, () => void>()
    return {
      retain: (key: K) => {
        if (!releases.has(key)) releases.set(key, this.retain(key))
      },
      dispose: () => {
        for (const release of releases.values()) release()
        releases.clear()
      }
    }
  }
  clear() {
    for (const key of this.entries.keys()) this.delete(key, true)
  }
  metrics(): CacheMetrics {
    let protectedBytes = 0
    for (const [key, entry] of this.entries) if (this.pinned(key)) protectedBytes += entry.bytes
    return {
      entries: this.entries.size,
      estimatedBytes: this.bytes,
      protectedBytes,
      evictions: this.evictions,
      hits: this.hits,
      misses: this.misses,
      overBudget: this.bytes > this.budget.bytes || this.entries.size > this.budget.entries
    }
  }
}

export function estimateResultBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength * 3
}
