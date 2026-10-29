import type {
  CommentsRead,
  CommentsEdit,
  CommentsResult,
  SongAssociation
} from '../../shared/ncmComments.ts'
import type { CommentTrack as TrackData } from '../../shared/ncmComments.ts'
import type { CommentPublish } from '../../shared/ncmComments.ts'
import type { NativeCommentPublisher } from './publisher.ts'
import { NcmClient } from './client.mjs'
import { AssociationStore } from './store.mjs'
import {
  automaticMatch,
  explicitSongId,
  parseSongLink,
  rankCandidates,
  trackFingerprint,
  validateTrack
} from './domain.mjs'

/** Native Core service. Anonymous transport and associations are independent of plugins. */
export class NativeCommentsService {
  private ready: Promise<void>
  private store: AssociationStore
  private client: NcmClient
  private lookup: (id: string) => Promise<TrackData | undefined>
  private publisher?: NativeCommentPublisher
  constructor(
    store: AssociationStore,
    client: NcmClient,
    lookup: (id: string) => Promise<TrackData | undefined>,
    publisher?: NativeCommentPublisher
  ) {
    this.store = store
    this.client = client
    this.lookup = lookup
    this.publisher = publisher
    this.ready = store.load()
    void this.ready.catch(() => {})
  }
  account(signal?: AbortSignal) {
    if (!this.publisher) return Promise.resolve({ loggedIn: false, context: 'unavailable' })
    return this.publisher.account(signal)
  }
  async publish(request: CommentPublish, signal?: AbortSignal) {
    if (!this.publisher) throw new Error('评论发布服务不可用')
    const result = await this.publisher.publish(request, signal)
    if (result.status === 'published') this.client.invalidateComments(request.songId)
    return result
  }
  async request(
    request: CommentsRead | CommentsEdit,
    signal: AbortSignal
  ): Promise<CommentsResult> {
    await this.ready
    signal.throwIfAborted()
    if (request.operation === 'image') return this.client.image(request.url, signal)
    if (request.operation === 'comments')
      return this.client.comments(
        request.songId,
        request.sort,
        request.offset,
        signal,
        request.force
      )
    let track = validateTrack(request.track)
    if (!explicitSongId(track)) track = validateTrack((await this.lookup(track.id)) ?? track)
    signal.throwIfAborted()
    const fingerprint = trackFingerprint(track)
    if (request.operation === 'unlink') {
      await this.store.set(track.id, { kind: 'paused' })
      return { kind: 'paused', track, candidates: [] }
    }
    if (request.operation === 'associate') {
      const id = parseSongLink(request.value)
      if (!id) throw new Error('请输入网易云歌曲链接或歌曲 ID')
      const song = await this.client.detail(id, signal)
      signal.throwIfAborted()
      await this.store.set(track.id, { kind: 'manual', fingerprint, song })
      return { kind: 'manual', track, song }
    }
    if (request.operation === 'search')
      return rankCandidates(track, await this.client.search(request.query, signal))
    if (request.operation === 'resolve') {
      const id = explicitSongId(track)
      if (id)
        return {
          kind: 'explicit',
          track,
          song: {
            id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration
          }
        }
      const saved = this.store.get(track.id)
      if (saved?.kind === 'paused') return { kind: 'paused', track, candidates: [] }
      if (saved?.song && (saved.kind === 'manual' || saved.fingerprint === fingerprint))
        return { kind: saved.kind, track, song: saved.song }
    }
    const candidates = rankCandidates(
      track,
      await this.client.search(`${track.title} ${track.artist}`, signal)
    )
    signal.throwIfAborted()
    const song = request.operation === 'resolve' ? automaticMatch(track, candidates) : null
    if (song) {
      await this.store.set(track.id, { kind: 'auto', fingerprint, song })
      return { kind: 'auto', track, song } satisfies SongAssociation
    }
    return { kind: 'choose', track, candidates }
  }
}
