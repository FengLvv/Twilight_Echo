import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtworkSourceCache } from './artworkSourceCache.ts'
import { createRemoteCoverCache } from './remoteCoverCache.ts'
import {
  RemoteMediaGrantService,
  createRemoteMediaRequestHandler
} from '../security/remoteMediaGrants.ts'
import { createTrackArtworkResolver } from '../../core/playback/artworkResolver.ts'
import { validCorePlatformPayload, type CorePlatformRequest } from '../../shared/corePlatform.ts'

test('a fresh Core and grant store resolve identity-only tracks and resized cached images entirely offline', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'te-artwork-offline-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let lookups = 0,
    downloads = 0
  const track = {
    id: 'ncm:42',
    source: 'ncm',
    ncmSongId: 42,
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    duration: 180,
    size: 0,
    filePath: '',
    fileName: '',
    cover: null,
    lyrics: null
  }
  const phase = (offline: boolean) => {
    const index = createArtworkSourceCache(() => root)
    const grants = new RemoteMediaGrantService()
    const images = createRemoteCoverCache(() => root, {
      resize: () => ({ bytes: new Uint8Array([9, 8, 7]), mime: 'image/jpeg' })
    })
    const resolve = createTrackArtworkResolver({
      restore: (keys) => Promise.all(keys.map((key) => index.read(key))),
      persist: async (items) => {
        for (const item of items) await index.write(item.key, item.source.coverSource!)
      },
      present: async (source) => ({ cover: grants.grant(source.coverSource!, 'image') }),
      ncm: async () => {
        lookups++
        if (offline) throw Error('No network')
        return {
          code: 200,
          songs: [{ id: 42, al: { picUrl: 'https://p1.music.126.net/song.jpg' } }]
        }
      },
      local: async () => null,
      search: async () => {
        throw Error('No search')
      }
    })
    const request = createRemoteMediaRequestHandler({
      grants,
      imageCache: images,
      fetch: async () => {
        downloads++
        if (offline) throw Error('No network')
        return new Response(new Uint8Array(1000), { headers: { 'content-type': 'image/png' } })
      }
    })
    return { resolve, request, index, images }
  }
  const online = phase(false)
  const first = await online.resolve(track, new AbortController().signal)
  const downloaded = await online.request(new Request(first.cover!))
  assert.deepEqual(
    [...new Uint8Array(await downloaded.arrayBuffer())],
    [9, 8, 7],
    'first paint also uses the resized cache representation'
  )
  const cold = phase(true)
  const restored = await cold.resolve(track, new AbortController().signal)
  const cached = await cold.request(new Request(restored.cover!))
  assert.equal(cached.status, 200)
  assert.deepEqual([...new Uint8Array(await cached.arrayBuffer())], [9, 8, 7])
  assert.equal(lookups, 1, 'no metadata lookup after restart')
  assert.equal(downloads, 1, 'no image download after restart')
  await cold.images.maintain(() =>
    cold.index.maintain(async () => {
      await rm(join(root, 'track-artwork'), { recursive: true, force: true })
    })
  )
  assert.equal(await cold.index.read('["ncm",42]'), null)
})

test('source cache obeys disabled policy, TTL, corrupted entries and clear fences', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'te-artwork-index-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let enabled = true,
    now = 100
  const cache = createArtworkSourceCache(
    () => (enabled ? root : null),
    () => now
  )
  await cache.write('song', 'https://cdn.test/song.jpg')
  assert.ok(await cache.read('song'))
  enabled = false
  assert.equal(await cache.read('song'), null)
  enabled = true
  now += 8 * 86400_000
  assert.equal(await cache.read('song'), null)
  await cache.write('song', 'https://cdn.test/song.jpg')
  const [file] = await readdir(join(root, 'track-artwork'))
  await writeFile(join(root, 'track-artwork', file), 'not JSON')
  assert.equal(await cache.read('song'), null)
  const pending = cache.write('before', 'https://cdn.test/before.jpg')
  await cache.maintain(async () => {
    await pending
    await cache.write('during', 'https://cdn.test/during.jpg')
    assert.equal(await cache.read('song'), null)
    await rm(join(root, 'track-artwork'), { recursive: true, force: true })
  })
  assert.equal(await cache.read('before'), null)
  assert.equal(await cache.read('during'), null)
  await cache.write('bad', 'file:///private.jpg')
  assert.equal(await cache.read('bad'), null)
})

test('private artwork cache capabilities reject oversized, malformed and path-like payloads', () => {
  const valid = (name: string, payload: unknown) =>
    validCorePlatformPayload({
      kind: 'core:platform',
      epoch: 'test',
      requestId: 'art',
      name,
      payload
    } as CorePlatformRequest)
  assert.equal(valid('artwork.restoreSources', { keys: ['["ncm",42]'] }), true)
  assert.equal(valid('artwork.restoreSources', { keys: Array(51).fill('key') }), false)
  assert.equal(valid('artwork.restoreSources', { keys: ['\0'] }), false)
  assert.equal(
    valid('artwork.rememberSources', {
      items: [{ key: 'song', source: { cover: null, coverSource: 'https://cdn.test/a.jpg' } }]
    }),
    true
  )
  assert.equal(
    valid('artwork.rememberSources', {
      items: [{ key: 'song', source: { cover: null, filePath: 'secret' } }]
    }),
    false
  )
})
