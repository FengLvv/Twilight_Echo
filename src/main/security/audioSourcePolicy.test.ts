import assert from 'node:assert/strict'
import test from 'node:test'

const { classifyAudioSource } = (await import(
  new URL('./audioSourcePolicy.ts', import.meta.url).href
)) as typeof import('./audioSourcePolicy.ts')

test('native audio source policy accepts local paths and HTTP(S) streams', () => {
  assert.deepEqual(classifyAudioSource('C:\\Music\\track.flac'), {
    kind: 'local',
    source: 'C:\\Music\\track.flac'
  })
  assert.deepEqual(classifyAudioSource('../Music/track.flac'), {
    kind: 'local',
    source: '../Music/track.flac'
  })
  assert.deepEqual(classifyAudioSource('https://media.example/track.flac?token=abc'), {
    kind: 'remote',
    source: 'https://media.example/track.flac?token=abc'
  })
})

test('native audio source policy rejects file URLs, FFmpeg protocols, and URL credentials', () => {
  assert.throws(() => classifyAudioSource('file:///C:/Music/track.flac'), /not authorized/)
  assert.throws(() => classifyAudioSource('concat:https://one|https://two'), /not authorized/)
  assert.throws(() => classifyAudioSource('data:audio/flac;base64,AAAA'), /not authorized/)
  assert.throws(
    () => classifyAudioSource('https://user:secret@example.test/track.flac'),
    /credentials/
  )
})
