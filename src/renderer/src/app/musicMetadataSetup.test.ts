import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { CoreSettingsRepository } from '../../../core/persistence/settingsRepository.ts'
import {
  defaultMusicIdentificationSettings,
  normalizeMusicIdentificationSettings,
  musicMetadataSetupChoice,
  type MusicIdentificationSettings
} from '../../../shared/musicIdentificationSchedule.ts'
import { createMusicMetadataSetup } from './musicMetadataSetup.ts'

const policy = async () => ({
  enabled: true,
  identity: true,
  introduction: true,
  reason: null,
  sources: [{ provider: 'platform.extra', identification: [], enrichment: [] }]
})

test('first import prompts once and accepting saves both scopes, every registered source and NCM fallback', async () => {
  let settings = defaultMusicIdentificationSettings(),
    hasMusic = false,
    writes = 0
  const model = createMusicMetadataSetup({
    current: () => settings,
    hasMusic: async () => hasMusic,
    policy,
    save: async (next) => {
      settings = next
      writes++
    }
  })
  await model.refresh(true)
  assert.equal(model.state.value.visible, false)
  hasMusic = true
  await model.refresh(false)
  assert.equal(model.state.value.visible, false, 'wait for import/onboarding completion')
  await model.refresh(true)
  assert.equal(model.state.value.visible, true)
  assert.equal(writes, 0)
  await model.choose(true)
  assert.equal(settings.setup, 'accepted')
  assert.equal(settings.newImports, true)
  assert.equal(settings.history, true)
  assert.equal(settings.ncmLocalFallback, true)
  assert.deepEqual(settings.sources, [
    ...defaultMusicIdentificationSettings().sources,
    'platform.extra'
  ])
  await model.refresh(true)
  assert.equal(model.state.value.visible, false)
  assert.equal(writes, 1)
  model.dispose()
})

test('declining is remembered without querying providers and never enables automatic work', async () => {
  let settings = defaultMusicIdentificationSettings()
  const model = createMusicMetadataSetup({
    current: () => settings,
    hasMusic: async () => true,
    policy: async () => {
      assert.fail('declining must not query providers')
    },
    save: async (next) => {
      settings = next
    }
  })
  await model.refresh(true)
  await model.choose(false)
  assert.equal(settings.setup, 'declined')
  assert.equal(settings.newImports, false)
  assert.equal(settings.history, false)
  const reopened = createMusicMetadataSetup({
    current: () => settings,
    hasMusic: async () => true,
    policy,
    save: async () => {}
  })
  await reopened.refresh(true)
  assert.equal(reopened.state.value.visible, false)
  model.dispose()
  reopened.dispose()
})

test('failed saves remain retryable and competing clicks cannot overwrite the pending decision', async () => {
  let settings = defaultMusicIdentificationSettings(),
    writes = 0
  const model = createMusicMetadataSetup({
    current: () => settings,
    hasMusic: async () => true,
    policy,
    save: async (next) => {
      if (++writes === 1) throw Error('disk full')
      settings = next
    }
  })
  await model.refresh(true)
  const work = model.choose(true)
  await model.choose(false)
  await work
  assert.equal(writes, 1)
  assert.equal(settings.setup, 'pending')
  assert.equal(model.state.value.visible, true)
  assert.match(model.state.value.error, /disk full/)
  await model.choose(true)
  assert.equal(model.state.value.visible, false)
  assert.equal(settings.setup, 'accepted')
  model.dispose()
})

test('a delayed library read cannot open a prompt after settings change or disposal', async () => {
  let finish!: (value: boolean) => void
  let settings = defaultMusicIdentificationSettings()
  const model = createMusicMetadataSetup({
    current: () => settings,
    hasMusic: () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    policy,
    save: async () => {}
  })
  const read = model.refresh(true)
  settings = musicMetadataSetupChoice(settings, false)
  finish(true)
  await read
  assert.equal(model.state.value.visible, false)
  settings = defaultMusicIdentificationSettings()
  const second = model.refresh(true)
  model.dispose()
  finish(true)
  await second
  assert.equal(model.state.value.visible, false)
})

test('new and legacy-unconfigured profiles wait for consent; existing saved choices survive normalization and restarts', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'metadata-release-settings-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const options = {
    filePath: join(root, 'settings.json'),
    environment: {
      platform: 'win32' as const,
      defaultCachePath: join(root, 'cache'),
      resolvePath: resolve
    },
    changed() {}
  }
  assert.deepEqual(
    new CoreSettingsRepository(options).read().musicIdentification,
    defaultMusicIdentificationSettings()
  )
  writeFileSync(options.filePath, JSON.stringify({ audioDevice: 'saved-dac', language: 'en-US' }))
  const legacy = new CoreSettingsRepository(options)
  assert.equal(legacy.read().musicIdentification.setup, 'pending')
  const choice = musicMetadataSetupChoice(legacy.read().musicIdentification, true)
  legacy.update({ musicIdentification: choice })
  assert.deepEqual(new CoreSettingsRepository(options).read().musicIdentification, choice)
  assert.equal(legacy.read().audioDevice, 'saved-dac')
  assert.equal(legacy.read().language, 'en-US')
  const explicit: MusicIdentificationSettings = {
    newImports: false,
    history: false,
    sources: [],
    ncmLocalFallback: false
  }
  legacy.update({ musicIdentification: explicit })
  assert.deepEqual(new CoreSettingsRepository(options).read().musicIdentification, explicit)
  assert.deepEqual(
    normalizeMusicIdentificationSettings({
      newImports: false,
      history: false,
      sources: ['musicbrainz']
    }),
    { newImports: false, history: false, sources: ['musicbrainz'] }
  )
})
