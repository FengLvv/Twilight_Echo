import type { RemoteMediaPlan, RemoteMediaReference } from '../../shared/remoteMedia.ts'
import type { TrackData } from '../../shared/track.ts'
import type { MediaStreamGrantStore } from '../cast/mediaTokens.ts'
/** Filesystem generation, not a title/path identity or a content-integrity digest. */
export interface MediaFileGeneration {
  dev?: number
  ino?: number
  size: number
  mtimeMs: number
  ctimeMs: number
}
export declare function mediaSourceVersion(stat: MediaFileGeneration): string
/** Exact-source resolution never starts or edits the desktop playback session. */
export declare class RemoteMediaResolver {
  constructor(options: {
    libraryId: string
    resolve(sourceId: string): Promise<TrackData | null>
    authorizeFile(path: string): Promise<string>
    grants: MediaStreamGrantStore
    now?(): number
  })
  get libraryId(): string
  resolve(reference: RemoteMediaReference, principal: string): Promise<RemoteMediaPlan>
}
