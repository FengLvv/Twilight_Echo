import {
  NCM_COMMENT_MAX_LENGTH,
  type CommentPublish,
  type CommentPublishResult
} from '../../../../shared/ncmComments.ts'

export interface CommentDraft {
  text: string
  sending: boolean
  result: CommentPublishResult | null
}
/** Drafts and in-flight sends survive scroll-driven component unmounts. */
export function createCommentDrafts(
  publish: (request: CommentPublish) => Promise<CommentPublishResult>,
  wrap: (draft: CommentDraft) => CommentDraft = (value) => value,
  makeId: () => string = () => crypto.randomUUID()
) {
  const drafts = new Map<string, CommentDraft>()
  const pending = new Map<string, Promise<CommentPublishResult | null>>()
  function get(songId: string): CommentDraft {
    let draft = drafts.get(songId)
    if (!draft) {
      if (drafts.size >= 32) {
        const expired = [...drafts].find(([, value]) => !value.sending)?.[0]
        if (expired) drafts.delete(expired)
      }
      draft = wrap({ text: '', sending: false, result: null })
      drafts.set(songId, draft)
    }
    return draft
  }
  function submit(songId: string, accountContext: string): Promise<CommentPublishResult | null> {
    const running = pending.get(songId)
    if (running) return running
    const draft = get(songId)
    const content = draft.text.trim()
    if (!content || Array.from(content).length > NCM_COMMENT_MAX_LENGTH)
      return Promise.resolve(null)
    draft.sending = true
    draft.result = null
    const work = Promise.resolve()
      .then(() => publish({ songId, content, accountContext, submissionId: makeId() }))
      .catch(
        (): CommentPublishResult => ({
          status: 'unknown',
          message: '发布结果暂未确认。请先查看最新评论，确认未发布后再重新发送。'
        })
      )
      .then((result) => {
        draft.result = result
        if (result.status === 'published') draft.text = ''
        return result
      })
      .finally(() => {
        draft.sending = false
        pending.delete(songId)
      })
    pending.set(songId, work)
    return work
  }
  return { get, submit }
}
