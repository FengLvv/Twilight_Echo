import { createHash } from '../../shared/portableCrypto.ts'

type EventListener = (...args: any[]) => void

class PortableEventEmitter {
  private readonly listenersMap = new Map<string | symbol, Set<EventListener>>()

  on(event: string | symbol, listener: EventListener): this {
    let set = this.listenersMap.get(event)
    if (!set) {
      set = new Set()
      this.listenersMap.set(event, set)
    }
    set.add(listener)
    return this
  }

  addListener(event: string | symbol, listener: EventListener): this {
    return this.on(event, listener)
  }

  once(event: string | symbol, listener: EventListener): this {
    const wrapped: EventListener = (...args: any[]) => {
      this.off(event, wrapped)
      listener(...args)
    }
    return this.on(event, wrapped)
  }

  off(event: string | symbol, listener: EventListener): this {
    const set = this.listenersMap.get(event)
    if (set) {
      set.delete(listener)
      if (set.size === 0) this.listenersMap.delete(event)
    }
    return this
  }

  removeListener(event: string | symbol, listener: EventListener): this {
    return this.off(event, listener)
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) {
      this.listenersMap.clear()
    } else {
      this.listenersMap.delete(event)
    }
    return this
  }

  listenerCount(event: string | symbol): number {
    return this.listenersMap.get(event)?.size ?? 0
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    const set = this.listenersMap.get(event)
    if (!set || set.size === 0) return false
    for (const listener of [...set]) {
      listener(...args)
    }
    return true
  }
}

export interface ProviderPlaybackIdentity {
  providerId: string
  trackId: string
  source: string
  originSource: string
  requestedQuality: string
  actualQuality: string | null
  format: string | null
  sampleRate: number | null
  bitrate: number | null
  bytes: number | null
  expiresAt: number | null
}
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= 8192 ? v : null
const positive = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Internal provenance only. A resolution revision is never a content digest;
 * native analysis/transport must still hash and lease the actual local bytes. */
export class ProviderPlaybackIdentityRegistry extends PortableEventEmitter {
  private sequence = 0
  private readonly tracks = new Map<
    string,
    { identity: ProviderPlaybackIdentity; revision: number; digest: string }
  >()
  private readonly sources = new Map<string, { key: string; revision: number }>()
  record(providerId: string, trackId: string, requestedQuality: string, result: unknown): void {
    const envelope = object(result)
    const source = text(envelope.streamUrl ?? result)
    if (!source || !trackId) return
    const meta = object(envelope.providerSource)
    const identity: ProviderPlaybackIdentity = {
      providerId,
      trackId,
      source,
      originSource: text(meta.originSource) ?? source,
      requestedQuality,
      actualQuality: text(meta.actualQuality),
      format: text(meta.format),
      sampleRate: positive(meta.sampleRate),
      bitrate: positive(meta.bitrate),
      bytes: positive(meta.bytes),
      expiresAt: positive(meta.expiresAt)
    }
    const key = JSON.stringify([providerId, trackId])
    const digest = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
    const old = this.tracks.get(key)
    if (old?.digest === digest) return
    const revision = ++this.sequence
    this.tracks.delete(key)
    this.tracks.set(key, { identity, revision, digest })
    this.sources.set(source, { key, revision })
    // Preserve revoked aliases until bounded eviction; these must not become
    // eligible simply because the queue still contains an older cached path.
    while (this.tracks.size > 1024) this.tracks.delete(this.tracks.keys().next().value!)
    while (this.sources.size > 4096) this.sources.delete(this.sources.keys().next().value!)
    this.emit('changed', [
      ...new Set([old?.identity.source, source].filter((s): s is string => !!s))
    ])
  }
  revision(source: string): string {
    const alias = this.sources.get(source)
    if (!alias) return ''
    const record = this.tracks.get(alias.key)
    return `${alias.revision}:${record?.revision ?? 'evicted'}:${record?.digest ?? ''}`
  }
  assertCurrent(source: string): void {
    const alias = this.sources.get(source)
    if (!alias) return
    const record = this.tracks.get(alias.key)
    if (!record || record.revision !== alias.revision)
      throw new Error('provider_source_resolution_changed')
    if (
      /^https?:/i.test(source) &&
      record.identity.expiresAt !== null &&
      record.identity.expiresAt <= Date.now()
    )
      throw new Error('provider_source_expired')
  }
  get(source: string): ProviderPlaybackIdentity | null {
    this.assertCurrent(source)
    const alias = this.sources.get(source)
    const record = alias && this.tracks.get(alias.key)
    return record ? structuredClone(record.identity) : null
  }
}
export const providerPlaybackIdentities = new ProviderPlaybackIdentityRegistry()
