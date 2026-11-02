import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse } from '@vue/compiler-sfc'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

const require = createRequire(import.meta.url),
  run = promisify(execFile)
const root = fileURLToPath(new URL('../../../../', import.meta.url))

test('song analysis controls toggle independently, expose hover formats, and keep HiFi edge-to-edge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-analysis-controls-'))
  const source = (path: string) => JSON.stringify(join(root, path).replaceAll('\\', '/'))
  try {
    const original = (
      await readFile(join(root, 'src/renderer/src/components/PlayingMusic.vue'), 'utf8')
    ).replaceAll('\r\n', '\n')
    const { descriptor } = parse(original)
    const template = descriptor.template!.content
    const start = template.indexOf(
      '<div v-if="currentTrack && viewMode === \'cover\'" class="playback-tools">'
    )
    const toolbar = template.slice(start, template.indexOf('\n\n      <Transition', start))
    assert(start >= 0 && toolbar.includes('LyricAnalysisControl'))
    const headingStart = template.indexOf('<div class="track-heading">')
    const heading = template.slice(
      headingStart,
      template.indexOf('<p class="track-artist">', headingStart)
    )
    const noise = await readFile(join(root, 'src/renderer/src/assets/images/playback-dither.svg'))
    const css = descriptor.styles[0].content.replace(
      '../assets/images/playback-dither.svg',
      `data:image/svg+xml;base64,${noise.toString('base64')}`
    )
    const visualizer = pathToFileURL(join(root, 'resources/audio-visualizer/index.html')).href
    await writeFile(
      join(directory, 'Fixture.vue'),
      `<script setup lang="ts">
import {ref,shallowRef,nextTick,h} from 'vue'
import LyricAnalysisControl from ${source('src/renderer/src/components/LyricAnalysisControl.vue')}
import SongTonalKey from ${source('src/renderer/src/components/SongTonalKey.vue')}
import SongAnalysisPanel from ${source('src/renderer/src/components/SongAnalysisPanel.vue')}
import {createSongAnalysis} from ${source('src/renderer/src/composables/useSongAnalysis.ts')}
const currentTrack=ref({title:'I Love You So'}),viewMode=ref('cover'),commands=[]
const PlayingMusicTimeChip=()=>h('div',{class:'time-chip'},'0:55 / 2:40')
const project={id:'p',status:'completed',revision:1,chordsVisible:false,result:{ready:['six','chords']},mix:{mode:'instruments',tracks:{}}}
const displays=shallowRef({song:{chordsVisible:false,notationVisible:false,mode:'names',notationMode:'numbered',key:'auto'}})
const store={songs:shallowRef({song:project}),displays,readSong:async()=>{},retain:()=>()=>{},refresh:async()=>{},setDisplay:async patch=>{commands.push({name:'study.setLyricsDisplay',patch});displays.value={...displays.value,song:{...displays.value.song,...patch}}},core:{state:shallowRef({queue:{occurrenceId:'o'}}),command:async(name)=>{commands.push({name});return name==='study.analyze'?project:undefined}}}
const analysis=createSongAnalysis(()=> 'song',store)
const chordDisplay={mode:ref('names'),notationMode:ref('numbered'),override:ref('auto'),inferred:ref({tonic:10,mode:'major'}),setMode(v){chordDisplay.mode.value=v},setNotationMode(v){chordDisplay.notationMode.value=v},setKey(v){chordDisplay.override.value=v}}
const tick=async()=>{await nextTick();await new Promise(r=>setTimeout(r,60))}
window.analysisQa={analysis,viewMode,commands,chordDisplay,tick}
</script>
<template><main class="playing-music"><div class="playing-music-stage">
<button class="visualizer-toggle-button" aria-label="HiFi" @click="viewMode=viewMode==='cover'?'visualizer':'cover'">HiFi</button>
<button v-if="viewMode==='cover'" class="visualizer-toggle-button song-analysis-trigger" aria-label="分析歌曲" :aria-pressed="analysis.open.value" @click="analysis.toggle">分析</button>
${toolbar}
<div v-show="viewMode==='cover'" class="stage"><div class="layout"><section class="cover-column"><div class="cover-frame" :class="{'cover-frame--analysis':analysis.open.value}"><SongAnalysisPanel v-if="analysis.open.value" :project="analysis.project.value" :mode="analysis.mode.value" :tracks="analysis.tracks.value" :position="0" @change="analysis.changeTrack"/><div v-else class="qa-cover">Songs for Dads</div></div><div class="cover-meta">${heading}<p class="track-artist">The Walters</p><p class="track-album">I Love You So</p></div></section><section class="lyrics-column"><div class="qa-lyrics"><div v-if="analysis.chordsVisible.value" class="qa-chords">Cm7&#12288; F7&#12288; Bb&#12288; D7</div><p>演唱歌词</p><p class="qa-translation">歌词译文</p></div></section></div></div>
<div v-if="viewMode==='visualizer'" class="stage stage--visualizer"><iframe class="visualizer-surface" src="${visualizer}" title="HiFi" style="border:0;background:#e4e6eb"/></div>
</div><div class="playing-comments" style="min-height:800px">Comments</div></main></template>
<style scoped>${css}
.qa-cover{height:100%;display:grid;place-items:center;background:#f4efcf;color:#222;font-size:32px}.qa-lyrics{margin-top:30vh;text-align:center;font-size:42px}.qa-translation{opacity:.6}.qa-chords{font-size:16px;opacity:.7}.playing-music{background:#17212b}
</style>`
    )
    await writeFile(
      join(directory, 'entry.ts'),
      `import ${source('src/renderer/src/assets/main.css')};import {createApp} from 'vue';import Fixture from './Fixture.vue';createApp(Fixture).mount('#app')`
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
        emptyOutDir: true,
        minify: false,
        lib: {
          entry: join(directory, 'entry.ts'),
          name: 'AnalysisUiTest',
          formats: ['iife'],
          fileName: 'runtime'
        }
      }
    })
    const materials = await readFile(join(root, 'src/renderer/src/assets/materials.css'), 'utf8')
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html data-theme="dark" data-te-motion="off"><head><meta charset="utf-8">${files
        .filter((f) => f.endsWith('.css'))
        .map((f) => `<link rel="stylesheet" href="bundle/${f}">`)
        .join(
          ''
        )}<style>${materials}body{margin:0}:root{--te-control-bg:#ffffff;--te-control-fg:#17212b;--te-control-border:#d5dbe1;--te-player-bg:#17212b;--te-card-bg:#18232e;--te-card-border:#54616c;--te-text-primary:#f4f7fb;--te-playback-page-text:#f4f7fb;--te-subtle-bg:#324454;--te-primary-500:#b7d7f0;--te-playback-control-text:#cbd5df;--te-font-sans:Arial,sans-serif;--te-font-display:Arial,sans-serif}</style></head><body><div id="app"></div><script>window.process={env:{}}</script><script src="bundle/${files.find((f) => f.endsWith('.iife.js'))}"></script></body></html>`
    )
    await writeFile(join(directory, 'runner.cjs'), runner())
    const evidence = join(root, '.local/playback-polish-v4-20261101/visual')
    await mkdir(evidence, { recursive: true })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const response = await run(
      require('electron'),
      ['--no-sandbox', join(directory, 'runner.cjs'), join(directory, 'index.html'), evidence],
      { env, windowsHide: true, timeout: 90000, maxBuffer: 1024 ** 2 }
    )
    assert.match(response.stdout, /ANALYSIS_CONTROLS_OK/)
  } finally {
    assert(directory.startsWith(join(tmpdir(), 'twilight-analysis-controls-')))
    await rm(directory, { recursive: true, force: true })
  }
})

function runner() {
  return `const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
app.disableHardwareAcceleration();app.whenReady().then(async()=>{try{
const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)});
await win.loadFile(process.argv.find(v=>v.endsWith('index.html')));
const verify=async code=>{const r=await win.webContents.executeJavaScript('(async()=>{'+code+'})().catch(e=>({error:e.stack}))');if(r?.error)throw Error(r.error);return r};
for(const width of [1440,900]){win.setSize(width,900);await verify('await window.analysisQa.tick()');
const result=await verify(\`const q=window.analysisQa,buttons=[...document.querySelectorAll('.lyric-analysis-toggle')];
if(buttons.map(b=>b.textContent.trim()).join(',')!=='和弦,旋律')throw Error('Toolbar must have only two fixed labels');
const rects=[...document.querySelectorAll('.playback-tools > div')].map(e=>e.getBoundingClientRect());for(let i=1;i<rects.length;i++)if(rects[i-1].right>rects[i].left)throw Error('Toolbar controls overlap');
const lyrics=document.querySelector('.lyrics-column').getBoundingClientRect().x;
buttons[0].click();await q.tick();if(!q.analysis.chordsVisible.value||q.analysis.open.value)throw Error('Chords must not open mixer');
buttons[0].click();await q.tick();if(q.analysis.chordsVisible.value)throw Error('Chord off failed');
const chordRoot=buttons[0].parentElement;chordRoot.dispatchEvent(new PointerEvent('pointerenter'));await q.tick();
const menu=chordRoot.querySelector('[role=group]');if(getComputedStyle(menu).display==='none')throw Error('Hover formats missing');
const br=buttons[0].getBoundingClientRect(),mr=menu.getBoundingClientRect();if(Math.abs((br.left+br.right-mr.left-mr.right)/2)>1)throw Error('Formats not centered under button');
const luminance=color=>{const values=color.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{if(color.startsWith('color('))v*=255;v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*values[0]+.7152*values[1]+.0722*values[2]};
for(const [bg,fg] of [['#ffffff','#17212b'],['#18232e','#f4f7fb']]){document.documentElement.style.setProperty('--te-control-bg',bg);document.documentElement.style.setProperty('--te-control-fg',fg);const unselected=menu.querySelector('button[aria-pressed=false]'),ms=getComputedStyle(menu),bs=getComputedStyle(unselected),l=[luminance(ms.backgroundColor),luminance(bs.color)].sort((a,b)=>a-b);if((l[1]+.05)/(l[0]+.05)<4.5)throw Error('Unreadable unselected format: '+bs.color+' on '+ms.backgroundColor);}
document.documentElement.style.removeProperty('--te-control-bg');document.documentElement.style.removeProperty('--te-control-fg');

[...menu.querySelectorAll('button')].find(b=>b.textContent.includes('罗马')).click();await q.tick();
if(q.chordDisplay.mode.value!=='degrees'||q.analysis.chordsEnabled.value||q.analysis.open.value)throw Error('Format selection changed activation');
chordRoot.dispatchEvent(new PointerEvent('pointerleave'));buttons[0].focus();buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await q.tick();
if(getComputedStyle(menu).display==='none')throw Error('Keyboard formats missing');
buttons[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await q.tick();
if(getComputedStyle(menu).display!=='none')throw Error('Escape did not dismiss formats');
const melodyRoot=buttons[1].parentElement;melodyRoot.dispatchEvent(new PointerEvent('pointerenter'));await q.tick();
[...melodyRoot.querySelectorAll('[role=group] button')].find(b=>b.textContent.includes('五线谱')).click();await q.tick();
if(q.chordDisplay.notationMode.value!=='staff'||q.analysis.melodyEnabled.value)throw Error('Melody format changed activation');
melodyRoot.dispatchEvent(new PointerEvent('pointerleave'));buttons[1].click();await q.tick();if(!q.analysis.melodyEnabled.value||q.analysis.open.value)throw Error('Melody activation leaked');buttons[1].click();await q.tick();
if(q.commands.some(c=>['study.mix','study.analyze','study.transport'].includes(c.name)))throw Error('Display changed audio');
const key=document.querySelector('.song-tonal-key');if(!key.closest('.cover-meta')||!key.textContent.includes('Bb'))throw Error('Key must remain near song title');
key.click();await q.tick();const select=document.querySelector('select[aria-label="选择调性"]');select.value='0:minor';select.dispatchEvent(new Event('change',{bubbles:true}));await q.tick();if(!key.textContent.includes('C 小调'))throw Error('Key override failed');
document.querySelector('.song-analysis-trigger').click();await q.tick();if(!q.analysis.open.value)throw Error('Mixer did not open');
if(!document.querySelector('.song-analysis-panel'))throw Error('Mixer must render after the analysis toggle');
if(document.querySelector('.lyrics-column').getBoundingClientRect().x!==lyrics)throw Error('Lyrics column moved');
return {width:innerWidth,independentToggles:true,hoverFormats:true,keyboard:true,keyNearTitle:true,lyricsStable:true};\`);
await new Promise(r=>setTimeout(r,180));await fs.promises.writeFile(path.join(process.argv.at(-1),'analysis-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
await win.webContents.executeJavaScript("document.querySelector('.lyric-analysis-control').dispatchEvent(new PointerEvent('pointerenter'));window.analysisQa.tick()");await new Promise(r=>setTimeout(r,100));await fs.promises.writeFile(path.join(process.argv.at(-1),'formats-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
await verify(\`const q=window.analysisQa;q.viewMode.value='visualizer';await q.tick();const frame=document.querySelector('iframe');await new Promise(resolve=>{if(frame.contentDocument?.readyState==='complete')resolve();else frame.onload=resolve});frame.contentWindow.postMessage({kind:'track',track:{title:'I Love You So',artist:'The Walters',album:'I Love You So',duration:'2:40',durationSeconds:160,source:'NCM',quality:'PCM / 32-bit / 44.1kHz',samplerate:'44.1 kHz',bitdepth:'32-bit',channels:'Stereo',bitrate:'2822 kbps',format:'PCM'}},'*');await q.tick();const root=document.querySelector('.playing-music');if(root.scrollHeight<=root.clientHeight)throw Error('Fixture needs vertical scrolling');if(root.clientWidth!==innerWidth||Math.abs(frame.getBoundingClientRect().right-innerWidth)>1)throw Error('HiFi right gutter remains');\`);
await fs.promises.writeFile(path.join(process.argv.at(-1),'hifi-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
console.log(JSON.stringify(result));await verify(\`const q=window.analysisQa;await q.analysis.back();q.viewMode.value='cover';await q.tick();q.chordDisplay.setKey('auto');q.chordDisplay.setMode('names');if(q.analysis.chordsEnabled.value)await q.analysis.toggleChords();q.commands.length=0;\`);
}
if(errors.length)throw Error(errors.join('\\n'));console.log('ANALYSIS_CONTROLS_OK');app.exit(0);
}catch(e){console.error(e.stack);app.exit(1)}});`
}
