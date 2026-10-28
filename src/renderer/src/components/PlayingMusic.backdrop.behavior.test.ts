import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { compileStyle, parse } from '@vue/compiler-sfc'

const require = createRequire(import.meta.url)

test('dark cover backgrounds dither the final composite without affecting other modes or foreground', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-playback-backdrop-'))
  try {
    const source = await readFile(new URL('./PlayingMusic.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    const template = descriptor.template!.content.match(
      /<div v-if="!visualizerMounted" class="backdrop"[\s\S]*?\n        <\/div>/
    )?.[0]
    assert.ok(template, 'fixture must render the production backdrop template')
    const compiled = compileStyle({
      source: descriptor.styles[0].content,
      filename: 'PlayingMusic.vue',
      id: 'data-v-backdrop-test',
      scoped: true
    })
    assert.deepEqual(compiled.errors, [])
    const noise = await readFile(new URL('../assets/images/playback-dither.svg', import.meta.url))
    const css = compiled.code.replace(
      '../assets/images/playback-dither.svg',
      `data:image/svg+xml;base64,${noise.toString('base64')}`
    )
    await copyFile(require.resolve('vue/dist/vue.global.js'), join(directory, 'vue.js'))
    await writeFile(join(directory, 'index.html'), fixtureHtml(template, css))
    await writeFile(join(directory, 'runner.cjs'), runnerSource())
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const { stdout } = await promisify(execFile)(
      require('electron') as string,
      ['--no-sandbox', '--force-device-scale-factor=1', join(directory, 'runner.cjs')],
      { env, windowsHide: true, timeout: 45_000 }
    )
    assert.match(stdout, /PLAYBACK_BACKDROP_OK/)
  } finally {
    assert.ok(directory.startsWith(join(tmpdir(), 'twilight-playback-backdrop-')))
    await rm(directory, { recursive: true, force: true })
  }
})

function fixtureHtml(template: string, css: string): string {
  return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>
  :root { --te-player-bg: #0b0f15; --te-ease-out-strong: ease-out }
  body { margin: 0 }
  ${css}
  #foreground { position: absolute; z-index: 1; top: 32px; left: 32px; width: 180px;
    height: 80px; border: 0; background: #234567; color: white; font-size: 20px }
  html[data-baseline] .backdrop::after { content: none !important }
  html[data-baseline] .backdrop { isolation: auto !important }
  </style></head><body><div id="app"></div><script src="vue.js"></script><script>
  const { createApp, ref, computed, nextTick } = Vue
  const mode = ref('blur'), currentTrack = ref(null), visualizerMounted = ref(false)
  const cover = (colors) => 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">' +
    '<defs><linearGradient id="c" x2="1" y2="1"><stop stop-color="' + colors[0] +
    '"/><stop offset=".48" stop-color="' + colors[1] + '"/><stop offset="1" stop-color="' +
    colors[2] + '"/></linearGradient></defs><path fill="url(#c)" d="M0 0h800v800H0z"/></svg>')
  const covers = [cover(['#00684c', '#bf987b', '#14375b']), cover(['#040710', '#2c4877', '#b5bbc4'])]
  currentTrack.value = { id: '0', cover: covers[0] }
  createApp({
    __scopeId: 'data-v-backdrop-test',
    components: { CoverImg: { props: ['cover', 'coverSource', 'identity'], template: '<img :src="cover">' } },
    setup: () => ({ mode, currentTrack, visualizerMounted, hasSwitchedPlaybackView: true,
      isBlurBackground: computed(() => mode.value === 'blur'),
      isFluidBackground: computed(() => mode.value === 'fluid'),
      isSolidBackground: computed(() => mode.value === 'solid'),
      coverIdentity: computed(() => currentTrack.value?.id) }),
    template: ${JSON.stringify(`<div class="playing-music" :class="'bg-' + mode" style="--accent-color: #168864">${template}<button id="foreground">播放 / 暂停</button></div>`)}
  }).mount('#app')
  window.configure = async ({ theme = 'dark', background = 'blur', track = 0, visualizer = false, motion = 'off', baseline = false } = {}) => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.teMotion = motion
    document.documentElement.toggleAttribute('data-baseline', baseline)
    mode.value = background
    visualizerMounted.value = visualizer
    currentTrack.value = track === null ? null : { id: String(track), cover: covers[track] }
    await nextTick()
    await Promise.all([...document.images].map(image => image.decode()))
    await new Promise(resolve => setTimeout(resolve, 650))
  }
  </script></body></html>`
}

function runnerSource(): string {
  return `const { app, BrowserWindow } = require('electron')
  const assert = require('node:assert/strict')
  const { join } = require('node:path')
  const { mkdir, writeFile } = require('node:fs/promises')
  const profile = process.env.TWILIGHT_ELECTRON_USER_DATA_DIR || join(__dirname, 'profile')
  app.setPath('userData', profile)
  app.commandLine.appendSwitch('disk-cache-dir', join(profile, 'cache'))
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 2560, height: 1440, useContentSize: true,
      webPreferences: { contextIsolation: true, backgroundThrottling: false, offscreen: true } })
    const js = code => win.webContents.executeJavaScript(code)
    const configure = options => js('window.configure(' + JSON.stringify(options) + ')')
    const capture = async () => {
      const image = await win.webContents.capturePage()
      return { image, pixels: image.toBitmap(), ...image.getSize() }
    }
    const stats = (before, after) => {
      assert.equal(before.width, after.width)
      let changed = 0, sum = 0, max = 0, count = 0, foregroundChanges = 0
      for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
        const foreground = x >= 32 && x < 212 && y >= 32 && y < 112
        for (let c = 0; c < 3; c++) {
          const i = (y * before.width + x) * 4 + c
          const delta = after.pixels[i] - before.pixels[i]
          if (foreground) { foregroundChanges += delta !== 0; continue }
          changed += delta !== 0; sum += delta; max = Math.max(max, Math.abs(delta)); count++
        }
      }
      return { changed: changed / count, mean: sum / count, max, foregroundChanges }
    }
    const longestFlatRun = frame => {
      const y = Math.floor(frame.height / 2)
      let longest = 1, run = 1
      for (let x = 513; x < 2048; x++) {
        const i = (y * frame.width + x) * 4
        const same = [0, 1, 2].every(c => frame.pixels[i + c] === frame.pixels[i - 4 + c])
        run = same ? run + 1 : 1
        longest = Math.max(longest, run)
      }
      return longest
    }
    try {
      await win.loadFile(join(__dirname, 'index.html'))
      const visualDir = process.env.TWILIGHT_BACKDROP_VISUAL_DIR
      if (visualDir) await mkdir(visualDir, { recursive: true })
      for (const track of [0, 1]) {
        await configure({ track, baseline: true })
        const before = await capture()
        assert.equal(before.width, 2560); assert.equal(before.height, 1440)
        await configure({ track })
        const after = await capture()
        const result = stats(before, after)
        const flatRuns = [longestFlatRun(before), longestFlatRun(after)]
        console.log('DITHER', track, JSON.stringify({ ...result, flatRuns }))
        if (visualDir) {
          await writeFile(join(visualDir, 'cover-' + track + '-before.png'), before.image.toPNG())
          await writeFile(join(visualDir, 'cover-' + track + '-after.png'), after.image.toPNG())
          await writeFile(join(visualDir, 'cover-' + track + '-metrics.json'), JSON.stringify({ ...result, flatRuns }, null, 2))
        }
        assert.ok(result.changed > 0.1, 'noise must survive all dimming/gradient layers')
        assert.ok(result.max <= 4, 'grain must stay subtle')
        assert.ok(flatRuns[1] < flatRuns[0] / 2, 'long flat color steps must be broken up')
        assert.ok(Math.abs(result.mean) < 0.25, 'grain must not lift blacks or shift the palette')
        assert.equal(result.foregroundChanges, 0, 'grain leaked onto foreground controls')
        const repeated = await capture()
        assert.equal(after.pixels.equals(repeated.pixels), true, 'static grain must not shimmer')
      }
      for (const options of [{ theme: 'light' }, { theme: 'pureWhite' }, { background: 'solid' }, { background: 'fluid' }, { track: null }]) {
        await configure(options)
        assert.equal(await js('getComputedStyle(document.querySelector(".backdrop"), "::after").content'), 'none', JSON.stringify(options))
        assert.equal(await js('getComputedStyle(document.querySelector(".backdrop")).isolation'), 'auto', JSON.stringify(options))
      }
      await configure({ motion: 'reduced' })
      assert.equal(await js('getComputedStyle(document.querySelector(".backdrop")).isolation'), 'isolate')
      assert.equal(await js('getComputedStyle(document.querySelector(".backdrop"), "::after").pointerEvents'), 'none')
      assert.equal(await js('document.elementFromPoint(64, 64).id'), 'foreground')
      await configure({ visualizer: true })
      assert.equal(await js('document.querySelector(".backdrop")'), null)
      console.log('PLAYBACK_BACKDROP_OK')
      app.exit(0)
    } catch (error) { console.error(error.stack); app.exit(1) }
  })`
}
