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
const root = fileURLToPath(new URL('../../../../../', import.meta.url))
test('automatic analysis settings retain independent choices, handle failed saves and fit light/dark narrow panels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-analysis-settings-'))
  try {
    await writeFile(join(directory, 'core.ts'), `
import {ref} from 'vue'
export const state=ref({phase:'ready',studyRevision:0}),policy={stages:[]},commands=[]
const cache={limitBytes:2147483648,usedBytes:0,protectedBytes:0,preloadNext:true}
export const useCoreConnection=()=>({state,query:async name=>structuredClone(name==='study.automation'?policy:cache),command:async(name,payload)=>{commands.push({name,payload});if(window.failSave)throw Error('测试保存失败');if(name==='study.setAutomation')policy.stages=[...payload.stages];else Object.assign(cache,payload);state.value={...state.value,studyRevision:state.value.studyRevision+1}}})
`)
    await writeFile(join(directory, 'entry.ts'), `
import '@renderer/assets/main.css'
import '@renderer/components/settings-page/SettingsPage.css'
import 'primeicons/primeicons.css'
import {createApp,h,nextTick} from 'vue'
import SongAnalysisSettings from '@renderer/components/settings-page/SongAnalysisSettings.vue'
import {commands} from './core.ts'
createApp({render:()=>h('main',{class:'settings-preview-page'},h(SongAnalysisSettings))}).mount('#app')
const wait=async()=>{await nextTick();await new Promise(resolve=>setTimeout(resolve,50));await nextTick()}
const expect=(ok,message)=>{if(!ok)throw Error(message)}
window.verifyAnalysisSettings=async()=>{await wait();document.querySelector('.settings-group-trigger').click();await wait();const buttons=[...document.querySelectorAll('[role="checkbox"]')];expect(buttons.length===3,'Three independent options');expect(buttons.every(b=>b.getAttribute('aria-checked')==='false'),'Defaults off');buttons[0].click();await wait();buttons[2].click();await wait();expect(buttons[0].getAttribute('aria-checked')==='true'&&buttons[1].getAttribute('aria-checked')==='false'&&buttons[2].getAttribute('aria-checked')==='true','Independent choices');expect(JSON.stringify(commands.at(-1).payload.stages)==='["six","melody"]','Core saved explicit choices');window.failSave=true;buttons[1].click();await wait();expect(buttons[1].getAttribute('aria-checked')==='false'&&document.body.textContent.includes('测试保存失败'),'Failed saves retain last confirmed selection');window.failSave=false;buttons[0].click();await wait();expect(JSON.stringify(commands.at(-1).payload.stages)==='["melody"]','Melody does not force six checkbox');return true}
window.verifyLayout=async()=>{await wait();expect(document.documentElement.scrollWidth<=innerWidth,'No horizontal overflow');const button=document.querySelector('[role="checkbox"]');expect(getComputedStyle(button).color!==getComputedStyle(document.querySelectorAll('[role="checkbox"]')[2]).color,'Selected option contrast');return true}
`)
    await build({ configFile: false, root, logLevel: 'error', plugins: [vue()],
      define: { 'process.env.NODE_ENV': '"production"' }, resolve: { alias: [
        { find: /^.*\/stores\/coreConnection(?:\.ts)?$/, replacement: join(directory, 'core.ts') },
        { find: '@renderer', replacement: join(root, 'src/renderer/src') },
        { find: 'vue', replacement: require.resolve('vue/dist/vue.esm-bundler.js') },
        { find: 'primeicons/primeicons.css', replacement: require.resolve('primeicons/primeicons.css') }
      ] }, build: { outDir: join(directory, 'bundle'), minify: false, lib: {
        entry: join(directory, 'entry.ts'), name: 'AnalysisSettingsTest', formats: ['iife'], fileName: 'runtime'
      } } })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(join(directory, 'index.html'), `<!doctype html><html data-theme="pureWhite"><head><meta charset="utf-8">${files.filter(f => f.endsWith('.css')).map(f => `<link rel="stylesheet" href="bundle/${f}">`).join('')}<style>body{margin:0;padding:24px}main{max-width:900px;margin:auto}.settings-group-content{padding:20px}.setting-item{min-width:0}</style></head><body><div id="app"></div><script src="bundle/${files.find(f => f.endsWith('.iife.js'))}"></script></body></html>`)
    await writeFile(join(directory, 'runner.cjs'), `
const {app,BrowserWindow}=require('electron'),path=require('node:path'),fs=require('node:fs/promises');app.setPath('userData',path.join(__dirname,'profile'));app.disableHardwareAcceleration();app.whenReady().then(async()=>{try{const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{offscreen:true,backgroundThrottling:false}});await win.loadFile(path.join(__dirname,'index.html'));await win.webContents.executeJavaScript('window.verifyAnalysisSettings()');for(const theme of ['pureWhite','dark'])for(const width of [1000,420]){win.setSize(width,700);await win.webContents.executeJavaScript('document.documentElement.dataset.theme='+JSON.stringify(theme)+';window.verifyLayout()');const folder=process.argv.at(-1);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'automatic-analysis-'+theme+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG())}console.log('ANALYSIS_SETTINGS_OK');app.exit(0)}catch(error){console.error(error.stack);app.exit(1)}})
`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(require('electron'), ['--no-sandbox', join(directory, 'runner.cjs'), join(root, '.local/study-continuity-20261101/visual')], {
      env, windowsHide: true, timeout: 60000, maxBuffer: 1024 ** 2
    })
    assert.match(result.stdout, /ANALYSIS_SETTINGS_OK/)
  } finally {
    assert(directory.startsWith(join(tmpdir(), 'twilight-analysis-settings-')))
    await rm(directory, { recursive: true, force: true })
  }
})
