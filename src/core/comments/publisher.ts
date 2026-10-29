import { normalizeComment } from './domain.mjs'
import {
  validCommentPublish,
  type CommentAccount,
  type CommentPublish,
  type CommentPublishResult
} from '../../shared/ncmComments.ts'

interface PublisherOptions {
  session(): Promise<{ loggedIn: boolean; cookie?: string }>
  context(): string
  request(path: string, cookie: string, options: { signal?: AbortSignal }): Promise<unknown>
  now?: () => number
}
type Submission = {
  fingerprint: string
  pending: Promise<CommentPublishResult>
  settled: boolean
  at: number
}
const unknownResult = (): CommentPublishResult => ({
  status: 'unknown',
  message: '发布结果暂未确认。请先查看最新评论，确认未发布后再重新发送。'
})

/** Authenticated native writes. A timed out/disconnected write is never replayed. */
export class NativeCommentPublisher {
  private readonly options: PublisherOptions
  private readonly submissions = new Map<string, Submission>()
  constructor(options: PublisherOptions) {
    this.options = options
  }
  async account(signal?: AbortSignal): Promise<CommentAccount> {
    signal?.throwIfAborted()
    const session = await this.options.session()
    signal?.throwIfAborted()
    return {
      loggedIn: session.loggedIn && !!session.cookie,
      context: this.options.context()
    }
  }
  publish(request: CommentPublish, signal?: AbortSignal): Promise<CommentPublishResult> {
    if (!validCommentPublish(request)) return Promise.reject(new Error('评论内容或发布参数无效'))
    signal?.throwIfAborted()
    const fingerprint = JSON.stringify([request.songId, request.content, request.accountContext])
    const previous = this.submissions.get(request.submissionId)
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        return Promise.reject(new Error('请重新确认评论内容后发布'))
      return previous.pending
    }
    const now = (this.options.now ?? Date.now)()
    for (const [id, entry] of this.submissions) {
      if (entry.settled && now - entry.at > 10 * 60 * 1000) this.submissions.delete(id)
    }
    if (this.submissions.size >= 64) return Promise.reject(new Error('发布请求过多，请稍后重试'))
    const entry: Submission = {
      fingerprint,
      pending: Promise.resolve(unknownResult()),
      settled: false,
      at: now
    }
    entry.pending = this.send(request, signal).finally(() => {
      entry.settled = true
    })
    this.submissions.set(request.submissionId, entry)
    return entry.pending
  }
  private async send(request: CommentPublish, signal?: AbortSignal): Promise<CommentPublishResult> {
    const reject = (message: string): CommentPublishResult => ({ status: 'rejected', message })
    if (request.accountContext !== this.options.context())
      return reject('网易云账号已变化，请重新确认登录后发布')
    let session: Awaited<ReturnType<PublisherOptions['session']>>
    try {
      session = await this.options.session()
    } catch {
      signal?.throwIfAborted()
      return reject('暂时无法检查网易云登录状态，请稍后重试')
    }
    signal?.throwIfAborted()
    if (request.accountContext !== this.options.context())
      return reject('网易云账号已变化，请重新确认登录后发布')
    if (!session.loggedIn || !session.cookie) return reject('请先在网易云音乐源中登录，再发布评论')
    // Only add a song comment. No renderer-selected API path, operation, cookie or reply target.
    const query = new URLSearchParams({
      t: '1',
      type: '0',
      id: request.songId,
      content: request.content.trim(),
      timestamp: String((this.options.now ?? Date.now)())
    })
    let response: unknown
    try {
      response = await this.options.request(`/comment?${query}`, session.cookie, { signal })
    } catch {
      return unknownResult()
    }
    if (!response || typeof response !== 'object') return unknownResult()
    const data = response as { code?: unknown; comment?: unknown }
    const code = Number(data.code)
    if (code === 200) return { status: 'published', comment: normalizeComment(data.comment) }
    if (!Number.isFinite(code) || code === -1) return unknownResult()
    if ([301, 401, 403].includes(code))
      return reject('登录已失效或账号暂无评论权限，请重新登录网易云后重试')
    if ([405, 415, 460, 461, -462].includes(code))
      return reject('网易云要求安全验证，请先在官方客户端完成验证后重试')
    return reject(`网易云未接受评论（${code}），请检查内容或稍后重试`)
  }
}
