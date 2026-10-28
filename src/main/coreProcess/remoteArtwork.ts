import {
  getCoverCacheContentType,
  isCoverCacheFileName,
  readCoverCacheFileBytes,
  resizeCoverImageBytes
} from '../library/coverCache.ts'
import { createRemoteMediaRequestHandler } from '../security/remoteMediaGrants.ts'
import { parsePersonalMusicArtwork } from '../../shared/personalMusicArtwork.ts'

const MAX_BYTES = 180_000
const MAX_DATA_URL = 250_000
const SAFE_DATA_URL = /^data:image\/(?:png|jpe?g|webp);base64,/i

/** Phone browsers receive a small raster, never an application grant or source URL. */
export async function resolveRemoteArtwork(
  cover: string | null,
  signal: AbortSignal
): Promise<string | null> {
  if (!cover) return null
  let bytes: Uint8Array, mime: string
  if (SAFE_DATA_URL.test(cover)) {
    if (cover.length <= MAX_DATA_URL) return cover
    const artwork = parsePersonalMusicArtwork(cover)
    if (!artwork) return null
    bytes = Buffer.from(cover.slice(cover.indexOf(',') + 1), 'base64')
    mime = artwork.mime
  } else if (cover.startsWith('cover://')) {
    const fileName = cover.slice('cover://'.length)
    if (!isCoverCacheFileName(fileName)) return null
    const cached = await readCoverCacheFileBytes(fileName)
    if (!cached) return null
    bytes = cached
    mime = getCoverCacheContentType(fileName)
  } else if (cover.startsWith('twilight-media://image/')) {
    const response = await createRemoteMediaRequestHandler({ fetch: globalThis.fetch })(
      new Request(cover, { signal })
    )
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    bytes = new Uint8Array(await response.arrayBuffer())
    mime = response.headers.get('content-type')?.split(';')[0] ?? ''
  } else return null
  signal.throwIfAborted()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return null
  if (bytes.length > MAX_BYTES) {
    const resized = resizeCoverImageBytes(bytes, mime)
    if (!resized) return null
    bytes = resized.bytes
    mime = resized.mime
  }
  const result = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
  return result.length <= MAX_DATA_URL ? result : null
}
