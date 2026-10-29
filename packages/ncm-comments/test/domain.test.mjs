import test from 'node:test'
import assert from 'node:assert/strict'
import {
  automaticMatch,
  explicitSongId,
  parseSongLink,
  normalizeCandidate,
  normalizeComment,
  mergeComments,
  trackFingerprint
} from '../lib/domain.mjs'
const track = { id: 'local:one', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269 }
const candidate = { ...track, id: '186016', duration: 270 }

test('auto matching requires a unique matching recording with full metadata', () => {
  assert.equal(automaticMatch(track, [candidate])?.id, '186016')
  assert.equal(automaticMatch(track, [candidate, { ...candidate, id: '2' }]), null)
  for (const patch of [
    { artist: '翻唱歌手' },
    { album: '现场专辑' },
    { title: '晴天 (Live)' },
    { title: '晴天 (Remastered)' },
    { title: '晴天 (伴奏)' },
    { duration: 272 }
  ]) {
    assert.equal(automaticMatch(track, [{ ...candidate, ...patch }]), null)
  }
  for (const patch of [{ artist: '' }, { album: '' }, { duration: 0 }])
    assert.equal(automaticMatch({ ...track, ...patch }, [candidate]), null)
  assert.equal(
    automaticMatch({ ...track, title: ' Song！', artist: ' ARTIST ', album: 'Album' }, [
      { ...candidate, title: 'song', artist: 'artist', album: 'album' }
    ])?.id,
    '186016'
  )
})

test('IDs and links are scoped to real NetEase song pages', () => {
  assert.equal(explicitSongId({ id: 'ncm:186016' }), '186016')
  assert.equal(explicitSongId({ id: 'local:x', ncmSongId: 186016 }), '186016')
  for (const value of [
    '186016',
    'https://music.163.com/song?id=186016',
    'https://music.163.com/#/song?id=186016',
    'https://y.music.163.com/m/song?id=186016'
  ])
    assert.equal(parseSongLink(value), '186016')
  for (const value of [
    '-1',
    '0',
    'Infinity',
    'https://music.163.com.evil.test/song?id=186016',
    'https://music.163.com/album?id=186016',
    'https://user@music.163.com/song?id=186016'
  ])
    assert.equal(parseSongLink(value), null)
})

test('candidate units, comment replies, deduplication and metadata fingerprints', () => {
  assert.equal(
    normalizeCandidate({
      id: 1,
      name: 'song',
      dt: 120000,
      ar: [{ name: 'artist' }],
      al: { name: 'album' }
    }).duration,
    120
  )
  const comment = normalizeComment({
    commentId: 1,
    content: '<script>unsafe</script>',
    user: { nickname: 'A' },
    beReplied: [{ user: { nickname: 'B' }, content: 'reply' }]
  })
  assert.equal(comment.content, '<script>unsafe</script>')
  assert.equal(comment.replies[0].nickname, 'B')
  assert.equal(normalizeComment({ content: 'missing id' }), null)
  assert.deepEqual(
    mergeComments([comment], [comment, { ...comment, id: '2' }]).map((item) => item.id),
    ['1', '2']
  )
  assert.notEqual(trackFingerprint(track), trackFingerprint({ ...track, album: 'new album' }))
})
