import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, realpath, lstat, symlink, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import { resolveStudyRuntimeView } from './studyRuntimeView.ts'

test('deep component files are read through a verified short junction without copying data', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-view-'))
  const target = join(root, 'very-long-component-directory-'.repeat(8), 'payload')
  await mkdir(target, { recursive: true }); await writeFile(join(target, 'weight.bin'), 'verified bytes')
  const views = await resolveStudyRuntimeView({ demucs: { directory: target, version: 'a'.repeat(64) } }, root)
  assert.ok(views.demucs.length < target.length)
  assert.ok((await lstat(views.demucs)).isSymbolicLink())
  assert.equal(await realpath(views.demucs), await realpath(target))
  assert.equal(await readFile(join(views.demucs, 'weight.bin'), 'utf8'), 'verified bytes')
  assert.deepEqual(await resolveStudyRuntimeView({ demucs: { directory: target, version: 'a'.repeat(64) } }, root), views)
  t.after(async () => { await unlink(views.demucs); assert.ok((await realpath(root)).startsWith(tmpdir())); await rm(root, { recursive: true, force: true }) })
})

test('a conflicting junction is rejected and a broken junction is repaired without touching its target', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'twilight-view-'))
  const target = join(root, 'target'), other = join(root, 'other')
  await mkdir(target); await mkdir(other)
  const canonical = await realpath(target), version = 'b'.repeat(64)
  const digest = createHash('sha256').update(normalize(canonical).toLowerCase()).digest('hex').slice(0, 12)
  const directory = join(root, 'te-analysis'); await mkdir(directory)
  const alias = join(directory, `tifa-${version.slice(0, 12)}-${digest}`)
  await symlink(other, alias, 'junction')
  await assert.rejects(resolveStudyRuntimeView({ tifa: { directory: target, version } }, root), /不匹配/)
  await unlink(alias); await symlink(join(root, 'missing'), alias, 'junction')
  const view = await resolveStudyRuntimeView({ tifa: { directory: target, version } }, root)
  assert.equal(await realpath(view.tifa), canonical)
  await assert.rejects(resolveStudyRuntimeView({ '../evil': { directory: target, version } }, root), /无效/)
  t.after(async () => { await unlink(alias); assert.ok((await realpath(root)).startsWith(tmpdir())); await rm(root, { recursive: true, force: true }) })
})
