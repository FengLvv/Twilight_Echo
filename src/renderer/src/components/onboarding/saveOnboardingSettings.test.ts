import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { CoreSettingsRepository } from '../../../../core/persistence/settingsRepository.ts'
import { CoreSettingsService } from '../../../../core/settings/service.ts'
import { CoreSettingsBridge } from '../../../../main/coreProcess/settingsBridge.ts'
import type { SettingsSnapshot } from '../../../../shared/appSettings.ts'
import type { CoreAudioOutput } from '../../../../shared/coreAudio.ts'
import {
  coreOperation,
  isCoreRequest,
  type CoreRequestEnvelope
} from '../../../../shared/coreProtocol.ts'
import { saveOnboardingSettings } from './saveOnboardingSettings.ts'
import {
  buildSettingsPatch,
  createDefaultOnboardingChoices,
  type OnboardingUsage
} from './useOnboardingFlow.ts'

function fixture(t: test.TestContext, exclusive = false) {
  const root = mkdtempSync(join(tmpdir(), 'onboarding-settings-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repository = new CoreSettingsRepository({
    filePath: join(root, 'settings.json'),
    environment: { platform: 'win32', defaultCachePath: join(root, 'cache'), resolvePath: resolve },
    initial: { audioExclusiveMode: exclusive },
    changed() {}
  })
  const settings = new CoreSettingsService({
    repository,
    authorizePaths: async (paths) => paths,
    configureLibrary: async () => {},
    serialize: (action) => action(),
    schedule: () => () => {},
    failed: (error) => {
      throw error
    },
    audio: {
      setAutoMixMode: async () => true,
      invalidateAutoMixSource() {},
      stop: async () => {}
    }
  })
  const requests: CoreRequestEnvelope[] = []
  let audioRevision = 7
  let failure: { name: string; message: string; code: string } | null = null
  async function request(name: string, payload: unknown): Promise<unknown> {
    const envelope = {
      kind: coreOperation(name)?.kind,
      name,
      payload,
      requestId: 'onboarding',
      epoch: 'test'
    }
    if (!isCoreRequest(envelope)) throw new Error('Unknown or malformed Core operation')
    requests.push(structuredClone(envelope))
    if (failure?.name === name) {
      const error = failure
      failure = null
      throw Object.assign(new Error(error.message), { code: error.code })
    }
    switch (envelope.name) {
      case 'settings.state':
        return settings.state()
      case 'settings.edit':
        return settings.edit(envelope.payload, new AbortController().signal)
      case 'audio.output':
        return {
          revision: audioRevision,
          output: {
            output: 'wasapi',
            device: 'auto',
            exclusiveMode: repository.read().audioExclusiveMode,
            exclusiveAvailable: true,
            outputOptions: [],
            deviceOptions: []
          },
          config: { preferredBufferSize: 0, routingMode: 'auto' },
          applyStatus: {
            requestedRevision: 0,
            appliedRevision: 0,
            failedRevision: 0,
            state: 'idle',
            error: '',
            generation: 0
          },
          exclusiveAutoRelease: true
        } satisfies CoreAudioOutput
      case 'audio.output.edit':
        assert.equal(envelope.payload.revision, audioRevision)
        assert.equal(envelope.payload.edit.kind, 'exclusive')
        if (envelope.payload.edit.kind !== 'exclusive') assert.fail('Unexpected output edit')
        // Only the native boundary is simulated; preferences use the production writer and file.
        repository.update({ audioExclusiveMode: envelope.payload.edit.enabled })
        audioRevision++
        return
      default:
        assert.fail(`Unexpected request: ${name}`)
    }
  }
  let projected = settings.state()
  const bridge = new CoreSettingsBridge({
    request: async (name, payload) => (await request(name, payload)) as never,
    project: (state) => {
      projected = state
    },
    snapshot: () => ({ settings: structuredClone(projected.settings) }) as SettingsSnapshot
  })
  const api: Parameters<typeof saveOnboardingSettings>[1] = {
    core: {
      query: async (name, payload) => (await request(name, payload)) as CoreAudioOutput,
      command: request
    },
    updateSettings: (patch) => bridge.update(patch)
  }
  return {
    api,
    bridge,
    requests,
    state: () => settings.state(),
    persisted: () => JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8')),
    failNext(name: string, message: string, code = 'FAILED') {
      failure = { name, message, code }
    }
  }
}

for (const usage of ['local', 'streaming', 'both'] as const satisfies readonly OnboardingUsage[]) {
  test(`first-run ${usage} saves default compatible audio and all visited preferences`, async (t) => {
    const f = fixture(t)
    const choices = createDefaultOnboardingChoices()
    choices.usage = usage
    choices.closeWindowBehavior = 'tray'
    const patch = buildSettingsPatch(choices)
    const original = structuredClone(patch)
    // This is the exact request the old finish handler sent, including the default false.
    await assert.rejects(f.bridge.update(patch), /Unknown or malformed Core operation/)
    await saveOnboardingSettings(patch, f.api)
    assert.equal(f.persisted().onboardingCompleted, true)
    assert.equal(f.persisted().audioExclusiveMode, false)
    assert.equal(f.persisted().startupHomePage, usage === 'streaming' ? 'streaming' : 'local')
    assert.equal(f.persisted().closeWindowBehavior, 'tray')
    assert.equal(
      f.requests.some((r) => r.name === 'audio.output.edit'),
      false
    )
    const edit = f.requests.find((r) => r.name === 'settings.edit')!
    assert.equal('audioExclusiveMode' in edit.payload.patch, false)
    assert.deepEqual(patch, original, 'saving must not mutate the retry draft')
  })
}

for (const exclusive of [true, false]) {
  test(`audio mode ${exclusive} commits through output before completing onboarding`, async (t) => {
    const f = fixture(t, !exclusive)
    await saveOnboardingSettings(
      { onboardingCompleted: true, audioExclusiveMode: exclusive },
      f.api
    )
    assert.deepEqual(
      f.requests.map((r) => r.name),
      ['audio.output', 'audio.output.edit', 'settings.state', 'settings.edit']
    )
    assert.deepEqual(f.requests[1].payload, {
      revision: 7,
      edit: { kind: 'exclusive', enabled: exclusive }
    })
    assert.deepEqual(f.requests[3].payload, { revision: 1, patch: { onboardingCompleted: true } })
    assert.equal(f.persisted().audioExclusiveMode, exclusive)
    assert.equal(f.persisted().onboardingCompleted, true)
  })
}

test('skip and early completion never query or overwrite unvisited audio choices', async (t) => {
  const f = fixture(t, true)
  const choices = createDefaultOnboardingChoices()
  await saveOnboardingSettings(buildSettingsPatch(choices), f.api)
  choices.usage = 'both'
  await saveOnboardingSettings(
    buildSettingsPatch(choices, new Set(['welcome', 'usage', 'local'])),
    f.api
  )
  assert.equal(
    f.requests.some((r) => r.name.startsWith('audio.')),
    false
  )
  assert.equal(f.persisted().audioExclusiveMode, true)
  assert.equal(f.persisted().onboardingCompleted, true)
})

for (const name of ['audio.output', 'audio.output.edit'] as const) {
  test(`${name} failure keeps onboarding incomplete and allows an explicit retry`, async (t) => {
    const f = fixture(t)
    const patch = { onboardingCompleted: true, audioExclusiveMode: true }
    f.failNext(name, '设备暂不可用')
    await assert.rejects(saveOnboardingSettings(patch, f.api), /设备暂不可用/)
    assert.equal(f.state().settings.onboardingCompleted, false)
    assert.equal(
      f.requests.some((r) => r.name === 'settings.edit'),
      false
    )
    await saveOnboardingSettings(patch, f.api)
    assert.equal(f.persisted().onboardingCompleted, true)
    assert.equal(f.persisted().audioExclusiveMode, true)
  })
}

test('a failed preferences save can retry without replaying an acknowledged audio change', async (t) => {
  const f = fixture(t)
  const patch = { onboardingCompleted: true, audioExclusiveMode: true }
  f.failNext('settings.edit', 'disk full')
  await assert.rejects(saveOnboardingSettings(patch, f.api), /disk full/)
  assert.equal(f.persisted().onboardingCompleted, false)
  assert.equal(f.persisted().audioExclusiveMode, true)
  await saveOnboardingSettings(patch, f.api)
  assert.equal(f.persisted().onboardingCompleted, true)
  assert.equal(f.requests.filter((r) => r.name === 'audio.output.edit').length, 1)
})

test('an output revision conflict is surfaced without replaying the rejected command', async (t) => {
  const f = fixture(t)
  f.failNext('audio.output.edit', 'Output configuration changed', 'STALE_REVISION')
  await assert.rejects(
    saveOnboardingSettings({ onboardingCompleted: true, audioExclusiveMode: true }, f.api),
    { code: 'STALE_REVISION' }
  )
  assert.equal(f.requests.filter((r) => r.name === 'audio.output.edit').length, 1)
  assert.equal(f.state().settings.onboardingCompleted, false)
})
