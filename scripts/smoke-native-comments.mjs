import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const output = resolve('output/playwright/native-comments')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(output, 'profile-'))
const media = join(profile, 'media')
await mkdir(media)
const tracks = []
const cover = 'data:image/png;base64,' + (await readFile('build/icon.png')).toString('base64')
for (const [id, ncmSongId] of [
  ['native-known', 186016],
  ['native-unmatched', undefined]
]) {
  const samples = Buffer.alloc(44100 * 2 * 10),
    header = Buffer.alloc(44)
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
  const filePath = join(media, id + '.wav')
  await writeFile(filePath, Buffer.concat([header, samples]))
  const lyrics = Array.from(
    { length: 30 },
    (_, index) => `[00:${String(index).padStart(2, '0')}.00]滚动浏览歌词 ${index + 1}`
  ).join('\n')
  await writeFile(join(media, id + '.lrc'), lyrics)
  tracks.push({
    id,
    ncmSongId,
    source: 'local',
    title: id,
    artist: 'Test Artist',
    album: 'Test Album',
    fileName: id + '.wav',
    filePath,
    dir: media,
    duration: 10,
    size: samples.length + 44,
    cover,
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
    theme: 'pureWhite',
    proxyMode: 'off',
    playerBar: {
      mode: 'compact',
      modeSource: 'user',
      playingPageMode: 'compact',
      visibility: 'visible',
      playingPageVisibility: 'visible'
    }
  })
)
const env = {
  ...process.env,
  NCM_COMMENTS_TEST_PROFILE: profile,
  NCM_COMMENTS_TEST_PACKAGE: process.env.NCM_COMMENTS_TEST_PACKAGE || resolve('dist/win-unpacked')
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: require('electron'),
  args: [
    resolve('packages/ncm-comments/scripts/bootstrap.cjs'),
    '--mute-audio',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'
  ],
  env,
  timeout: 60000
})
const results = { profile, checks: [], errors: [] }
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => results.errors.push(error.message))
  let connection
  for (let attempt = 0; attempt < 100 && !connection; attempt++) {
    connection = await app.evaluate(() => [...global.__commentsTestConnections.values()].at(-1))
    if (!connection) await page.waitForTimeout(200)
  }
  assert.ok(connection)
  const request = async (name, payload = {}, kind = 'command') => {
    for (let attempt = 0; ; attempt++) {
      const result = await page.evaluate(
        ({ connection, name, payload, kind }) =>
          window.api.core.request(connection.connectionId, {
            kind,
            name,
            payload,
            epoch: connection.snapshot.epoch,
            requestId: crypto.randomUUID()
          }),
        { connection, name, payload, kind }
      )
      if (result.ok) return result.value
      if (result.error.code !== 'NOT_READY' || attempt >= 100)
        throw Error(JSON.stringify(result.error))
      await page.waitForTimeout(200)
    }
  }
  const panel = page.locator('[data-native-comments]')
  const prompt = page.getByRole('button', { name: '暂不开启', exact: true })
  await prompt
    .waitFor({ timeout: 5000 })
    .then(() => prompt.click())
    .catch(() => {})
  const plugins = await request('plugins.list', {}, 'query')
  assert.equal(
    plugins.some((item) => item.id === 'com.twilightecho.tool.ncm-comments'),
    false
  )
  assert.equal(await page.locator('.native-comments-button').count(), 0)
  assert.equal(await panel.count(), 0)
  const select = (id) =>
    request('queue.fromQuery', {
      query: { ids: [id], sort: 'playlist' },
      selectedId: id,
      play: false
    })
  await select('native-known')
  const lyricsState = await request('lyrics.state', {}, 'query')
  assert.ok(lyricsState.current)
  await request('lyrics.reload', lyricsState.current)
  await page.locator('.player-cover-slot[title="打开播放页面"]').first().click()
  const playing = page.locator('.playing-music')
  await playing.waitFor()
  await page.waitForFunction(
    () => {
      const node = document.querySelector('.playing-music')
      return (
        node &&
        !node.classList.contains('playing-page-enter-active') &&
        getComputedStyle(node).transform === 'none'
      )
    },
    null,
    { polling: 100 }
  )
  await playing.locator('.lyrics-scroll').waitFor()
  assert.equal(await panel.count(), 0)
  const before = await request('state.snapshot', {}, 'query')
  const lyrics = await playing.locator('.lyrics-scroll').boundingBox()
  assert.ok(
    await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.lyrics-column'),
      { x: lyrics.x + lyrics.width / 2, y: lyrics.y + lyrics.height / 2 }
    )
  )
  await page.mouse.move(lyrics.x + lyrics.width / 2, lyrics.y + lyrics.height / 2)
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(150)
  assert.equal(await playing.evaluate((node) => Math.round(node.scrollTop)), 0)
  assert.equal(await panel.count(), 0)
  await page.screenshot({ path: join(output, 'native-player-before.png') })
  results.checks.push(
    'no-plugin-or-playbar-button',
    'original-playback-page',
    'comments-lazy-before-scroll',
    'lyrics-wheel-stays-in-lyrics'
  )
  const scrollIntoComments = async () => {
    const cover = await playing.locator('.cover-frame').boundingBox()
    await page.mouse.move(cover.x + cover.width / 2, Math.max(90, cover.y + cover.height / 2))
    await page.mouse.wheel(0, 900)
    await page.waitForFunction(
      () => document.querySelector('.playing-music').scrollTop > 100,
      null,
      { polling: 100 }
    )
    await panel.waitFor({ timeout: 30000 })
  }
  const alignComments = () =>
    playing.evaluate((node) => {
      node.scrollTop = node.querySelector('.playing-comments').offsetTop - 48
    })
  await scrollIntoComments()
  await panel.locator('.comment-row').nth(19).waitFor({ timeout: 45000 })
  await alignComments()
  assert.equal(await panel.locator('iframe').count(), 0)
  assert.equal(await playing.locator('[data-native-comments]').count(), 1)
  await page.screenshot({ path: join(output, 'native-comments-light.png') })
  assert.equal(
    await panel
      .locator('.comment-action')
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)'
  )
  const playBox = await page.locator('.player-bar .btn-play').boundingBox()
  assert.ok(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.player-bar'), {
      x: playBox.x + playBox.width / 2,
      y: playBox.y + playBox.height / 2
    })
  )
  assert.equal(
    await panel.evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)'
  )
  assert.equal(
    await playing
      .locator('.playing-page-background')
      .evaluate((node) => getComputedStyle(node).position),
    'fixed'
  )
  await panel.getByRole('tab', { name: '最新', exact: true }).click()
  await panel.locator('.comment-row').nth(19).waitFor({ timeout: 30000 })
  await panel.getByRole('button', { name: '加载更多评论', exact: true }).click()
  await panel.locator('.comment-row').nth(20).waitFor({ timeout: 30000 })
  const ids = await panel
    .locator('.comment-row')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.commentId))
  assert.equal(new Set(ids).size, ids.length)
  results.checks.push(
    'cover-wheel-enters-comments',
    'comments-embedded-under-original-player',
    'live-hot-comments',
    'live-latest-page-two'
  )
  const settings = await request('settings.state', {}, 'query')
  await request('settings.edit', { revision: settings.revision, patch: { theme: 'dark' } })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, {
    polling: 100
  })
  assert.equal(
    await panel.evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)'
  )
  assert.equal(
    await panel.evaluate((node) => getComputedStyle(node).color),
    await playing.evaluate((node) => getComputedStyle(node).color)
  )
  await alignComments()
  await page.screenshot({ path: join(output, 'native-comments-dark.png') })
  await panel.getByRole('button', { name: '回到歌词', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.playing-music').scrollTop < 2, null, {
    polling: 100
  })
  await panel.waitFor({ state: 'detached' })
  const after = await request('state.snapshot', {}, 'query')
  assert.equal(after.track?.id, before.track?.id)
  assert.equal(after.playback.state, before.playback.state)
  results.checks.push(
    'native-theme-sync',
    'back-to-lyrics-unmounts-comments',
    'scroll-preserves-playback-state'
  )
  await playing.getByRole('button', { name: '向下滚动查看评论', exact: true }).click()
  await panel.locator('.comment-row').first().waitFor({ timeout: 30000 })
  await select('native-unmatched')
  await page.waitForFunction(() => document.querySelector('.playing-music').scrollTop < 2, null, {
    polling: 100
  })
  await panel.waitFor({ state: 'detached' })
  await scrollIntoComments()
  await panel.locator('#native-song-link').waitFor({ timeout: 30000 })
  assert.equal(await panel.locator('.comment-row').count(), 0)
  await panel.locator('#native-song-link').fill('186016')
  await panel.getByRole('button', { name: '关联', exact: true }).click()
  await panel.locator('.comment-row').first().waitFor({ timeout: 30000 })
  assert.ok((await panel.locator('.association').innerText()).includes('手动关联'))
  await panel.getByRole('button', { name: '回到歌词', exact: true }).click()
  await panel.waitFor({ state: 'detached' })
  await playing.getByRole('button', { name: '向下滚动查看评论', exact: true }).click()
  await panel.locator('.comment-row').first().waitFor({ timeout: 30000 })
  assert.ok((await panel.locator('.association').innerText()).includes('手动关联'))
  results.checks.push(
    'track-change-resets-page-and-cancels-comments',
    'manual-association-survives-section-reopen'
  )
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(
      (w) => w.isVisible() && w.webContents.getURL().includes('index.html')
    )
    win.setMinimumSize(480, 520)
    win.setContentSize(560, 800)
  })
  await alignComments()
  assert.ok(await playing.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
  await page.screenshot({ path: join(output, 'native-comments-narrow.png') })
  results.checks.push('narrow-page-no-horizontal-overflow')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await playing.waitFor({ state: 'detached' })
  assert.equal(await panel.count(), 0)
  results.checks.push('leaving-playback-page-removes-comments')

  assert.deepEqual(results.errors, [])
  results.passed = true
} catch (error) {
  results.error = error.stack
  const page = await app.firstWindow().catch(() => null)
  if (page) {
    console.error(
      'scroll metrics',
      await page.evaluate(() =>
        Object.fromEntries(
          ['.playing-music', '.playing-music-stage', '.playing-comments', '.lyrics-column'].map(
            (selector) => {
              const node = document.querySelector(selector)
              return [
                selector,
                node
                  ? {
                      top: node.getBoundingClientRect().top,
                      height: node.getBoundingClientRect().height,
                      scrollTop: node.scrollTop,
                      overflow: getComputedStyle(node).overflowY
                    }
                  : null
              ]
            }
          )
        )
      )
    )
    await page.screenshot({ path: join(output, 'failure.png') })
    console.error((await page.locator('body').innerText()).slice(-1800))
  }
  throw error
} finally {
  await writeFile(join(output, 'result.json'), JSON.stringify(results, null, 2))
  await app.close().catch(() => {})
}
console.log(JSON.stringify(results, null, 2))
