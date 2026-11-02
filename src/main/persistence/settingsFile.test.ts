import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const { backupPathFor } = (await import(
  new URL('./jsonFile.ts', import.meta.url).href
)) as typeof import('./jsonFile.ts')
const { loadSettingsFile, writeSettingsFile } = (await import(
  new URL('./settingsFile.ts', import.meta.url).href
)) as typeof import('./settingsFile.ts')

interface TestSettings {
  theme: 'light' | 'dark'
  volume: number
}

const defaults: TestSettings = { theme: 'dark', volume: 50 }

function normalize(value: Partial<TestSettings>): TestSettings {
  return {
    theme: value.theme === 'light' ? 'light' : 'dark',
    volume:
      typeof value.volume === 'number' && Number.isFinite(value.volume)
        ? Math.min(100, Math.max(0, value.volume))
        : defaults.volume
  }
}

test('settings use atomic backups and report recovery instead of silently using defaults', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-settings-recovery-'))
  t.after(async () => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'settings.json')

  writeSettingsFile(filePath, { theme: 'light', volume: 20 })
  writeSettingsFile(filePath, { theme: 'dark', volume: 80 })
  await writeFile(filePath, '{broken', 'utf8')

  const loaded = loadSettingsFile(filePath, defaults, normalize)

  assert.deepEqual(loaded.settings, { theme: 'light', volume: 20 })
  assert.equal(loaded.issue?.kind, 'recovered')
})

test('settings preserve both corrupt candidates and surface a fatal load issue', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'twilight-settings-corrupt-'))
  t.after(async () => rm(directory, { recursive: true, force: true }))
  const filePath = join(directory, 'settings.json')
  await writeFile(filePath, '{broken primary', 'utf8')
  await writeFile(backupPathFor(filePath), '[]', 'utf8')

  const loaded = loadSettingsFile(filePath, defaults, normalize)

  assert.deepEqual(loaded.settings, defaults)
  assert.equal(loaded.issue?.kind, 'corrupt')
  if (loaded.issue?.kind !== 'corrupt') return
  assert.equal(await readFile(loaded.issue.corruptCopyPath!, 'utf8'), '{broken primary')
  assert.equal(await readFile(loaded.issue.corruptBackupCopyPath!, 'utf8'), '[]')

  writeSettingsFile(filePath, loaded.settings)
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), defaults)
  assert.equal(await readFile(loaded.issue.corruptCopyPath!, 'utf8'), '{broken primary')
  assert.equal(await readFile(loaded.issue.corruptBackupCopyPath!, 'utf8'), '[]')
})
