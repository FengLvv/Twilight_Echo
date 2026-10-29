import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeCommentsService } from './service.ts'
import { NativeAssociationStore } from '../../main/coreProcess/nativeCommentsStore.ts'
import { AssociationStore } from './store.mjs'
import type { NcmClient } from './client.mjs'
import { validCommentsRequest } from '../../shared/ncmComments.ts'
import { NativeCommentPublisher } from './publisher.ts'

test('native publication invalidates only accepted song comments and never changes associations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'native-comment-publish-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const invalidated: string[] = []
  let accepted = false
  const store = new AssociationStore(directory)
  const service = new NativeCommentsService(
    store,
    {
      invalidateComments: (id: string) => invalidated.push(id)
    } as unknown as NcmClient,
    async () => undefined,
    new NativeCommentPublisher({
      context: () => 'account',
      session: async () => ({ loggedIn: true, cookie: 'test' }),
      request: async () => ({ code: accepted ? 200 : 301 })
    })
  )
  assert.equal((await service.account()).loggedIn, true)
  const request = {
    songId: '42',
    content: 'Test',
    submissionId: 'first',
    accountContext: 'account'
  }
  assert.equal((await service.publish(request)).status, 'rejected')
  assert.deepEqual(invalidated, [])
  accepted = true
  assert.equal((await service.publish({ ...request, submissionId: 'second' })).status, 'published')
  assert.deepEqual(invalidated, ['42'])
  assert.equal(store.get('42'), undefined)
})

test('native service resolves library IDs without a plugin and preserves corrections', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'native-comments-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const track = { id: 'local:test', title: 'Song', artist: 'Artist', album: 'Album', duration: 120 }
  let searches = 0
  const song = { ...track, id: '42' }
  const client = {
    search: async () => {
      searches++
      return [song]
    },
    detail: async (id: string) => ({ ...song, id })
  } as unknown as NcmClient
  const signal = new AbortController().signal
  let service = new NativeCommentsService(new AssociationStore(directory), client, async () => ({
    ...track,
    ncmSongId: 123
  }))
  const explicit = await service.request({ operation: 'resolve', track }, signal)
  assert.equal((explicit as { kind: string }).kind, 'explicit')
  assert.equal(searches, 0)
  service = new NativeCommentsService(
    new AssociationStore(directory),
    client,
    async () => undefined
  )
  assert.equal(
    ((await service.request({ operation: 'resolve', track }, signal)) as { kind: string }).kind,
    'auto'
  )
  await service.request({ operation: 'associate', track, value: '77' }, signal)
  service = new NativeCommentsService(
    new AssociationStore(directory),
    client,
    async () => undefined
  )
  const manual = (await service.request(
    { operation: 'resolve', track: { ...track, album: 'Changed' } },
    signal
  )) as { kind: string; song: { id: string } }
  assert.equal(manual.kind, 'manual')
  assert.equal(manual.song.id, '77')
  await service.request({ operation: 'unlink', track }, signal)
  assert.equal(
    ((await service.request({ operation: 'resolve', track }, signal)) as { kind: string }).kind,
    'paused'
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(service.request({ operation: 'resolve', track }, controller.signal), {
    name: 'AbortError'
  })
})

test('native Core requests bound inputs and separate association writes', () => {
  const track = { id: 'local:test' }
  assert.equal(validCommentsRequest({ operation: 'associate', track, value: '42' }, false), false)
  assert.equal(validCommentsRequest({ operation: 'associate', track, value: '42' }, true), true)
  assert.equal(
    validCommentsRequest({ operation: 'comments', songId: '42', sort: 'hot', offset: 0 }, false),
    true
  )
  assert.equal(
    validCommentsRequest({ operation: 'comments', songId: '42', sort: 'hot', offset: -1 }, false),
    false
  )
  assert.equal(
    validCommentsRequest({ operation: 'search', track, query: 'x'.repeat(201) }, false),
    false
  )
})

test('native association migration retains legacy corrections without overwriting native ones', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'native-comments-upgrade-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const legacy = join(root, 'plugin-data', 'com.twilightecho.tool.ncm-comments')
  await mkdir(legacy, { recursive: true })
  const source = JSON.stringify({ version: 1, entries: [['track', { kind: 'paused' }]] })
  await writeFile(join(legacy, 'associations.json'), source)
  const store = new NativeAssociationStore(root)
  await store.load()
  assert.equal(store.get('track')?.kind, 'paused')
  await store.set('track', {
    kind: 'manual',
    song: { id: '42', title: 'Song', artist: 'Artist', album: 'Album', duration: 120 }
  })
  const restored = new NativeAssociationStore(root)
  await restored.load()
  assert.equal(restored.get('track')?.song?.id, '42')
  assert.equal(await readFile(join(legacy, 'associations.json'), 'utf8'), source)
})
