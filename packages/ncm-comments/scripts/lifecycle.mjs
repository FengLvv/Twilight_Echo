import assert from 'node:assert/strict'
import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { runCli } = require('../../create-twilight-plugin/lib/cli.cjs')
const root = fileURLToPath(new URL('../../..', import.meta.url))
const output = join(root, 'output/playwright/ncm-comments')
const smoke = JSON.parse(await readFile(join(output, 'smoke-result.json'), 'utf8'))
assert.equal(smoke.passed, true, 'Run the packaged-app smoke first')
const pluginId = 'com.twilightecho.tool.ncm-comments'
const fixture = join(output, 'upgrade-fixture')
await mkdir(fixture, { recursive: true })
const current = JSON.parse(await readFile(join(root, 'packages/ncm-comments/plugin.json'), 'utf8'))
await cp(join(root, `packages/ncm-comments/dist/stage-${current.version}`), fixture, {
  recursive: true
})
const manifest = JSON.parse(await readFile(join(fixture, 'plugin.json'), 'utf8'))
const versionParts = current.version.split('.').map(Number)
versionParts[2]++
manifest.version = versionParts.join('.')
await writeFile(join(fixture, 'plugin.json'), JSON.stringify(manifest, null, 2))
const upgrade = join(output, 'upgrade-fixture.tep')
await runCli(['pack', fixture, '--out', upgrade])
const env = {
  ...process.env,
  NCM_COMMENTS_TEST_PROFILE: smoke.profile,
  NCM_COMMENTS_TEST_PACKAGE:
    process.env.NCM_COMMENTS_TEST_PACKAGE || join(root, 'dist/ncm-comments-host/win-unpacked')
}
delete env.ELECTRON_RUN_AS_NODE
let app
async function launch() {
  app = await electron.launch({
    executablePath: require('electron'),
    args: [join(root, 'packages/ncm-comments/scripts/bootstrap.cjs'), '--mute-audio'],
    env,
    timeout: 60000
  })
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.api?.core)
  let connection
  for (let attempt = 0; attempt < 100 && !connection; attempt++) {
    connection = await app.evaluate(() => [...global.__commentsTestConnections.values()].at(-1))
    if (!connection) await page.waitForTimeout(200)
  }
  assert.ok(connection)
  const request = async (name, payload, kind = 'command') => {
    for (let attempt = 0; ; attempt++) {
      const result = await page.evaluate(
        ({ connection, name, payload, kind }) =>
          window.api.core.request(connection.connectionId, {
            kind,
            name,
            payload,
            epoch: connection.snapshot.epoch,
            requestId: crypto.randomUUID()
          }),
        { connection, name, payload, kind }
      )
      if (result.ok) return result.value
      if (result.error.code !== 'NOT_READY' || attempt >= 100)
        throw Error(JSON.stringify(result.error))
      await page.waitForTimeout(200)
    }
  }
  return request
}
async function association(request) {
  const invoke = (requestBody) =>
    request('extensions.pluginRequest', { id: pluginId, request: requestBody })
  const { session } = await invoke({ operation: 'open' })
  const result = await invoke({
    operation: 'resolve',
    session,
    track: { id: 'comments-unmatched', title: 'Fixture', artist: '', album: '', duration: 120 }
  })
  await invoke({ operation: 'close', session })
  assert.equal(result.kind, 'manual')
  assert.equal(result.song.id, '186016')
}
const results = { profile: smoke.profile, checks: [] }
try {
  let request = await launch()
  await association(request)
  results.checks.push('association-preserved-on-real-app-restart')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  }, upgrade)
  const installed = await request('plugins.install', { kind: 'package' })
  assert.equal(installed.plugin.version, manifest.version)
  await association(request)
  results.checks.push('real-tep-upgrade-preserves-association')
  await app.close()
  app = null
  request = await launch()
  const plugins = await request('plugins.list', {}, 'query')
  const plugin = plugins.find((item) => item.id === pluginId)
  assert.equal(plugin.version, manifest.version)
  assert.equal(plugin.enabled, true)
  await association(request)
  results.checks.push('enabled-upgraded-plugin-and-association-survive-relaunch')
  results.passed = true
} finally {
  await app?.close().catch(() => {})
  await writeFile(join(output, 'lifecycle-result.json'), JSON.stringify(results, null, 2))
}
console.log(JSON.stringify(results, null, 2))
