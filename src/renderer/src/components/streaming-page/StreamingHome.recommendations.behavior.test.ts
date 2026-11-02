import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../../../', import.meta.url))

test('the real streaming recommendation home supports entries, details, refresh, charts and recent playback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-streaming-home-'))
  try {
    const page = await readFile(join(root, 'src/renderer/src/components/StreamingPage.vue'), 'utf8')
    assert.match(page, /:home-entries="homeEntries\.entries\.value"/)
    assert.match(page, /@open-home-entry="homeEntries\.open"/)
    assert.match(
      page,
      /providerId === 'ncm' && \(section\.key === 'fm' \|\| section\.key === 'radar'\)/
    )
    let visuals: unknown = {}
    if (process.env.TWILIGHT_STREAMING_HOME_FIXTURE)
      visuals = JSON.parse(await readFile(process.env.TWILIGHT_STREAMING_HOME_FIXTURE, 'utf8'))
    await writeFile(
      join(directory, 'fixture.ts'),
      `export const visuals=${JSON.stringify(visuals)};\n${fixture}`
    )
    await writeFile(join(directory, 'entry.ts'), runtime)
    await build({
      configFile: false,
      root,
      logLevel: 'error',
      plugins: [vue()],
      resolve: {
        alias: [
          {
            find: /^@renderer\/stores\/use(?:Provider|Player)Store$/,
            replacement: join(directory, 'fixture.ts')
          },
          { find: '../stores/useSettingsStore', replacement: join(directory, 'fixture.ts') },
          {
            find: 'primeicons/primeicons.css',
            replacement: require.resolve('primeicons/primeicons.css')
          },
          {
            find: '@phosphor-icons/web/src/regular/style.css',
            replacement: join(root, 'node_modules/@phosphor-icons/web/src/regular/style.css')
          },
          {
            find: '@phosphor-icons/web/src/fill/style.css',
            replacement: join(root, 'node_modules/@phosphor-icons/web/src/fill/style.css')
          },
          { find: '@renderer', replacement: join(root, 'src/renderer/src') },
          { find: 'vue', replacement: require.resolve('vue/dist/vue.esm-bundler.js') }
        ]
      },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: join(directory, 'bundle'),
        lib: {
          entry: join(directory, 'entry.ts'),
          name: 'StreamingHomeTest',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html lang="zh-CN" data-te-motion="off"><head><meta charset="utf-8">${files
        .filter((f) => f.endsWith('.css'))
        .map((f) => `<link rel="stylesheet" href="bundle/${f}">`)
        .join(
          ''
        )}<style>body{margin:0;background:var(--te-bg-primary)}#app{padding:24px 32px 80px;max-width:1360px;margin:auto;box-sizing:border-box}button{font:inherit}@media(max-width:600px){#app{padding:16px}}</style></head><body><div id="app"></div><script src="bundle/${files.find((f) => f.endsWith('.js'))}"></script></body></html>`
    )
    await writeFile(join(directory, 'runner.cjs'), runner)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(
      require('electron'),
      ['--no-sandbox', join(directory, 'runner.cjs'), join(directory, 'index.html')],
      { windowsHide: true, env, timeout: 90_000 }
    )
    assert.match(result.stdout, /STREAMING_HOME_OK/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const fixture = `import {computed,ref,shallowRef} from 'vue'
export const source={id:'ncm',name:'网易云音乐',capabilities:['login','playbackUrl'],supportedMethods:['fetchRecommendSongs','fetchIntelligenceList','fetchLikedTracksPage','fetchUserLibrary','fetchPrivateContent','fetchPersonalFm','fetchPlaylistTracks','fetchToplists']}
export const providers=ref([source]),loggedIn=ref(true),currentTrack=shallowRef(null),isPlaying=ref(false)
export const commands=[],events=[],played=[]
export const song=(id,index=0)=>({id:'ncm:'+id,source:'ncm',title:'测试歌曲 '+id,artist:'测试艺人',album:'测试专辑',cover:visuals.tracks?.[index]?.cover||null,duration:180,...visuals.tracks?.[index],lyrics:null,filePath:'',fileName:'',size:0})
export const daily=Array.from({length:12},(_,i)=>song(i+1,i))
export const playlists=visuals.playlists||Array.from({length:20},(_,i)=>({id:i+100,name:['给耳朵放个假','在城市里听见晚风','适合练琴的旋律','沿着海岸线','日落之后','把好心情放进耳机'][i%6],cover:null,trackCount:20}))
export const charts=[19723756,3779629,3778678,2884035,999].map((id,i)=>({id,name:['飙升榜','新歌榜','热歌榜','原创榜','数字专辑畅销榜'][i],trackCount:100,cover:daily[i].cover,previewTracks:daily.slice(i,i+3).map(t=>({title:t.title,artist:t.artist}))}))
export const useProviderStore=()=>({providers,checkLogin:async()=>({loggedIn:loggedIn.value,profile:null}),callProvider:async(_id,method)=>method==='fetchToplists'?charts:daily})
export const usePlayerStore=()=>({currentTrack,isPlaying,playTrack:async(track,queue)=>{played.push({track,queue});currentTrack.value=track;isPlaying.value=true},togglePlay:async()=>{isPlaying.value=!isPlaying.value}})
export const settings=ref({motionPreference:'off'}),useSettingsStore=()=>({settings})
`
const runtime = `import {createApp,h,nextTick,computed,ref} from 'vue'
import Home from '@renderer/components/StreamingHome.vue'
import Charts from '@renderer/components/local-dashboard/NcmToplists.vue'
import {useStreamingHomeEntries} from '@renderer/components/streaming-page/useStreamingHomeEntries.ts'
import '@renderer/assets/base.css'
import 'primeicons/primeicons.css'
import '@phosphor-icons/web/src/regular/style.css'
import '@phosphor-icons/web/src/fill/style.css'
import * as state from './fixture.ts'
const busy=ref(false),failure=ref(''),detail=ref('')
createApp({setup(){
 const entry=useStreamingHomeEntries({provider:computed(()=>state.source),enabled:ref(true),checkLogin:async()=>({loggedIn:state.loggedIn.value,profile:null}),login:id=>state.events.push('login:'+id),openDaily:async()=>state.events.push('daily'),command:async(name,payload)=>state.commands.push({name,payload})})
 window.homeTest={state,entry,busy,failure,detail,tick:async()=>{await nextTick();await new Promise(r=>setTimeout(r,70))}}
 return ()=>h(Home,{providerLabel:'网易云音乐',supportsDiscovery:true,isLoggedIn:state.loggedIn.value,recsLoading:busy.value,recsError:failure.value,recSections:[{key:'daily',title:'每日推荐',icon:'pi pi-calendar',tracks:state.daily},{key:'fm',title:'私人漫游',icon:'pi pi-compass',tracks:[]},{key:'radar',title:'私人雷达',icon:'pi pi-send',tracks:[]}],recommendPlaylists:state.playlists,currentTrackId:state.currentTrack.value?.id,homeEntries:entry.entries.value,pendingHomeEntry:entry.pending.value,homeEntryError:entry.error.value,recentTracks:state.daily.slice(0,6),onOpenHomeEntry:entry.open,onPlayTrack:(track,queue)=>state.usePlayerStore().playTrack(track,queue),onOpenRecSection:()=>state.events.push('daily'),onOpenPlaylist:p=>state.events.push('playlist:'+p.id),onOpenDiscovery:()=>state.events.push('discover'),onLoadRecommendations:()=>{state.events.push('refresh');busy.value=true},onRequestLogin:()=>state.events.push('login:ncm')},{rankings:()=>h(Charts,{compact:true,onLogin:()=>state.events.push('login:ncm')})})
}}).mount('#app')
`
const runner = `const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.disableHardwareAcceleration();app.whenReady().then(async()=>{try{
const win=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{offscreen:true,backgroundThrottling:false}});
const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});await win.loadFile(process.argv.at(-1));
const run=async source=>{const result=await win.webContents.executeJavaScript('(async()=>{'+source+'})().catch(e=>({error:e.stack}))');if(result?.error)throw Error(result.error)};
await run(\`await window.homeTest.tick();const q=window.homeTest,s=q.state,expect=(v,m)=>{if(!v)throw Error(m)};const click=id=>document.querySelector('[data-home-entry="'+id+'"]').click();
expect(document.querySelectorAll('.home-entry').length===4,'Four entries missing');expect(s.commands.length===0,'Page consumed FM before click');
click('daily');await q.tick();expect(s.events.at(-1)==='daily'&&s.commands.length===0,'Daily did not open the existing detail');
for(const id of ['heart','radar','fm']){click(id);await q.tick()};expect(s.commands.map(c=>c.name).join(',')==='liked.play,personalized.start,personalized.start','Wrong playback owner');
expect(s.commands[0].payload.mode==='heart'&&s.commands[1].payload.key==='radar'&&s.commands[2].payload.key==='fm','Wrong modes');
expect(document.querySelectorAll('.shelf-tile').length===6,'Home playlist row is unbounded');document.querySelector('.shelf-tile').click();expect(s.events.at(-1).startsWith('playlist:'),'Playlist did not open');
expect(document.querySelectorAll('.ncm-toplists--compact .toplist-card').length===4,'Not four regular charts');expect(!document.querySelector('.ncm-toplists').textContent.includes('数字专辑'),'Commercial chart exposed');
expect(document.querySelectorAll('.home-recent .chart-row').length===6,'Recent row missing');document.querySelector('.home-recent .chart-row').click();await q.tick();expect(s.played.at(-1).queue.length===6,'Recent queue wrong');
const shelf=document.querySelector('.shelf');document.querySelector('[aria-label="刷新推荐歌单"]').click();await q.tick();expect(s.events.at(-1)==='refresh'&&document.querySelector('.shelf')===shelf&&!document.querySelector('.home-skeleton'),'Refresh destroyed content');
q.busy.value=false;q.failure.value='测试部分推荐不可用';await q.tick();expect(document.querySelector('.shelf')===shelf&&document.querySelector('[role=status]'),'Partial error hid working content');q.failure.value='';await q.tick();
s.loggedIn.value=false;await q.tick();expect(document.querySelector('.hero-invite'),'Login state missing');s.loggedIn.value=true;await q.tick();\`);
for(const [name,width,height,dark] of [['light',1280,1800,false],['dark',1280,1800,true],['narrow',740,1100,false],['mobile',390,1100,false]]){
 win.setSize(width,height);await run('document.documentElement.dataset.theme='+JSON.stringify(dark?'dark':'light')+';await window.homeTest.tick()');await new Promise(r=>setTimeout(r,100));
 const overflow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth+1');if(overflow)throw Error('Horizontal overflow '+name);
 if(process.env.TWILIGHT_STREAMING_HOME_SCREENSHOTS){fs.mkdirSync(process.env.TWILIGHT_STREAMING_HOME_SCREENSHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.TWILIGHT_STREAMING_HOME_SCREENSHOTS,name+'.png'),(await win.webContents.capturePage()).toPNG())}
}
if(errors.length)throw Error(errors.join('\\n'));console.log('STREAMING_HOME_OK');app.exit(0);
}catch(e){console.error(e.stack);app.exit(1)}});`
