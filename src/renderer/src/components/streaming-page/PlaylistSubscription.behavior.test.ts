import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../../../', import.meta.url))

test('playlist page keeps playback actions beside the account subscription control in every state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-playlist-subscription-'))
  try {
    await writeFile(
      join(directory, 'entry.ts'),
      `
import {createApp,h,ref,nextTick,effectScope} from 'vue'
import '@renderer/assets/main.css'
import Stage from '@renderer/components/streaming-page/StreamingDetailStage.vue'
import {usePlaylistSubscription} from '@renderer/components/streaming-page/usePlaylistSubscription.ts'
const playlist=ref({id:7,name:'华语精选 · 夜晚',cover:null,trackCount:2}),enabled=ref(true)
let server=false,fail=false,release=null,plays=0
const writes=[]
const controller=effectScope().run(()=>usePlaylistSubscription({playlist:()=>playlist.value,enabled:()=>enabled.value,scope:()=>1,captureSession:()=>()=>true,
fetchState:async()=>({owned:false,subscribed:server}),subscribe:async(_,value)=>{writes.push(value);await new Promise(resolve=>release=resolve);if(fail)throw Error('收藏失败，请稍后重试');server=value}}))
const tracks=[{id:'ncm:1',title:'夜空中最亮的星',artist:'逃跑计划',album:'世界',duration:252,source:'ncm',cover:null},{id:'ncm:2',title:'晴天',artist:'周杰伦',album:'叶惠美',duration:269,source:'ncm',cover:null}]
createApp({render:()=>h(Stage,{kind:'playlist',title:playlist.value.name,trackCountLabel:'2 首',tracks,isSelected:()=>false,isTrackLiked:()=>false,isLiking:()=>false,formatTime:()=> '4:12',playlistSubscription:controller.control.value,onSubscribePlaylist:controller.toggle,onPlayAll:()=>plays++})}).mount('#app')
const settle=async()=>{await nextTick();await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,50));await nextTick()}
const expect=(condition,message)=>{if(!condition)throw Error(message)}
const button=()=>document.querySelector('.stage-playlist-subscribe')
window.verifyPlaylist=async()=>{
await settle();expect(button()?.textContent.trim()==='收藏','Missing uncollected action');expect(document.querySelector('.stage-actions').textContent.includes('播放全部'),'Playback action replaced');expect(document.querySelector('.stage-actions').textContent.includes('随机'),'Shuffle action replaced');document.querySelector('.stage-btn-primary').click();expect(plays===1,'Play action broken');
button().click();await nextTick();expect(button().disabled&&button().getAttribute('aria-busy')==='true','Write must disable button');button().click();expect(writes.length===1,'Double-click duplicated write');release();await settle();expect(button().textContent.trim()==='已收藏'&&button().getAttribute('aria-pressed')==='true','Confirmation did not update state');
button().click();await nextTick();release();await settle();expect(button().textContent.trim()==='收藏','Unsubscribe did not update state');expect(JSON.stringify(writes)==='[true,false]','Wrong desired state');
fail=true;button().click();await nextTick();release();await settle();expect(button().textContent.trim()==='收藏','Rejected write changed favorite state');expect(document.querySelector('[role=alert]')?.textContent.includes('收藏失败'),'Error was hidden');
playlist.value={...playlist.value,owned:true};await settle();expect(!button(),'Own playlist has a subscribe action');playlist.value={...playlist.value,id:8,owned:false};enabled.value=false;await settle();expect(!button(),'Signed-out account has a write action');enabled.value=true;await settle();return true
}
window.capturePlaylist=async(theme)=>{document.documentElement.dataset.theme=theme;await settle();await new Promise(resolve=>setTimeout(resolve,350));expect(!button().disabled,'Subscription control stayed disabled after state refresh');expect(document.documentElement.scrollWidth<=innerWidth,'Page overflows');const play=document.querySelector('.stage-btn-primary').getBoundingClientRect(),subscribe=button().getBoundingClientRect();expect(subscribe.top>=play.top,'Subscription is outside the action group');return true}
`
    )
    await build({
      configFile: false,
      root,
      logLevel: 'error',
      plugins: [vue()],
      define: { 'process.env.NODE_ENV': '"production"' },
      resolve: {
        alias: {
          '@renderer': join(root, 'src/renderer/src'),
          vue: require.resolve('vue/dist/vue.esm-bundler.js')
        }
      },
      build: {
        outDir: join(directory, 'bundle'),
        minify: false,
        lib: {
          entry: join(directory, 'entry.ts'),
          name: 'PlaylistSubscription',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html data-theme="light"><head><meta charset="utf-8">${files
        .filter((f) => f.endsWith('.css'))
        .map((f) => `<link rel="stylesheet" href="bundle/${f}">`)
        .join(
          ''
        )}<style>html,body{margin:0;min-height:100%;width:100%}body{background:var(--te-bg-main,#f6f6f8)}#app{padding:32px;box-sizing:border-box;min-height:100vh}</style></head><body><div id="app"></div><script src="bundle/${files.find((f) => f.endsWith('.iife.js'))}"></script></body></html>`
    )
    await writeFile(
      join(directory, 'runner.cjs'),
      `
const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{offscreen:true,backgroundThrottling:false}});await win.loadFile(path.join(__dirname,'index.html'));await win.webContents.executeJavaScript('window.verifyPlaylist()');const output=process.argv.at(-1);await fs.mkdir(output,{recursive:true});for(const [theme,width] of [['light',1280],['dark',780]]){win.setSize(width,800);await win.webContents.executeJavaScript('window.capturePlaylist('+JSON.stringify(theme)+')');await fs.writeFile(path.join(output,theme+'.png'),(await win.webContents.capturePage()).toPNG())}console.log('PLAYLIST_SUBSCRIPTION_OK');app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}})
`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(
      require('electron'),
      [
        '--no-sandbox',
        join(directory, 'runner.cjs'),
        join(root, '.local/playlist-subscription-20261102/visual')
      ],
      { env, windowsHide: true, timeout: 60000, maxBuffer: 2 * 1024 ** 2 }
    )
    assert.match(result.stdout, /PLAYLIST_SUBSCRIPTION_OK/)
  } finally {
    assert(directory.startsWith(join(tmpdir(), 'twilight-playlist-subscription-')))
    await rm(directory, { recursive: true, force: true })
  }
})
