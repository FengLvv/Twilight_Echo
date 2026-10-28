/** Durable source reference; URLs and access tickets are deliberately not part of it. */
export interface RemoteMediaReference {
  libraryId: string
  sourceId: string
  sourceVersion?: string
}

export interface RemoteMediaPlan extends Required<RemoteMediaReference> {
  contentPath: string
  contentType: 'audio/flac' | 'audio/mpeg'
  size: number
  expiresAt: number
  maxRangeBytes: number
}

export const REMOTE_STREAM_TTL_MS = 15 * 60_000
export const REMOTE_STREAM_RANGE_BYTES = 256 * 1024
