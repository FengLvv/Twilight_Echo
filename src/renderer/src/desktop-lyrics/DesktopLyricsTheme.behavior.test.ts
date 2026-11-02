import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import vue from '@vitejs/plugin-vue'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../../', import.meta.url))
const runtime = `
import {createApp,nextTick} from 'vue'
import '@renderer/assets/main.css'
import DesktopLyricsApp from '@renderer/desktop-lyrics/DesktopLyricsApp.vue'
import {DEFAULT_DESKTOP_LYRICS_SETTINGS} from '@renderer/../../shared/desktopLyrics.ts'
const display={mode:'degrees',notationMode:'numbered',key:'auto',chordsVisible:false,notationVisible:false}
const lines=[{id:'one',startMs:0,endMs:4000,text:'Lead words',translation:'当前中文翻译',romanization:'Current line',words:[{text:'Lead ',startMs:0,endMs:1000},{text:'words',startMs:1000,endMs:2000}]},{id:'two',startMs:5000,endMs:9000,text:'Next line',translation:'下一句中文翻译'}]
window.fixture={settings:{...DEFAULT_DESKTOP_LYRICS_SETTINGS,fontSize:40,windowHeight:480,resolvedFontFamily:'Arial',translationVisible:true,romanizationVisible:true,palette:'custom',customActiveColor:'#ffba50',customInactiveColor:'#80c8ff'},session:{schemaVersion:1,sessionId:'theme',contentRevision:1,track:{id:'song',title:'Theme check',artist:'Artist'},status:'ready',lyricOffsetMs:0,lines:structuredClone(lines),analysis:{display,key:{tonic:0,mode:'major'},inferred:{tonic:0,mode:'major'},melodyBusy:false,chordsBusy:false}},clock:{schemaVersion:1,sessionId:'theme',sequence:1,epoch:1,positionMs:500,durationMs:10000,rate:1,state:'paused'}}
createApp(DesktopLyricsApp).mount('#app')
const settle=async()=>{await nextTick();await document.fonts.ready;await new Promise(r=>setTimeout(r,100));await nextTick()}
const expect=(condition,message)=>{if(!condition)throw Error(message)}
const active=()=>document.querySelector('.dl-slot-shell.is-active')
const translated=()=>active().querySelector('.dl-translation')
const style=node=>getComputedStyle(node)
const color=value=>{const span=document.createElement('span');span.style.color=value;document.body.append(span);const result=style(span).color;span.remove();return result}
const patch=async value=>{window.fixture.settings={...window.fixture.settings,...value};window.events.onSettingsChanged(window.fixture.settings);await settle()}
function checkTranslation(){expect(style(translated()).color===style(active()).color,'Translation lost the current-line palette');const future=document.querySelector('.dl-slot-shell:not(.is-active)');if(future)expect(style(future.querySelector('.dl-translation')).color===style(future).color,'Future translation lost the inactive palette')}
window.verifyDesktopTheme=async()=>{
 await settle();checkTranslation();expect(style(translated()).color===color('#ffba50'),'Custom active palette missing');expect(parseFloat(style(translated()).webkitTextStrokeWidth)>0,'Plain translation outline missing');
 await patch({palette:'accent',accentColor:'#34d399'});checkTranslation();expect(style(translated()).color===color('#34d399'),'Theme accent did not reach translation');
 const first=window.fixture.session.lines[0];first.score={text:first.text,notes:[{start:0,end:1,midi:60,beat:0,durationBeats:1,lyric:'Lead'},{start:1,end:2,midi:62,beat:1,durationBeats:1,lyric:'words'}],svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><g data-note="0" transform="translate(3 2)"><text fill="currentColor"><tspan>1</tspan></text></g><text x="6" y="2" font-size="2.2" fill="currentColor"><tspan>0</tspan></text><g data-note="1" transform="translate(8 2)"><text fill="currentColor"><tspan>2</tspan></text></g><text x="0" y="8" font-size="2.47" fill="currentColor"><tspan>Lead <tspan>words</tspan></tspan></text></svg>'};
 first.chords=[{start:0,end:2,label:'C',confidence:'high',candidates:[]},{start:2,end:4,label:'G',confidence:'high',candidates:[]}];window.fixture.session.analysis.display={...display,notationVisible:true,chordsVisible:true};window.fixture.session={...window.fixture.session,contentRevision:2,lines:[{...first},lines[1]]};window.events.onSessionChanged(window.fixture.session);await settle();window.events.onClockChanged({...window.fixture.clock,sequence:2});await settle();
 checkTranslation();const symbols=active().querySelectorAll('.lyric-rhythmic-score text, .lyric-rhythmic-score tspan');expect(symbols.length>=7,'Engraver text, rests and nested spans were not rendered');for(const node of symbols){expect(parseFloat(style(node).strokeWidth)===1,'SVG outline missing');expect(style(node).vectorEffect==='non-scaling-stroke','SVG outline scales with the score: '+node.localName+' '+node.textContent)}
 const chord=active().querySelector('.lyric-chords .chord-active');expect(chord?.textContent.trim()==='I','Roman chord degree missing');expect(parseFloat(style(chord).webkitTextStrokeWidth)===1,'Chord degree outline missing');expect(style(chord).color===color('#34d399'),'Chord degree lost the active palette');
 return true
}
window.verifyDesktopVariants=async(vertical,outline,taskbar=false)=>{await patch({writingMode:vertical?'vertical':'horizontal',textOutline:outline,placement:taskbar?'taskbar':'desktop',displayMode:taskbar?'single':'double'});checkTranslation();for(const node of active().querySelectorAll('.lyric-rhythmic-score text, .lyric-rhythmic-score tspan')){expect(parseFloat(style(node).strokeWidth)===(outline?1:0),'Score outline setting not synchronized');expect(style(node).vectorEffect==='non-scaling-stroke','Nested outline scaling changed in a layout variant')};expect(parseFloat(style(translated()).webkitTextStrokeWidth)===(outline?1:0),'Translation outline setting not synchronized');return true}
window.verifyDesktopStaff=async()=>{window.fixture.session={...window.fixture.session,contentRevision:3,analysis:{...window.fixture.session.analysis,display:{...window.fixture.session.analysis.display,notationMode:'staff'}}};window.events.onSessionChanged(window.fixture.session);for(let i=0;i<30&&!active().querySelector('.vocal-staff-score text.abcjs-lyric');i++)await settle();const lyric=active().querySelector('.vocal-staff-score text.abcjs-lyric');expect(lyric,'Staff lyric did not render');expect(parseFloat(style(lyric).strokeWidth)===1,'Staff lyric outline missing');for(const node of active().querySelectorAll('.vocal-staff-score text, .vocal-staff-score tspan'))expect(style(node).vectorEffect==='non-scaling-stroke','Staff nested text outline scales with the score');checkTranslation();return true}
`

test('desktop palettes, played translations and outlines survive numbered/staff, roman chords and writing modes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-desktop-theme-'))
  try {
    await writeFile(join(directory, 'entry.ts'), runtime)
    await build({ configFile: false, root, logLevel: 'error', plugins: [vue()], define: { 'process.env.NODE_ENV': '"production"' },
      resolve: { alias: { '@renderer': join(root, 'src/renderer/src'), vue: require.resolve('vue/dist/vue.esm-bundler.js') } },
      build: { outDir: join(directory, 'bundle'), minify: false, lib: { entry: join(directory, 'entry.ts'), name: 'DesktopTheme', formats: ['iife'], fileName: 'runtime' } } })
    const files = await readdir(join(directory, 'bundle'))
    const bootstrap = `window.events={};window.api={desktopLyrics:new Proxy({}, {get:(_,name)=>name.startsWith('on')?fn=>{window.events[name]=fn;return()=>{delete window.events[name]}}:name==='bootstrap'?async()=>structuredClone(window.fixture):async()=>{}})}`
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">${files.filter(file=>file.endsWith('.css')).map(file=>`<link rel="stylesheet" href="bundle/${file}">`).join('')}<style>html,body,#app{margin:0;width:100%;height:100%}body{background:#384757}</style></head><body><div id="app"></div><script>${bootstrap}</script><script src="bundle/${files.find(file=>file.endsWith('.iife.js'))}"></script></body></html>`)
    await writeFile(join(directory, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron'),fs=require('node:fs/promises'),path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,width:1000,height:480,webPreferences:{offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>console.error(event.message));await win.loadFile(path.join(__dirname,'index.html'));await win.webContents.executeJavaScript('window.verifyDesktopTheme()');const folder=process.argv.at(-1);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'desktop-theme-numbered.png'),(await win.webContents.capturePage()).toPNG());await win.webContents.executeJavaScript('window.verifyDesktopVariants(false,false)');await fs.writeFile(path.join(folder,'desktop-theme-no-outline.png'),(await win.webContents.capturePage()).toPNG());win.setSize(500,800);await win.webContents.executeJavaScript('window.verifyDesktopVariants(true,true)');await fs.writeFile(path.join(folder,'desktop-theme-vertical.png'),(await win.webContents.capturePage()).toPNG());win.setSize(1000,480);await win.webContents.executeJavaScript('window.verifyDesktopVariants(false,true,true)');await win.webContents.executeJavaScript('window.verifyDesktopVariants(false,true)');await win.webContents.executeJavaScript('window.verifyDesktopStaff()');await fs.writeFile(path.join(folder,'desktop-theme-staff.png'),(await win.webContents.capturePage()).toPNG());console.log('DESKTOP_THEME_OK');app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}})
`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(require('electron'), ['--no-sandbox', join(directory, 'runner.cjs'), join(root, '.local/desktop-theme-perf-20261101/visual')], { env, windowsHide: true, timeout: 90000, maxBuffer: 2 * 1024 ** 2 })
    assert.match(result.stdout, /DESKTOP_THEME_OK/)
  } finally {
    assert(directory.startsWith(join(tmpdir(), 'twilight-desktop-theme-')))
    await rm(directory, { recursive: true, force: true })
  }
})
