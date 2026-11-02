import assert from 'node:assert/strict'
import test from 'node:test'

const { parseM3uPlaylist, parsePlsPlaylist, parseRadioPlaylist } = (await import(
  new URL('./playlistImport.ts', import.meta.url).href
)) as typeof import('./playlistImport.ts')

test('parses M3U playlist with EXTINF titles', () => {
  const text = `#EXTM3U
#EXTINF:-1,Jazz FM
https://stream.example/jazz
#EXTINF:-1,News
http://stream.example/news
# comment
not-a-url
`
  const entries = parseM3uPlaylist(text)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0], { name: 'Jazz FM', streamUrl: 'https://stream.example/jazz' })
  assert.equal(entries[1].name, 'News')
})

test('parses PLS playlist File/Title pairs', () => {
  const text = `[playlist]
NumberOfEntries=2
File1=https://a.example/1
Title1=Alpha
File2=https://b.example/2
Title2=Beta
Version=2
`
  const entries = parsePlsPlaylist(text)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].name, 'Alpha')
  assert.equal(entries[1].streamUrl, 'https://b.example/2')
})

test('parseRadioPlaylist chooses PLS by hint or content', () => {
  const pls = parseRadioPlaylist('File1=https://x.example/s\nTitle1=X', 'stations.pls')
  assert.equal(pls[0].name, 'X')
  const m3u = parseRadioPlaylist('https://y.example/s\n', 'stations.m3u')
  assert.equal(m3u[0].streamUrl, 'https://y.example/s')
})
