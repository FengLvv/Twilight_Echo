import type { CommentSong, CommentPage } from '../../shared/ncmComments.ts'
export class NcmClient {
  constructor(options?: { fetcher?: typeof fetch })
  search(query: string, signal?: AbortSignal): Promise<CommentSong[]>
  detail(id: string, signal?: AbortSignal): Promise<CommentSong>
  comments(
    id: string,
    sort: 'hot' | 'latest',
    offset: number,
    signal?: AbortSignal,
    force?: boolean
  ): Promise<CommentPage>
  image(url: string, signal?: AbortSignal): Promise<string | null>
  invalidateComments(id: string): void
  close(): void
}
