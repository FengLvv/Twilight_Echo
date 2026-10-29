import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommentDrafts } from './commentDrafts.ts'
import type { CommentPublishResult } from '../../../../shared/ncmComments.ts'
test('drafts survive remount and song changes; a late send clears only its captured song', async () => {
  let finish!: (result: CommentPublishResult) => void
  const requests: string[] = []
  const drafts = createCommentDrafts(
    (request) => {
      requests.push(request.songId)
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    undefined,
    () => 'unique'
  )
  drafts.get('42').text = 'First song'
  const first = drafts.submit('42', 'account')
  assert.equal(drafts.submit('42', 'account'), first)
  drafts.get('43').text = 'Other song'
  await Promise.resolve()
  assert.equal(drafts.get('42').text, 'First song')
  assert.equal(drafts.get('42').sending, true)
  finish({ status: 'published', comment: null })
  await first
  assert.equal(drafts.get('42').text, '')
  assert.equal(drafts.get('43').text, 'Other song')
  assert.deepEqual(requests, ['42'])
})
test('unknown sends retain drafts and retry requires a fresh explicit submission', async () => {
  const ids: string[] = []
  const drafts = createCommentDrafts(
    async (request) => {
      ids.push(request.submissionId)
      throw Error('Connection lost')
    },
    undefined,
    () => `id-${ids.length}`
  )
  drafts.get('42').text = 'Keep me'
  await drafts.submit('42', 'account')
  assert.equal(drafts.get('42').text, 'Keep me')
  assert.equal(drafts.get('42').result?.status, 'unknown')
  assert.equal(ids.length, 1)
  await drafts.submit('42', 'account')
  assert.deepEqual(ids, ['id-0', 'id-1'])
})
test('empty and excessive drafts never dispatch', async () => {
  let called = 0
  const drafts = createCommentDrafts(async () => {
    called++
    return { status: 'published', comment: null }
  })
  await drafts.submit('42', 'account')
  drafts.get('42').text = 'x'.repeat(141)
  await drafts.submit('42', 'account')
  assert.equal(called, 0)
})
