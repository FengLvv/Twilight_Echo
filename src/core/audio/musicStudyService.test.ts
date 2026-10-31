import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CoreMusicStudyService,
  type StudyPorts,
  type StudyRecord,
  type StudyWorkerStatus
} from './musicStudyService.ts'
import { studyMixGains, validStudyPayload, type StudyResult } from '../../shared/musicStudy.ts'
import { validCorePayload } from '../../shared/coreRequestValidation.ts'
import { validCorePlatformPayload } from '../../shared/corePlatform.ts'
const result: StudyResult = {
  version: 1,
  ready: ['six','chords','leadBacking','twoSingers'],
  duration: 10,
  frames: 441000,
  sampleRate: 44100,
  stems: [
    'vocals',
    'drums',
    'bass',
    'other',
    'piano',
    'guitar',
    'lead',
    'backing',
    'singerA',
    'singerB'
  ],
  harmonicStems: ['bass', 'piano'],
  chords: {
    algorithm: 'fixture',
    tuningCents: 0,
    segments: [
      { start: 0, end: 5, label: 'C', confidence: 'high', candidates: ['C', 'Am7'] },
      { start: 5, end: 10, label: 'G', confidence: 'medium', candidates: ['G'] }
    ]
  },
  originalChords: { segments: [] },
  waveforms: {},
  sourceSha256: 'abc',
  models: {
    instruments: 'six',
    voices: 'kara',
    singers: 'duet',
    singersSampleRate: 24000,
    singersChannels: 1
  }
}
function fixture(initial: StudyRecord[] = []) {
  const saved = new Map(initial.map((r) => [r.id, structuredClone(r)])),
    launched: string[] = [],
    cancelled: string[] = [],
    removed: string[] = [],
    timers: Array<() => void> = []
  let status: StudyWorkerStatus = { running: true, progress: 0.2, stage: 'six' },
    audition = false
  const ports: StudyPorts = {
    repository: {
      list: async () => [...saved.values()].map((r) => structuredClone(r)),
      save: async (r) => {
        saved.set(r.id, structuredClone(r))
      },
      remove: async (id) => {
        saved.delete(id)
      }
    },
    newId: () => `project-${saved.size + 1}`,
    now: () => 1,
    changed: () => {},
    source: async () => ({
      title: 'A song',
      source: { path: '/test/song.wav', identity: 'logical-song' }
    }),
    environment: async () => ({ ready: true, gpu: true, gpuName: 'test' }),
    choosePack: async () => {},
    lyrics: () => '[{"id":0,"start":0,"end":10,"text":"test"}]',
    start: async (r) => {
      launched.push(r.id)
    },
    worker: async () => status,
    cancel: async (id) => {
      cancelled.push(id)
    },
    removeFiles: async (id) => {
      removed.push(id)
    },
    writeMix: async () => '/test/mix.temix',
    export: async () => '/export',
    audition: {
      begin: async () => {
        audition = true
      },
      replace: async () => {},
      control: async (c) => {
        if (c.action === 'exit') audition = false
      },
      state: async () =>
        audition ? { id: '', position: 2, duration: 10, playing: true, loop: null } : null
    },
    schedule: (cb) => {
      timers.push(cb)
      return () => {
        const i = timers.indexOf(cb)
        if (i >= 0) timers.splice(i, 1)
      }
    }
  }
  const service = new CoreMusicStudyService(ports)
  const settle = async () => {
    await new Promise<void>((done) => setImmediate(done))
  }
  return {
    service,
    ports,
    saved,
    launched,
    cancelled,
    removed,
    settle,
    tick: async () => {
      await settle()
      timers.shift()?.()
      await settle()
    },
    complete: () => {
      status = { running: false, progress: 1, stage: 'done', result }
    },
    workerStatus: (value: StudyWorkerStatus) => {
      status = value
    }
  }
}
test('background submit keeps explicit sources and voice splitting opt-in',async()=>{
  const f=fixture()
  let selected: unknown
  f.ports.source=async(input,current)=>{selected={input,current};return {title:'Background',source:{path:'/background.wav',identity:'background'}}}
  const input={kind:'local' as const,id:'background'}
  const project=await f.service.submit({input,stages:['six']})
  await f.settle()
  assert.deepEqual(selected,{input,current:undefined})
  assert.equal(project.songId,'background')
  assert.equal(f.saved.get(project.id)?.operation,'six')
  assert(!f.saved.get(project.id)?.stages?.leadBacking)
  assert(!f.saved.get(project.id)?.stages?.twoSingers)
  await f.service.shutdown()
})
test('supplied timed lyrics validate before any background job is launched',async()=>{
  const f=fixture()
  await assert.rejects(f.service.submit({input:{kind:'local',id:'background'},stages:['six','chords','melody'],lyrics:'No timestamps'}),/时间/)
  assert.equal(f.launched.length,0)
  assert.equal(f.saved.size,0)
  const project=await f.service.submit({input:{kind:'local',id:'background'},stages:['six','chords','melody'],lyrics:'[00:00.00]First line\n[00:05.00]Second line'})
  await f.settle()
  const saved=f.saved.get(project.id)!
  assert.equal(saved.operation,'melody')
  assert.equal(JSON.parse(saved.lyrics!)[0].text,'First line')
  assert(saved.pending?.includes('chords'))
  assert(!saved.pending?.includes('twoSingers'))
  await f.service.shutdown()
})
test('vocal melody is opt-in, prepares six without chords and is reused when complete', async () => {
  const f = fixture()
  const p = await f.service.transcribeMelody('logical-song')
  await f.service.transcribeMelody('logical-song')
  await f.settle()
  assert.equal(f.saved.size, 1)
  assert.equal(f.saved.get(p!.id)?.operation, 'melody')
  assert.equal(f.launched.length, 1)
  assert(!f.saved.get(p!.id)?.stages?.chords)
  const withMelody = structuredClone(result)
  withMelody.ready = ['six', 'melody']
  withMelody.melody = {
    scores: [],
    notes: [{ start: 0, end: 1, midi: 60 }],
    key: null,
    source: 'vocals',
    algorithm: 'vocal2midi-tifa-game-medium-rhythm-v1'
  }
  f.workerStatus({ running: false, progress: 1, stage: 'done', result: withMelody })
  await f.tick()
  const launches = f.launched.length
  assert.equal(
    (await f.service.transcribeMelody('logical-song'))?.result?.melody?.notes[0].midi,
    60
  )
  await f.settle()
  assert.equal(f.launched.length, launches)
  f.ports.lyrics = () => '[{"id":0,"start":0,"end":10,"text":"changed lyrics"}]'
  const changed = await f.service.transcribeMelody('logical-song')
  assert.equal(changed?.id, p!.id)
  assert.equal(changed?.result?.melody, undefined)
  assert.equal(f.saved.get(p!.id)?.stages?.melody?.status, 'queued')
  assert(validStudyPayload('study.transcribeMelody', { songId: 'logical-song' }))
  assert(
    validCorePlatformPayload({
      kind: 'core:platform',
      requestId: 'melody-test',
      epoch: 'e',
      name: 'study.startWorker',
      payload: {
        id: 'project-1',
        source: '/test/source.wav',
        leadBacking: false,
        twoSingers: false,
        operation: 'melody'
      }
    })
  )
  assert(
    !validStudyPayload('study.transcribeMelody', { songId: 'logical-song', filePath: '/injected' })
  )
  await f.service.shutdown()
})

test('default song analysis is coalesced and six can mix while chords are still running', async () => {
  const f = fixture()
  const created = await Promise.all([
    f.service.analyze('logical-song'),
    f.service.analyze('logical-song')
  ])
  assert.equal(created[0]!.id, created[1]!.id)
  assert.equal(f.saved.size, 1)
  const id = created[0]!.id
  assert.equal(f.saved.get(id)?.twoSingers, false)
  assert.equal(f.saved.get(id)?.leadBacking, false)
  const partial = structuredClone(result)
  partial.ready = ['six']
  partial.stems = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano']
  partial.chords = { segments: [], tuningCents: null, algorithm: 'not-requested' }
  f.workerStatus({
    running: true,
    progress: 0.1,
    stage: '和弦识别',
    phase: 'chords',
    result: partial,
    resultRevision: 1
  })
  await f.tick()
  assert.equal((await f.service.project(id)).sixReady, true)
  assert.equal((await f.service.project(id)).chordsReady, false)
  await f.service.setMix({ id, mode: 'instruments', tracks: {} })
  assert.equal((await f.service.state({})).audition?.id, id)
  f.workerStatus({
    running: false,
    progress: 1,
    stage: 'done',
    result: { ...partial, chords: result.chords, ready: ['six', 'chords'] },
    resultRevision: 2
  })
  await f.tick()
  assert.equal((await f.service.project(id)).chordsVisible, true)
  await f.service.shutdown()
})

test('a manual chord visibility choice survives completion and a failed chord stage preserves six', async () => {
  const f = fixture(),
    created = await f.service.analyze('logical-song'),
    id = created!.id
  const partial = { ...structuredClone(result), ready: ['six'] as const }
  f.workerStatus({
    running: true,
    progress: 0.1,
    stage: 'chords',
    phase: 'chords',
    result: { ...partial, ready: ['six'] },
    resultRevision: 1
  })
  await f.tick()
  await f.service.chordsVisible(id, false)
  f.workerStatus({
    running: false,
    progress: 0.2,
    stage: 'failed',
    phase: 'chords',
    error: 'model failure',
    result: { ...partial, ready: ['six'] },
    resultRevision: 1
  })
  await f.tick()
  assert.equal((await f.service.project(id)).sixReady, true)
  await f.service.setMix({ id, mode: 'instruments', tracks: {} })
  await f.service.retry(id)
  await f.tick()
  f.workerStatus({
    running: false,
    progress: 1,
    stage: 'done',
    result: { ...structuredClone(result), ready: ['six', 'chords'] },
    resultRevision: 2
  })
  await f.tick()
  assert.equal((await f.service.project(id)).chordsVisible, false)
  await f.service.shutdown()
})
test('lyric display shares controls between windows, persists mode and key, and resets visibility on occurrence changes', async () => {
  const f = fixture()
  let preferences: { mode: 'names' | 'degrees'; notationMode?: 'numbered' | 'staff' } | null = null
  f.ports.repository.loadPreferences = async () => preferences
  f.ports.repository.savePreferences = async (value) => {
    preferences = value
  }
  f.service.bindLyrics('logical-song', 'first')
  await f.service.setLyricsDisplay({ songId: 'logical-song', notationVisible: true })
  await f.settle()
  const id = [...f.saved.keys()][0]
  assert.equal(f.saved.get(id)?.operation, 'melody')
  await f.service.setLyricsDisplay({
    songId: 'logical-song',
    notationVisible: false,
    mode: 'degrees',
    notationMode: 'staff',
    key: '2:major'
  })
  assert.equal((await f.service.lyricsDisplay('logical-song')).notationVisible, false)
  assert.equal(f.launched.length, 1)
  assert.deepEqual(preferences, { mode: 'degrees', notationMode: 'staff' })
  f.service.bindLyrics('logical-song', 'second')
  assert.deepEqual(await f.service.lyricsDisplay('logical-song'), {
    notationMode: 'staff',
    notationVisible: false,
    chordsVisible: false,
    mode: 'degrees',
    key: '2:major'
  })
  f.service.bindLyrics('next', 'third')
  await assert.rejects(
    f.service.setLyricsDisplay({ songId: 'logical-song', notationVisible: true }),
    /变化/
  )
  assert.equal((await f.service.lyricsDisplay('next')).key, 'auto')
  await f.service.shutdown()
})

test('an async display update cannot turn on annotations for a new song', async () => {
  const f = fixture()
  let release!: () => void
  f.ports.repository.savePreferences = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  f.service.bindLyrics('logical-song', 'first')
  await f.service.lyricsDisplay('logical-song')
  const changing = f.service.setLyricsDisplay({
    songId: 'logical-song',
    mode: 'degrees',
    notationVisible: true
  })
  await f.settle()
  f.service.bindLyrics('next', 'second')
  release()
  await assert.rejects(changing, /变化/)
  assert.equal((await f.service.lyricsDisplay('next')).notationVisible, false)
  assert.equal(f.launched.length, 0)
  await f.service.shutdown()
})

test('fixed stem families never double vocals or original; solos are confined to the active family', () => {
  const mix = studyMixGains(
    {
      id: 'a',
      mode: 'twoSingers',
      tracks: {
        vocals: { gain: 2, mute: false, solo: true },
        singerA: { gain: 0.5, mute: false, solo: true }
      }
    },
    result.stems
  )
  assert.equal(mix.vocals, undefined)
  assert.equal(mix.original, undefined)
  assert.equal(mix.singerA, 1, 'parent vocal gain is a bus gain for its children')
  assert.equal(mix.singerB, 0)
  assert.equal(mix.piano, 0)
  assert.deepEqual(studyMixGains({ id: 'a', mode: 'original', tracks: {} }, result.stems), {
    original: 1
  })
})
test('protocol refuses traversal IDs, arbitrary paths, nonfinite gains, unsupported chords and bad source inputs', () => {
  assert.equal(validStudyPayload('study.retry', { id: '../escape' }), false)
  assert.equal(
    validStudyPayload('study.mix', {
      id: 'a',
      mode: 'instruments',
      tracks: { vocals: { gain: NaN, mute: false, solo: false } }
    }),
    false
  )
  assert.equal(
    validCorePayload('study.create', {
      input: {
        kind: 'local',
        id: 'a',
        fallback: { filePath: '/song.wav', title: 'A', artist: '', album: '', duration: 10 }
      }
    }),
    true
  )
  assert.equal(
    validCorePayload('study.create', { input: { kind: 'arbitrary', path: '/secret' } }),
    false
  )
  assert.equal(
    validCorePayload('study.edit', {
      id: 'a',
      revision: 1,
      index: 0,
      label: 'C/E',
      start: 0,
      end: 2
    }),
    true
  )
  for (const label of ['C6', 'Cm6', 'CmMaj7/Eb', 'C7sus4']) {
    assert.equal(
      validCorePayload('study.edit', { id: 'a', revision: 1, index: 0, label, start: 0, end: 2 }),
      true
    )
  }
  assert.equal(
    validCorePayload('study.edit', {
      id: 'a',
      revision: 1,
      index: 0,
      label: '<script>',
      start: 0,
      end: 2
    }),
    false
  )
})
test('project queries remain available while large model integrity checks are pending', async () => {
  const f = fixture()
  let release!: (value: { ready: boolean; gpu: boolean; gpuName: string }) => void
  f.ports.environment = () =>
    new Promise((done) => {
      release = done
    })
  const state = await f.service.state({})
  assert.equal(state.environment.ready, false)
  assert.match(state.environment.error!, /正在检查/)
  let created = false
  const pending = f.service.create({}).then(() => {
    created = true
  })
  await f.settle()
  assert.equal(
    created,
    true,
    'creation acknowledges immediately while environment work runs in the task'
  )
  assert.deepEqual(f.launched, [])
  release({ ready: true, gpu: true, gpuName: 'test' })
  await pending
  assert.equal((await f.service.state({})).environment.ready, true)
  await f.service.shutdown()
})

test('requests across songs and optional vocal stages keep global FIFO order', async () => {
  const f = fixture(),
    first = (await f.service.create({}))!,
    second = (await f.service.create({}))!
  await f.settle()
  const partial = { ...structuredClone(result), ready: ['six'] as Array<'six'> }
  f.workerStatus({
    running: true,
    progress: 0.2,
    stage: 'chords',
    phase: 'chords',
    result: partial,
    resultRevision: 1
  })
  await f.tick()
  await f.service.splitVocals(first.id, 'leadBacking')
  f.complete()
  await f.tick()
  await f.tick()
  assert.deepEqual(f.launched.slice(0, 2), [first.id, second.id])
  await f.tick()
  await f.tick()
  assert.equal(f.launched[2], first.id)
  assert.equal(f.saved.get(first.id)?.operation, 'leadBacking')
  await f.service.shutdown()
})

test('cancel during environment preparation acknowledges without waiting for the probe or launching a worker', async () => {
  const f = fixture()
  let release!: (value: { ready: boolean; gpu: boolean; gpuName: string }) => void
  f.ports.environment = () =>
    new Promise((done) => {
      release = done
    })
  const project = (await f.service.analyze('logical-song'))!
  await f.settle()
  await f.service.cancel(project.id)
  assert.equal((await f.service.project(project.id)).status, 'cancelled')
  assert.deepEqual(f.launched, [])
  release({ ready: true, gpu: true, gpuName: 'test' })
  await f.settle()
  assert.equal((await f.service.project(project.id)).status, 'cancelled')
  await f.service.shutdown()
})

test('cache validation retries missing stages and source replacement gets a fresh analysis', async () => {
  const f = fixture(),
    first = (await f.service.analyze('logical-song'))!
  await f.settle()
  f.complete()
  await f.tick()
  f.ports.validate = async () => ({ ready: ['six'] })
  const reused = (await f.service.analyze('logical-song'))!
  assert.equal(reused.id, first.id)
  assert.equal(reused.sixReady, true)
  assert.equal(reused.chordsReady, false)
  await f.settle()
  await f.tick()
  f.ports.validate = async () => ({ ready: [], sourceChanged: true })
  const replaced = (await f.service.analyze('logical-song'))!
  assert.notEqual(replaced.id, first.id)
  await f.service.shutdown()
})

test('GPU jobs are queued once; result is durable and source paths never leave Core', async () => {
  const f = fixture()
  const first = await f.service.create({}),
    second = await f.service.create({})
  await f.settle()
  assert.ok(first && second)
  assert.deepEqual(f.launched, [first.id])
  assert.equal('source' in first, false)
  f.complete()
  await f.tick()
  assert.equal((await f.service.project(first.id)).status, 'completed')
  await f.tick()
  assert.equal(f.launched.length, 2)
  const state = await f.service.state({})
  assert.equal(state.total, 2)
  assert.equal(JSON.stringify(state).includes('/test/'), false)
  await f.service.shutdown()
})
test('cancel joins a pending launch before killing it; retry preserves stable identity', async () => {
  const f = fixture()
  let release!: () => void
  f.ports.start = async (r) => {
    f.launched.push(r.id)
    await new Promise<void>((done) => (release = done))
  }
  const project = await f.service.create({})
  await f.settle()
  const cancel = f.service.cancel(project!.id)
  await f.settle()
  assert.deepEqual(f.cancelled, [])
  release()
  await cancel
  assert.deepEqual(f.cancelled, [project!.id])
  assert.equal(f.saved.get(project!.id)?.status, 'cancelled')
  await f.service.retry(project!.id)
  await f.settle()
  assert.equal(f.launched.length, 2)
  release()
  await f.service.shutdown()
})
test('restart requires explicit resume and preserves completed work and manual chord edits', async () => {
  const f = fixture()
  const p = await f.service.create({})
  await f.settle()
  f.complete()
  await f.tick()
  const current = await f.service.project(p!.id)
  const edited = await f.service.edit({
    id: p!.id,
    revision: current.revision,
    index: 0,
    label: 'C/E',
    start: 0,
    end: 4.8
  })
  assert.equal(edited.result!.chords.segments[1].start, 4.8)
  await assert.rejects(
    f.service.edit({
      id: p!.id,
      revision: current.revision,
      index: 0,
      label: 'C',
      start: 0,
      end: 5
    }),
    /已更新/
  )
  await f.service.shutdown()
  const restarted = fixture([...f.saved.values()])
  assert.equal((await restarted.service.project(p!.id)).result?.chords.segments[0].label, 'C/E')
  await restarted.service.shutdown()
  const interrupted = fixture([{ ...f.saved.get(p!.id)!, status: 'running' }])
  assert.equal((await interrupted.service.project(p!.id)).status, 'interrupted')
  assert.deepEqual(interrupted.launched, [])
  await interrupted.service.shutdown()
})
test('preview ends before removing audio cache and cannot export missing results', async () => {
  const f = fixture()
  const p = await f.service.create({})
  await f.settle()
  await assert.rejects(
    f.service.export({ id: p!.id, audioFormat: 'flac', chordFormat: 'csv', stems: [] }),
    /等待/
  )
  f.complete()
  await f.tick()
  await f.service.setMix({ id: p!.id, mode: 'leadBacking', tracks: {} })
  assert.equal((await f.service.state({})).audition?.id, p!.id)
  await f.service.remove(p!.id)
  assert.equal((await f.service.state({})).audition, null)
  assert.deepEqual(f.removed, [p!.id])
  await f.service.shutdown()
})
