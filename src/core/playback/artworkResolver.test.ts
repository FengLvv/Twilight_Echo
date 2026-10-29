import assert from 'node:assert/strict'
import test from 'node:test'
import type { TrackData } from '../../shared/track.ts'
import { createTrackArtworkResolver } from './artworkResolver.ts'
import { createArtworkProjection } from '../../main/coreProcess/artworkProjection.ts'
import { createQueueInputResolver } from './queueInputResolver.ts'
import { libraryTrack } from './libraryTrack.ts'
import { saveQueueTrack, restoreQueueTrackIdentity } from '../workspace/tracks.ts'
import { CorePlayerPresentationService } from './presentationService.ts'

const signal = () => new AbortController().signal
const song = (id = 42): TrackData => ({
  id: `ncm:${id}`,
  source: 'ncm',
  ncmSongId: id,
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  filePath: '',
  fileName: 'Song',
  size: 0,
  cover: null,
  lyrics: null
})
const details = (ids: number[]) => ({
  code: 200,
  songs: ids.map((id) => ({ id, al: { picUrl: `https://p1.music.126.net/${id}.jpg` } }))
})
const turn = () => new Promise<void>((resolve) => setImmediate(resolve))
function fixture(extra: Partial<Parameters<typeof createTrackArtworkResolver>[0]> = {}) {
  const present = createArtworkProjection({
    normalizeCachedCover: async (handle) => handle,
    migrateBase64Cover: () => null,
    resolve: () => {
      throw Error('Old session')
    },
    grant: (source) => `twilight-media://image/${new URL(source).pathname.slice(1)}`
  })
  return createTrackArtworkResolver({
    present: (source, abort) =>
      present({ ...source, coverSource: source.coverSource ?? null }, abort),
    local: async () => null,
    ncm: async (ids) => details(ids),
    search: async () => ({ items: [] }),
    ...extra
  })
}

test('identity-only list playback and saved queue restoration recover the same player artwork', async (t) => {
  const resolveInput = createQueueInputResolver({
    database: {
      getTracksByIds: async () => {
        throw Error('No local lookup')
      },
      readLibraryQueue: async () => {
        throw Error('No occurrence lookup')
      }
    },
    providers: () => new Set(['ncm']),
    authorizeLocal: async (path) => path,
    streams: () => new Map(),
    network: async () => {
      throw Error('No network source')
    }
  })
  const [item] = await resolveInput(
    [
      {
        kind: 'provider',
        track: {
          id: 'ncm:42',
          source: 'ncm',
          ncmSongId: 42,
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          duration: 180
        }
      }
    ],
    signal()
  )
  assert.ok(item.snapshot)
  const queued = libraryTrack(item.snapshot)
  assert.equal(queued.cover, null)
  const restored = restoreQueueTrackIdentity(saveQueueTrack(queued, () => 'saved'))
  const service = new CorePlayerPresentationService({
    artwork: fixture(),
    playlists: { isFavorite: async () => false, toggleFavorite: async () => false },
    supportedMethods: () => [],
    callProvider: async () => null,
    changed: () => {},
    failed: (error) => assert.fail(String(error))
  })
  t.after(() => service.shutdown())
  for (const [index, track] of [queued, restored].entries()) {
    service.observe(track, `occurrence:${index}`)
    await turn()
    assert.equal(service.snapshot().cover, 'twilight-media://image/42.jpg')
    assert.doesNotMatch(JSON.stringify(service.snapshot()), /https:|music\.126/)
  }
})

test('cached local artwork wins; restored local identities use current library artwork without searching', async () => {
  let locals = 0
  const resolve = fixture({
    local: async (id) => {
      locals++
      assert.equal(id, 'local:1')
      return { cover: 'cover://current.jpg' }
    },
    ncm: async () => {
      throw Error('No provider lookup')
    },
    search: async () => {
      throw Error('No search')
    }
  })
  const local = { ...song(), id: 'local:1', source: 'local', cover: 'cover://existing.jpg' }
  assert.equal((await resolve(local, signal())).cover, 'cover://existing.jpg')
  assert.equal(locals, 0)
  assert.equal((await resolve({ ...local, cover: null }, signal())).cover, 'cover://current.jpg')
  assert.equal(locals, 1)
})

test('expired image handles recover by exact provider identity and prefer durable origins', async () => {
  let calls = 0
  const resolve = fixture({
    ncm: async (ids) => {
      calls++
      return details(ids)
    }
  })
  assert.equal(
    (await resolve({ ...song(), cover: 'twilight-media://image/old' }, signal())).cover,
    'twilight-media://image/42.jpg'
  )
  assert.equal(
    (
      await resolve(
        {
          ...song(),
          cover: 'twilight-media://image/old',
          coverSource: 'https://p1.music.126.net/durable.jpg'
        },
        signal()
      )
    ).cover,
    'twilight-media://image/durable.jpg'
  )
  assert.equal(calls, 1)
})

test('other providers require exact provider and track IDs, never a title-only cover', async () => {
  const target = { ...song(), id: 'custom:42', source: 'custom', ncmSongId: undefined }
  let now = 0,
    correct = false
  const resolve = fixture({
    now: () => now,
    search: async (provider) => {
      assert.equal(provider, 'custom')
      return {
        items: [
          { ...target, id: 'custom:43', cover: 'https://cdn.test/wrong-title.jpg' },
          { ...target, source: 'other', cover: 'https://cdn.test/wrong-provider.jpg' },
          ...(correct ? [{ ...target, cover: 'https://cdn.test/correct.jpg' }] : [])
        ]
      }
    }
  })
  assert.equal((await resolve(target, signal())).cover, null)
  correct = true
  now = 30_001
  assert.equal((await resolve(target, signal())).cover, 'twilight-media://image/correct.jpg')
})

test('NetEase detail batches and image grants stay bounded, deduplicated and identity-correct across rankings', async () => {
  const batches: number[][] = []
  let active = 0,
    maxActive = 0,
    images = 0,
    maxImages = 0
  const resolve = fixture({
    ncm: async (ids) => {
      batches.push(ids)
      active++
      maxActive = Math.max(maxActive, active)
      await turn()
      active--
      return details([...ids].reverse())
    },
    present: async (source) => {
      images++
      maxImages = Math.max(maxImages, images)
      await turn()
      images--
      return {
        cover: source.coverSource!.replace('https://p1.music.126.net/', 'twilight-media://image/')
      }
    }
  })
  const requests = Array.from({ length: 3 }, () =>
    Array.from({ length: 200 }, (_, index) => song(index + 1))
  ).flat()
  const results = await Promise.all(requests.map((track) => resolve(track, signal())))
  assert.equal(batches.flat().length, 200)
  assert.ok(batches.every((ids) => ids.length <= 50))
  assert.ok(maxActive <= 3)
  assert.ok(maxImages <= 6)
  results.forEach((result, index) =>
    assert.equal(result.cover, `twilight-media://image/${(index % 200) + 1}.jpg`)
  )
})

test('one cancelled consumer does not abort another; an abandoned batch is cancelled', async () => {
  let release!: () => void
  let started!: () => void
  let remoteSignal!: AbortSignal
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const resolve = fixture({
    ncm: async (ids, abort) => {
      remoteSignal = abort
      started()
      await new Promise<void>((done) => {
        release = done
      })
      return details(ids)
    }
  })
  const first = new AbortController(),
    second = new AbortController()
  const a = resolve(song(), first.signal),
    b = resolve(song(), second.signal)
  await ready
  first.abort()
  await assert.rejects(a, { name: 'AbortError' })
  assert.equal(remoteSignal.aborted, false)
  release()
  assert.equal((await b).cover, 'twilight-media://image/42.jpg')
  const third = new AbortController()
  const c = resolve(song(43), third.signal)
  await turn()
  third.abort()
  await assert.rejects(c, { name: 'AbortError' })
  assert.equal(remoteSignal.aborted, true)
  release()
})

test('late provider details cannot overwrite a newer playback occurrence', async (t) => {
  let release!: () => void
  const resolve = fixture({
    ncm: async (ids) => {
      if (ids.includes(42))
        await new Promise<void>((done) => {
          release = done
        })
      return details(ids)
    }
  })
  const service = new CorePlayerPresentationService({
    artwork: resolve,
    playlists: { isFavorite: async () => false, toggleFavorite: async () => false },
    supportedMethods: () => [],
    callProvider: async () => null,
    changed: () => {},
    failed: () => {}
  })
  t.after(() => service.shutdown())
  service.observe(song(42), 'old')
  await turn()
  service.observe(song(43), 'new')
  await turn()
  assert.equal(service.snapshot().cover, 'twilight-media://image/43.jpg')
  release()
  await turn()
  assert.equal(service.snapshot().cover, 'twilight-media://image/43.jpg')
})

test('foreground playback does not wait behind queued background artwork searches', async () => {
  const started: string[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const resolve = fixture({
    search: async (_provider, query) => {
      started.push(query)
      if (started.length <= 3) await gate
      return { items: [] }
    }
  })
  const track = (title: string) => ({ ...song(), id: `custom:${title}`, source: 'custom', title })
  const background = Array.from({ length: 6 }, (_, index) =>
    resolve(track(`background-${index}`), signal())
  )
  await turn()
  const foreground = resolve(track('playing'), signal(), true)
  release()
  await Promise.all([...background, foreground])
  assert.equal(started[3], 'playing Artist')
})

test('API failures and missing/invalid IDs recover after cooldown and never borrow a different song', async () => {
  let now = 0,
    fail = true,
    calls = 0
  const resolve = fixture({
    now: () => now,
    ncm: async (ids) => {
      calls++
      if (fail) return { code: 500 }
      return { code: 200, songs: [...details(ids).songs, ...details([99]).songs] }
    }
  })
  await assert.rejects(resolve(song(), signal()), /封面读取失败/)
  assert.equal((await resolve(song(), signal())).cover, null)
  assert.equal(calls, 1)
  now = 30_001
  fail = false
  assert.equal((await resolve(song(), signal())).cover, 'twilight-media://image/42.jpg')
  assert.equal(
    (await resolve({ ...song(), id: 'ncm:invalid', ncmSongId: undefined }, signal())).cover,
    null
  )
  const empty = fixture({ ncm: async () => details([99]) })
  assert.equal((await empty(song(), signal())).cover, null)
})
