import type { TrackData } from './track.ts'
export type CommentTrack = Pick<TrackData, 'id' | 'title' | 'artist' | 'album' | 'duration'> &
  Partial<Pick<TrackData, 'ncmSongId' | 'source'>>
export interface CommentSong {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  version?: string
  coverUrl?: string
}
export interface MusicComment {
  id: string
  content: string
  nickname: string
  avatarUrl: string
  time: number
  likes: number
  replies: { nickname: string; content: string }[]
}
export interface CommentPage {
  items: MusicComment[]
  total: number
  nextOffset: number
  hasMore: boolean
}
export const NCM_COMMENT_MAX_LENGTH = 140
export interface CommentAccount {
  loggedIn: boolean
  context: string
}
export interface CommentPublish {
  songId: string
  content: string
  submissionId: string
  accountContext: string
}
export type CommentPublishResult =
  | { status: 'published'; comment: MusicComment | null }
  | { status: 'rejected' | 'unknown'; message: string }
export function validCommentPublish(value: unknown): value is CommentPublish {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return (
    Object.keys(r).every((key) =>
      ['songId', 'content', 'submissionId', 'accountContext'].includes(key)
    ) &&
    typeof r.songId === 'string' &&
    /^[1-9]\d{0,15}$/.test(r.songId) &&
    typeof r.content === 'string' &&
    r.content.length <= NCM_COMMENT_MAX_LENGTH * 2 &&
    r.content.trim().length > 0 &&
    Array.from(r.content.trim()).length <= NCM_COMMENT_MAX_LENGTH &&
    !r.content.includes('\0') &&
    typeof r.submissionId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.submissionId) &&
    typeof r.accountContext === 'string' &&
    r.accountContext.length > 0 &&
    r.accountContext.length <= 1024
  )
}
export interface SongAssociation {
  kind: 'explicit' | 'manual' | 'auto' | 'paused' | 'choose'
  track: CommentTrack
  song?: CommentSong
  candidates?: CommentSong[]
}
export type CommentsRead =
  | { operation: 'resolve' | 'rematch'; track: CommentTrack }
  | { operation: 'search'; track: CommentTrack; query: string }
  | {
      operation: 'comments'
      songId: string
      sort: 'hot' | 'latest'
      offset: number
      force?: boolean
    }
  | { operation: 'image'; url: string }
export type CommentsEdit = {
  operation: 'associate' | 'unlink'
  track: CommentTrack
  value?: string
}
export type CommentsResult = SongAssociation | CommentSong[] | CommentPage | string | null
export function validCommentsRequest(value: unknown, edit: boolean): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  if (
    edit
      ? !['associate', 'unlink'].includes(String(r.operation))
      : !['resolve', 'rematch', 'search', 'comments', 'image'].includes(String(r.operation))
  )
    return false
  if (r.operation === 'comments')
    return (
      /^[1-9]\d{0,15}$/.test(String(r.songId)) &&
      ['hot', 'latest'].includes(String(r.sort)) &&
      Number.isSafeInteger(r.offset) &&
      Number(r.offset) >= 0 &&
      Number(r.offset) <= 10000000 &&
      (r.force === undefined || typeof r.force === 'boolean')
    )
  if (r.operation === 'image') return typeof r.url === 'string' && r.url.length <= 4096
  const track = r.track as Record<string, unknown> | undefined
  if (
    !track ||
    typeof track !== 'object' ||
    typeof track.id !== 'string' ||
    !track.id ||
    track.id.length > 512
  )
    return false
  if (r.operation === 'search') return typeof r.query === 'string' && r.query.length <= 200
  return r.operation !== 'associate' || (typeof r.value === 'string' && r.value.length <= 4096)
}
