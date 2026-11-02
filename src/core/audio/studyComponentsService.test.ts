import test from 'node:test'
import assert from 'node:assert/strict'
import { CoreStudyComponentsService } from './studyComponentsService.ts'
import { componentIds, planComponents, validComponentIO, validComponentPayload, type StudyComponentState, type StudyComponentIO } from '../../shared/studyComponents.ts'

function fixture(ready: string[] = []) {
  const ids = componentIds(['six', 'chords', 'melody', 'lyricFilter', 'twoSingers', 'leadBacking', 'btc'])
  const value: StudyComponentState = { directory: 'D:/分析组件', supported: true,
    catalog: { schema: 1, version: 'fixture', repository: 'FengLvv/Twilight_Echo', tag: 'analysis-components-fixture', platform: 'win32-x64',
      components: ids.map(id => ({ id, title: id, version: 'a'.repeat(64), platform: 'win32-x64', installedBytes: 200,
        archiveBytes: 100, archiveSha256: 'a'.repeat(64), parts: [{ name: id + '.zip', url: 'https://github.com/file', bytes: 100, sha256: 'b'.repeat(64) }] })) },
    components: ids.map(id => ({ id, phase: ready.includes(id) ? 'ready' : 'missing', receivedBytes: 0, totalBytes: 100 })), requests: [] }
  const actions: StudyComponentIO[] = []
  const service = new CoreStudyComponentsService(async request => {
    actions.push(request)
    if (request.action === 'start') for (const id of request.ids!) value.components.find(c => c.id === id)!.phase = 'queued'
    return structuredClone(value)
  }, () => {})
  return { service, value, actions }
}

test('quotes include shared runtime once and only missing dependencies', () => {
  const { value } = fixture()
  const both = planComponents(value, ['six', 'chords'])
  assert.equal(both.ids.filter(id => id === 'engine-torch').length, 1)
  assert.equal(both.downloadBytes, 500)
  value.components.find(c => c.id === 'engine-torch')!.phase = 'ready'
  assert.equal(planComponents(value, ['six']).downloadBytes, 200)
  value.components.find(c => c.id === 'demucs')!.cachedBytes = 50
  assert.equal(planComponents(value, ['six']).downloadBytes, 150)
  assert.equal(planComponents(value, ['six']).directory, 'D:/分析组件')
})
test('manual analysis asks without downloading; explicit consent starts exact dependencies', async () => {
  const f = fixture()
  assert.equal(await f.service.require(['six', 'chords'], 'song-a', '原来的歌曲', true), false)
  assert.equal((await f.service.state()).requests[0].title, '原来的歌曲')
  assert.equal(f.actions.some(a => a.action === 'start'), false)
  await f.service.install(['six', 'chords'])
  assert.deepEqual(f.actions.find(a => a.action === 'start')?.ids, ['engine-main', 'engine-torch', 'demucs', 'sheetsage', 'mert'])
  assert.equal((await f.service.state()).requests.filter(item => item.interactive).length, 0)
})
test('background analysis never starts downloads or creates consent prompts', async () => {
  const f = fixture()
  assert.equal(await f.service.require(['melody'], 'next', '下一首', false), false)
  assert.equal((await f.service.state()).requests.filter(item => item.interactive).length, 0)
  assert.equal(f.actions.some(a => a.action === 'start'), false)
})
test('six runs independently while harmony waits; installed melody does not imply lyric filtering', async () => {
  const f = fixture(componentIds(['six', 'melody']))
  assert.equal(await f.service.require(['six'], 'song-a', '歌曲', true), true)
  assert.equal(await f.service.require(['chords'], 'song-a', '歌曲', true), false)
  assert.equal(planComponents(f.value, ['melody']).downloadBytes, 0)
  assert.deepEqual(planComponents(f.value, ['lyricFilter']).ids, ['lyric'])
})
test('cancelling a song removes its consent without cancelling shared downloads', async () => {
  const f = fixture()
  await f.service.require(['six'], 'song-a', '歌曲', true)
  f.service.release('song-a')
  assert.equal((await f.service.state()).requests.length, 0)
  assert.equal(f.actions.some(a => a.action === 'task'), false)
})
test('external commands accept registered IDs and reject URL/path/executable payloads', () => {
  assert.equal(validComponentPayload('study.componentInstall', { features: ['six'] }), true)
  assert.equal(validComponentPayload('study.componentInstall', { features: ['six'], url: 'https://evil' }), false)
  assert.equal(validComponentPayload('study.componentInstall', { features: ['six', 'six'] }), false)
  assert.equal(validComponentIO({ action: 'start', ids: ['engine-main'] }), true)
  assert.equal(validComponentIO({ action: 'start', ids: ['../../elsewhere'] }), false)
  assert.equal(validComponentIO({ action: 'remove', id: 'demucs', path: 'C:/' }), false)
})
