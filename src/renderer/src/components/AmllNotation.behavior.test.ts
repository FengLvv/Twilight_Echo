import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,readdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'
import vue from '@vitejs/plugin-vue'

const require=createRequire(import.meta.url),run=promisify(execFile)
const root=fileURLToPath(new URL('../../../../',import.meta.url))

test('AMLL lead notation renders in the lyric slot and desktop projection without consuming backing text',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'twilight-amll-notation-'))
  const source=(path:string)=>JSON.stringify(join(root,path).replaceAll('\\','/'))
  try{
    const entry=join(directory,'entry.ts')
    await writeFile(entry,`
import ${source('src/renderer/src/assets/main.css')}
import {createApp,h,ref,nextTick} from 'vue'
import PlayingLyricLine from ${source('src/renderer/src/components/PlayingLyricLine.vue')}
import LyricRhythmicScore from ${source('src/renderer/src/components/LyricRhythmicScore.vue')}
import DesktopLyricSlot from ${source('src/renderer/src/desktop-lyrics/components/DesktopLyricSlot.vue')}
import {buildLyricLines} from ${source('src/shared/lyrics/lyricLineBuilder.ts')}
import {rhythmicLyricScore,primaryLyricScore} from ${source('src/shared/lyrics/lyricAnalysis.ts')}
import {projectDesktopLyricsLines} from ${source('src/shared/lyrics/desktopLyricsProjection.ts')}
const line=buildLyricLines('<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><p begin="00:01.000" end="00:04.000"><span begin="00:01.000" end="00:03.000">Lead words</span><span ttm:role="x-bg" begin="00:02.000" end="00:04.000">Backing words</span></p></body></tt>',null)[0]
line.translation='主唱译文'
const melody={source:'vocals',algorithm:'fixture',key:null,notes:[{lineId:0,start:1,end:3,midi:60,lyric:'Lead words'}],scores:[{lineId:0,text:'Lead words',svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 40"><g data-note="0"><text x="3" y="30" font-size="28" fill="currentColor">1 2</text></g><text x="3" y="38" font-size="2.47" fill="currentColor">Lead words</text></svg>'}]}
const prepared=rhythmicLyricScore(melody,0,'Lead words'),score=primaryLyricScore(prepared,line)
if(!score)throw Error('Lead score did not match the structured voice')
const desktop=projectDesktopLyricsLines([line])[0],desktopScore=rhythmicLyricScore(melody,0,desktop.text)
if(!desktopScore)throw Error('Desktop lead score did not match')
const clock={snapshot:ref({epoch:1,revision:1,position:2.5}),isPlaying:ref(false),positionAt:()=>2.5}
const renderScore=value=>h(LyricRhythmicScore,{...value,position:2.5,tonalKey:{tonic:0,mode:'major'},notationMode:'numbered'})
createApp({render:()=>h('main',[
h('section',{class:'player-projection'},[h('h2','Player'),h('div',{class:'lyric-row active'},[h(PlayingLyricLine,{line,singing:true,karaokeEnabled:false,offsetSeconds:0,motionMode:'off',clock,translationStyle:{},romanizationStyle:{},harmonyStyle:{},align:'center'},{notation:()=>renderScore(score)})])]),
h('section',{class:'desktop-projection'},[h('h2','Desktop'),h(DesktopLyricSlot,{line:{...desktop,score:desktopScore},active:true,align:'center',writingMode:'horizontal',translationVisible:true,romanizationVisible:false})])])}).mount('#app')
window.verifyAmllNotation=async()=>{await nextTick();await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,150));const primary=document.querySelector('.lyric-voice--lead .lyric-rhythmic-score');const backing=document.querySelector('.lyric-voice--background');if(!primary||!primary.getAttribute('aria-label').startsWith('Lead words，')||!backing||!backing.textContent.includes('Backing words')||backing.querySelector('.lyric-rhythmic-score'))throw Error('Lead/backing projection failed');if(document.querySelectorAll('.lyric-rhythmic-score svg').length!==2)throw Error('Both score renderers must produce SVG');for(const [area,selector] of [['.player-projection','.lyric-translation'],['.desktop-projection','.dl-translation']]){const root=document.querySelector(area),text=root.querySelector('text[data-score-lyric]'),translation=root.querySelector(selector),m=text.getCTM(),expected=parseFloat(getComputedStyle(text).fontSize)*Math.hypot(m.c,m.d),actual=parseFloat(getComputedStyle(translation).fontSize);if(Math.abs(expected-actual)>.1)throw Error('Translation font mismatch '+area+': '+actual+' vs '+expected)};return {lead:true,backing:true,desktop:true,overflow:document.documentElement.scrollWidth>innerWidth}}
`)
    await build({configFile:false,root,logLevel:'error',plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},resolve:{alias:{'@renderer':join(root,'src/renderer/src'),vue:require.resolve('vue/dist/vue.esm-bundler.js')}},build:{outDir:join(directory,'bundle'),emptyOutDir:true,minify:false,lib:{entry,name:'AmllNotationTest',formats:['iife'],fileName:'runtime'}}})
    const files=await readdir(join(directory,'bundle')); assert(files.some(file=>file.endsWith('.iife.js')),'Missing IIFE entry')
    await writeFile(join(directory,'index.html'),`<!doctype html><html><head><meta charset="utf-8">${files.filter(file=>file.endsWith('.css')).map(file=>`<link rel="stylesheet" href="bundle/${file}">`).join('')}<style>:root{--te-text-primary:#eef4f8;--te-text-secondary:#b7c7d7}body{margin:0;background:#101b25;color:#fff;font-family:Arial,sans-serif}main{padding:40px;display:grid;gap:50px}section{min-width:0}.lyric-row{font-size:40px;--te-lyric-font-size:40px;--lyric-style-font-size:40px}.lyric-rhythmic-score{font-size:28px}.lyric-voice--background{color:#b7c7d7}</style></head><body><div id="app"></div><script>window.process={env:{}}</script><script src="bundle/${files.find(file=>file.endsWith('.iife.js'))}"></script></body></html>`)
    await writeFile(join(directory,'runner.cjs'),`
const {app,BrowserWindow}=require('electron'),{mkdir,writeFile}=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(process.argv.find(value=>value.endsWith('index.html')));for(const width of [1440,900]){win.setSize(width,800);const result=await win.webContents.executeJavaScript('window.verifyAmllNotation().catch(error=>({error:error.stack}))');if(result.error)throw Error(result.error);if(result.overflow)throw Error('Horizontal overflow');await mkdir(process.argv.at(-1),{recursive:true});await writeFile(path.join(process.argv.at(-1),'amll-notation-'+width+'.png'),(await win.webContents.capturePage()).toPNG());console.log(JSON.stringify({width,...result}));}app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}})
`)
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
    const result=await run(require('electron'),['--no-sandbox',join(directory,'runner.cjs'),join(directory,'index.html'),join(root,'.local/study-continuity-20261101/visual')],{env,windowsHide:true,timeout:60000,maxBuffer:1024**2})
    assert.match(result.stdout,/'desktop'|"desktop":true/)
  }finally{
    assert(directory.startsWith(join(tmpdir(),'twilight-amll-notation-')))
    await rm(directory,{recursive:true,force:true})
  }
})
