import assert from 'node:assert/strict'
import test from 'node:test'

const { getLogicalTrackKey, normalizeLogicalTrackText } = (await import(
  new URL('./logicalTrackIdentity.ts', import.meta.url).href
)) as typeof import('./logicalTrackIdentity.ts')

test('getLogicalTrackKey normalizes title and artist for cross-source identity', () => {
  assert.equal(
    getLogicalTrackKey({
      id: 'ncm:123',
      title: ' Moon  River ',
      artist: 'AUDREY'
    }),
    'logic:moon river::audrey'
  )
})

test('getLogicalTrackKey falls back to track id when title or artist is missing', () => {
  assert.equal(
    getLogicalTrackKey({
      id: 'local:hash',
      title: 'Moon River',
      artist: ''
    }),
    'local:hash'
  )
})

test('normalizeLogicalTrackText uses compatibility normalization and compact whitespace', () => {
  assert.equal(normalizeLogicalTrackText(' Ｍｏｏｎ　  River  '), 'moon river')
})
