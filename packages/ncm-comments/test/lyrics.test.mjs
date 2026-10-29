import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLyrics, currentLyric } from '../ui/lyrics.js'
test('lyrics preserve words, repeated timestamps and metadata offsets', () => {
  const lines = parseLyrics(
    '[ar:Artist]\n[offset:500]\n[00:01.20][00:03.40]第一句\n[00:02.00]<00:02.00>第二句'
  )
  assert.deepEqual(
    lines.map((line) => line.time),
    [1.7, 2.5, 3.9]
  )
  assert.deepEqual(
    lines.map((line) => line.text),
    ['第一句', '第二句', '第一句']
  )
  assert.equal(currentLyric(lines, 2.7), 1)
  assert.equal(currentLyric(lines, 0), -1)
  assert.equal(parseLyrics('没有时间戳的歌词')[0].text, '没有时间戳的歌词')
  assert.equal(parseLyrics('[00:01.00]保留 [Chorus] 段落标记')[0].text, '保留 [Chorus] 段落标记')
})
test('TTML is decoded as text with line timing, without executing markup', () => {
  const lines = parseLyrics(
    '<tt><body><p begin="00:01.200"><span>夜 &amp; 光</span><br/>歌词</p><p begin="2500ms">第二句</p></body></tt>'
  )
  assert.deepEqual(lines, [
    { time: 1.2, text: '夜 & 光\n歌词' },
    { time: 2.5, text: '第二句' }
  ])
})
