import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService, activate, deactivate } from '../index.mjs'
import { AssociationStore } from '../lib/store.mjs'
const track = { id: 'local:x', title: 'Song', artist: 'Artist', album: 'Album', duration: 120 }
const song = { ...track, id: '1' }

test('activation keeps the backend available without injecting a titlebar button', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-ncm-activation-'))
  let handler, contribution, fallback
  try {
    await activate({
      storagePath: directory,
      settings: { get: async () => null },
      twilight: {
        experience: {
          onRequest(callback) {
            handler = callback
            return () => {
              handler = null
            }
          }
        },
        ui: {
          register(value) {
            contribution = value
          },
          onCommand(name, callback) {
            assert.equal(name, 'ncm-comments.open')
            fallback = callback
          },
          notify() {}
        }
      }
    })
    assert.equal(contribution.kind, 'playerBarButton')
    assert.equal(contribution.title, '网易云评论')
    assert.equal(typeof fallback, 'function')
    const opened = await handler({ operation: 'open' })
    assert.ok(opened.session)
    await handler({ operation: 'close', session: opened.session })
  } finally {
    await deactivate()
    await rm(directory, { recursive: true, force: true })
  }
})
function fixture(directory, overrides = {}) {
  let writes = 0,
    searches = 0
  const context = {
    storagePath: directory,
    settings: { get: async () => null, set: async () => {} },
    twilight: {
      library: {
        getTracksByIds: async () => [],
        getCover: async () => null,
        patchTracks: () => {
          throw new Error('unexpected library write')
        }
      },
      appSettings: {
        get: async () => ({ theme: 'pureWhite', accentColor: '#abcdef', secret: 'not sent' }),
        update: () => {
          writes++
          throw new Error('unexpected settings write')
        }
      }
    }
  }
  const client = {
    search: async () => {
      searches++
      return [song]
    },
    detail: async (id) => ({ ...song, id }),
    comments: async () => ({}),
    close() {},
    ...overrides
  }
  return {
    service: createService(context, { client, ...overrides.options }),
    counts: () => ({ writes, searches })
  }
}
async function using(run) {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-ncm-comments-'))
  const services = []
  try {
    await run(directory, (options) => {
      const result = fixture(directory, options)
      services.push(result.service)
      return result
    })
  } finally {
    await Promise.all(services.map((service) => service.close()))
    await rm(directory, { recursive: true, force: true })
  }
}

test('explicit IDs win; manual associations persist across restart and metadata changes', () =>
  using(async (directory, make) => {
    const first = make()
    const { session } = await first.service.handle({ operation: 'open' })
    const call = (operation, args = {}) => first.service.handle({ operation, session, ...args })
    assert.equal((await call('resolve', { track })).kind, 'auto')
    await call('associate', { track, value: '2' })
    await first.service.close()
    const next = make()
    const open = await next.service.handle({ operation: 'open' })
    const result = await next.service.handle({
      operation: 'resolve',
      session: open.session,
      track: { ...track, album: 'Changed' }
    })
    assert.equal(result.kind, 'manual')
    assert.equal(result.song.id, '2')
    assert.equal(
      (
        await next.service.handle({
          operation: 'resolve',
          session: open.session,
          track: { ...track, ncmSongId: 3 }
        })
      ).song.id,
      '3'
    )
    assert.equal(next.counts().searches, 0)
  }))

test('unlink pauses automatic matching; rematch does not overwrite manual selection', () =>
  using(async (_, make) => {
    const { service, counts } = make()
    const { session } = await service.handle({ operation: 'open' })
    const call = (operation, args = {}) => service.handle({ operation, session, ...args })
    await call('unlink', { track })
    assert.equal((await call('resolve', { track })).kind, 'paused')
    assert.equal(counts().searches, 0)
    assert.equal((await call('rematch', { track })).kind, 'choose')
    assert.equal((await call('resolve', { track })).kind, 'paused')
  }))

test('theme returns only appearance fields and never calls settings/library writes', () =>
  using(async (_, make) => {
    const { service, counts } = make()
    const { session } = await service.handle({ operation: 'open' })
    const result = await service.handle({ operation: 'theme', session })
    assert.equal(result.theme, 'pureWhite')
    assert.equal(result.palettes.pureWhite.accent, '#2563eb')
    assert.equal(result.secret, undefined)
    assert.equal(counts().writes, 0)
  }))

test('the real host returns full library tracks in a LibraryPage', () =>
  using(async (directory) => {
    const context = {
      storagePath: directory,
      settings: { get: async () => null },
      twilight: {
        library: { getTracksByIds: async () => ({ tracks: [{ ...track, ncmSongId: 186016 }] }) }
      }
    }
    const service = createService(context, {
      client: {
        close() {},
        search() {
          throw new Error('must not search an identified song')
        }
      }
    })
    try {
      const { session } = await service.handle({ operation: 'open' })
      const result = await service.handle({ operation: 'resolve', session, track })
      assert.equal(result.kind, 'explicit')
      assert.equal(result.song.id, '186016')
    } finally {
      await service.close()
    }
  }))

test('session cancel, close and lease expiry abort in-flight reads', () =>
  using(async (_, make) => {
    for (const action of ['cancel', 'close', 'expiry']) {
      let now = 0
      const { service } = make({
        options: { now: () => now, leaseMs: 100 },
        comments: async (_id, _sort, _offset, signal) =>
          new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          )
      })
      const { session } = await service.handle({ operation: 'open' })
      const pending = service.handle({
        operation: 'comments',
        session,
        songId: '1',
        sort: 'latest',
        offset: 0
      })
      const rejected = assert.rejects(pending, /aborted/)
      await new Promise((resolve) => setImmediate(resolve))
      if (action === 'expiry') {
        now = 101
        await new Promise((resolve) => setTimeout(resolve, 220))
      } else await service.handle({ operation: action, session })
      await rejected
    }
  }))

test('atomic association store serializes simultaneous writes', () =>
  using(async (directory) => {
    const store = new AssociationStore(directory)
    await store.load()
    await Promise.all([
      store.set('a', { kind: 'paused' }),
      store.set('b', { kind: 'manual', song })
    ])
    const restored = new AssociationStore(directory)
    await restored.load()
    assert.equal(restored.get('a').kind, 'paused')
    assert.equal(restored.get('b').song.id, '1')
  }))

test('a corrupt association file is reported without replacing it', () =>
  using(async (directory, make) => {
    await writeFile(join(directory, 'associations.json'), '{broken')
    const { service } = make()
    await assert.rejects(service.handle({ operation: 'open' }), /关联数据无法读取/)
  }))
