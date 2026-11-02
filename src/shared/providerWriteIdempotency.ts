export const PROVIDER_WRITE_IDEMPOTENCY_TTL_MS = 5 * 60_000
export const MAX_PROVIDER_WRITE_IDEMPOTENCY_ENTRIES = 256

const PROVIDER_WRITE_METHODS = new Set([
  'likeTrack',
  'followArtist',
  'followUser',
  'createPlaylist',
  'deletePlaylist',
  'subscribePlaylist',
  'subscribeAlbum',
  'addTracksToPlaylist',
  'removeTracksFromPlaylist',
  'createDownload'
])

interface ProviderWriteIdempotencyEntry {
  key: string
  payloadFingerprint: string
  expiresAt: number
  inFlight: number
}

export interface ProviderWriteIdempotencyLease {
  idempotencyKey?: string
  settle: (succeeded: boolean) => void
}

export interface ProviderWriteIdempotencyCoordinatorOptions {
  now?: () => number
  createKey?: () => string
  retryTtlMs?: number
  maxEntries?: number
}

/**
 * Keeps one idempotency key for a logical provider write until it succeeds.
 * A timeout/error retry of the same payload reuses the key, while a changed
 * desired state for the same target replaces it with a fresh key.
 */
export class ProviderWriteIdempotencyCoordinator {
  private readonly now: () => number
  private readonly createKey: () => string
  private readonly retryTtlMs: number
  private readonly maxEntries: number
  private readonly entries = new Map<string, ProviderWriteIdempotencyEntry>()

  constructor(options: ProviderWriteIdempotencyCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now
    this.createKey = options.createKey ?? (() => crypto.randomUUID())
    this.retryTtlMs = positiveInteger(
      options.retryTtlMs,
      PROVIDER_WRITE_IDEMPOTENCY_TTL_MS,
      'retryTtlMs'
    )
    this.maxEntries = positiveInteger(
      options.maxEntries,
      MAX_PROVIDER_WRITE_IDEMPOTENCY_ENTRIES,
      'maxEntries'
    )
  }

  begin(
    providerId: string,
    method: string,
    args: unknown[],
    suppliedKey?: string
  ): ProviderWriteIdempotencyLease {
    if (suppliedKey || !PROVIDER_WRITE_METHODS.has(method)) {
      return { idempotencyKey: suppliedKey, settle: () => undefined }
    }

    this.pruneExpired()
    const targetFingerprint = JSON.stringify([
      providerId.trim().toLowerCase(),
      method,
      args.slice(0, Math.max(0, args.length - 1))
    ])
    const payloadFingerprint = JSON.stringify(args)
    const existing = this.entries.get(targetFingerprint)
    let entry: ProviderWriteIdempotencyEntry
    if (existing?.payloadFingerprint === payloadFingerprint) {
      entry = existing
      entry.inFlight += 1
      entry.expiresAt = Number.POSITIVE_INFINITY
    } else {
      if (!existing) this.makeRoomForEntry()
      entry = {
        key: this.createKey(),
        payloadFingerprint,
        expiresAt: Number.POSITIVE_INFINITY,
        inFlight: 1
      }
    }
    this.entries.delete(targetFingerprint)
    this.entries.set(targetFingerprint, entry)

    return {
      idempotencyKey: entry.key,
      settle: (succeeded) => {
        const current = this.entries.get(targetFingerprint)
        if (current?.key !== entry.key) return
        current.inFlight = Math.max(0, current.inFlight - 1)
        if (succeeded) this.entries.delete(targetFingerprint)
        else if (current.inFlight === 0) current.expiresAt = this.now() + this.retryTtlMs
      }
    }
  }

  get size(): number {
    this.pruneExpired()
    return this.entries.size
  }

  private pruneExpired(): void {
    const now = this.now()
    for (const [target, entry] of this.entries) {
      if (entry.inFlight === 0 && entry.expiresAt <= now) this.entries.delete(target)
    }
  }

  private makeRoomForEntry(): void {
    if (this.entries.size < this.maxEntries) return
    for (const [target, entry] of this.entries) {
      if (entry.inFlight > 0) continue
      this.entries.delete(target)
      if (this.entries.size < this.maxEntries) return
    }
    throw new Error('Provider write idempotency registry is full of in-flight operations.')
  }
}

function positiveInteger(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback
  if (!Number.isInteger(selected) || selected < 1) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return selected
}
