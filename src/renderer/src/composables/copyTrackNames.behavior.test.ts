import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import vue from '@vitejs/plugin-vue'
import { build as bundle } from 'esbuild'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const workspace = fileURLToPath(new URL('../../../../', import.meta.url))

test(
  'native menu copies single, multiple and paged tracks while browser clipboard access is denied',
  { timeout: 90_000 },
  async () => {
    // Electron can run at a lower integrity level than an elevated Windows test runner.
    // Keep its writable profile in the workspace, like the development launcher.
    const fixtures = join(workspace, '.artifacts')
    await mkdir(fixtures, { recursive: true })
    const directory = await mkdtemp(join(fixtures, 'track-names-copy-'))
    try {
      await writeFile(join(directory, 'entry.ts'), runtime)
      await build({
        configFile: false,
        root: workspace,
        logLevel: 'error',
        plugins: [vue()],
        resolve: {
          alias: {
            '@renderer': join(workspace, 'src/renderer/src'),
            vue: require.resolve('vue/dist/vue.esm-bundler.js')
          }
        },
        define: { 'process.env.NODE_ENV': '"production"' },
        build: {
          outDir: join(directory, 'renderer/bundle'),
          emptyOutDir: true,
          lib: {
            entry: join(directory, 'entry.ts'),
            name: 'TrackNamesCopyTests',
            formats: ['iife'],
            fileName: 'runtime'
          }
        }
      })
      const files = await readdir(join(directory, 'renderer/bundle'))
      await writeFile(
        join(directory, 'renderer/index.html'),
        `<!doctype html><meta charset="utf-8"><div id="app"></div><script src="bundle/${files.find((name) => name.endsWith('.js'))}"></script>`
      )
      await bundle({
        stdin: {
          contents: `import {contextBridge} from 'electron'
          import {systemApi} from './src/preload/domains/systemApi.ts'
          contextBridge.exposeInMainWorld('api', {window: systemApi.window})`,
          resolveDir: workspace
        },
        outfile: join(directory, 'preload.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron']
      })
      await bundle({
        stdin: { contents: runner, resolveDir: workspace },
        outfile: join(directory, 'runner.cjs'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        external: ['electron']
      })
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const running = promisify(execFile)(
        require('electron'),
        ['--no-sandbox', join(directory, 'runner.cjs'), directory],
        {
          windowsHide: true,
          timeout: 80_000,
          env,
          maxBuffer: 1024 * 1024
        }
      )
      const result = await running
      assert.match(result.stdout, /TRACK_NAMES_COPY_OK/)
    } finally {
      assert.ok(resolve(directory).startsWith(resolve(fixtures) + sep))
      await rm(directory, { recursive: true, force: true })
    }
  }
)

const runtime = `
import {createApp,h,ref} from 'vue'
import ContextMenu from '@renderer/components/streaming-page/StreamingContextMenu.vue'
import {copyTrackNames,copyTrackNamePages} from '@renderer/composables/copyTrackNames.ts'
import {useAppNoticeStore} from '@renderer/stores/useAppNoticeStore.ts'
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
window.runTrackCopyTest=async mode=>{
  const notices=useAppNoticeStore();notices.clearNotices()
  const show=ref(true)
  const tracks=mode==='single' ? [{title:' 夜曲 ',artist:' 周杰伦 '}] :
    Array.from({length:mode==='paged'?605:2},(_,i)=>({title:'歌曲 '+i,artist:'作者 A / B'}))
  let copying
  const app=createApp({render:()=>h(ContextMenu,{
    show:show.value,x:40,y:40,allFavorited:false,actionLabel:tracks.length>1?' ('+tracks.length+')':'',
    canLike:false,singleLiked:false,canManagePlaylists:false,ownedUserPlaylists:[],showPlaylistSubmenu:false,
    canRemoveFromPlaylist:false,canDownload:false,showDownloadQualityMenu:false,aggregatePlaylists:[],showAggregateSubmenu:false,
    onClose:()=>{show.value=false},
    onCopyTrackNames:()=>{
      show.value=false
      copying=mode==='paged' ? copyTrackNamePages(async append=>{
        for(let i=0;i<tracks.length;i+=200){await pause(10);await append(tracks.slice(i,i+200))}
      }) : copyTrackNames(tracks)
    }
  })})
  app.mount('#app')
  try {
    for(let i=0;!copying&&i<200;i++)await pause(10)
    if(!copying)throw new Error('Native copy action was not dispatched')
    await copying
    const notice=notices.notices.value.at(-1)
    if(notice?.kind!=='success')throw new Error('Copy failed: '+notice?.message)
    if(show.value)throw new Error('Context menu remained open')
    return notice.message
  } finally {app.unmount();notices.clearNotices()}
}
`

const runner = `
import {app,BrowserWindow,Menu,clipboard,ipcMain,session} from 'electron'
import assert from 'node:assert/strict'
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {registerWindowIpc} from './src/main/ipc/windowIpc.ts'
import {installSessionSecurity} from './src/main/security/electronSecurity.ts'
const profile=join(process.argv.at(-1),'profile')
mkdirSync(profile,{recursive:true})
app.setPath('userData',profile)
app.disableHardwareAcceleration()
app.whenReady().then(async()=>{
  const previous=clipboard.readText()
  const popup=Menu.prototype.popup
  let win
  try {
    registerWindowIpc(ipcMain)
    // Select the native menu item without a browser gesture or an interactive OS popup.
    Menu.prototype.popup=function(options){
      const item=this.items.find(item=>item.label.startsWith('复制歌曲名-作者'))
      assert.ok(item,'Native copy menu item missing')
      item.click();options.callback()
    }
    const isolated=session.fromPartition('track-names-copy-test')
    installSessionSecurity(isolated)
    win=new BrowserWindow({show:false,webPreferences:{
      preload:join(process.argv.at(-1),'preload.cjs'),session:isolated,
      sandbox:true,contextIsolation:true,backgroundThrottling:false
    }})
    await win.loadFile(join(process.argv.at(-1),'renderer/index.html'))
    const js=source=>win.webContents.executeJavaScript(source)
    assert.equal(await js('(async()=>{try{await navigator.clipboard.writeText("browser write");return "allowed"}catch(e){return e.name}})()'),'NotAllowedError')
    assert.equal(await js('window.runTrackCopyTest("single")'),'已复制歌曲名和作者')
    assert.equal(clipboard.readText(),'夜曲 - 周杰伦')
    assert.equal(await js('window.runTrackCopyTest("multiple")'),'已复制 2 首歌曲名和作者')
    assert.equal(clipboard.readText(),'歌曲 0 - 作者 A / B\\n歌曲 1 - 作者 A / B')
    assert.equal(await js('window.runTrackCopyTest("paged")'),'已复制 605 首歌曲名和作者')
    const expected=Array.from({length:605},(_,i)=>'歌曲 '+i+' - 作者 A / B').join('\\n')
    assert.equal(clipboard.readText(),expected)
    await win.loadURL('data:text/html,<meta charset="utf-8">Untrusted document')
    assert.match(await js('window.api.window.copyTrackNames("untrusted").then(()=>"allowed",error=>error.message)'),/rejected from untrusted sender/)
    assert.equal(clipboard.readText(),expected)
    console.log('TRACK_NAMES_COPY_OK')
  } catch(error) {console.error(error.stack);process.exitCode=1}
  finally {
    Menu.prototype.popup=popup
    clipboard.writeText(previous)
    win?.destroy()
    app.exit(process.exitCode||0)
  }
})
`
