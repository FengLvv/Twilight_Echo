import type { TrackData } from '../../shared/track.ts'
import { getNcmSongId } from '../../shared/ncmTrack.ts'
import { getTrackSource } from '../../shared/trackSourceIdentity.ts'

type Source = { cover: string | null; coverSource?: string | null }
type Display = { cover: string | null; coverSource: null }
interface Flight {
  key: string
  track: TrackData
  controller: AbortController
  users: number
  promise: Promise<Source | null>
  resolve(value: Source | null): void
  reject(error: unknown): void
}

/** Private identity-based artwork recovery shared by playback and library/history
 * projections. Queue display hints never become image or audio authority. */
export function createTrackArtworkResolver(options: {
  present(source: Source, signal: AbortSignal): Promise<{ cover: string | null }>
  local(id: string, signal: AbortSignal): Promise<Source | null>
  ncm(ids: number[], signal: AbortSignal): Promise<unknown>
  search(provider: string, query: string, signal: AbortSignal): Promise<unknown>
  restore?: (keys: string[], signal: AbortSignal) => Promise<Array<Source | null>>
  persist?: (items: Array<{ key: string; source: Source }>, signal: AbortSignal) => Promise<void>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const cache = new Map<string, { source: Source | null; until: number }>()
  const pending = new Map<string, Flight>()
  const queued: Flight[] = []
  let active = 0
  let displaying = 0
  const displayQueue: Array<() => void> = []
  async function present(source: Source, signal: AbortSignal, key?: string) {
    signal.throwIfAborted()
    const release = await new Promise<() => void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', abort)
        displaying++
        resolve(() => {
          displaying--
          displayQueue.shift()?.()
        })
      }
      const abort = () => {
        const index = displayQueue.indexOf(start)
        if (index >= 0) displayQueue.splice(index, 1)
        reject(signal.reason)
      }
      if (displaying < 6) start()
      else {
        displayQueue.push(start)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
    try {
      signal.throwIfAborted()
      const display = await options.present(source, signal)
      const saved = key ? cache.get(key) : undefined
      if (display.cover && key && (!saved?.source || saved.until <= now() || JSON.stringify(saved.source) !== JSON.stringify(source))) {
        await options.persist?.([{ key, source }], signal).catch(() => {
          signal.throwIfAborted()
        })
        remember(key, source)
      }
      return display
    } finally {
      release()
    }
  }
  const keyOf = (track: TrackData) =>
    JSON.stringify([
      getTrackSource(track),
      getTrackSource(track) === 'ncm' ? (getNcmSongId(track) ?? track.id) : track.id
    ])
  const sourceOf = (value: unknown): Source | null => {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const cover =
      typeof record.cover === 'string'
        ? record.cover
        : typeof record.coverSmall === 'string'
          ? record.coverSmall
          : null
    const coverSource =
      typeof record.coverSource === 'string'
        ? record.coverSource
        : typeof record.coverSmallSource === 'string'
          ? record.coverSmallSource
          : null
    return cover || coverSource ? { cover, coverSource } : null
  }
  function remember(key: string, source: Source | null) {
    cache.delete(key)
    cache.set(key, { source, until: now() + (source ? 300_000 : 30_000) })
    if (cache.size > 512) cache.delete(cache.keys().next().value!)
  }
  async function fetchSources(group: Flight[], signal: AbortSignal): Promise<Array<Source | null>> {
    const source = getTrackSource(group[0].track)
    if (source === 'ncm') {
      const ids = group.map((item) => getNcmSongId(item.track))
      const valid = ids.filter(
        (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      )
      if (!valid.length) return group.map(() => null)
      const response = (await options.ncm(valid, signal)) as {
        code?: number
        songs?: unknown[]
      } | null
      signal.throwIfAborted()
      if (response?.code !== 200 || !Array.isArray(response.songs))
        throw new Error('网易云歌曲封面读取失败')
      const songs = new Map(
        response.songs.flatMap((value) => {
          if (!value || typeof value !== 'object') return []
          const song = value as {
            id?: number
            al?: { picUrl?: unknown }
            album?: { picUrl?: unknown }
          }
          const url = song.al?.picUrl ?? song.album?.picUrl
          return typeof song.id === 'number' && typeof url === 'string' && /^https?:\/\//i.test(url)
            ? [[song.id, { cover: null, coverSource: url }] as const]
            : []
        })
      )
      return ids.map((id) => (id === null ? null : (songs.get(id) ?? null)))
    }
    const track = group[0].track
    if (source === 'local') return [await options.local(track.id, signal)]
    if (['network', 'radio', 'podcast'].includes(source) || !track.title.trim()) return [null]
    const response = await options.search(
      source,
      [track.title, track.artist].filter(Boolean).join(' '),
      signal
    )
    signal.throwIfAborted()
    const items = (response as { items?: unknown[] } | null)?.items
    const match = Array.isArray(items)
      ? items.find((item) => {
          if (!item || typeof item !== 'object') return false
          const candidate = item as TrackData
          return (
            candidate.id === track.id && (!candidate.source || getTrackSource(candidate) === source)
          )
        })
      : null
    return [sourceOf(match)]
  }
  async function load(group: Flight[], signal: AbortSignal): Promise<Array<Source | null | Error>> {
    const saved =
      getTrackSource(group[0].track) === 'local'
        ? []
        : ((await options
            .restore?.(
              group.map((item) => item.key),
              signal
            )
            .catch(() => {
              signal.throwIfAborted()
              return []
            })) ?? [])
    signal.throwIfAborted()
    const result: Array<Source | null | Error> = group.map((_, index) => sourceOf(saved[index]))
    const missing = group.filter((_, index) => !result[index])
    if (!missing.length) return result
    let fetched: Array<Source | null | Error>
    try {
      fetched = await fetchSources(missing, signal)
      const items = fetched.flatMap((source, index) =>
        source && !(source instanceof Error) && getTrackSource(missing[index].track) !== 'local'
          ? [{ key: missing[index].key, source }]
          : []
      )
      if (items.length)
        await options.persist?.(items, signal).catch(() => {
          signal.throwIfAborted()
        })
    } catch (error) {
      signal.throwIfAborted()
      fetched = missing.map(() => (error instanceof Error ? error : new Error(String(error))))
    }
    let index = 0
    return result.map((source) => source ?? fetched[index++] ?? null)
  }
  function pump() {
    while (active < 3 && queued.length) {
      const first = queued.shift()!
      if (first.controller.signal.aborted) {
        first.reject(first.controller.signal.reason)
        continue
      }
      const group = [first]
      if (getTrackSource(first.track) === 'ncm') {
        for (let index = 0; index < queued.length && group.length < 50; ) {
          if (getTrackSource(queued[index].track) === 'ncm') group.push(...queued.splice(index, 1))
          else index++
        }
      }
      active++
      const controller = new AbortController()
      const cancel = () => {
        if (group.every((item) => item.controller.signal.aborted)) controller.abort()
      }
      for (const item of group)
        item.controller.signal.addEventListener('abort', cancel, { once: true })
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
      void load(group, signal)
        .then((sources) => {
          signal.throwIfAborted()
          group.forEach((item, index) => {
            const source = sources[index] ?? null
            if (!item.controller.signal.aborted)
              remember(item.key, source instanceof Error ? null : source)
            if (source instanceof Error) item.reject(source)
            else item.resolve(source)
          })
        })
        .catch((error) => {
          for (const item of group) {
            if (!item.controller.signal.aborted) remember(item.key, null)
            item.reject(error)
          }
        })
        .finally(() => {
          for (const item of group) item.controller.signal.removeEventListener('abort', cancel)
          active--
          pump()
        })
    }
  }
  function lookup(
    track: TrackData,
    signal: AbortSignal,
    foreground: boolean
  ): Promise<Source | null> {
    signal.throwIfAborted()
    const key = keyOf(track)
    const cached = cache.get(key)
    if (getTrackSource(track) !== 'local' && cached && cached.until > now()) {
      cache.delete(key)
      cache.set(key, cached)
      return Promise.resolve(cached.source)
    }
    let flight = pending.get(key)
    if (flight?.controller.signal.aborted) flight = undefined
    if (!flight) {
      let resolve!: Flight['resolve'], reject!: Flight['reject']
      const promise = new Promise<Source | null>((yes, no) => {
        resolve = yes
        reject = no
      })
      flight = {
        key,
        track: { ...track },
        controller: new AbortController(),
        users: 0,
        promise,
        resolve,
        reject
      }
      const created = flight
      pending.set(key, created)
      const cleanup = () => {
        if (pending.get(key) === created) pending.delete(key)
      }
      void promise.then(cleanup, cleanup)
      if (foreground) queued.unshift(created)
      else queued.push(created)
      queueMicrotask(pump)
    } else if (foreground) {
      const index = queued.indexOf(flight)
      if (index > 0) queued.unshift(...queued.splice(index, 1))
    }
    const current = flight
    current.users++
    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (action: () => void) => {
        if (finished) return
        finished = true
        signal.removeEventListener('abort', abort)
        if (--current.users === 0) current.controller.abort()
        action()
      }
      const abort = () => finish(() => reject(signal.reason))
      signal.addEventListener('abort', abort, { once: true })
      void current.promise.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error))
      )
      if (signal.aborted) abort()
    })
  }
  return async (track: TrackData, signal: AbortSignal, foreground = false): Promise<Display> => {
    signal.throwIfAborted()
    const existing = sourceOf(track)
    if (existing) {
      try {
        const value = await present(
          existing,
          signal,
          getTrackSource(track) === 'local' ? undefined : keyOf(track)
        )
        signal.throwIfAborted()
        if (value.cover) return { cover: value.cover, coverSource: null }
      } catch {
        signal.throwIfAborted()
      }
    }
    const source = await lookup(track, signal, foreground)
    signal.throwIfAborted()
    if (!source) return { cover: null, coverSource: null }
    try {
      const value = await present(source, signal)
      signal.throwIfAborted()
      return { cover: value.cover, coverSource: null }
    } catch (error) {
      cache.delete(keyOf(track))
      throw error
    }
  }
}
