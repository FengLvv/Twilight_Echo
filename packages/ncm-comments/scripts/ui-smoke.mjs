import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = resolve(root, '../../output/playwright/ncm-comments')
await mkdir(output, { recursive: true })
const profile = await mkdtemp(join(output, 'ui-profile-'))
const pageLayout = process.env.NCM_COMMENTS_UI_PAGE === '1'
const harness = `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><iframe src="/ui/${pageLayout ? 'page' : 'index'}.html" sandbox="allow-scripts allow-same-origin"></iframe><script>
window.mock={track:{id:'ncm:1',title:'夜曲',artist:'周杰伦',album:'十一月的萧邦',duration:226},lyrics:${JSON.stringify('[00:00.00]夜曲\n[00:10.00]为你弹奏\n[00:20.00]记住此刻的旋律')},theme:'dark',failNext:false,playing:true,operations:[]};let port;
const item=id=>({id:String(id),nickname:'听见故事的人',avatarUrl:'',time:1700000000000,likes:1234,content:id===1?Array(16).fill('这首歌，陪我走过了很长很长的夜晚。').join('\\n'):id===2?'<script>window.injected=true<\\/script>':'有些旋律，总能把时间留住。',replies:id===3?[{nickname:'另一个听众',content:'愿你每一天都被温柔以待。'}]:[]});
window.changeTrack=track=>{window.mock.track=track;port.postMessage({event:'player',value:{currentTrack:track,playing:true}})};
window.dropBridge=()=>port.close();
window.addEventListener('message',event=>{if(event.data.type!=='twilight-experience-ready')return;const channel=new MessageChannel();port=channel.port1;port.onmessage=async event=>{const{id,method,args}=event.data;try{let value=null;if(method==='host.exit'){document.querySelector('iframe').remove();return}if(method==='player.state')value={currentTrack:mock.track,playing:true};if(method==='plugin.request'){const r=args.request;mock.operations.push(r.operation);switch(r.operation){case'open':value={session:'session',tab:'hot'};break;case'theme':value={theme:mock.theme,accent:'#8b6bcb'};break;case'resolve':if(r.track.id==='old')await new Promise(resolve=>setTimeout(resolve,350));value={track:r.track,kind:'explicit',song:{id:r.track.id.replace('ncm:','')}};break;case'comments':if(mock.failNext){mock.failNext=false;throw Error('测试网络暂时断开')}value={items:r.offset?[item(20),item(21)]:Array.from({length:20},(_,i)=>item(i+1)),total:21,nextOffset:r.offset?21:20,hasMore:!r.offset};break;}}port.postMessage({id,value})}catch(error){port.postMessage({id,error:error.message})}};port.start();event.source.postMessage({type:'twilight-experience-connect',bridgeVersion:2},'*',[channel.port2]);port.postMessage({event:'player',value:{currentTrack:mock.track,playing:true}})});
</script></body></html>`
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(
        harness.replace(
          "if(method==='player.state')",
          "if(method==='player.lyrics')value={id:mock.track.id,lyrics:mock.lyrics};if(method==='player.state')"
        )
      )
      return
    }
    const path = request.url.split('?')[0]
    if (path === '/ui/native-fonts.css') {
      response.setHeader('Content-Type', 'text/css')
      response.end('')
      return
    }
    if (
      ![
        '/ui/index.html',
        '/ui/page.html',
        '/ui/app.js',
        '/ui/controller.js',
        '/ui/style.css',
        '/ui/page.css',
        '/ui/page.js',
        '/ui/lyrics.js'
      ].includes(path)
    ) {
      response.writeHead(404).end()
      return
    }
    response.setHeader(
      'Content-Type',
      path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'text/css'
    )
    const source = await readFile(
      join(root, path === '/ui/page.html' ? 'ui/index.html' : path.slice(1))
    )
    response.end(
      path === '/ui/page.html'
        ? source
            .toString()
            .replace('<body tabindex="-1">', '<body tabindex="-1" data-layout="page">')
        : source
    )
  } catch {
    response.writeHead(500).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const env = {
  ...process.env,
  NCM_COMMENTS_TEST_PROFILE: profile,
  NCM_COMMENTS_UI_URL: `http://127.0.0.1:${server.address().port}`
}
delete env.ELECTRON_RUN_AS_NODE
let app
const results = { checks: [], profile }
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [join(root, 'scripts/ui-bootstrap.cjs'), '--disable-renderer-backgrounding'],
    env
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('UI error:', error.message)
  })
  const frame = page.frameLocator('iframe')
  if (pageLayout) {
    await frame
      .locator('.page-record-title')
      .filter({ hasText: '夜曲' })
      .waitFor({ timeout: 10000 })
    await page.waitForTimeout(300)
    assert.equal((await page.evaluate(() => window.mock.operations)).includes('comments'), false)
    await page.screenshot({ path: join(output, 'lyrics-page.png') })
    await frame.getByRole('button', { name: '向下查看评论 ↓' }).click()
    results.checks.push('lyrics-page-shows-now-playing', 'comments-lazy-until-scroll')
  }
  await frame.locator('.comment').nth(19).waitFor()
  await frame.locator('.expand').first().waitFor({ state: 'visible' })
  await frame.locator('.expand').first().click()
  assert.equal(
    await frame
      .locator('.comment-body')
      .first()
      .evaluate((element) => element.classList.contains('collapsed')),
    false
  )
  assert.equal(
    await frame.locator('.comment-body').nth(1).innerText(),
    '<script>window.injected=true</script>'
  )
  results.checks.push('long-comments-expand', 'untrusted-comment-is-text')
  await page.evaluate(() => {
    window.mock.failNext = true
  })
  await frame.getByRole('button', { name: '加载更多评论' }).click()
  await frame.locator('#error').waitFor({ state: 'visible' })
  assert.equal(await frame.locator('.comment').count(), 20)
  await frame.getByRole('button', { name: '重试', exact: true }).click()
  await frame.locator('.comment').nth(20).waitFor()
  assert.equal(await frame.locator('.comment').count(), 21)
  results.checks.push('page-failure-preserves-list', 'retry-deduplicates')
  await page.evaluate(() => {
    window.mock.theme = 'pureWhite'
  })
  const child = page.frames().find((frame) => /\/ui\/(?:page|index)\.html$/.test(frame.url()))
  await child.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, {
    timeout: 8000,
    polling: 200
  })
  await page.screenshot({ path: join(output, 'ui-light.png') })
  await page.evaluate(() => {
    window.mock.theme = 'dark'
  })
  await child.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, {
    timeout: 8000,
    polling: 200
  })
  await frame.getByRole('tab', { name: '热评', exact: true }).focus()
  await frame.getByRole('tab', { name: '热评', exact: true }).press('ArrowRight')
  assert.equal(
    await frame.getByRole('tab', { name: '最新', exact: true }).getAttribute('aria-selected'),
    'true'
  )
  results.checks.push('light-dark-live-sync', 'keyboard-tabs')
  await page.evaluate(() => window.dropBridge())
  await page.waitForTimeout(4000)
  await frame.getByRole('button', { name: '刷新当前评论' }).click()
  await frame.locator('.comment').nth(19).waitFor()
  results.checks.push('closed-host-port-reconnects')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 320, height: 740 })
  )
  await page.screenshot({ path: join(output, 'ui-narrow.png') })
  assert.equal(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  results.checks.push('320px-no-horizontal-overflow')
  await page.evaluate(() => {
    window.changeTrack({ ...window.mock.track, id: 'old', title: 'OLD' })
    window.changeTrack({ ...window.mock.track, id: 'new', title: 'NEW' })
  })
  const titleSelector = pageLayout ? '.page-record-title' : '#song-title'
  await frame.locator(titleSelector).filter({ hasText: 'NEW' }).waitFor()
  await page.waitForTimeout(500)
  assert.equal(await frame.locator(titleSelector).innerText(), 'NEW')
  await (
    pageLayout ? frame.locator('body') : frame.getByRole('tab', { name: '最新', exact: true })
  ).press('Escape')
  await page.locator('iframe').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.mock.playing), true)
  assert.ok(
    !(await page.evaluate(() => window.mock.operations)).some((op) => /play|pause|stop/.test(op))
  )
  assert.deepEqual(errors, [])
  results.checks.push(
    'rapid-switch-does-not-show-old-song',
    'escape-closes',
    'no-playback-controls-issued'
  )
  results.passed = true
} catch (error) {
  const page = await app?.firstWindow().catch(() => null)
  if (page) {
    console.error(
      'harness',
      await page.evaluate(() => ({
        mock: typeof window.mock,
        operations: window.mock?.operations?.slice(-10)
      }))
    )
    const child = page.frames().find((entry) => /\/ui\//.test(entry.url()))
    if (child) console.error('UI text', (await child.locator('body').innerText()).slice(0, 700))
  }
  throw error
} finally {
  await writeFile(
    join(output, pageLayout ? 'page-ui-result.json' : 'ui-result.json'),
    JSON.stringify(results, null, 2)
  )
  await app?.close().catch(() => {})
  await new Promise((resolve) => server.close(resolve))
}
console.log(JSON.stringify(results, null, 2))
