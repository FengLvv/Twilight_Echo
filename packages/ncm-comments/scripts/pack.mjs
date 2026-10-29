import { mkdir, cp, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { extname } from 'node:path'
const require = createRequire(import.meta.url)
const { runCli } = require('../../create-twilight-plugin/lib/cli.cjs')
const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'))
const stage = resolve(root, 'dist', `stage-${manifest.version}`)
await mkdir(stage, { recursive: true })
for (const entry of ['plugin.json', 'index.mjs', 'lib', 'ui'])
  await cp(join(root, entry), join(stage, entry), { recursive: true })
for (const name of ['client.mjs', 'domain.mjs', 'store.mjs'])
  await cp(resolve(root, '../../src/core/comments', name), join(stage, 'lib', name))
const page = (await readFile(join(root, 'ui/index.html'), 'utf8'))
  .replace('<body tabindex="-1">', '<body tabindex="-1" data-layout="page">')
  .replace('<title>网易云评论</title>', '<title>歌词与评论</title>')
await writeFile(join(stage, 'ui/page.html'), page)
await cp(resolve(root, '../../resources/font'), join(stage, 'ui/fonts'), {
  recursive: true,
  filter: (source) =>
    !extname(source) || ['.woff2', '.css', '.txt', '.md'].includes(extname(source))
})
const fontCss = (
  await readFile(resolve(root, '../../src/renderer/src/assets/fonts.css'), 'utf8')
).replaceAll('/font/', './fonts/')
await writeFile(
  join(stage, 'ui/native-fonts.css'),
  `@import './fonts/misans/misans.css';\n${fontCss}`
)
const output = resolve(root, '../../dist/plugins', `${manifest.id}-${manifest.version}.tep`)
await runCli(['pack', stage, '--out', output])
const hash = createHash('sha256')
  .update(await readFile(output))
  .digest('hex')
await writeFile(output + '.sha256', `${hash}  ${manifest.id}-${manifest.version}.tep\n`)
console.log(`SHA-256: ${hash}`)
