import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parse } from '@vue/compiler-sfc'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../../', import.meta.url))

test('playback artwork keeps its corners throughout async image changes and analysis transitions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-cover-corners-'))
  try {
    const source = parse(
      await readFile(join(root, 'src/renderer/src/components/PlayingMusic.vue'), 'utf8')
    ).descriptor
    const frame = source.template!.content.match(
      /<div class="cover-frame"[\s\S]*?<\/Transition>\s*<\/div>/
    )?.[0]
    assert.ok(frame, 'Missing production cover frame')
    const css = source.styles.map((s) => s.content).join('\n')
    await writeFile(
      join(directory, 'loader.ts'),
      `
export const requests=[]
export const readCachedCover=()=>null
export const resolveCover=()=>new Promise(resolve=>requests.push(resolve))
export const invalidateRemoteCoverGrant=()=>{}
export const clearLocalCoverDataCache=()=>{}
`
    )
    await writeFile(
      join(directory, 'Fixture.vue'),
      `
<script setup>
import {ref,nextTick} from 'vue'
import CoverImg from '@renderer/components/CoverImg.vue'
import {requests} from './loader.ts'
const currentTrack=ref({id:'one',cover:'cover:one'}),lyricMotionLevel=ref('full'),coverStyle=ref({'--te-playback-cover-radius':'32px'})
const analysis={open:ref(false),project:ref(null),mode:ref('six'),tracks:ref([]),error:ref(''),changeMix(){},family(){},split(){},store:{core:{command:async()=>{}}}}
const chordPosition=ref(0)
const SongAnalysisPanel={template:'<div class="song-analysis-panel" style="position:absolute;inset:0;width:460px;color:white">人声&#12288;鼓&#12288;贝斯&#12288;吉他&#12288;钢琴&#12288;其他乐器</div>'}
const cover=color=>'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><path fill="'+color+'" d="M0 0h320v320H0z"/></svg>')
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const samples=[]
function sample(){const host=document.querySelector('.cover-frame'),images=[...host.querySelectorAll('img')],frame=getComputedStyle(host);const rounded=images.every(image=>{const style=getComputedStyle(image);return style.display==='none'||parseFloat(style.opacity)<.01||frame.overflow==='hidden'||parseFloat(style.borderTopLeftRadius)>0});const loadingTransition=images.some(image=>image.className.includes('analysis-view-'));samples.push({rounded,loadingTransition,overflow:frame.overflow,images:images.length});return {rounded,loadingTransition}}
async function monitor(ms){const until=performance.now()+ms;while(performance.now()<until){sample();await new Promise(requestAnimationFrame)}}
window.coverQa={samples,async load(){await pause(80);requests.shift()(cover('#33cc99'));await nextTick();await monitor(400);await document.querySelector('.cover-frame img').decode();return samples},async cycle(mode){lyricMotionLevel.value=mode;document.documentElement.dataset.teMotion=mode;await nextTick();currentTrack.value={id:'two-'+mode,cover:'cover:two-'+mode};await nextTick();requests.shift()(cover('#ffcc44'));await nextTick();await monitor(330);analysis.open.value=true;await nextTick();await pause(350);analysis.open.value=false;await nextTick();await pause(25);requests.shift()(cover('#33cc99'));await nextTick();await monitor(400);return true},open(){analysis.open.value=true},async inspectFrame(kind){document.documentElement.dataset.teArtworkFrame=kind;await nextTick();const frame=document.querySelector('.cover-frame').getBoundingClientRect();return {radius:parseFloat(getComputedStyle(document.querySelector('.cover-frame img')).borderTopLeftRadius),width:frame.width,height:frame.height}},async inspectSquareSetting(){coverStyle.value={'--te-playback-cover-radius':'0px'};await nextTick();return getComputedStyle(document.querySelector('.cover-frame')).borderTopLeftRadius}}
</script>
<template><main class="playing-music"><div class="cover-column">${frame}</div></main></template>
<style scoped>${css}
.playing-music{position:relative;height:100vh;display:grid;place-items:center;background:#182330}.cover-column{width:320px;min-height:0}.cover-frame{width:320px!important}
</style>
`
    )
    await writeFile(
      join(directory, 'entry.ts'),
      `import {createApp} from 'vue';import Fixture from './Fixture.vue';createApp(Fixture).mount('#app')`
    )
    await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: 'error',
      plugins: [vue()],
      define: { 'process.env.NODE_ENV': '"production"' },
      resolve: {
        alias: [
          { find: '../utils/coverLoader.ts', replacement: join(directory, 'loader.ts') },
          { find: '@renderer', replacement: join(root, 'src/renderer/src') },
          { find: 'vue', replacement: require.resolve('vue/dist/vue.esm-bundler.js') }
        ]
      },
      build: {
        outDir: join(directory, 'bundle'),
        minify: false,
        lib: {
          entry: join(directory, 'entry.ts'),
          name: 'CoverCorners',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">${files
        .filter((f) => f.endsWith('.css'))
        .map((f) => `<link rel="stylesheet" href="bundle/${f}">`)
        .join(
          ''
        )}<style>body{margin:0} :root{--te-motion-panel:280ms;--te-motion-return:220ms;--te-motion-page:300ms;--te-ease-spring:ease;--te-ease-soft:ease}</style></head><body><div id="app"></div><script src="bundle/${files.find((f) => f.endsWith('.iife.js'))}"></script></body></html>`
    )
    await writeFile(
      join(directory, 'runner.cjs'),
      `
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{try{
 const win=new BrowserWindow({show:false,width:800,height:600,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const js=code=>win.webContents.executeJavaScript(code);
 await win.loadFile(path.join(__dirname,'index.html'));
 const result=await js('window.coverQa.load()'),output=process.argv.at(-1);
 await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'loading-samples.json'),JSON.stringify(result,null,2));
 assert(result.every(row=>row.rounded),'Loaded artwork lost its rounded clip');
 assert(result.every(row=>!row.loadingTransition),'Bitmap resolution incorrectly triggers the analysis transition');
 for(const mode of ['full','reduced','off'])await js('window.coverQa.cycle('+JSON.stringify(mode)+')');
 const samples=await js('window.coverQa.samples');assert(samples.every(row=>row.rounded),'Artwork lost its clip while switching analysis or track');
 for(const [kind,radius] of [['plain',32],['glass-frame',24],['polaroid',22],['vinyl',999]]){
   const frame=await js('window.coverQa.inspectFrame('+JSON.stringify(kind)+')');
   assert.equal(frame.radius,radius,'Theme image corner override changed: '+kind);
   if(kind==='plain')assert(Math.abs(frame.width-frame.height)<1,'Artwork is no longer square');
 }
 await js('window.coverQa.inspectFrame("plain")');
 await fs.writeFile(path.join(output,'cover-rounded.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(await js('window.coverQa.inspectSquareSetting()'),'0px','User square-corner setting was overridden');
 console.log('COVER_CORNERS_OK '+samples.length);app.exit(0)
}catch(error){console.error(error.stack);app.exit(1)}})
`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(
      require('electron'),
      [
        '--no-sandbox',
        join(directory, 'runner.cjs'),
        join(root, '.local/cover-corners-20261102/visual')
      ],
      { env, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 ** 2 }
    )
    assert.match(result.stdout, /COVER_CORNERS_OK/)
  } finally {
    assert(directory.startsWith(join(tmpdir(), 'twilight-cover-corners-')))
    await rm(directory, { recursive: true, force: true })
  }
})
