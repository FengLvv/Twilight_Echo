import assert from 'node:assert/strict'
import test from 'node:test'

const { shouldReserveLyricsColumn } = (await import(
  new URL('./nowPlayingLayout.ts', import.meta.url).href
)) as typeof import('./nowPlayingLayout.ts')

test('reserves lyric column while local track lyrics are still lazy-loading', () => {
  assert.equal(
    shouldReserveLyricsColumn({
      source: 'local',
      hasLyrics: false,
      lyrics: null,
      translatedLyrics: null
    }),
    true
  )
})

test('reserves lyric column while provider track lyrics are still lazy-loading', () => {
  assert.equal(
    shouldReserveLyricsColumn({
      source: 'ncm',
      hasLyrics: false,
      lyrics: null,
      translatedLyrics: null
    }),
    true
  )
})

test('does not reserve lyric column after local lyric lookup finished empty', () => {
  assert.equal(
    shouldReserveLyricsColumn({
      source: 'local',
      hasLyrics: false,
      lyrics: '',
      translatedLyrics: null
    }),
    false
  )
})

test('does not reserve lyric column after provider lyric lookup finished empty', () => {
  assert.equal(
    shouldReserveLyricsColumn({
      source: 'ncm',
      hasLyrics: false,
      lyrics: '',
      translatedLyrics: null
    }),
    false
  )
})

test('always reserves lyric column when parsed lyrics exist', () => {
  assert.equal(
    shouldReserveLyricsColumn({
      source: 'local',
      hasLyrics: true,
      lyrics: '[00:01]line',
      translatedLyrics: null
    }),
    true
  )
})
