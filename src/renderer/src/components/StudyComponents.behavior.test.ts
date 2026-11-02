import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../../../', import.meta.url))

test('analysis components use a focused consent dialog, exact sizes and accessible themed settings', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(root, '.local', 'study-component-ui-'))
  const catalog = JSON.parse(await readFile(join(root, 'resources/music-study/components.json'), 'utf8'))
  await writeFile(join(directory, 'core.ts'), `import {ref} from 'vue';export const calls:any[]=[];export const data:any={directory:'D:/音乐与分析组件',supported:true,catalog:${JSON.stringify(catalog)},components:${JSON.stringify(catalog.components.map((c: { id: string; parts: { bytes: number }[] }) => ({ id: c.id, phase: 'missing', receivedBytes: 0, totalBytes: c.parts.reduce((n, p) => n + p.bytes, 0) })))},requests:[]};export const core={state:ref({}),query:async(name:string)=>{if(name==='study.components')return structuredClone(data);return{}},command:async(name:string,p:any)=>{calls.push({name,p});if(name==='study.componentInstall'){data.requests=[];for(const row of data.components)row.phase='queued'}return{}}};export const useCoreConnection=()=>core;`)
  await writeFile(join(directory, 'entry.ts'), entry)
  await build({ configFile: false, root, logLevel: 'error', plugins: [vue()], resolve: { alias: [
    { find: /^.*\/coreConnection(?:\.ts)?$/, replacement: join(directory, 'core.ts') },
    { find: '@renderer', replacement: join(root, 'src/renderer/src') }, { find: 'vue', replacement: require.resolve('vue/dist/vue.esm-bundler.js') },
    { find: 'primeicons/primeicons.css', replacement: require.resolve('primeicons/primeicons.css') }
  ] }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: join(directory, 'bundle'), minify: false, lib: { entry: join(directory, 'entry.ts'), name: 'StudyComponentUI', formats: ['iife'], fileName: 'runtime' } } })
  const files = await readdir(join(directory, 'bundle'))
  await writeFile(join(directory, 'index.html'), `<!doctype html><html data-theme="pureWhite"><head><meta charset="utf-8">${files.filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="bundle/${f}">`).join('')}</head><body><div id="app" class="settings-preview-page settings-preview-layout"></div><script src="bundle/${files.find(f => f.endsWith('.js'))}"></script></body></html>`)
  await mkdir(join(directory, 'screenshots'))
  await writeFile(join(directory, 'runner.cjs'), `const{app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{contextIsolation:false,backgroundThrottling:false,offscreen:true}});try{await win.loadFile(path.join(__dirname,'index.html'));for(const dark of [false,true]){await win.webContents.executeJavaScript('window.openComponentConsent('+dark+')');for(const width of [1000,390]){win.setSize(width,850);await win.webContents.executeJavaScript('window.checkComponentDialog()');fs.writeFileSync(path.join(__dirname,'screenshots',(dark?'dark':'light')+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG())}await win.webContents.executeJavaScript('window.finishComponentConsent()')}console.log('COMPONENT_UI_OK');app.exit(0)}catch(e){console.error(e.stack);app.exit(1)}})`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const result = await promisify(execFile)(require('electron'), [join(directory, 'runner.cjs')], { env, windowsHide: true, timeout: 75000, maxBuffer: 1024 * 1024 })
  assert.match(result.stdout, /COMPONENT_UI_OK/)
  console.log('component screenshots', join(directory, 'screenshots'))
})

const entry = String.raw`
import {createApp,nextTick} from 'vue'
import Settings from '@renderer/components/settings-page/StudyComponentsSettings.vue'
import Host from '@renderer/components/StudyComponentsHost.vue'
import {useStudyComponents} from '@renderer/stores/studyComponents.ts'
import {calls,data} from './core.ts'
import '@renderer/assets/base.css'
import '@renderer/components/settings-page/SettingsPage.css'
import 'primeicons/primeicons.css'
let components:any
createApp({components:{Settings,Host},setup(){components=useStudyComponents();return{}},template:'<Settings/><Host/>'}).mount('#app')
const wait=()=>new Promise(r=>setTimeout(r,400))
function assert(value:any,reason:string){if(!value)throw new Error(reason)}
window.openComponentConsent=async(dark:boolean)=>{
 document.documentElement.dataset.theme=dark?'dark':'pureWhite'
 for(const row of data.components)row.phase='missing'
 await components.refresh();await components.request(['six']);await nextTick();await wait()
 assert(document.querySelector('dialog:modal'),'native focused modal')
 assert(document.querySelector('dialog').textContent.includes('3.81 GB'),'download includes engine + torch + model')
 assert(document.querySelector('dialog').textContent.includes('共享 PyTorch'),'shared dependency listed')
 assert(document.querySelector('dialog').contains(document.activeElement),'focus inside dialog')
}
window.checkComponentDialog=async()=>{await wait();const d=document.querySelector('dialog'),r=d.getBoundingClientRect();assert(r.left>=0&&r.right<=innerWidth+1,'dialog viewport');assert(d.scrollWidth<=d.clientWidth+1,'no horizontal scroll');const style=getComputedStyle(d);assert(style.backgroundColor!=='rgba(0, 0, 0, 0)','opaque themed dialog');const button=getComputedStyle(d.querySelector('button[type=submit]'));const lum=(s:string)=>{const v=s.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return v[0]*.2126+v[1]*.7152+v[2]*.0722};const a=lum(button.color),b=lum(button.backgroundColor);assert((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'primary action contrast')}
window.finishComponentConsent=async()=>{const before=calls.length;document.querySelector('dialog button[type=submit]').click();await wait();assert(calls.slice(before).some(c=>c.name==='study.componentInstall'&&c.p.features[0]==='six'),'explicit install');assert(!document.querySelector('dialog:modal'),'closed after install');for(const row of data.components)row.phase='missing';data.requests=[{owner:'song-a',title:'原来的歌曲',interactive:true,plan:{...(await components.request(['six'])),features:['six'],ids:['demucs'],downloadBytes:10,installedBytes:20,peakBytes:30,directory:data.directory}}];components.selected.value=null;await components.refresh();await wait();document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await wait();assert(calls.some(c=>c.name==='study.componentDismiss'&&c.p.owner==='song-a'),'cancel original song only');data.requests=[]}
`
