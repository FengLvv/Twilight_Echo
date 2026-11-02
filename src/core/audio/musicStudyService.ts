import type {
  StudyProject,
  StudyResult,
  StudyState,
  StudyMix,
  StudyTransport,
  StudyCreate,
  StudyEdit,
  StudyExport,
  StudyTrack,
  StudyOperation,
  StudyStage,
  StudyLyricDisplay,
  StudyLyricDisplayPatch,
  StudyLyricsProjection,
  StudySubmit,
  StudyAutomaticStage,
  StudyAutomationPolicy
} from '../../shared/musicStudy.ts'
import {
  studyMixGains,
  studyReady,
  STUDY_STAGES,
  STUDY_MELODY_ALGORITHM,
  STUDY_AUTOMATIC_STAGES
} from '../../shared/musicStudy.ts'
import type { CoreQueueTrackInput } from '../../shared/coreQueueSubmission.ts'
import { studyLyricsFromText } from './studyLyrics.ts'
import { CoreStudyAudioCache } from './studyAudioCache.ts'
import { LeasedLru, estimateResultBytes } from '../../shared/leasedLru.ts'
import { studyResultHeader } from '../../shared/studyResultHeader.ts'
import type {
  StudyAudioGroup,
  StudyCachePolicy,
  StudyRuntimeStatus
} from '../../shared/musicStudy.ts'

async function lyricDigest(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const operationStages = (operation: StudyOperation): StudyStage[] =>
  operation === 'analyze' ? ['six', 'chords'] : operation === 'melody' ? ['melody'] : [operation]

export interface StudyRecord extends StudyProject {
  resultLoaded?: boolean
  audioAccess?: Partial<Record<'six' | 'leadBacking' | 'twoSingers', number>>
  prefetch?: boolean
  budgetBytes?: number
  notesReady?: boolean
  source: {
    path: string
    start?: number
    end?: number
    duration?: number
    virtualPregapSeconds?: number
    identity: string
    versionHint?: string
    input?: CoreQueueTrackInput
  }
  harmonicStems?: StudyTrack[]
  pending?: StudyOperation[]
  workerRevision?: number
  workerRunId?: string
  chordsVisibleManual?: boolean
  lyrics?: string
  tonalKey?: string
}
export interface StudyWorkerStatus {
  running: boolean
  progress: number
  stage: string
  error?: string
  result?: StudyResult
  phase?: StudyStage
  resultRevision?: number
  runId?: string
  generation?: number
  interrupted?: boolean
  recovering?: boolean
}
export interface StudyPreferences {
  mode: 'names' | 'degrees'
  notationMode?: 'numbered' | 'staff'
  cachePolicy?: StudyCachePolicy
  automaticStages?: StudyAutomaticStage[]
}
export interface StudyRepository {
  loadPreferences?(): Promise<StudyPreferences | null>
  savePreferences?(value: StudyPreferences): Promise<void>
  list(): Promise<StudyRecord[]>
  loadResult?(id: string): Promise<StudyResult | undefined>
  resultBytes?(): Promise<number>
  close?(): void
  saveSummary(record: StudyRecord): Promise<void>
  commitArtifacts(record: StudyRecord): Promise<number>
  remove(id: string): Promise<void>
}
export interface StudyPorts {
  repository: StudyRepository
  newId(): string
  now(): number
  changed(): void
  source(
    input?: CoreQueueTrackInput,
    current?: boolean,
    projectId?: string
  ): Promise<{
    title: string
    source: StudyRecord['source']
    capture?(): Promise<StudyRecord['source']>
  } | null>
  environment(): Promise<StudyState['environment']>
  runtime?(): Promise<StudyRuntimeStatus>
  runtimeActivity?(busy: boolean): Promise<void>
  audioInventory?(): Promise<StudyAudioGroup[]>
  removeAudio?(group: StudyAudioGroup): Promise<void>
  next?(): Promise<{ key: string; input: CoreQueueTrackInput } | null>
  exportSources?(record: StudyRecord, outputDirectory: string): Promise<number>
  choosePack(): Promise<void>
  lyrics?(songId: string, input?: CoreQueueTrackInput): string | Promise<string>
  validate?(
    record: StudyRecord,
    source: StudyRecord['source'],
    verifyAudio?: boolean
  ): Promise<{ ready: StudyStage[]; sourceChanged?: boolean; notesReady?: boolean }>
  start(record: StudyRecord, signal?: AbortSignal): Promise<void>
  worker(id: string, revision?: number, runId?: string): Promise<StudyWorkerStatus>
  acknowledge?(id: string, status: StudyWorkerStatus): Promise<void>
  cancel(id: string): Promise<void>
  removeFiles(id: string): Promise<void>
  writeMix(id: string, gains: Partial<Record<StudyTrack, number>>, frames: number): Promise<string>
  export(record: StudyRecord, request: StudyExport): Promise<string | null>
  audition: {
    begin(source: string, binding?: { songId: string; occurrenceId?: string }): Promise<void>
    replace(source: string): Promise<void>
    control(command: StudyTransport): Promise<void>
    state(): Promise<StudyState['audition']>
    update?(gains: Partial<Record<StudyTrack, number>>): Promise<void>
  }
  schedule(callback: () => void, delay: number): () => void
}

/** Core owns durable jobs, recovery, revisions and mixer policy; host owns IO/processes. */
export class CoreMusicStudyService {
  private revision = 0
  private lyricBinding = ''
  private lyricSong = ''
  private notationVisible = false
  private requestedChords: boolean | undefined
  private pendingKey = 'auto'
  private chordMode: 'names' | 'degrees' = 'names'
  private notationMode: 'numbered' | 'staff' = 'numbered'
  private records = new Map<string, StudyRecord>()
  private readonly resultLoads = new Map<string, Promise<StudyResult | undefined>>()
  private readonly results = new LeasedLru<string, StudyResult>(
    { bytes: 128 * 1024 ** 2, entries: 32 },
    (id, result) => {
      const record = this.records.get(id)
      if (record?.result === result) {
        record.result = studyResultHeader(result)
        record.resultLoaded = false
      }
    },
    (id) => {
      const record = this.records.get(id)
      return (
        id === this.running ||
        id === this.active ||
        id === this.prefetchId ||
        this.exportIds.has(id) ||
        record?.source.identity === this.lyricSong
      )
    }
  )
  private initialized: Promise<void> | null = null
  private running: string | null = null
  private readonly cancellations = new Map<string, Promise<void>>()
  private stopped = false
  private runtimeDemand = false
  private ticking: Promise<void> | null = null
  private cancelTick: (() => void) | null = null
  private environment: StudyState['environment'] = { ready: false, gpu: false, gpuName: '' }
  private environmentCheck: Promise<void> | null = null
  private active: string | null = null
  private mixFiles = ''
  private mixWork: Promise<unknown> = Promise.resolve()
  private creation: Promise<unknown> = Promise.resolve()
  private queue: Array<{ id: string; operation: StudyOperation }> = []
  private launch: AbortController | null = null
  private readonly audioCache: CoreStudyAudioCache
  private activeRelease: (() => void) | null = null
  private jobLeases = new Map<string, () => void>()
  private waiters = new Set<() => void>()
  private exportIds = new Map<string, number>()
  private analysisEnabled = false
  private prefetchKey = ''
  private prefetchId: string | null = null
  private prefetchTimer: (() => void) | null = null
  private prefetchWork: Promise<void> | null = null
  private automaticStages: StudyAutomaticStage[] = []
  private playing = false
  private automaticKey = ''
  private automaticTimer: (() => void) | null = null
  private automaticWork: Promise<void> | null = null
  private readonly ports: StudyPorts
  constructor(ports: StudyPorts) {
    this.ports = ports
    this.audioCache = new CoreStudyAudioCache({
      inventory: () => ports.audioInventory?.() ?? Promise.resolve([]),
      remove: (group) => ports.removeAudio?.(group) ?? Promise.resolve(),
      record: (id) => this.records.get(id),
      save: (record) => this.save(record),
      resultBytes: () => ports.repository.resultBytes?.() ?? Promise.resolve(0),
      now: ports.now
    })
  }
  activate() {
    void this.init().catch(() => {})
  }
  private async hydrate(
    record: StudyRecord | undefined,
    scope: ReturnType<LeasedLru<string, StudyResult>['scope']>
  ) {
    if (record) scope.retain(record.id)
    if (record?.resultLoaded === false && this.ports.repository.loadResult) {
      const loading =
        this.resultLoads.get(record.id) ??
        this.ports.repository
          .loadResult(record.id)
          .finally(() => this.resultLoads.delete(record.id))
      this.resultLoads.set(record.id, loading)
      record.result = await loading
      record.resultLoaded = true
    }
    if (record?.result) {
      if (this.results.get(record.id) !== record.result)
        this.results.set(record.id, record.result, estimateResultBytes(record.result))
    }
    return record
  }
  private releaseJob(id: string) {
    this.jobLeases.get(id)?.()
    this.jobLeases.delete(id)
    this.audioCache.releaseReservation(id)
    this.results.trim()
  }
  private prefetchSchedule() {
    if (this.stopped || this.prefetchTimer || this.prefetchWork || !this.ports.next) return
    this.prefetchTimer = this.ports.schedule(() => {
      this.prefetchTimer = null
      this.prefetchWork = this.prefetch()
        .catch((error) => console.warn('[study.prefetch]', String(error)))
        .finally(() => {
          this.prefetchWork = null
          if (this.analysisEnabled || this.notationVisible || this.requestedChords)
            this.prefetchSchedule()
        })
    }, 1200)
  }
  private async prefetch() {
    await this.init()
    if (this.results.metrics().overBudget) return
    if (
      !this.audioCache.policy.preloadNext ||
      !(this.analysisEnabled || this.notationVisible || this.requestedChords)
    ) {
      this.audioCache.protectNext(null)
      if (this.prefetchId && this.records.get(this.prefetchId)?.prefetch)
        await this.cancel(this.prefetchId)
      this.prefetchId = null
      this.prefetchKey = ''
      return
    }
    const binding = this.lyricBinding
    const next = await this.ports.next?.()
    const key = next
      ? JSON.stringify([next.key, this.analysisEnabled, this.notationVisible, this.requestedChords])
      : ''
    if (binding !== this.lyricBinding || key === this.prefetchKey) return
    this.prefetchKey = key
    const old = this.prefetchId
    this.prefetchId = null
    this.audioCache.protectNext(null)
    if (old && this.records.get(old)?.prefetch) await this.cancel(old)
    if (!next || this.stopped) return
    const operation = this.notationVisible ? 'melody' : this.analysisEnabled ? 'analyze' : 'chords'
    const project = await this.create({ input: next.input }, undefined, operation, undefined, true)
    if (!project || binding !== this.lyricBinding || this.stopped) return
    this.prefetchId = project.id
    this.audioCache.protectNext(project.id)
    if (this.analysisEnabled && !studyReady(this.get(project.id).result, 'six'))
      await this.enqueue(this.get(project.id), 'six')
    if (
      (this.requestedChords || this.analysisEnabled) &&
      !studyReady(this.get(project.id).result, 'chords')
    )
      await this.enqueue(this.get(project.id), 'chords')
  }
  async cache() {
    await this.init()
    return { ...(await this.audioCache.status()), memory: this.results.metrics() }
  }
  async runtime() {
    return this.ports.runtime?.() ?? { state: 'stopped' as const, pid: null, loaded: [] }
  }
  private persistPreferences() {
    return this.ports.repository.savePreferences?.({
      mode: this.chordMode,
      notationMode: this.notationMode,
      cachePolicy: { ...this.audioCache.policy },
      automaticStages: [...this.automaticStages]
    })
  }
  async automation(): Promise<StudyAutomationPolicy> {
    await this.init()
    return { stages: [...this.automaticStages] }
  }
  async setAutomation(policy: StudyAutomationPolicy) {
    await this.init()
    this.automaticStages = STUDY_AUTOMATIC_STAGES.filter((stage) => policy.stages.includes(stage))
    this.automaticKey = ''
    await this.persistPreferences()
    this.changed()
    this.automaticSchedule()
    return this.automation()
  }
  private automaticSchedule() {
    this.automaticTimer?.()
    this.automaticTimer = null
    if (
      this.stopped ||
      !this.playing ||
      !this.lyricSong ||
      !this.automaticStages.length ||
      this.automaticWork
    )
      return
    const key = JSON.stringify([this.lyricBinding, this.automaticStages])
    if (key === this.automaticKey) return
    this.automaticTimer = this.ports.schedule(() => {
      this.automaticTimer = null
      this.automaticKey = key
      const songId = this.lyricSong,
        stages = [...this.automaticStages]
      const current = () =>
        !this.stopped &&
        this.playing &&
        key === JSON.stringify([this.lyricBinding, this.automaticStages])
      this.automaticWork = this.automaticallyAnalyze(songId, stages, current)
        .catch((error) => console.warn('[study.automatic]', String(error)))
        .finally(() => {
          this.automaticWork = null
          this.automaticSchedule()
        })
    }, 700)
  }
  private async automaticallyAnalyze(
    songId: string,
    stages: StudyAutomaticStage[],
    current: () => boolean
  ) {
    const resultScope = this.results.scope()
    try {
      const existing = await this.hydrate(this.songRecord(songId), resultScope)
      // Melody needs vocals; admitting separation first lets other selected stages
      // finish even when timed lyrics are unavailable.
      const first =
        stages.length === 1 && stages[0] === 'melody' && studyReady(existing?.result, 'melody')
          ? 'melody'
          : stages.includes('six') || !stages.includes('chords')
            ? 'six'
            : 'chords'
      const project = await this.create(
        { current: true },
        songId,
        first,
        undefined,
        false,
        false,
        current
      )
      if (!project || !current()) return
      const record = this.get(project.id)
      if (stages.includes('chords') && first !== 'chords') await this.enqueue(record, 'chords')
      if (!stages.includes('melody') || first === 'melody' || !current()) return
      try {
        await this.create({ current: true }, songId, 'melody', undefined, false, false, current)
      } catch (error) {
        if (!current()) return
        record.stages ??= {}
        record.stages.melody = {
          status: 'failed',
          progress: 0,
          error: error instanceof Error ? error.message : String(error)
        }
        if (!['queued', 'running', 'cancelling', 'recovering'].includes(record.status))
          record.status = 'failed'
        await this.save(record)
      }
    } finally {
      resultScope.dispose()
    }
  }
  async setCachePolicy(patch: Partial<StudyCachePolicy>) {
    await this.init()
    Object.assign(this.audioCache.policy, patch)
    await this.persistPreferences()
    if (!this.audioCache.policy.preloadNext) {
      this.audioCache.protectNext(null)
      this.prefetchKey = ''
      if (this.prefetchId && this.records.get(this.prefetchId)?.prefetch)
        await this.cancel(this.prefetchId)
    }
    await this.audioCache.trim()
    this.changed()
    this.prefetchSchedule()
    return this.audioCache.status()
  }
  async clearAudioCache() {
    await this.init()
    await this.audioCache.trim(true)
    this.changed()
    return this.audioCache.status()
  }
  getRevision() {
    return this.revision
  }
  private changed() {
    this.updateRuntimeDemand()
    this.revision++
    this.ports.changed()
    for (const check of [...this.waiters]) check()
  }
  private updateRuntimeDemand() {
    const busy =
      !this.stopped &&
      (!!this.running ||
        this.queue.some((job) => this.records.get(job.id)?.pending?.includes(job.operation)))
    if (busy === this.runtimeDemand) return
    this.runtimeDemand = busy
    void this.ports
      .runtimeActivity?.(busy)
      .catch((error) => console.warn('[study.runtimeActivity]', String(error)))
  }
  bindLyrics(songId: string, occurrenceId: string | null, playing = false) {
    const binding = JSON.stringify([songId, occurrenceId])
    const playbackChanged = this.playing !== playing
    this.playing = playing
    if (this.lyricBinding === binding) {
      if (playbackChanged) this.automaticSchedule()
      return
    }
    this.lyricBinding = binding
    this.lyricSong = songId
    this.results.trim()
    this.notationVisible = false
    this.requestedChords = undefined
    this.pendingKey = 'auto'
    this.audioCache.protectNext(null)
    this.prefetchKey = ''
    this.prefetchSchedule()
    this.automaticSchedule()
    this.revision++
  }
  private songRecord(songId: string) {
    return [...this.records.values()]
      .filter((r) => r.source.identity === songId)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
  }
  private displayFor(songId: string, record = this.songRecord(songId)): StudyLyricDisplay {
    const current = songId === this.lyricSong
    return {
      notationMode: this.notationMode,
      notationVisible: current && this.notationVisible,
      chordsVisible:
        current && this.requestedChords !== undefined
          ? this.requestedChords
          : (record?.chordsVisible ?? false),
      mode: this.chordMode,
      key: record?.tonalKey ?? (current ? this.pendingKey : 'auto')
    }
  }
  async lyricsDisplay(songId: string) {
    await this.init()
    return this.displayFor(songId)
  }
  async setLyricsDisplay(patch: StudyLyricDisplayPatch) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      if (patch.songId !== this.lyricSong) throw new Error('当前歌曲已变化，请重试')
      const binding = this.lyricBinding
      const current = () => {
        if (binding !== this.lyricBinding) throw new Error('当前歌曲已变化，请重试')
      }
      if (patch.mode !== undefined || patch.notationMode !== undefined) {
        if (patch.mode !== undefined) this.chordMode = patch.mode
        if (patch.notationMode !== undefined) this.notationMode = patch.notationMode
        await this.persistPreferences()
        current()
      }
      const record = await this.hydrate(this.songRecord(patch.songId), resultScope)
      if (patch.key !== undefined) {
        this.pendingKey = patch.key
        if (record) {
          record.tonalKey = patch.key
          await this.save(record)
        }
        current()
      }
      if (patch.notationVisible !== undefined) this.notationVisible = patch.notationVisible
      if (patch.chordsVisible !== undefined) {
        this.requestedChords = patch.chordsVisible
        if (record) await this.chordsVisible(record.id, patch.chordsVisible)
        current()
      }
      this.changed()
      this.prefetchSchedule()
      if (patch.notationVisible) await this.transcribeMelody(patch.songId)
      if (patch.chordsVisible && !studyReady(record?.result, 'chords'))
        await this.analyze(patch.songId)
      return this.displayFor(patch.songId)
    } finally {
      resultScope.dispose()
    }
  }
  async lyricsProjection(songId: string): Promise<StudyLyricsProjection> {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = await this.hydrate(this.songRecord(songId), resultScope)
      const busy = (stage: StudyStage) =>
        ['queued', 'running', 'cancelling', 'recovering'].includes(
          record?.stages?.[stage]?.status ?? ''
        )
      return {
        display: this.displayFor(songId),
        chords: studyReady(record?.result, 'chords') ? record!.result!.chords.segments : [],
        melody: studyReady(record?.result, 'melody') ? record!.result!.melody : undefined,
        melodyBusy: busy('melody'),
        chordsBusy: busy('chords'),
        error: record?.error
      }
    } finally {
      resultScope.dispose()
    }
  }
  private init(): Promise<void> {
    return (this.initialized ??= (async () => {
      const preferences = await this.ports.repository.loadPreferences?.()
      this.chordMode = preferences?.mode ?? 'names'
      this.notationMode = preferences?.notationMode ?? 'numbered'
      Object.assign(this.audioCache.policy, preferences?.cachePolicy ?? {})
      this.automaticStages = STUDY_AUTOMATIC_STAGES.filter((stage) =>
        preferences?.automaticStages?.includes(stage)
      )
      for (const record of await this.ports.repository.list()) {
        if (record.status === 'running' || record.status === 'queued') {
          record.status = 'interrupted'
          record.pending = []
          for (const phase of Object.values(record.stages ?? {}))
            if (phase.status === 'running' || phase.status === 'queued')
              phase.status = 'interrupted'
          record.stage = '上次任务中断，可继续'
          record.revision++
          await this.ports.repository.saveSummary(record)
        }
        this.records.set(record.id, record)
      }
      await this.audioCache.trim().catch(() => {})
      this.automaticSchedule()
      // Multi-GB integrity checks and Python startup must not block project
      // queries or read-only playback behind the window request deadline.
      this.environment = { ready: false, gpu: false, gpuName: '', error: '正在检查分析环境与模型' }
      this.environmentCheck = this.ports
        .environment()
        .then((environment) => {
          this.environment = environment
        })
        .catch((error) => {
          this.environment = { ready: false, gpu: false, gpuName: '', error: String(error) }
        })
        .finally(() => {
          if (!this.stopped) this.changed()
        })
    })())
  }
  private async save(record: StudyRecord, artifacts = false) {
    record.revision++
    if (artifacts) {
      record.artifactRevision = await this.ports.repository.commitArtifacts(record)
      if (record.result)
        this.results.set(record.id, record.result, estimateResultBytes(record.result))
    } else await this.ports.repository.saveSummary(record)
    this.changed()
  }
  private get(id: string) {
    const record = this.records.get(id)
    if (!record) throw new Error('分析项目不存在')
    return record
  }
  private view(record: StudyRecord, includeResult = true): StudyProject {
    const {
      source,
      pending: _pending,
      workerRevision: _worker,
      workerRunId: _run,
      chordsVisibleManual: _manual,
      lyrics: _lyrics,
      tonalKey: _key,
      resultLoaded: _loaded,
      budgetBytes: _budget,
      notesReady: _notes,
      audioAccess: _access,
      prefetch: _prefetch,
      result,
      ...view
    } = record
    return structuredClone({
      ...view,
      ...(includeResult && result ? { result } : {}),
      lyricDisplay: this.displayFor(source.identity, record),
      songId: source.identity,
      sixReady: studyReady(record.result, 'six'),
      chordsReady: studyReady(record.result, 'chords')
    })
  }
  async state(query: { offset?: number; limit?: number }): Promise<StudyState> {
    await this.init()
    const records = [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt)
    const audition = await this.ports.audition.state()
    if (!audition) {
      this.active = null
      this.results.trim()
      this.activeRelease?.()
      this.activeRelease = null
    }
    return {
      total: records.length,
      activeCount: records.filter((r) =>
        ['running', 'queued', 'cancelling', 'recovering'].includes(r.status)
      ).length,
      projects: records
        .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50))
        .map((record) => {
          const summary = this.view(record, false)
          return { ...summary, ...(record.result ? { duration: record.result.duration } : {}) }
        }),
      environment: { ...this.environment },
      audition: audition && this.active ? { ...audition, id: this.active } : null
    }
  }
  async project(id: string) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      await this.hydrate(this.get(id), resultScope)
      return this.view(this.get(id))
    } finally {
      resultScope.dispose()
    }
  }
  async song(songId: string): Promise<StudyProject | null> {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = [...this.records.values()]
        .filter((r) => r.source.identity === songId)
        .sort((a, b) => b.createdAt - a.createdAt)[0]
      return record ? this.view((await this.hydrate(record, resultScope))!) : null
    } finally {
      resultScope.dispose()
    }
  }
  async songSummary(songId: string) {
    await this.init()
    const record = this.songRecord(songId)
    return record ? this.view(record, false) : null
  }
  async analyze(songId: string) {
    this.analysisEnabled = true
    this.prefetchSchedule()
    return this.create({ current: true }, songId)
  }
  async transcribeMelody(songId: string) {
    return this.create({ current: true }, songId, 'melody')
  }
  async submit(input: StudySubmit) {
    const first: StudyOperation = input.stages.includes('chords')
      ? 'analyze'
      : input.stages.includes('melody')
        ? 'melody'
        : 'six'
    const selection = { ...(input.input ? { input: input.input } : { current: true }) }
    const project = await this.create(
      selection,
      undefined,
      first,
      input.lyrics,
      false,
      input.stages.includes('melody')
    )
    if (!project) throw new Error('没有可分析的音源')
    const record = this.get(project!.id)
    if (
      input.stages.includes('melody') &&
      first !== 'melody' &&
      !studyReady(record.result, 'melody')
    ) {
      record.lyrics =
        record.lyrics ??
        studyLyricsFromText(
          input.lyrics ?? (await this.ports.lyrics?.(record.source.identity, input.input)) ?? '',
          record.source.duration
        )
      if (!record.lyrics) throw new Error('请先加载带时间的原文歌词')
      await this.enqueue(record, 'melody')
    }
    if (input.stages.includes('six') && !studyReady(record.result, 'six') && first === 'melody')
      await this.enqueue(record, 'six')
    if (
      input.stages.includes('chords') &&
      first !== 'analyze' &&
      !studyReady(record.result, 'chords')
    )
      await this.enqueue(record, 'chords')
    for (const stage of input.stages)
      if (
        stage !== 'six' &&
        stage !== 'chords' &&
        stage !== 'melody' &&
        !studyReady(record.result, stage)
      )
        await this.enqueue(record, stage)
    return this.view(record)
  }
  async splitVocals(id: string, kind: 'leadBacking' | 'twoSingers') {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(id)
      await this.hydrate(record, resultScope)
      if (kind === 'twoSingers' && this.environment.ready && !this.environment.gpu)
        throw new Error('双歌手分离需要 CUDA GPU')
      if (!studyReady(record.result, kind)) await this.enqueue(record, kind)
      return this.view(record)
    } finally {
      resultScope.dispose()
    }
  }
  async chordsVisible(id: string, visible: boolean) {
    await this.init()
    const record = this.get(id)
    if (record.source.identity === this.lyricSong) this.requestedChords = visible
    record.chordsVisible = visible
    record.chordsVisibleManual = true
    await this.save(record)
    this.prefetchSchedule()
  }
  private async enqueue(record: StudyRecord, operation: StudyOperation) {
    const covered = new Set((record.pending ?? []).flatMap(operationStages))
    if (record.status === 'running' && record.operation)
      operationStages(record.operation).forEach((stage) => covered.add(stage))
    const missing = operationStages(operation).filter(
      (stage) => !studyReady(record.result, stage) && !covered.has(stage)
    )
    if (!missing.length) return
    if (operation === 'analyze' && missing.length === 1) operation = missing[0] as StudyOperation
    if (
      !record.prefetch &&
      this.running &&
      this.running !== record.id &&
      this.get(this.running).prefetch
    )
      await this.cancel(this.running)
    if (
      (record.status === 'running' && record.operation === operation) ||
      record.pending?.includes(operation)
    )
      return
    record.pending ??= []
    record.pending.push(operation)
    if (record.prefetch) this.queue.push({ id: record.id, operation })
    else {
      const background = this.queue.findIndex((job) => this.records.get(job.id)?.prefetch)
      this.queue.splice(background < 0 ? this.queue.length : background, 0, {
        id: record.id,
        operation
      })
    }
    const phases = operationStages(operation)
    record.stages ??= {}
    for (const phase of phases)
      if (!studyReady(record.result, phase) || operation !== 'analyze')
        record.stages[phase] = { status: 'queued', progress: 0 }
    if (record.status !== 'running') {
      record.status = 'queued'
      record.stage = '等待处理'
      record.error = undefined
    }
    await this.save(record)
    this.kick()
  }
  create(
    input: StudyCreate,
    expectedSong?: string,
    operation: StudyOperation = 'analyze',
    suppliedLyrics?: string,
    prefetch = false,
    needsLyrics = false,
    current?: () => boolean
  ): Promise<StudyProject | null> {
    const work = this.creation.then(() =>
      this.createRecord(
        input,
        expectedSong,
        operation,
        suppliedLyrics,
        prefetch,
        needsLyrics,
        current
      )
    )
    this.creation = work.catch(() => {})
    return work
  }
  private async createRecord(
    input: StudyCreate,
    expectedSong: string | undefined,
    operation: StudyOperation,
    suppliedLyrics?: string,
    prefetch = false,
    needsLyrics = false,
    current?: () => boolean
  ) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      if (current && !current()) return null
      const projectId = this.ports.newId()
      const source = await this.ports.source(input.input, input.current, projectId)
      if (current && !current()) return null
      if (!source) return null
      if (expectedSong && source.source.identity !== expectedSong)
        throw Object.assign(new Error('当前歌曲已变化'), { code: 'CANCELLED' })
      const lyrics =
        operation === 'melody' || needsLyrics
          ? suppliedLyrics !== undefined
            ? studyLyricsFromText(
                suppliedLyrics,
                source.source.duration && source.source.duration > 0
                  ? source.source.duration
                  : undefined
              )
            : await this.ports.lyrics?.(source.source.identity, input.input)
          : undefined
      if (current && !current()) return null
      if ((operation === 'melody' || needsLyrics) && !lyrics)
        throw new Error('请先加载带时间的原文歌词，再生成简谱')
      if (input.current || input.input) {
        const existing = [...this.records.values()]
          .filter(
            (r) =>
              r.source.identity === source.source.identity &&
              r.source.start === source.source.start &&
              r.source.end === source.source.end &&
              r.source.virtualPregapSeconds === source.source.virtualPregapSeconds &&
              r.source.versionHint === source.source.versionHint
          )
          .sort((a, b) => b.createdAt - a.createdAt)[0]
        if (existing) {
          await this.hydrate(existing, resultScope)
          const checked =
            existing.status !== 'running' && existing.status !== 'queued' && existing.result
              ? await this.ports.validate?.(existing, source.source)
              : undefined
          if (current && !current()) return null
          if (!checked?.sourceChanged) {
            const promoted = !prefetch && existing.prefetch
            if (!prefetch) existing.prefetch = false
            else if (!['queued', 'running', 'cancelling', 'recovering'].includes(existing.status))
              existing.prefetch = true
            existing.notesReady = checked?.notesReady ?? existing.notesReady
            existing.source = { ...existing.source, ...source.source }
            if ((operation === 'melody' || needsLyrics) && existing.lyrics !== lyrics) {
              if (existing.status === 'running' && existing.operation === 'melody')
                throw new Error('歌词已变化，请等待当前简谱完成后重新生成')
              existing.lyrics = lyrics
              if (existing.result) {
                // Retain immutable prior notes for context-level reuse; readiness
                // hides them until they match the new lyrics.
                existing.result.ready = existing.result.ready?.filter((s) => s !== 'melody')
                delete existing.result.cache?.signatures.notes
                delete existing.result.cache?.signatures.score
                existing.notesReady = false
                if (checked) checked.ready = checked.ready.filter((s) => s !== 'melody')
              }
            }
            if (checked && existing.result) {
              existing.result.ready = checked.ready
              existing.result.stems = existing.result.stems.filter((s) =>
                ['lead', 'backing'].includes(s)
                  ? checked.ready.includes('leadBacking')
                  : ['singerA', 'singerB'].includes(s)
                    ? checked.ready.includes('twoSingers')
                    : checked.ready.includes('six')
              )
              existing.leadBacking = checked.ready.includes('leadBacking')
              existing.twoSingers = checked.ready.includes('twoSingers')
              for (const [phase, value] of Object.entries(existing.stages ?? {}))
                if (value.status === 'completed' && !checked.ready.includes(phase as StudyStage))
                  existing.stages![phase as StudyStage] = { status: 'idle', progress: 0 }
              await this.save(existing)
            }
            if (operationStages(operation).some((stage) => !studyReady(existing.result, stage)))
              await this.enqueue(existing, operation)
            if (promoted) {
              const jobs = this.queue.filter((job) => job.id === existing.id)
              this.queue = this.queue.filter((job) => job.id !== existing.id)
              const background = this.queue.findIndex((job) => this.records.get(job.id)?.prefetch)
              this.queue.splice(background < 0 ? this.queue.length : background, 0, ...jobs)
              await this.save(existing)
            }
            return this.view(existing)
          }
        }
      }
      const record: StudyRecord = {
        id: projectId,
        title: source.title,
        source: source.source,
        prefetch,
        resultLoaded: true,
        lyrics,
        tonalKey: source.source.identity === this.lyricSong ? this.pendingKey : 'auto',
        status: 'queued',
        stage: '等待分析',
        progress: 0,
        leadBacking: false,
        twoSingers: false,
        stages: {},
        pending: [],
        chordsVisible: false,
        createdAt: this.ports.now(),
        revision: 0,
        artifactRevision: 0
      }
      this.records.set(record.id, record)
      await this.enqueue(record, operation)
      return this.view(record)
    } finally {
      resultScope.dispose()
    }
  }
  private kick() {
    if (this.stopped || this.ticking || this.cancellations.size) return
    this.cancelTick?.()
    this.cancelTick = null
    this.ticking = this.tick()
      .catch(async (error) => {
        if (this.running) {
          const record = this.get(this.running)
          try {
            await this.ports.cancel(record.id)
          } catch (cancelError) {
            record.status = 'recovering'
            record.stage = '等待分析进程退出'
            record.error = String(cancelError)
            await this.save(record)
            return
          }
          const receipt = {
            ...(await this.ports.worker(record.id, -1, record.workerRunId)),
            running: false
          }
          const artifactsChanged = await this.acceptResult(record, receipt)
          if (['running', 'recovering', 'cancelling'].includes(record.status)) {
            record.status = this.stopped ? 'interrupted' : 'failed'
            record.error = String(error)
            record.stage = this.stopped ? '上次任务中断，可继续' : '分析失败'
            const phases: StudyStage[] = record.operation
              ? operationStages(record.operation)
              : ['six']
            for (const key of phases) {
              const phase = record.stages?.[key]
              if (phase && (phase.status === 'running' || phase.status === 'queued')) {
                phase.status = this.stopped ? 'interrupted' : 'failed'
                phase.error = record.error
              }
            }
            record.pending = []
          }
          try {
            await this.save(record, artifactsChanged)
            await this.ports.acknowledge?.(record.id, receipt)
          } catch (error) {
            record.status = 'recovering'
            record.stage = '等待保存分析结果'
            record.error = String(error)
            this.changed()
            return
          }
          this.running = null
          this.releaseJob(record.id)
        }
      })
      .finally(() => {
        this.ticking = null
        this.updateRuntimeDemand()
        if (
          !this.stopped &&
          (this.running || [...this.records.values()].some((r) => r.status === 'queued'))
        )
          this.cancelTick = this.ports.schedule(() => this.kick(), 700)
      })
  }
  private async acceptResult(record: StudyRecord, status: StudyWorkerStatus): Promise<boolean> {
    if (!(status.result && (record.workerRevision !== status.resultRevision || !status.running)))
      return false
    const old = record.result
    const next = structuredClone(status.result)
    record.resultLoaded = true
    if (old?.sourceSha256 === next.sourceSha256 && old.chords.segments.some((s) => s.edited))
      for (const edit of old.chords.segments.filter((s) => s.edited)) {
        next.chords.segments = next.chords.segments.flatMap((s) =>
          s.end <= edit.start || s.start >= edit.end
            ? [s]
            : [
                ...(s.start < edit.start ? [{ ...s, end: edit.start }] : []),
                ...(s.end > edit.end ? [{ ...s, start: edit.end }] : [])
              ]
        )
        next.chords.segments.push(edit)
        next.chords.segments.sort((a, b) => a.start - b.start)
      }
    if (
      next.melody &&
      next.cache?.signatures.notes &&
      record.lyrics &&
      next.melody.lyricsKey !== (await lyricDigest(record.lyrics))
    ) {
      next.ready = next.ready.filter((s) => s !== 'melody')
      delete next.cache?.signatures.notes
      delete next.cache?.signatures.score
    }
    const chordBecameReady = !studyReady(old, 'chords') && studyReady(next, 'chords')
    record.result = next

    // A six-track result can still carry stale notes from an earlier model.
    // Admission must use the same provenance check as cache restoration.
    const checked = await this.ports.validate?.(record, record.source)
    record.notesReady =
      checked?.notesReady ??
      (next.melody?.algorithm === STUDY_MELODY_ALGORITHM && !!next.cache?.signatures.notes)
    record.workerRevision = status.resultRevision
    record.leadBacking = studyReady(next, 'leadBacking')
    record.twoSingers = studyReady(next, 'twoSingers')
    record.stages ??= {}
    for (const phase of STUDY_STAGES)
      if (studyReady(next, phase)) {
        record.stages[phase] = { status: 'completed', progress: 1, ...next.timings?.[phase] }
      }
    if (chordBecameReady && !record.prefetch && !record.chordsVisibleManual)
      record.chordsVisible = true

    return true
  }
  private async tick() {
    const resultScope = this.results.scope()
    try {
      if (!this.running) {
        let next: { id: string; operation: StudyOperation } | undefined
        while ((next = this.queue.shift())) {
          if (this.records.get(next.id)?.pending?.includes(next.operation)) break
        }
        if (!next) return
        const record = this.get(next.id)
        await this.hydrate(record, resultScope)
        this.running = record.id
        record.status = 'running'
        record.operation = next.operation
        record.pending?.splice(record.pending.indexOf(next.operation), 1)
        record.workerRevision = -1
        record.stage = '检查分析环境'
        record.error = undefined
        await this.save(record)
        const controller = new AbortController()
        this.launch = controller
        let abort!: () => void
        try {
          await Promise.race([
            this.environmentCheck,
            new Promise<void>((_, reject) => {
              abort = () => reject(new Error('任务已取消'))
              controller.signal.addEventListener('abort', abort, { once: true })
            })
          ])
          controller.signal.throwIfAborted()
          if (record.status !== 'running') return
          if (!this.environment.ready) throw new Error(this.environment.error || '请先配置分析环境')
          if (record.operation === 'twoSingers' && !this.environment.gpu)
            throw new Error('双歌手分离需要 CUDA GPU')
          record.stage = '准备本地音频'
          this.jobLeases.set(record.id, await this.audioCache.acquire(record.id))
          const notesOnly = record.operation === 'melody' && record.notesReady
          const duration = record.source.duration || record.result?.duration || 180
          const tracks = ['leadBacking', 'twoSingers'].includes(record.operation ?? '') ? 9 : 7
          const estimate = notesOnly
            ? 0
            : Math.ceil(duration * 44100 * 8 * tracks * 1.02) +
              (record.operation === 'melody' ? 32 * 1024 ** 2 : 0)
          record.budgetBytes = await this.audioCache.reserve(record.id, estimate, controller.signal)
          this.audioCache.touch(record.id)
          record.workerRunId = crypto.randomUUID()
          record.workerRevision = undefined
          await this.ports.start(record, controller.signal)
        } finally {
          controller.signal.removeEventListener('abort', abort)
          if (this.launch === controller) this.launch = null
        }
        if (record.status !== 'running') return
      }
      if (!this.running) return
      const record = this.get(this.running!),
        status = await this.ports.worker(record.id, record.workerRevision, record.workerRunId)
      if (status.recovering) {
        if (record.status !== 'recovering') {
          record.status = 'recovering'
          record.stage = '等待分析进程退出'
          record.error = status.error
          await this.save(record)
        }
        return
      }
      if (record.status === 'recovering') record.status = 'running'
      if (record.status !== 'running') {
        this.running = null
        return
      }
      if (
        status.running &&
        record.progress === status.progress &&
        record.stage === status.stage &&
        (!status.result || record.workerRevision === status.resultRevision)
      )
        return
      const artifactsChanged = await this.acceptResult(record, status)
      record.stages ??= {}
      if (
        status.phase &&
        (!studyReady(record.result, status.phase) ||
          record.stages[status.phase]?.status !== 'completed')
      )
        record.stages[status.phase] = {
          status: status.running ? 'running' : 'failed',
          progress: status.progress,
          error: status.error
        }
      record.progress = status.progress
      record.stage = status.stage
      if (!status.running) {
        if (status.error || !record.result) {
          record.status = status.interrupted ? 'interrupted' : 'failed'
          record.error = status.error ?? '未生成完整分析结果'
          record.stage = status.interrupted ? '分析中断，可重试' : '分析失败'
          if (status.interrupted) record.pending = []
        } else {
          record.status = 'completed'
          record.progress = 1
          record.stage = '分析完成'
        }
        if (record.pending?.length) {
          record.status = 'queued'
          record.stage = '等待处理'
        }
      }
      try {
        await this.save(record, artifactsChanged)
      } catch (error) {
        // The producer keeps the exact payload until durable commit and ACK succeed.
        record.status = 'running'
        record.stage = '等待保存分析结果'
        record.error = String(error)
        record.workerRevision = -1
        this.changed()
        return
      }
      try {
        await this.ports.acknowledge?.(record.id, status)
      } catch (error) {
        record.status = 'running'
        record.stage = '等待确认分析结果'
        record.error = String(error)
        this.changed()
        return
      }
      if (!status.running) {
        this.running = null
        this.releaseJob(record.id)
        await this.audioCache.trim()
        this.prefetchSchedule()
      }
    } finally {
      resultScope.dispose()
    }
  }
  cancel(id: string): Promise<void> {
    const pending = this.cancellations.get(id)
    if (pending) return pending
    const work = this.cancelRecord(id).finally(() => {
      this.cancellations.delete(id)
      this.kick()
    })
    this.cancellations.set(id, work)
    return work
  }
  private async cancelRecord(id: string) {
    await this.init()
    const record = this.get(id)
    if (!['running', 'queued', 'cancelling', 'recovering'].includes(record.status)) return
    record.status = 'cancelling'
    record.pending = []
    this.queue = this.queue.filter((job) => job.id !== id)
    for (const phase of Object.values(record.stages ?? {}))
      if (phase.status === 'running' || phase.status === 'queued') phase.status = 'cancelled'
    record.stage = '已取消，结果缓存可继续使用'
    if (this.running === id) this.launch?.abort()
    // Join an in-flight launch before cancellation so it cannot leave an orphan worker.
    await this.ticking
    try {
      await this.ports.cancel(id)
    } catch (error) {
      this.running = id
      record.status = 'recovering'
      record.stage = '等待分析进程退出'
      record.error = String(error)
      await this.save(record)
      throw error
    }
    const receipt =
      this.running === id
        ? { ...(await this.ports.worker(id, -1, record.workerRunId)), running: false }
        : { running: false, progress: record.progress, stage: '已取消' }
    const artifactsChanged = await this.acceptResult(record, receipt)
    try {
      record.status = 'cancelled'
      await this.save(record, artifactsChanged)
      await this.ports.acknowledge?.(id, receipt)
    } catch (error) {
      this.running = id
      record.status = 'recovering'
      record.stage = '等待保存分析结果'
      record.error = String(error)
      throw error
    }
    if (this.running === id) this.running = null
    this.releaseJob(id)
    this.kick()
  }
  async retry(id: string) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(id)
      if (['running', 'queued', 'cancelling', 'recovering'].includes(record.status)) return
      await this.hydrate(record, resultScope)
      const failed = STUDY_STAGES.filter(
        (stage) =>
          ['failed', 'interrupted'].includes(record.stages?.[stage]?.status ?? '') &&
          !studyReady(record.result, stage)
      )
      if (failed.length) {
        for (const stage of failed) {
          if (stage === 'melody') {
            const lyrics =
              (await this.ports.lyrics?.(record.source.identity, record.source.input)) ||
              record.lyrics
            if (!lyrics) throw new Error('请先加载带时间的原文歌词，再生成简谱')
            record.lyrics = lyrics
          }
          await this.enqueue(record, stage)
        }
        return
      }
      if (
        operationStages(record.operation ?? 'analyze').every((stage) =>
          studyReady(record.result, stage)
        )
      ) {
        record.status = 'completed'
        record.progress = 1
        record.stage = '分析完成'
        record.error = undefined
        await this.save(record)
        return
      }
      await this.enqueue(record, record.operation ?? 'analyze')
    } finally {
      resultScope.dispose()
    }
  }
  async analyzeChords(id: string, stems: StudyTrack[]) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(id)
      await this.hydrate(record, resultScope)
      if (!studyReady(record.result, 'six')) throw new Error('请等待六轨分离完成')
      if (stems.some((stem) => stem !== 'original' && !record.result!.stems.includes(stem)))
        throw new Error('分析轨道不存在')
      record.harmonicStems = [...stems]
      const stage = stems.length === 1 && stems[0] === 'original' ? 'originalChords' : 'chords'
      delete record.result?.cache?.signatures[stage]
      if (record.result)
        record.result.ready = record.result.ready.filter((value) => value !== stage)
      await this.enqueue(
        record,
        stems.length === 1 && stems[0] === 'original' ? 'originalChords' : 'chords'
      )
    } finally {
      resultScope.dispose()
    }
  }
  async remove(id: string) {
    if (this.exportIds.has(id)) throw new Error('歌曲正在导出')
    await this.cancel(id)
    const record = this.get(id)
    if (this.active === id) await this.transport({ id, action: 'exit' })
    await this.ports.removeFiles(id)
    await this.ports.repository.remove(id)
    this.records.delete(id)
    if (record.source.identity === this.lyricSong) {
      this.notationVisible = false
      this.requestedChords = undefined
    }
    this.changed()
  }
  async edit(request: StudyEdit) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(request.id)
      await this.hydrate(record, resultScope)
      const segments = record.result?.chords.segments
      if (record.revision !== request.revision) throw new Error('和弦结果已更新，请刷新后重试')
      if (!segments?.[request.index] || request.end > (record.result?.duration ?? 0))
        throw new Error('和弦片段无效')
      const previous = segments[request.index - 1],
        next = segments[request.index + 1]
      if ((previous && request.start <= previous.start) || (next && request.end >= next.end))
        throw new Error('边界不能越过相邻和弦')
      // Move shared boundaries together, preserving a contiguous timeline.
      if (previous) previous.end = request.start
      if (next) next.start = request.end
      segments[request.index] = {
        ...segments[request.index],
        start: request.start,
        end: request.end,
        label: request.label,
        edited: true
      }
      await this.save(record, true)
      return this.view(record)
    } finally {
      resultScope.dispose()
    }
  }
  setMix(mix: StudyMix): Promise<void> {
    const work = this.mixWork.then(() => this.applyMix(mix))
    this.mixWork = work.catch(() => {})
    return work
  }
  private async applyMix(mix: StudyMix) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(mix.id)
      await this.hydrate(record, resultScope)
      const release = await this.audioCache.acquire(record.id)
      let retained = false
      try {
        if (record.result && this.ports.validate) {
          const validated = await this.ports.validate(record, record.source, true)
          record.result.ready = validated.ready
        }
        const stages: StudyStage[] = ['six']
        if (mix.mode === 'leadBacking' || mix.mode === 'twoSingers') stages.push(mix.mode)
        record.prefetch = false
        for (const stage of stages)
          if (!studyReady(record.result, stage)) await this.enqueue(record, stage)
        if (stages.some((stage) => !studyReady(record.result, stage)))
          await this.waitFor(record, stages)
        if (!record.result) throw new Error('请等待六轨分离完成')
        const gains = Object.fromEntries(
          ['original', ...record.result.stems].map((stem) => [stem, 0])
        ) as Partial<Record<StudyTrack, number>>
        Object.assign(gains, studyMixGains(mix, record.result.stems))
        const files = record.result.stems.join(',')
        const active = this.active === mix.id && (await this.ports.audition.state())
        if (active && files === this.mixFiles && this.ports.audition.update)
          await this.ports.audition.update(gains)
        else {
          const source = await this.ports.writeMix(record.id, gains, record.result.frames)
          if (active) await this.ports.audition.replace(source)
          else
            await this.ports.audition.begin(source, {
              songId: record.source.identity,
              occurrenceId: mix.occurrenceId
            })
          this.activeRelease?.()
          this.activeRelease = release
          retained = true
        }
        this.active = mix.id
        this.mixFiles = files
        this.audioCache.touch(record.id, [
          'six',
          ...(record.leadBacking ? ['leadBacking' as const] : []),
          ...(record.twoSingers ? ['twoSingers' as const] : [])
        ])
        record.mix = { ...structuredClone(mix), occurrenceId: undefined }
        await this.save(record)
      } finally {
        if (!retained) release()
      }
    } finally {
      resultScope.dispose()
    }
  }
  async transport(command: StudyTransport) {
    await this.init()
    if (command.action === 'exit') {
      this.analysisEnabled = false
      this.prefetchSchedule()
    }
    if (command.action === 'play' && this.active !== command.id)
      await this.setMix({ id: command.id, mode: 'instruments', tracks: {} })
    if (this.active !== command.id) return
    const result = this.get(command.id).result
    if (
      (command.position ?? 0) > (result?.duration ?? 0) ||
      (command.end ?? 0) > (result?.duration ?? 0)
    )
      throw new Error('试听位置超出音频范围')
    await this.ports.audition.control(command)
    if (command.action === 'exit') {
      this.active = null
      this.results.trim()
      this.activeRelease?.()
      this.activeRelease = null
      this.analysisEnabled = false
      this.prefetchSchedule()
    }
    this.ports.changed()
  }
  async export(request: StudyExport) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(request.id)
      await this.hydrate(record, resultScope)
      const release = await this.audioCache.acquire(record.id)
      this.exportIds.set(record.id, (this.exportIds.get(record.id) ?? 0) + 1)
      try {
        if (request.stems.length && record.result && this.ports.validate) {
          record.result.ready = (await this.ports.validate(record, record.source, true)).ready
        }
        const stages = new Set<StudyStage>()
        if (
          request.stems.some((s) =>
            ['original', 'vocals', 'drums', 'bass', 'guitar', 'piano', 'other'].includes(s)
          )
        )
          stages.add('six')
        if (request.stems.some((s) => ['lead', 'backing'].includes(s))) stages.add('leadBacking')
        if (request.stems.some((s) => ['singerA', 'singerB'].includes(s))) stages.add('twoSingers')
        record.prefetch = false
        for (const stage of stages)
          if (!studyReady(record.result, stage)) await this.enqueue(record, stage)
        if ([...stages].some((stage) => !studyReady(record.result, stage)))
          await this.waitFor(record, [...stages])
        if (!record.result) throw new Error('请等待识别结果生成')
        if (
          request.stems.some(
            (s) =>
              s !== 'original' &&
              !record.result!.stems.includes(s as import('../../shared/musicStudy.ts').StudyStem)
          )
        )
          throw new Error('导出轨道尚未就绪')
        if (request.stems.length)
          this.audioCache.touch(
            record.id,
            [...stages].filter((s): s is StudyAudioGroup['kind'] =>
              ['six', 'leadBacking', 'twoSingers'].includes(s)
            )
          )
        return await this.ports.export(record, request)
      } finally {
        release()
        const count = (this.exportIds.get(record.id) ?? 1) - 1
        if (count) this.exportIds.set(record.id, count)
        else this.exportIds.delete(record.id)
      }
    } finally {
      resultScope.dispose()
    }
  }
  private waitFor(record: StudyRecord, stages: StudyStage[]) {
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        this.waiters.delete(check)
        error ? reject(error) : resolve()
      }
      const check = () => {
        if (this.stopped || ['failed', 'cancelled', 'interrupted'].includes(record.status))
          finish(new Error(record.error || '分析任务已中断'))
        else if (stages.every((stage) => studyReady(record.result, stage))) finish()
      }
      const timer = setTimeout(() => finish(new Error('等待音频生成超时')), 10 * 60 * 1000)
      timer.unref?.()
      this.waiters.add(check)
      check()
    })
  }
  async exportSources(id: string, outputDirectory: string) {
    const resultScope = this.results.scope()
    try {
      await this.init()
      const record = this.get(id)
      await this.hydrate(record, resultScope)
      if (
        !studyReady(record.result, 'melody') ||
        !record.result?.melody ||
        !record.lyrics ||
        !this.ports.exportSources
      )
        throw new Error('曲谱原始数据不可用')
      return this.ports.exportSources(record, outputDirectory)
    } finally {
      resultScope.dispose()
    }
  }
  async choosePack() {
    await this.init()
    if (this.active) throw new Error('请先结束分轨试听')
    await this.environmentCheck
    await this.ports.choosePack()
    this.environment = await this.ports.environment()
    this.ports.changed()
  }
  async shutdown() {
    this.stopped = true
    this.changed()
    this.prefetchTimer?.()
    this.prefetchTimer = null
    this.automaticTimer?.()
    this.automaticTimer = null
    this.cancelTick?.()
    this.launch?.abort()
    await this.ticking
    if (this.running) {
      const id = this.running
      await this.cancelRecord(id)
      const record = this.get(id)
      record.status = 'interrupted'
      record.stage = '上次任务中断，可继续'
      await this.save(record)
    }
    if (this.active) await this.ports.audition.control({ id: this.active, action: 'exit' })
    this.activeRelease?.()
    this.activeRelease = null
    await this.prefetchWork
    await this.automaticWork
    this.ports.repository.close?.()
    this.results.clear()
  }
}
