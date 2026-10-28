import { coreFs, type PortableStats } from '../ports/index.ts'
import { extname } from '../../shared/portablePath.ts'
import { guessAudioContentType, type MediaStreamGrantStore } from '../cast/mediaTokens.ts'
import type { TrackData } from '../../shared/track.ts'
import { REMOTE_STREAM_RANGE_BYTES, REMOTE_STREAM_TTL_MS,
  type RemoteMediaPlan, type RemoteMediaReference } from '../../shared/remoteMedia.ts'

const fail = (code: string) => Object.assign(new Error(code), { code })

/** Filesystem generation, not a title/path identity or a content-integrity digest. */
export function mediaSourceVersion(stat: PortableStats): string {
  return `f1-${stat.dev ?? 0}-${stat.ino ?? 0}-${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`
}

/** Exact-source resolution never starts or edits the desktop playback session. */
export class RemoteMediaResolver {
  private readonly options: {
    libraryId: string
    resolve(sourceId: string): Promise<TrackData | null>
    authorizeFile(path: string): Promise<string>
    grants: MediaStreamGrantStore
    now?(): number
  }
  constructor(options: RemoteMediaResolver['options']) { this.options = options }

  get libraryId(): string { return this.options.libraryId }

  async resolve(reference: RemoteMediaReference, principal: string): Promise<RemoteMediaPlan> {
    if (reference.libraryId !== this.libraryId) throw fail('NOT_FOUND')
    const track = await this.options.resolve(reference.sourceId)
    if (!track) throw fail('NOT_FOUND')
    if ((track.source && track.source !== 'local') || track.subTrack || track.cueRange ||
      !['.flac', '.mp3'].includes(extname(track.filePath).toLowerCase()))
      throw fail('UNSUPPORTED_CAPABILITY')
    const path = await this.options.authorizeFile(track.filePath)
    const stat = await coreFs.promises.stat(path).catch(() => { throw fail('NOT_FOUND') })
    if (!stat.isFile() || stat.size <= 0) throw fail('NOT_FOUND')
    const sourceVersion = mediaSourceVersion(stat)
    if (reference.sourceVersion && reference.sourceVersion !== sourceVersion) throw fail('SOURCE_CHANGED')
    const expiresAt = (this.options.now?.() ?? Date.now()) + REMOTE_STREAM_TTL_MS
    const contentType = guessAudioContentType(path) as RemoteMediaPlan['contentType']
    const token = this.options.grants.issueFile(path, { contentType, ttlMs: REMOTE_STREAM_TTL_MS,
      stream: { principal, libraryId: this.libraryId, sourceId: reference.sourceId, sourceVersion } })
    return { libraryId: this.libraryId, sourceId: reference.sourceId, sourceVersion,
      contentPath: `/media/${token}`, contentType, size: stat.size, expiresAt,
      maxRangeBytes: REMOTE_STREAM_RANGE_BYTES }
  }
}
