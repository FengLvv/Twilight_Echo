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
  StudySubmit
} from '../../shared/musicStudy.ts'
import { studyMixGains, studyReady, STUDY_STAGES } from '../../shared/musicStudy.ts'
import type { CoreQueueTrackInput } from '../../shared/coreQueueSubmission.ts'
import { studyLyricsFromText } from './studyLyrics.ts'

const operationStages = (operation: StudyOperation): StudyStage[] =>
  operation === 'analyze'
    ? ['six', 'chords']
    : operation === 'melody'
      ? ['six', 'melody']
      : [operation]

export interface StudyRecord extends StudyProject {
  source: {
    path: string
    start?: number
    end?: number
    duration?: number
    virtualPregapSeconds?: number
    identity: string
    input?: CoreQueueTrackInput
  }
  harmonicStems?: StudyTrack[]
  pending?: StudyOperation[]
  workerRevision?: number
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
}
export interface StudyRepository {
  loadPreferences?(): Promise<{
    mode: 'names' | 'degrees'
    notationMode?: 'numbered' | 'staff'
  } | null>
  savePreferences?(value: {
    mode: 'names' | 'degrees'
    notationMode?: 'numbered' | 'staff'
  }): Promise<void>
  list(): Promise<StudyRecord[]>
  save(record: StudyRecord): Promise<void>
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
  choosePack(): Promise<void>
  lyrics?(songId: string, input?: CoreQueueTrackInput): string | Promise<string>
  validate?(
    record: StudyRecord,
    source: StudyRecord['source']
  ): Promise<{ ready: StudyStage[]; sourceChanged?: boolean }>
  start(record: StudyRecord, signal?: AbortSignal): Promise<void>
  worker(id: string): Promise<StudyWorkerStatus>
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
  private initialized: Promise<void> | null = null
  private running: string | null = null
  private stopped = false
  private ticking: Promise<void> | null = null
  private cancelTick: (() => void) | null = null
  private environment: StudyState['environment'] = { ready: false, gpu: false, gpuName: '' }
  private environmentCheck: Promise<void> | null = null
  private active: string | null = null
  private mixFiles = ''
  private creation: Promise<unknown> = Promise.resolve()
  private queue: Array<{ id: string; operation: StudyOperation }> = []
  private launch: AbortController | null = null
  private readonly ports: StudyPorts
  constructor(ports: StudyPorts) {
    this.ports = ports
  }
  getRevision() {
    return this.revision
  }
  private changed() {
    this.revision++
    this.ports.changed()
  }
  bindLyrics(songId: string, occurrenceId: string | null) {
    const binding = JSON.stringify([songId, occurrenceId])
    if (this.lyricBinding === binding) return
    this.lyricBinding = binding
    this.lyricSong = songId
    this.notationVisible = false
    this.requestedChords = undefined
    this.pendingKey = 'auto'
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
    await this.init()
    if (patch.songId !== this.lyricSong) throw new Error('当前歌曲已变化，请重试')
    const binding = this.lyricBinding
    const current = () => {
      if (binding !== this.lyricBinding) throw new Error('当前歌曲已变化，请重试')
    }
    if (patch.mode !== undefined || patch.notationMode !== undefined) {
      if (patch.mode !== undefined) this.chordMode = patch.mode
      if (patch.notationMode !== undefined) this.notationMode = patch.notationMode
      await this.ports.repository.savePreferences?.({
        mode: this.chordMode,
        notationMode: this.notationMode
      })
      current()
    }
    const record = this.songRecord(patch.songId)
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
    if (patch.notationVisible) await this.transcribeMelody(patch.songId)
    if (patch.chordsVisible && !studyReady(record?.result, 'chords'))
      await this.analyze(patch.songId)
    return this.displayFor(patch.songId)
  }
  async lyricsProjection(songId: string): Promise<StudyLyricsProjection> {
    await this.init()
    const record = this.songRecord(songId)
    const busy = (stage: StudyStage) =>
      ['queued', 'running'].includes(record?.stages?.[stage]?.status ?? '')
    return {
      display: this.displayFor(songId),
      chords: studyReady(record?.result, 'chords') ? record!.result!.chords.segments : [],
      melody: studyReady(record?.result, 'melody') ? record!.result!.melody : undefined,
      melodyBusy: busy('melody'),
      chordsBusy: busy('chords'),
      error: record?.error
    }
  }
  private init(): Promise<void> {
    return (this.initialized ??= (async () => {
      const preferences = await this.ports.repository.loadPreferences?.()
      this.chordMode = preferences?.mode ?? 'names'
      this.notationMode = preferences?.notationMode ?? 'numbered'
      for (const record of await this.ports.repository.list()) {
        if (record.status === 'running' || record.status === 'queued') {
          record.status = 'interrupted'
          record.pending = []
          for (const phase of Object.values(record.stages ?? {}))
            if (phase.status === 'running' || phase.status === 'queued')
              phase.status = 'interrupted'
          record.stage = '上次任务中断，可继续'
          record.revision++
          await this.ports.repository.save(record)
        }
        this.records.set(record.id, record)
      }
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
  private async save(record: StudyRecord) {
    record.revision++
    await this.ports.repository.save(record)
    this.changed()
  }
  private get(id: string) {
    const record = this.records.get(id)
    if (!record) throw new Error('分析项目不存在')
    return record
  }
  private view(record: StudyRecord): StudyProject {
    const {
      source,
      pending: _pending,
      workerRevision: _worker,
      chordsVisibleManual: _manual,
      lyrics: _lyrics,
      tonalKey: _key,
      ...view
    } = record
    return structuredClone({
      ...view,
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
    if (!audition) this.active = null
    return {
      total: records.length,
      activeCount: records.filter((r) => r.status === 'running' || r.status === 'queued').length,
      projects: records
        .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50))
        .map((record) => {
          const { result, ...summary } = this.view(record)
          return { ...summary, ...(result ? { duration: result.duration } : {}) }
        }),
      environment: { ...this.environment },
      audition: audition && this.active ? { ...audition, id: this.active } : null
    }
  }
  async project(id: string) {
    await this.init()
    return this.view(this.get(id))
  }
  async song(songId: string): Promise<StudyProject | null> {
    await this.init()
    const record = [...this.records.values()]
      .filter((r) => r.source.identity === songId)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    return record ? this.view(record) : null
  }
  async analyze(songId: string) {
    return this.create({ current: true }, songId)
  }
  async transcribeMelody(songId: string) {
    return this.create({ current: true }, songId, 'melody')
  }
  async submit(input: StudySubmit) {
    const first: StudyOperation = input.stages.includes('melody') ? 'melody' : input.stages.includes('chords') ? 'analyze' : 'six'
    const selection = { ...(input.input ? { input: input.input } : { current: true }) }
    const project = await this.create(selection, undefined, first, input.lyrics)
    if (!project) throw new Error('没有可分析的音源')
    const record = this.get(project!.id)
    if (input.stages.includes('chords') && first !== 'analyze' && !studyReady(record.result, 'chords'))
      await this.enqueue(record, 'chords')
    for (const stage of input.stages)
      if (stage !== 'six' && stage !== 'chords' && stage !== 'melody' && !studyReady(record.result, stage))
        await this.enqueue(record, stage)
    return this.view(record)
  }
  async splitVocals(id: string, kind: 'leadBacking' | 'twoSingers') {
    await this.init()
    const record = this.get(id)
    if (!studyReady(record.result, 'six')) throw new Error('请等待六轨分离完成')
    if (kind === 'twoSingers' && this.environment.ready && !this.environment.gpu)
      throw new Error('双歌手分离需要 CUDA GPU')
    if (!studyReady(record.result, kind)) await this.enqueue(record, kind)
    return this.view(record)
  }
  async chordsVisible(id: string, visible: boolean) {
    await this.init()
    const record = this.get(id)
    if (record.source.identity === this.lyricSong) this.requestedChords = visible
    record.chordsVisible = visible
    record.chordsVisibleManual = true
    await this.save(record)
  }
  private async enqueue(record: StudyRecord, operation: StudyOperation) {
    if (
      (record.status === 'running' && record.operation === operation) ||
      record.pending?.includes(operation)
    )
      return
    record.pending ??= []
    record.pending.push(operation)
    this.queue.push({ id: record.id, operation })
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
    suppliedLyrics?: string
  ): Promise<StudyProject | null> {
    const work = this.creation.then(() => this.createRecord(input, expectedSong, operation, suppliedLyrics))
    this.creation = work.catch(() => {})
    return work
  }
  private async createRecord(
    input: StudyCreate,
    expectedSong: string | undefined,
    operation: StudyOperation,
    suppliedLyrics?: string
  ) {
    await this.init()
    const projectId = this.ports.newId()
    const source = await this.ports.source(input.input, input.current, projectId)
    if (!source) return null
    if (expectedSong && source.source.identity !== expectedSong)
      throw Object.assign(new Error('当前歌曲已变化'), { code: 'CANCELLED' })
    const lyrics = operation === 'melody' ? suppliedLyrics !== undefined
      ? studyLyricsFromText(suppliedLyrics, source.source.duration && source.source.duration > 0 ? source.source.duration : undefined)
      : await this.ports.lyrics?.(source.source.identity, input.input) : undefined
    if (operation === 'melody' && !lyrics) throw new Error('请先加载带时间的原文歌词，再生成简谱')
    if (input.current || input.input) {
      const existing = [...this.records.values()]
        .filter(
          (r) =>
            r.source.identity === source.source.identity &&
            r.source.start === source.source.start &&
            r.source.end === source.source.end &&
            r.source.virtualPregapSeconds === source.source.virtualPregapSeconds
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0]
      if (existing) {
        const checked =
          existing.status !== 'running' && existing.status !== 'queued' && existing.result
            ? await this.ports.validate?.(existing, source.source)
            : undefined
        if (!checked?.sourceChanged) {
          if (operation === 'melody' && existing.lyrics !== lyrics) {
            if (existing.status === 'running' && existing.operation === 'melody')
              throw new Error('歌词已变化，请等待当前简谱完成后重新生成')
            existing.lyrics = lyrics
            if (existing.result) {
              delete existing.result.melody
              existing.result.ready = existing.result.ready?.filter((s) => s !== 'melody')
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
          return this.view(existing)
        }
      }
    }
    const record: StudyRecord = {
      id: projectId,
      title: source.title,
      source: source.source,
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
      revision: 0
    }
    this.records.set(record.id, record)
    await this.enqueue(record, operation)
    return this.view(record)
  }
  private kick() {
    if (this.stopped || this.ticking) return
    this.cancelTick?.()
    this.cancelTick = null
    this.ticking = this.tick()
      .catch(async (error) => {
        if (this.running) {
          const record = this.get(this.running)
          if (record.status === 'running') {
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
            if (!this.stopped && record.pending?.length) {
              record.status = 'queued'
              record.stage = '等待处理'
            }
            await this.save(record)
          }
          this.running = null
        }
      })
      .finally(() => {
        this.ticking = null
        if (
          !this.stopped &&
          (this.running || [...this.records.values()].some((r) => r.status === 'queued'))
        )
          this.cancelTick = this.ports.schedule(() => this.kick(), 700)
      })
  }
  private async tick() {
    if (!this.running) {
      let next: { id: string; operation: StudyOperation } | undefined
      while ((next = this.queue.shift())) {
        if (this.records.get(next.id)?.pending?.includes(next.operation)) break
      }
      if (!next) return
      const record = this.get(next.id)
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
        await this.ports.start(record, controller.signal)
      } finally {
        controller.signal.removeEventListener('abort', abort)
        if (this.launch === controller) this.launch = null
      }
      if (record.status !== 'running') return
    }
    if (!this.running) return
    const record = this.get(this.running!),
      status = await this.ports.worker(record.id)
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
    if (status.result && (record.workerRevision !== status.resultRevision || !status.running)) {
      const old = record.result
      const next = structuredClone(status.result)
      if (
        old?.sourceSha256 === next.sourceSha256 &&
        old.chords.segments.some((s) => s.edited) &&
        !['chords'].includes(record.operation ?? '')
      )
        next.chords = old.chords
      const chordBecameReady = !studyReady(old, 'chords') && studyReady(next, 'chords')
      record.result = next
      record.workerRevision = status.resultRevision
      record.leadBacking = studyReady(next, 'leadBacking')
      record.twoSingers = studyReady(next, 'twoSingers')
      record.stages ??= {}
      for (const phase of STUDY_STAGES)
        if (studyReady(next, phase)) {
          record.stages[phase] = { status: 'completed', progress: 1, ...next.timings?.[phase] }
        }
      if (chordBecameReady && !record.chordsVisibleManual) record.chordsVisible = true
    }
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
      if (status.error || !status.result) {
        record.status = 'failed'
        record.error = status.error ?? '未生成完整分析结果'
        record.stage = '分析失败'
      } else {
        record.status = 'completed'
        record.progress = 1
        record.stage = '分析完成'
      }
      this.running = null
      if (record.pending?.length) {
        record.status = 'queued'
        record.stage = '等待处理'
      }
    }
    await this.save(record)
  }
  async cancel(id: string) {
    await this.init()
    const record = this.get(id)
    if (!['running', 'queued'].includes(record.status)) return
    record.status = 'cancelled'
    record.pending = []
    this.queue = this.queue.filter((job) => job.id !== id)
    for (const phase of Object.values(record.stages ?? {}))
      if (phase.status === 'running' || phase.status === 'queued') phase.status = 'cancelled'
    record.stage = '已取消，结果缓存可继续使用'
    if (this.running === id) this.launch?.abort()
    // Join an in-flight launch before cancellation so it cannot leave an orphan worker.
    await this.ticking
    await this.ports.cancel(id)
    await this.save(record)
    if (this.running === id) this.running = null
    this.kick()
  }
  async retry(id: string) {
    await this.init()
    const record = this.get(id)
    if (record.status === 'running' || record.status === 'queued') return
    await this.enqueue(record, record.operation ?? 'analyze')
  }
  async analyzeChords(id: string, stems: StudyTrack[]) {
    await this.init()
    const record = this.get(id)
    if (!studyReady(record.result, 'six')) throw new Error('请等待六轨分离完成')
    if (stems.some((stem) => stem !== 'original' && !record.result!.stems.includes(stem)))
      throw new Error('分析轨道不存在')
    record.harmonicStems = [...stems]
    await this.enqueue(
      record,
      stems.length === 1 && stems[0] === 'original' ? 'originalChords' : 'chords'
    )
  }
  async remove(id: string) {
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
    await this.init()
    const record = this.get(request.id),
      segments = record.result?.chords.segments
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
    await this.save(record)
    return this.view(record)
  }
  async setMix(mix: StudyMix) {
    await this.init()
    const record = this.get(mix.id)
    if (!record.result || !studyReady(record.result, 'six')) throw new Error('请等待六轨分离完成')
    if (
      (mix.mode === 'twoSingers' && !record.twoSingers) ||
      (mix.mode === 'leadBacking' && !record.leadBacking)
    )
      throw new Error('该人声结果未生成')
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
    }
    this.active = mix.id
    this.mixFiles = files
    record.mix = { ...structuredClone(mix), occurrenceId: undefined }
    await this.save(record)
  }
  async transport(command: StudyTransport) {
    await this.init()
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
    if (command.action === 'exit') this.active = null
    this.ports.changed()
  }
  async export(request: StudyExport) {
    await this.init()
    const record = this.get(request.id)
    if (!record.result || !studyReady(record.result, 'six')) throw new Error('请等待分析完成')
    if (
      request.stems.some(
        (s) =>
          s !== 'original' &&
          !record.result!.stems.includes(s as import('../../shared/musicStudy.ts').StudyStem)
      )
    )
      throw new Error('导出轨道尚未就绪')
    return this.ports.export(record, request)
  }
  async choosePack() {
    await this.init()
    await this.environmentCheck
    await this.ports.choosePack()
    this.environment = await this.ports.environment()
    this.ports.changed()
  }
  async shutdown() {
    this.stopped = true
    this.cancelTick?.()
    this.launch?.abort()
    await this.ticking
    if (this.running) {
      await this.ports.cancel(this.running)
      const record = this.get(this.running)
      record.status = 'interrupted'
      record.stage = '上次任务中断，可继续'
      await this.save(record)
    }
    if (this.active) await this.ports.audition.control({ id: this.active, action: 'exit' })
  }
}
