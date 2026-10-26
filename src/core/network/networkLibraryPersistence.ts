import { coreFsPromises } from '../ports/index.ts'
import { PortableBuffer } from '../../shared/portableBytes.ts'
import { randomUUID } from '../../shared/portableCrypto.ts'
import { dirname } from '../../shared/portablePath.ts'
import { NetworkSourceFailure } from './errors.ts'
import { tryParseJsonWithNestingLimit } from '../../shared/jsonSafety.ts'
import type { NetworkEntry } from '../../shared/networkSources.ts'

interface LibraryProfileIndex {
  roots: string[]
  entries: NetworkEntry[]
}

export type NetworkLibraryDocument = Record<string, LibraryProfileIndex>
export interface NetworkLibraryPersistence {
  load(): Promise<NetworkLibraryDocument>
  save(document: NetworkLibraryDocument): Promise<void>
}

const MAX_INDEX_BYTES = 64 * 1024 * 1024

/** One in-flight read, no retained document cache or stale-file TTL. */
export function createNetworkLibraryPersistence(filePath: string): NetworkLibraryPersistence {
  let reading: Promise<NetworkLibraryDocument> | null = null

  async function readDocument(): Promise<NetworkLibraryDocument> {
    try {
      const file = await coreFsPromises.open(filePath, 'r')
      try {
        if ((await file.stat()).size > MAX_INDEX_BYTES) throw new Error('index is too large')
        const raw = await coreFsPromises.readFile(file, 'utf8')
        if (PortableBuffer.byteLength(raw, 'utf8') > MAX_INDEX_BYTES)
          throw new Error('index is too large')
        const parsed = tryParseJsonWithNestingLimit(raw)
        if (!parsed.ok || !isLibraryDocument(parsed.value)) throw new Error('invalid index')
        return parsed.value
      } finally {
        await file.close()
      }
    } catch (err) {
      if ((err as { code?: string })?.code === 'ENOENT') return {}
      throw new NetworkSourceFailure('network', '网络媒体库索引读取失败')
    }
  }

  return {
    load() {
      if (!reading) {
        const request = readDocument().finally(() => {
          if (reading === request) reading = null
        })
        reading = request
      }
      return reading
    },
    async save(document) {
      const raw = JSON.stringify(document)
      if (PortableBuffer.byteLength(raw, 'utf8') > MAX_INDEX_BYTES) {
        throw new NetworkSourceFailure('network', '网络媒体库索引过大，未写入')
      }
      await coreFsPromises.mkdir(dirname(filePath), { recursive: true })
      const temporary = `${filePath}.${randomUUID()}.tmp`
      try {
        await coreFsPromises.writeFile(temporary, raw, 'utf8')
        // Replace in the same directory. Never unlink the old index on failure.
        await coreFsPromises.rename(temporary, filePath)
      } catch (error) {
        await coreFsPromises.rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
    }
  }
}

function isLibraryDocument(value: unknown): value is NetworkLibraryDocument {
  if (!isRecord(value)) return false
  return Object.values(value).every(
    (profile) =>
      isRecord(profile) &&
      Array.isArray(profile.roots) &&
      profile.roots.every((root) => typeof root === 'string') &&
      Array.isArray(profile.entries) &&
      profile.entries.every(isNetworkLibraryEntry)
  )
}

function isNetworkLibraryEntry(value: unknown): value is NetworkEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.profileId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    (value.kind === 'directory' ||
      value.kind === 'file' ||
      value.kind === 'audio' ||
      value.kind === 'playlist')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
