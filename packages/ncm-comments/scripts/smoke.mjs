import assert from 'node:assert/strict'
import { mkdir, writeFile, mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pluginId = 'com.twilightecho.tool.ncm-comments'
const output = resolve(root, 'output/playwright/ncm-comments')
await mkdir(output, { recursive: true })
const profile = process.env.NCM_COMMENTS_SMOKE_PROFILE || (await mkdtemp(join(output, 'profile-')))
await mkdir(profile, { recursive: true })
const media = join(profile, 'media')
await mkdir(media, { recursive: true })
const fixtures = [
  { id: 'comments-fixture', title: '晴天', artist: '周杰伦', album: '叶惠美', ncmSongId: 186016 },
  {
    id: 'comments-unmatched',
    title: 'Unmatched Comments Fixture',
    artist: 'Fixture Artist',
    album: 'Fixture Album'
  }
]
if (!process.env.NCM_COMMENTS_SMOKE_PROFILE) {
  const tracks = []
  for (const fixture of fixtures) {
    const samples = Buffer.alloc(44100 * 2 * 120)
    const header = Buffer.alloc(44)
    header.write('RIFF')
    header.writeUInt32LE(samples.length + 36, 4)
    header.write('WAVE', 8)
    header.write('fmt ', 12)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(44100, 24)
    header.writeUInt32LE(88200, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(samples.length, 40)
    const fileName = `${fixture.id}.wav`,
      filePath = join(media, fileName)
    await writeFile(filePath, Buffer.concat([header, samples]))
    const lyrics =
      '[00:00.00]让音乐陪着你\n[00:10.00]在此刻留下一个故事\n[00:20.00]向下滚动，听见更多共鸣'
    await writeFile(join(media, `${fixture.id}.lrc`), lyrics)
    tracks.push({
      ...fixture,
      source: 'local',
      filePath,
      fileName,
      dir: media,
      duration: 120,
      size: samples.length + 44,
      format: 'WAV',
      sampleRate: 44100,
      bitDepth: 16,
      cover: null,
      lyrics
    })
  }
  await writeFile(
    join(profile, 'music-library.json'),
    JSON.stringify({ version: 2, revision: 1, tracks, folders: [media], exclusions: [] })
  )
  await writeFile(
    join(profile, 'settings.json'),
    JSON.stringify({
      onboardingCompleted: true,
      startupHomePage: 'local',
      libraryFolders: [media],
      volume: 0,
      theme: 'dark',
      accentColor: '#a78bfa',
      proxyMode: 'off'
    })
  )
}
const manifest = JSON.parse(
  await readFile(resolve(root, 'packages/ncm-comments/plugin.json'), 'utf8')
)
const packageFile = resolve(root, 'dist/plugins', `${pluginId}-${manifest.version}.tep`)
const env = {
  ...process.env,
  NCM_COMMENTS_TEST_PROFILE: profile,
  NCM_COMMENTS_TEST_PACKAGE:
    process.env.NCM_COMMENTS_TEST_PACKAGE || resolve(root, 'dist/ncm-comments-host/win-unpacked')
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: require('electron'),
  args: [
    resolve(root, 'packages/ncm-comments/scripts/bootstrap.cjs'),
    '--mute-audio',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ],
  env,
  timeout: 60000
})
const errors = [],
  results = { profile, baseline: '0eaa5700', version: manifest.version, checks: [] }
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && /plugin|form|script/i.test(message.text()))
      console.error('renderer:', message.text().slice(0, 250))
  })
  await page.waitForFunction(() => !!window.api?.plugins && !!window.api?.core, { timeout: 60000 })
  await app.evaluate(({ dialog }, packageFile) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [packageFile] })
  }, packageFile)
  let connection
  for (let attempt = 0; attempt < 40 && !connection; attempt++) {
    connection = await app.evaluate(({ BrowserWindow }) =>
      global.__commentsTestConnections.get(
        BrowserWindow.getAllWindows().find(
          (window) => !window.isDestroyed() && window.webContents.getURL().includes('index.html')
        )?.webContents.id
      )
    )
    if (!connection) await page.waitForTimeout(500)
  }
  assert.ok(connection, 'Renderer Core connection was captured without reconnecting the app')
  await page.evaluate((connection) => {
    window.__commentsTestConnection = connection
    window.__commentsTestRequest = async (name, payload = {}, kind = 'command') => {
      const reply = await window.api.core.request(connection.connectionId, {
        kind,
        name,
        payload,
        epoch: connection.snapshot.epoch,
        requestId: crypto.randomUUID()
      })
      if (!reply.ok) throw new Error(JSON.stringify(reply.error))
      return reply.value
    }
  }, connection)
  const request = async (name, payload = {}, kind = 'command') => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await page.evaluate(
          ({ name, payload, kind }) => window.__commentsTestRequest(name, payload, kind),
          { name, payload, kind }
        )
      } catch (error) {
        if (!error.message.includes('NOT_READY') || attempt >= 100) throw error
        await page.waitForTimeout(300)
      }
    }
  }
  const libraries = await request('library.tracks', { limit: 10 }, 'query')
  console.log('library', JSON.stringify(libraries).slice(0, 900))
  if (!process.env.NCM_COMMENTS_SMOKE_PROFILE) {
    const installation = await request('plugins.install', { kind: 'package' })
    console.log('installation', JSON.stringify(installation).slice(0, 500))
  }
  await request('plugins.enable', { id: pluginId })
  const metadataPrompt = page.getByRole('button', { name: '暂不开启', exact: true })
  if (await metadataPrompt.isVisible()) await metadataPrompt.click()
  await page
    .getByText('歌词与评论', { exact: true })
    .first()
    .waitFor({ state: 'attached', timeout: 30000 })
  assert.equal(await page.locator('.plugin-titlebar-btn[aria-label="网易云评论"]').count(), 0)
  results.checks.push('tep-installed-and-enabled', 'no-titlebar-button')
  const button = page.locator('.player-right .plugin-playerbar-button[aria-label="网易云评论"]')
  await button.waitFor({ timeout: 30000 })
  const buttonBox = await button.boundingBox()
  const barBox = await page.locator('.player-right').boundingBox()
  assert.ok(
    buttonBox.y >= barBox.y && buttonBox.y + buttonBox.height <= barBox.y + barBox.height + 1
  )
  results.checks.push('native-bottom-playbar-button')
  const frame = page.frameLocator('.experience-flyout iframe')
  const openComments = async () => {
    await button.click()
    await frame.locator('#song-title').waitFor({ timeout: 30000 })
  }
  await openComments()
  await frame.getByText('播放一首歌曲，在这里阅读它的评论。').waitFor()
  await frame.locator('body').press('Escape')
  await page.locator('.experience-flyout iframe').waitFor({ state: 'detached' })
  results.checks.push('idle-playbar-opens-empty-state')
  try {
    await request('queue.fromQuery', {
      query: { ids: [fixtures[0].id], sort: 'playlist' },
      selectedId: fixtures[0].id,
      play: true
    })
    results.nativePlayback = true
  } catch (error) {
    results.nativePlayback = false
    results.nativePlaybackLimitation = error.message
    await request('queue.fromQuery', {
      query: { ids: [fixtures[0].id], sort: 'playlist' },
      selectedId: fixtures[0].id,
      play: false
    })
  }
  await page.locator('.player-cover-slot[title="打开播放页面"]').first().click()
  await page.locator('.playing-music').waitFor()
  await page.screenshot({ path: join(output, 'player-bottom-button.png') })
  await openComments()
  await frame.locator('#comments .comment').first().waitFor({ timeout: 45000 })
  assert.ok((await frame.locator('#association').innerText()).includes('已识别歌曲 ID'))
  results.checks.push('local-library-ncm-id-resolved', 'live-hot-comments')
  const before = await request('state.snapshot', {}, 'query')
  assert.ok(await page.locator('.playing-music').isVisible())
  results.checks.push('panel-opens-over-original-playback-page')
  await page.screenshot({ path: join(output, 'comments-dark.png') })
  await frame.getByRole('tab', { name: '最新', exact: true }).click()
  await frame.locator('#comments .comment').nth(19).waitFor({ timeout: 30000 })
  const firstIds = await frame
    .locator('.comment')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.commentId))
  await frame.getByRole('button', { name: '加载更多评论' }).click()
  await frame.locator('#comments .comment').nth(20).waitFor({ timeout: 30000 })
  const ids = await frame
    .locator('.comment')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.commentId))
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.length > firstIds.length)
  results.checks.push('live-latest-page2-deduplicated')
  const settings = await request('settings.state', {}, 'query')
  console.log('settings shape', Object.keys(settings))
  await request('settings.edit', {
    revision: settings.revision,
    patch: { theme: 'pureWhite', accentColor: '#7354cc' }
  })
  const debugSession = await request('extensions.pluginRequest', {
    id: pluginId,
    request: { operation: 'open' }
  })
  console.log(
    'theme-read',
    await request('extensions.pluginRequest', {
      id: pluginId,
      request: { operation: 'theme', session: debugSession.session }
    })
  )
  await request('extensions.pluginRequest', {
    id: pluginId,
    request: { operation: 'close', session: debugSession.session }
  })
  const child = page.frames().find((entry) => entry.url().startsWith('plugin-ui:'))
  console.log(
    'theme-ui',
    await child.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      hidden: document.hidden
    }))
  )
  await child.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, {
    timeout: 15000,
    polling: 200
  })
  await page.screenshot({ path: join(output, 'comments-light.png') })
  results.checks.push('live-theme-sync')
  await frame.getByRole('tab', { name: '最新', exact: true }).press('Escape')
  await page.locator('.experience-flyout iframe').waitFor({ state: 'detached' })
  const after = await request('state.snapshot', {}, 'query')
  assert.equal(after.track?.id, before.track?.id)
  console.log(
    'playback',
    JSON.stringify({ before: before.playback?.state, after: after.playback?.state })
  )
  assert.equal(after.playback?.state, before.playback?.state)
  results.checks.push('escape-closes-without-stopping-playback')
  await request('queue.fromQuery', {
    query: { ids: [fixtures[1].id], sort: 'playlist' },
    selectedId: fixtures[1].id,
    play: false
  })
  await openComments()
  await frame.locator('#matching').waitFor({ timeout: 30000 })
  await frame.locator('#manual-entry summary').click()
  await frame.locator('#song-link').fill('https://music.163.com/song?id=186016')
  await frame.getByRole('button', { name: '关联', exact: true }).click()
  await frame.locator('#comments .comment').first().waitFor({ timeout: 30000 })
  assert.ok((await frame.locator('#association').innerText()).includes('手动关联'))
  await page.screenshot({ path: join(output, 'comments-associated.png') })
  results.checks.push('manual-link-corrects-local-match')
  await frame.getByRole('tab', { name: '最新', exact: true }).press('Escape')
  await page.locator('.experience-flyout iframe').waitFor({ state: 'detached' })
  await request('plugins.disable', { id: pluginId })
  await button.waitFor({ state: 'detached' })
  await page.getByText('歌词与评论', { exact: true }).first().waitFor({ state: 'detached' })
  await request('plugins.enable', { id: pluginId })
  await openComments()
  await frame.locator('#comments .comment').first().waitFor({ timeout: 30000 })
  assert.ok((await frame.locator('#association').innerText()).includes('手动关联'))
  results.checks.push('disable-enable-preserves-association')
  // Disabling while open removes both the entry and the hosted iframe.
  await request('plugins.disable', { id: pluginId })
  await page.locator('.experience-flyout iframe').waitFor({ state: 'detached' })
  await button.waitFor({ state: 'detached' })
  await request('plugins.enable', { id: pluginId })
  results.checks.push('disable-closes-panel-and-removes-entry')
  await button.waitFor()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.locator('.playing-music').waitFor({ state: 'detached' })
  await page.getByText('歌词与评论', { exact: true }).first().dispatchEvent('click')
  const lyricsFrame = page.frameLocator('.experience-window iframe')
  await lyricsFrame.locator('.page-record-title').waitFor({ timeout: 30000 })
  await page.screenshot({ path: join(output, 'player-lyrics-page.png') })
  await lyricsFrame.getByRole('button', { name: '向下查看评论 ↓' }).click()
  await lyricsFrame.locator('#comments .comment').first().waitFor({ timeout: 30000 })
  const lyricsChild = page.frames().find((entry) => entry.url().endsWith('/ui/page.html'))
  await lyricsChild.waitForFunction(() => scrollY > innerHeight * 0.6, null, {
    polling: 100,
    timeout: 15000
  })
  await page.screenshot({ path: join(output, 'player-lyrics-comments.png') })
  results.checks.push('independent-lyrics-page-installed', 'scroll-from-lyrics-to-comments')
  results.errors = errors
  assert.deepEqual(errors, [])
  results.passed = true
} catch (error) {
  results.error = error.stack
  console.error(
    'recent plugin calls',
    await app.evaluate(() => global.__commentsTestOperations).catch(() => [])
  )
  const page = await app.firstWindow().catch(() => null)
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    console.error(
      'panel state',
      await page
        .locator('body')
        .innerText()
        .then((text) => text.slice(-1800))
        .catch(() => 'unavailable')
    )
    const child = page.frames().find((frame) => frame.url().startsWith('plugin-ui:'))
    if (child)
      console.error(
        'plugin text',
        await child
          .locator('body')
          .innerText()
          .catch(() => 'unavailable')
      )
  }
  throw error
} finally {
  await writeFile(join(output, 'smoke-result.json'), JSON.stringify(results, null, 2))
  await app.close().catch(() => {})
}
console.log(JSON.stringify(results, null, 2))
