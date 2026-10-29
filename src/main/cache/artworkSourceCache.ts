import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** A private identity -> durable image origin index, cleared with image bytes.
 * Session tokens and audio URLs never enter this store. */
export function createArtworkSourceCache(directory: () => string | null, now = Date.now) {
  let generation = 0,
    clearing = false
  const writes = new Set<Promise<void>>()
  const pathOf = (key: string) => {
    const root = directory()
    return root
      ? join(root, 'track-artwork', `${createHash('sha256').update(key).digest('hex')}.json`)
      : null
  }
  const validSource = (source: unknown): source is string => {
    if (typeof source !== 'string' || source.length > 8192) return false
    try {
      const url = new URL(source)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    } catch {
      return false
    }
  }
  return {
    async read(key: string): Promise<{ cover: null; coverSource: string } | null> {
      const path = pathOf(key),
        expected = generation
      if (!path || clearing) return null
      try {
        const info = await stat(path)
        if (info.size > 16384) return null
        const value = JSON.parse(await readFile(path, 'utf8'))
        if (
          clearing ||
          expected !== generation ||
          value.key !== key ||
          value.version !== 1 ||
          !Number.isFinite(value.savedAt) ||
          value.savedAt > now() ||
          now() - value.savedAt > 7 * 86400_000 ||
          !validSource(value.source)
        )
          return null
        return { cover: null, coverSource: value.source }
      } catch {
        return null
      }
    },
    async write(key: string, source: string): Promise<void> {
      const path = pathOf(key),
        expected = generation
      if (!path || clearing || !validSource(source)) return
      const work = (async () => {
        const temporary = `${path}.${randomUUID()}.part`
        try {
          await mkdir(join(path, '..'), { recursive: true })
          if (clearing || generation !== expected) return
          await writeFile(temporary, JSON.stringify({ version: 1, key, source, savedAt: now() }))
          if (!clearing && generation === expected) await rename(temporary, path)
        } finally {
          await rm(temporary, { force: true }).catch(() => {})
        }
      })()
      writes.add(work)
      try {
        await work
      } finally {
        writes.delete(work)
      }
    },
    async maintain<T>(action: () => Promise<T>): Promise<T> {
      if (clearing) throw Error('Artwork source maintenance already running')
      clearing = true
      generation++
      try {
        await Promise.allSettled([...writes])
        return await action()
      } finally {
        generation++
        clearing = false
      }
    }
  }
}
