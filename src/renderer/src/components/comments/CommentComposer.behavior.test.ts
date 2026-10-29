import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
const require = createRequire(import.meta.url)

test('real comment composer handles login, drafts, duplicate sends, late responses, errors and transparent narrow layout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-comment-composer-'))
  const evidence = resolve('output/playwright/comment-composer')
  await mkdir(evidence, { recursive: true })
  try {
    await writeFile(join(directory, 'mock.ts'), mock)
    await writeFile(join(directory, 'entry.ts'), runtime)
    await build({
      configFile: false,
      logLevel: 'error',
      root: process.cwd(),
      publicDir: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [vue()],
      resolve: {
        alias: [
          { find: '../../stores/coreConnection.ts', replacement: join(directory, 'mock.ts') },
          {
            find: '@composer',
            replacement: resolve('src/renderer/src/components/comments/CommentComposer.vue')
          }
        ]
      },
      build: {
        outDir: join(directory, 'bundle'),
        emptyOutDir: true,
        lib: {
          entry: join(directory, 'entry.ts'),
          formats: ['iife'],
          name: 'CommentFixture',
          fileName: 'runtime'
        }
      }
    })
    const files = await readdir(join(directory, 'bundle'))
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8">
      ${files
        .filter((file) => file.endsWith('.css'))
        .map((file) => `<link rel="stylesheet" href="bundle/${file}">`)
        .join('')}
      <style>body{margin:0;color:#f4f7fb;background:linear-gradient(140deg,#254c61,#0d1924);font:16px 'Segoe UI',sans-serif;min-height:100vh;--te-text-secondary:color-mix(in srgb,currentColor 60%,transparent);--te-hover-bg:color-mix(in srgb,currentColor 6%,transparent);--te-primary-500:#a5c9d6}#app{box-sizing:border-box;max-width:1080px;margin:auto;padding:32px 18px}</style>
      </head><body><div id="app"></div><script src="bundle/${files.find((file) => file.endsWith('.js'))}"></script></body></html>`
    )
    await writeFile(
      join(directory, 'runner.cjs'),
      `const fs=require('fs');const {app,BrowserWindow}=require('electron');
      app.disableHardwareAcceleration();app.setPath('userData',__dirname+'/profile');app.whenReady().then(async()=>{
        const win=new BrowserWindow({show:false,width:1100,height:700,webPreferences:{offscreen:true,contextIsolation:false,backgroundThrottling:false}});
        try{await win.loadFile(__dirname+'/index.html');const result=await win.webContents.executeJavaScript('window.runCommentTests()');console.log('COMMENT_INTERACTION_OK');
          for(const [name,width,light] of [['dark',1100,false],['light',1100,true],['narrow',360,false]]){
            win.setContentSize(width,700);await win.webContents.executeJavaScript('window.prepareCommentEvidence('+JSON.stringify(light)+')');
            await new Promise(r=>setTimeout(r,180));
            if(process.env.NCM_COMMENT_CAPTURE==='1'){
              let image;for(let attempt=0;attempt<3;attempt++){try{image=await win.webContents.capturePage();break}catch(error){if(attempt===2)throw error;win.webContents.invalidate();await new Promise(r=>setTimeout(r,250))}}
              fs.writeFileSync(${JSON.stringify(evidence)}+'/'+name+'.png',image.toPNG());
            }
            const overflow=await win.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth');if(overflow)throw Error('Horizontal overflow: '+name);
          }
          fs.writeFileSync(${JSON.stringify(join(evidence, 'result.json'))},JSON.stringify({passed:true,...result},null,2));console.log('COMMENT_COMPOSER_OK');app.exit(0);
        }catch(error){console.error(error);app.exit(1)}
      })`
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await promisify(execFile)(
      require('electron'),
      ['--no-sandbox', join(directory, 'runner.cjs')],
      { windowsHide: true, timeout: 40_000, env }
    )
    assert.match(result.stdout, /COMMENT_COMPOSER_OK/)
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep))
    await rm(directory, { recursive: true, force: true })
  }
})
const mock = `import {reactive} from 'vue'
export const state=reactive({loggedIn:false,mode:'pending',requests:[],finish:null,latest:0,published:0,song:'42'})
export const useCoreConnection=()=>({
 query:async()=>({loggedIn:state.loggedIn,context:'account'}),
 command:async(name,request)=>{state.requests.push(request);
  if(state.mode==='pending')return new Promise(resolve=>{state.finish=resolve});
  if(state.mode==='unknown')throw Error('Connection lost');
  if(state.mode==='rejected')return {status:'rejected',message:'登录已失效，请重新登录'};
  return {status:'published',comment:null}
 }
})`
const runtime = `import {createApp,h,nextTick} from 'vue'
import Composer from '@composer'
import {state} from './mock'
const check=(value,message)=>{if(!value)throw Error(message)}
const tick=async()=>{for(let n=0;n<10;n++){await Promise.resolve();await nextTick()}}
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text)
const setText=value=>{const input=document.querySelector('textarea');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))}
createApp({render:()=>h(Composer,{key:state.song,song:{id:state.song,title:state.song==='42'?'好想爱这个世界啊':'另一首歌',artist:'华晨宇',album:'新世界',duration:259},onPublished:()=>state.published++,onLatest:()=>state.latest++})}).mount('#app')
window.runCommentTests=async()=>{
 check(!document.querySelector('textarea'),'Composer should start collapsed');button('写评论').click();await tick();
 check(document.body.textContent.includes('请先在网易云音乐源中登录'),'Missing logged-out guidance');check(document.querySelector('[type=submit]').disabled,'Logged-out submit enabled');
 setText('这段旋律陪伴了我很久。');state.loggedIn=true;button('重新检查登录').click();await tick();
 document.querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));await tick();
 check(state.requests.length===1,'Keyboard submit was not dispatched once');check(document.querySelector('[type=submit]').disabled,'Sending submit enabled');
 document.querySelector('[type=submit]').click();await tick();check(state.requests.length===1,'Double submit');
 document.querySelector('[aria-label="收起评论输入框"]').click();await tick();button('写评论').click();await tick();
 check(document.querySelector('textarea').value.includes('陪伴'),'Draft lost on collapse');check(document.querySelector('[type=submit]').disabled,'In-flight send lost on reopen');
 const finish=state.finish;state.song='43';await tick();button('写评论').click();await tick();setText('另一首歌的草稿');await tick();
 finish({status:'published',comment:null});await tick();check(document.querySelector('textarea').value==='另一首歌的草稿','Late success overwrote another song');check(state.published===0,'Unmounted composer refreshed a different song');
 state.mode='rejected';document.querySelector('[type=submit]').click();await tick();check(document.querySelector('textarea').value==='另一首歌的草稿','Rejected send erased draft');check(document.body.textContent.includes('登录已失效'),'Missing failure message');
 state.mode='unknown';document.querySelector('[type=submit]').click();await tick();const count=state.requests.length;await tick();check(state.requests.length===count,'Unknown send replayed automatically');check(button('查看最新评论'),'Missing uncertain outcome action');button('查看最新评论').click();await tick();check(state.latest===1,'Latest action not emitted');
 state.mode='success';document.querySelector('[type=submit]').click();await tick();check(state.published===1,'Success did not refresh latest');check(!document.querySelector('textarea').value,'Successful draft not cleared');
 check(new Set(state.requests.map(r=>r.submissionId)).size===state.requests.length,'Explicit retries reused submission IDs');
 setText('x'.repeat(141));await tick();check(document.querySelector('[type=submit]').disabled,'Oversized draft allowed');
 check(document.querySelector('textarea').getAttribute('aria-invalid')==='true','Invalid draft not accessible');
 setText('每次听到这首歌，都会想起那些被音乐陪伴的日子。');await tick();
 const color=getComputedStyle(document.querySelector('.comment-composer')).backgroundColor;check(color==='rgba(0, 0, 0, 0)','Composer has an opaque background');
 return {checks:16,mockedSubmissions:state.requests.length,realExternalWrites:0}
}
window.prepareCommentEvidence=async light=>{document.body.style.color=light?'#2e3b42':'#f4f7fb';document.body.style.background=light?'linear-gradient(140deg,#b8cdd1,#8fa6b5)':'linear-gradient(140deg,#254c61,#0d1924)';await tick()}
`
