import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { effectScope, ref, shallowRef } from 'vue'
import { createSongListActionSource } from './songListActionSource.ts'
import { useTrackMultiSelect } from './useTrackMultiSelect.ts'
import { coreQueueTrackInput } from '../../stores/player/corePlayerQueue.ts'
import { copyTrackNames, copyTrackNamePages } from '../../composables/copyTrackNames.ts'
import { useAppNoticeStore } from '../../stores/useAppNoticeStore.ts'

const source = readFileSync(new URL('../SongList.vue', import.meta.url), 'utf8')
const track = (id, patch = {}) => ({
  id, title: `Song ${id}`, artist: 'Artist', album: 'Album',
  duration: 180, size: 1, source: 'local', ...patch
})
function fixture(count = 605) {
  const rows = Array.from({ length: count }, (_, position) => ({
    position, definitionId: String(position), track: track(String(position)), version: 2, instance: 3
  }))
  const snapshot = { id: 'selection:1', revision: 7, total: count, selectedCount: count,
    localTrackCount: count, fileCount: count }
  const calls = []
  const api = {
    open: async request => { calls.push(['open', request]); return snapshot },
    page: async (id, cursor = 0, projection = 'tracks', signal) => {
      signal?.throwIfAborted()
      calls.push(['page', id, cursor, projection])
      const page = rows.slice(cursor, cursor + 200)
      return { snapshot, rows: page, nextCursor: cursor + page.length < count ? cursor + page.length : null }
    },
    close: async id => { calls.push(['close', id]) }
  }
  const request = { query: { sort: 'insertion', contentRevision: 7 }, total: count, ranges: [[0, count]] }
  return { api, request, rows, calls, snapshot }
}

function clipboardFixture(t, copyTrackNames) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const notices = useAppNoticeStore()
  notices.clearNotices()
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { api: { window: { copyTrackNames } } }
  })
  t.after(() => {
    notices.clearNotices()
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return notices
}

test('query selection keeps absolute ranges across unloaded windows without caching selected tracks', t => {
  const scope = effectScope()
  t.after(() => scope.stop())
  const rows = shallowRef(Array.from({ length: 200 }, (_, i) => track(String(i))))
  const epoch = ref(0)
  const positions = shallowRef(new Map(rows.value.map((row, i) => [row.id, i])))
  const selection = scope.run(() => useTrackMultiSelect({
    tracks: rows,
    querySelection: () => ({ total: 605, positionForKey: key => positions.value.get(key) ?? null }),
    selectionOrder: row => positions.value.get(row.id) ?? -1,
    snapshotTrack: () => { throw new Error('query mode cached a selected track') },
    resetSources: [epoch]
  }))
  selection.selectAll()
  assert.equal(selection.selectedCount.value, 605)
  assert.equal(selection.selectedIds.value.size, 0)
  assert.deepEqual(selection.getSelectedRanges(), [[0, 605]])
  assert.throws(selection.getSelectedTracks, /异步批次/)
  selection.clearSelection()
  selection.toggle('15', 15, rows.value[15])
  const last = track('604')
  rows.value = [last]
  positions.value = new Map([['604', 604]])
  selection.onRowClick(last, 0, { shiftKey: true })
  assert.deepEqual(selection.getSelectedRanges(), [[15, 605]])
  assert.equal(selection.selectedCount.value, 590)
  epoch.value++
  assert.equal(selection.selectedCount.value, 0)
})

test('an immutable Core selection intent streams every bounded page and closes exactly once', async () => {
  const f = fixture()
  const intent = createSongListActionSource({ api: f.api, request: f.request })
  f.request.query.sort = 'title'
  f.request.ranges[0][1] = 1
  assert.equal(intent.count, 605)
  assert.equal(f.calls.length, 0, 'capturing a dialog intent performs no business work')
  const lease = await intent.open()
  const pages = []
  try {
    await lease.tracks(async tracks => { pages.push(tracks) })
  } finally {
    await lease.close()
    await lease.close()
  }
  assert.deepEqual(pages.map(page => page.length), [200, 200, 200, 5])
  assert.equal(pages.flat().at(-1).id, '604')
  assert.equal(pages.flat().some(row => 'filePath' in row), false)
  assert.equal(f.calls[0][1].query.sort, 'insertion')
  assert.deepEqual(f.calls[0][1].ranges, [[0, 605]])
  assert.equal(f.calls.filter(([kind]) => kind === 'close').length, 1)
  await assert.rejects(intent.open(), /已使用/)
  await assert.rejects(lease.tracks(async () => {}), /取消/)
})

test('playlist member pages retain configured identities while source pages retain repeated occurrences', async () => {
  const f = fixture(3)
  f.rows[0].definitionId = 'original-missing-id'
  f.rows[0].track = track('resolved-variant')
  f.rows[1].track = track('one', { queueEntryId: 'occurrence:1' })
  f.rows[1].definitionId = 'one'
  f.rows[2].track = track('one', { queueEntryId: 'occurrence:2' })
  f.rows[2].definitionId = 'one'
  const lease = await createSongListActionSource({ api: f.api, request: f.request }).open()
  try {
    const ids = [], members = [], inputs = []
    await lease.ids(async page => { ids.push(...page) })
    await lease.members(async page => { members.push(...page) })
    await lease.forEachPage(async page => {
      inputs.push(...page.map(({ track }) => coreQueueTrackInput(track, null, { id: 'queue', revision: 4 })))
    })
    assert.deepEqual(ids, ['original-missing-id', 'one', 'one'])
    assert.deepEqual(members[0], { id: 'original-missing-id' })
    assert.equal(members[1].track.id, 'one')
    assert.deepEqual(inputs, [
      { kind: 'local', id: 'resolved-variant' },
      { kind: 'occurrence', queueId: 'queue', revision: 4, occurrenceId: 'occurrence:1' },
      { kind: 'occurrence', queueId: 'queue', revision: 4, occurrenceId: 'occurrence:2' }
    ])
  } finally { await lease.close() }
})

test('a page failure poisons its action instead of retrying unknown work', async () => {
  const f = fixture()
  const page = f.api.page
  f.api.page = async (...args) => {
    if (args[1] === 200) throw new Error('Core connection lost')
    return page(...args)
  }
  const lease = await createSongListActionSource({ api: f.api, request: f.request }).open()
  const consumed = []
  await assert.rejects(lease.tracks(async rows => { consumed.push(...rows) }), /connection lost/)
  assert.equal(consumed.length, 200)
  const calls = f.calls.length
  await assert.rejects(lease.tracks(async () => {}), /中断/)
  assert.equal(f.calls.length, calls)
  await lease.close()
})

test('cancelling an action prevents further reads while lease cleanup remains available', async () => {
  const f = fixture(), controller = new AbortController()
  const lease = await createSongListActionSource({ api: f.api, request: f.request }).open(controller.signal)
  await assert.rejects(lease.tracks(async () => { controller.abort() }), { name: 'AbortError' })
  assert.equal(f.calls.filter(([kind]) => kind === 'page').length, 1)
  await lease.close()
  assert.equal(f.calls.at(-1)[0], 'close')
})

test('a retained dialog intent is fenced before publication when its selection changes', async () => {
  const f = fixture(2)
  let current = true
  const intent = createSongListActionSource({ api: f.api, request: f.request }, () => {
    if (!current) throw new Error('selection changed')
  })
  const lease = await intent.open()
  const guard = await lease.tracks(async () => {})
  current = false
  assert.throws(guard, /selection changed/)
  await lease.close()
})

test('copy text consumes all Core pages and checks the final intent before using the clipboard', async t => {
  const copied = []
  clipboardFixture(t, async text => { copied.push(text) })
  const f = fixture()
  const lease = await createSongListActionSource({ api: f.api, request: f.request }).open()
  try { await copyTrackNamePages(lease.tracks) } finally { await lease.close() }
  assert.equal(copied[0].split('\n').length, 605)
  assert.equal(copied[0].split('\n').at(-1), 'Song 604 - Artist')
  await assert.rejects(copyTrackNamePages(async append => {
    await append([{ title: 'One', artist: 'Artist' }])
    return () => { throw new Error('dialog closed') }
  }), /dialog closed/)
  assert.equal(copied.length, 1)
})

test('single and multi-track copies retain their format and ignore empty selections', async t => {
  const copied = []
  const notices = clipboardFixture(t, async text => { copied.push(text) })
  await copyTrackNames([])
  assert.deepEqual(copied, [])
  assert.equal(notices.notices.value.length, 0)
  await copyTrackNames([{ title: '  夜曲  ', artist: '  周杰伦  ' }])
  assert.deepEqual(copied, ['夜曲 - 周杰伦'])
  assert.equal(notices.notices.value.at(-1).message, '已复制歌曲名和作者')
  await copyTrackNames([
    { title: ' No artist ', artist: ' ' },
    { title: ' ', artist: ' Artist only ' },
    { title: 'Duet', artist: 'A / B' }
  ])
  assert.equal(copied.at(-1), 'No artist\nArtist only\nDuet - A / B')
  assert.equal(notices.notices.value.at(-1).message, '已复制 3 首歌曲名和作者')
})

test('copy feedback waits for the native write and reports a rejected write as failure', async t => {
  let rejectWrite
  const notices = clipboardFixture(t, () => new Promise((_resolve, reject) => { rejectWrite = reject }))
  const copying = copyTrackNames([{ title: 'Song', artist: 'Artist' }])
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(typeof rejectWrite, 'function', 'copy did not use the native clipboard bridge')
  assert.equal(notices.notices.value.length, 0)
  rejectWrite(new Error('Clipboard unavailable'))
  await copying
  assert.equal(notices.notices.value.length, 1)
  assert.equal(notices.notices.value[0].kind, 'error')
  assert.equal(notices.notices.value[0].message, '复制歌曲名和作者失败，请重试')
})

test('SongList binds Core selection and identity-only commands, not private media records', () => {
  assert.match(source, /api: selectionApi/)
  assert.match(source, /rows\.map\(\(\{ track \}\) => trackInput\(track\)\)/)
  assert.match(source, /'library\.remove',[\s\S]*?\{ selectionId: lease\.selectionId, mode \}/)
  assert.match(source, /:selection="tagManagerSelection"/)
  assert.doesNotMatch(source, /toPlaylistTrackSnapshot|LibraryTrackRecord|window\.api\.library/)
})
