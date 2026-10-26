import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaSessionSentinel, silentWavDataUri } from './mediaSessionSentinel.ts'

type FakeAudio = HTMLAudioElement & {
  playedCount: number
  pausedCount: number
  loadedCount: number
  removedSrc: boolean
  playError?: Error
}

function fakeAudio(playError?: Error): FakeAudio {
  const audio = {
    src: '',
    muted: true,
    volume: 1,
    loop: false,
    preload: '',
    playedCount: 0,
    pausedCount: 0,
    loadedCount: 0,
    removedSrc: false,
    playError,
    play() {
      audio.playedCount++
      return audio.playError ? Promise.reject(audio.playError) : Promise.resolve()
    },
    pause() {
      audio.pausedCount++
    },
    load() {
      audio.loadedCount++
    },
    removeAttribute(name: string) {
      if (name === 'src') audio.removedSrc = true
    }
  }
  return audio as unknown as FakeAudio
}

test('the sentinel source is a well-formed silent PCM WAV', () => {
  const uri = silentWavDataUri()
  assert.match(uri, /^data:audio\/wav;base64,/)
  const buffer = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64')
  assert.equal(buffer.subarray(0, 4).toString(), 'RIFF')
  assert.equal(buffer.subarray(8, 12).toString(), 'WAVE')
  assert.equal(buffer.subarray(12, 16).toString(), 'fmt ')
  assert.equal(buffer.subarray(36, 40).toString(), 'data')
  // Declared chunk sizes must match the payload exactly, otherwise Chromium
  // rejects the source and publishes no MPRIS player.
  assert.equal(buffer.readUInt32LE(4), buffer.length - 8)
  assert.equal(buffer.readUInt32LE(40), buffer.length - 44)
  // 8-bit PCM silence is the unsigned midpoint, not zero.
  assert.equal(buffer.subarray(44).every((byte) => byte === 0x80), true)
  assert.ok(buffer.length < 2048, 'sentinel payload should stay small')
})

test('the sentinel plays unmuted at zero volume, which is what publishes MPRIS', () => {
  const audio = fakeAudio()
  const sentinel = createMediaSessionSentinel({ createElement: () => audio as never })
  sentinel.arm()
  // muted === true publishes no player at all, so silence must come from volume.
  assert.equal(audio.muted, false)
  assert.equal(audio.volume, 0)
  assert.equal(audio.loop, true)
  assert.match(audio.src, /^data:audio\/wav;base64,/)
  assert.equal(audio.playedCount, 1)
})

test('arming twice keeps one element and dispose releases it', () => {
  const created: FakeAudio[] = []
  const sentinel = createMediaSessionSentinel({
    createElement: () => {
      const audio = fakeAudio()
      created.push(audio)
      return audio as never
    }
  })
  sentinel.arm()
  sentinel.arm()
  assert.equal(created.length, 1)
  sentinel.dispose()
  const audio = created[0]!
  assert.equal(audio.pausedCount, 1)
  assert.equal(audio.removedSrc, true)
  assert.equal(audio.loadedCount, 1)
  // Disposing twice must not throw or touch the element again.
  sentinel.dispose()
  assert.equal(audio.pausedCount, 1)
})

test('a blocked autoplay is reported without breaking the caller and retries on a later arm', async () => {
  const errors: unknown[] = []
  let created = 0
  const audio = fakeAudio(new Error('NotAllowedError'))
  const sentinel = createMediaSessionSentinel({
    createElement: () => {
      created++
      return audio as never
    },
    onError: (error) => errors.push(error)
  })
  sentinel.arm()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]), /NotAllowedError/)
  assert.equal(audio.playedCount, 1)
  audio.playError = undefined
  sentinel.arm()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(created, 1)
  assert.equal(audio.playedCount, 2)
  sentinel.dispose()
})

test('required: false short-circuits so non-Linux platforms stay untouched', () => {
  let created = 0
  const sentinel = createMediaSessionSentinel({
    required: false,
    createElement: () => {
      created++
      return fakeAudio() as never
    }
  })
  sentinel.arm()
  sentinel.dispose()
  assert.equal(created, 0)
})
