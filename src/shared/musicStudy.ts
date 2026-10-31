import type { CoreQueueTrackInput } from './coreQueueSubmission.ts'

export const STUDY_STEMS = [
  'drums',
  'bass',
  'other',
  'vocals',
  'guitar',
  'piano',
  'lead',
  'backing',
  'singerA',
  'singerB'
] as const
export type StudyStem = (typeof STUDY_STEMS)[number]
export type StudyTrack = StudyStem | 'original'
export const STUDY_OPERATIONS = [
  'six',
  'analyze',
  'leadBacking',
  'twoSingers',
  'chords',
  'originalChords',
  'melody'
] as const
export type StudyOperation = (typeof STUDY_OPERATIONS)[number]
export const STUDY_STAGES = [
  'six',
  'chords',
  'leadBacking',
  'twoSingers',
  'originalChords',
  'melody'
] as const
export type StudyStage = (typeof STUDY_STAGES)[number]
export interface StudyLyricDisplay {
  notationMode?: 'numbered' | 'staff'
  notationVisible: boolean
  chordsVisible: boolean
  mode: 'names' | 'degrees'
  key: string
}
export interface StudyLyricDisplayPatch {
  notationMode?: 'numbered' | 'staff'
  songId: string
  notationVisible?: boolean
  chordsVisible?: boolean
  mode?: 'names' | 'degrees'
  key?: string
}
export interface StudyLyricsProjection {
  display: StudyLyricDisplay
  chords: StudyChord[]
  melody?: StudyResult['melody']
  melodyBusy: boolean
  chordsBusy: boolean
  error?: string
}
export interface StudyStageState {
  status: StudyStatus | 'idle'
  progress: number
  elapsedMs?: number
  cacheHit?: boolean
  error?: string
}
export type StudyStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
export interface StudyChord {
  start: number
  end: number
  label: string
  confidence: 'high' | 'medium' | 'low' | 'unrated'
  candidates: string[]
  edited?: boolean
}
export interface StudyResult {
  version: 1
  duration: number
  sampleRate: number
  frames: number
  stems: StudyStem[]
  harmonicStems: StudyTrack[]
  chords: { segments: StudyChord[]; tuningCents: number | null; algorithm: string }
  originalChords: { segments: StudyChord[] }
  melody?: {
    notes: Array<{
      start: number
      end: number
      midi: number
      lineId?: number
      wordId?: number
      lyric?: string
      beat?: number
      durationBeats?: number
    }>
    key: { tonic: number; mode: 'major' | 'minor' } | null
    algorithm: string
    source: 'vocals'
    tempo?: number
    lyricsKey?: string
    scores: Array<{ lineId: number; text: string; svg: string }>
  }
  waveforms: Partial<Record<StudyTrack, number[]>>
  sourceSha256: string
  modelFingerprints?: Record<string, string>
  ready: StudyStage[]
  timings?: Partial<Record<StudyStage, { elapsedMs: number; cacheHit: boolean }>>
  singerIdentityUncertain?: Array<{ start: number; end: number }>
  models: {
    instruments: string
    voices: string
    singers: string
    singersSampleRate: number
    singersChannels: number
  }
}
export interface StudyProjectSummary {
  lyricDisplay?: StudyLyricDisplay
  id: string
  title: string
  status: StudyStatus
  stage: string
  progress: number
  createdAt: number
  error?: string
  duration?: number
  leadBacking: boolean
  twoSingers: boolean
  revision: number
  songId?: string
  stages?: Partial<Record<StudyStage, StudyStageState>>
  sixReady?: boolean
  chordsReady?: boolean
  mix?: StudyMix
  chordsVisible?: boolean
  operation?: StudyOperation
}
export interface StudyProject extends StudyProjectSummary {
  result?: StudyResult
}
export interface StudyMix {
  id: string
  mode: 'instruments' | 'leadBacking' | 'twoSingers' | 'original'
  tracks: Partial<Record<StudyTrack, { gain: number; mute: boolean; solo: boolean }>>
  occurrenceId?: string
}
export interface StudyTransport {
  id: string
  action: 'play' | 'pause' | 'seek' | 'loop' | 'clearLoop' | 'exit'
  position?: number
  end?: number
}
export interface StudyAudition {
  id: string
  position: number
  duration: number
  playing: boolean
  volume?: number
  loop: { start: number; end: number } | null
}
export interface StudyState {
  projects: StudyProjectSummary[]
  total: number
  environment: { ready: boolean; gpu: boolean; gpuName: string; error?: string }
  audition: StudyAudition | null
  activeCount?: number
}
export interface StudyCreate {
  input?: CoreQueueTrackInput
  current?: boolean
  leadBacking?: boolean
  twoSingers?: boolean
}
export interface StudySubmit {
  input?: CoreQueueTrackInput
  current?: boolean
  stages: StudyStage[]
  lyrics?: string
}
export interface StudyEdit {
  id: string
  revision: number
  index: number
  label: string
  start: number
  end: number
}
export interface StudyExport {
  id: string
  outputDirectory?: string
  audioFormat: 'wav' | 'flac'
  chordFormat: 'txt' | 'csv' | 'json'
  stems: StudyTrack[]
}
export interface StudyCommands {
  'study.submit': StudySubmit
  'study.setLyricsDisplay': StudyLyricDisplayPatch
  'study.analyze': { songId: string }
  'study.transcribeMelody': { songId: string }
  'study.splitVocals': { id: string; kind: 'leadBacking' | 'twoSingers' }
  'study.chordsVisible': { id: string; visible: boolean }
  'study.create': StudyCreate
  'study.cancel': { id: string }
  'study.retry': { id: string }
  'study.delete': { id: string }
  'study.edit': StudyEdit
  'study.mix': StudyMix
  'study.transport': StudyTransport
  'study.export': StudyExport
  'study.choosePack': Record<string, never>
  'study.analyzeChords': { id: string; stems: StudyTrack[] }
}
export interface StudyQueries {
  'study.lyricsDisplay': { input: { songId: string }; output: StudyLyricDisplay }
  'study.song': { input: { songId: string }; output: StudyProject | null }
  'study.state': { input: { offset?: number; limit?: number }; output: StudyState }
  'study.project': { input: { id: string }; output: StudyProject }
}
export interface StudyPlatformOperations {
  'study.environment': { input: Record<string, never>; output: StudyState['environment'] }
  'study.choosePack': { input: Record<string, never>; output: void }
  'study.chooseSource': {
    input: { id: string }
    output: { path: string; title: string } | null
  }
  'study.startWorker': {
    input: {
      id: string
      source: string
      start?: number
      end?: number
      expectedDuration?: number
      virtualPregapSeconds?: number
      leadBacking: boolean
      twoSingers: boolean
      harmonicStems?: StudyTrack[]
      operation?: StudyOperation
      lyrics?: string
    }
    output: void
  }
  'study.hasSource': { input: { id: string }; output: boolean }
  'study.validateCache': {
    input: { id: string; source?: string }
    output: { ready: StudyStage[]; sourceChanged?: boolean }
  }
  'study.captureLocal': { input: { id: string; path: string }; output: string }
  'study.workerStatus': {
    input: { id: string }
    output: {
      running: boolean
      progress: number
      stage: string
      error?: string
      result?: StudyResult
      phase?: StudyStage
      resultRevision?: number
    }
  }
  'study.cancelWorker': { input: { id: string }; output: void }
  'study.removeFiles': { input: { id: string }; output: void }
  'study.writeMix': {
    input: { id: string; gains: Partial<Record<StudyTrack, number>>; frames: number }
    output: string
  }
  'study.exportFiles': {
    input: StudyExport & { chords: StudyResult['chords'] }
    output: string | null
  }
}
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)
const id = (x: unknown) => typeof x === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(x)
const number = (x: unknown, low: number, high: number) =>
  typeof x === 'number' && Number.isFinite(x) && x >= low && x <= high
const keys = (p: Record<string, unknown>, allowed: string[]) =>
  Object.keys(p).every((k) => allowed.includes(k))
export const validStudyTrack = (x: unknown): x is StudyTrack =>
  x === 'original' || STUDY_STEMS.includes(x as StudyStem)
export function studyReady(result: StudyResult | undefined, stage: StudyStage): boolean {
  return !!result?.ready.includes(stage) &&
    (stage !== 'melody' || result.melody?.algorithm === 'vocal2midi-tifa-game-medium-rhythm-v1')
}
export function validStudyPayload(name: string, p: unknown): boolean {
  if (!object(p)) return false
  switch (name) {
    case 'study.submit':
      return keys(p, ['input', 'current', 'stages', 'lyrics']) &&
        (p.input === undefined || object(p.input)) &&
        (p.current === undefined || typeof p.current === 'boolean') &&
        !!(p.input || p.current) && !(p.input && p.current) &&
        Array.isArray(p.stages) && p.stages.length > 0 && p.stages.length <= STUDY_STAGES.length &&
        p.stages.every(stage => STUDY_STAGES.includes(stage as StudyStage)) && new Set(p.stages).size === p.stages.length &&
        (p.lyrics === undefined || typeof p.lyrics === 'string' && p.lyrics.length <= 2 * 1024 * 1024)
    case 'study.lyricsDisplay':
      return (
        keys(p, ['songId']) &&
        typeof p.songId === 'string' &&
        p.songId.length > 0 &&
        p.songId.length <= 512
      )
    case 'study.setLyricsDisplay':
      return (
        keys(p, ['songId', 'notationVisible', 'chordsVisible', 'mode', 'key', 'notationMode']) &&
        typeof p.songId === 'string' &&
        p.songId.length > 0 &&
        p.songId.length <= 512 &&
        ['notationVisible', 'chordsVisible'].every(
          (k) => p[k] === undefined || typeof p[k] === 'boolean'
        ) &&
        (p.mode === undefined || p.mode === 'names' || p.mode === 'degrees') &&
        (p.notationMode === undefined ||
          p.notationMode === 'numbered' ||
          p.notationMode === 'staff') &&
        (p.key === undefined ||
          (typeof p.key === 'string' && /^(auto|(?:[0-9]|1[01]):(?:major|minor))$/.test(p.key)))
      )
    case 'study.analyze':
    case 'study.transcribeMelody':
    case 'study.song':
      return (
        keys(p, ['songId']) &&
        typeof p.songId === 'string' &&
        p.songId.length > 0 &&
        p.songId.length <= 512
      )
    case 'study.splitVocals':
      return (
        keys(p, ['id', 'kind']) &&
        id(p.id) &&
        ['leadBacking', 'twoSingers'].includes(String(p.kind))
      )
    case 'study.chordsVisible':
      return keys(p, ['id', 'visible']) && id(p.id) && typeof p.visible === 'boolean'
    case 'study.create':
      return (
        keys(p, ['input', 'current', 'leadBacking', 'twoSingers']) &&
        (p.input === undefined || object(p.input)) &&
        (p.current === undefined || typeof p.current === 'boolean') &&
        !(p.input && p.current) &&
        ['leadBacking', 'twoSingers'].every((k) => p[k] === undefined || typeof p[k] === 'boolean')
      )
    case 'study.state':
      return (
        keys(p, ['offset', 'limit']) &&
        (p.offset === undefined || (number(p.offset, 0, 100000) && Number.isInteger(p.offset))) &&
        (p.limit === undefined || (number(p.limit, 1, 100) && Number.isInteger(p.limit)))
      )
    case 'study.project':
    case 'study.cancel':
    case 'study.retry':
    case 'study.delete':
      return keys(p, ['id']) && id(p.id)
    case 'study.choosePack':
      return !Object.keys(p).length
    case 'study.analyzeChords':
      return (
        keys(p, ['id', 'stems']) &&
        id(p.id) &&
        Array.isArray(p.stems) &&
        p.stems.length > 0 &&
        p.stems.length <= 11 &&
        p.stems.every(validStudyTrack) &&
        new Set(p.stems).size === p.stems.length
      )
    case 'study.edit':
      return (
        keys(p, ['id', 'revision', 'index', 'label', 'start', 'end']) &&
        id(p.id) &&
        number(p.revision, 0, 1e10) &&
        Number.isInteger(p.revision) &&
        number(p.index, 0, 100000) &&
        Number.isInteger(p.index) &&
        typeof p.label === 'string' &&
        /^(?:N|\?|[A-G](?:#|b)?(?:m|dim|aug|sus2|sus4|7|maj7|m7|dim7|m7b5|mMaj7|7sus4|6|m6)?(?:\/[A-G](?:#|b)?)?)$/.test(
          p.label
        ) &&
        number(p.start, 0, 14400) &&
        number(p.end, 0, 14400) &&
        Number(p.end) > Number(p.start)
      )
    case 'study.transport':
      return (
        keys(p, ['id', 'action', 'position', 'end']) &&
        id(p.id) &&
        ['play', 'pause', 'seek', 'loop', 'clearLoop', 'exit'].includes(String(p.action)) &&
        (p.position === undefined || number(p.position, 0, 14400)) &&
        (p.end === undefined || number(p.end, 0, 14400)) &&
        (p.action !== 'seek' || p.position !== undefined) &&
        (p.action !== 'loop' ||
          (p.position !== undefined && p.end !== undefined && Number(p.end) > Number(p.position)))
      )
    case 'study.mix':
      return (
        keys(p, ['id', 'mode', 'tracks', 'occurrenceId']) &&
        (p.occurrenceId === undefined ||
          (typeof p.occurrenceId === 'string' && p.occurrenceId.length <= 512)) &&
        id(p.id) &&
        ['instruments', 'leadBacking', 'twoSingers', 'original'].includes(String(p.mode)) &&
        object(p.tracks) &&
        Object.entries(p.tracks).every(
          ([key, value]) =>
            validStudyTrack(key) &&
            object(value) &&
            keys(value, ['gain', 'mute', 'solo']) &&
            number(value.gain, 0, 2) &&
            typeof value.mute === 'boolean' &&
            typeof value.solo === 'boolean'
        )
      )
    case 'study.export':
      return (
        keys(p, ['id', 'audioFormat', 'chordFormat', 'stems', 'outputDirectory']) &&
        (p.outputDirectory === undefined || typeof p.outputDirectory === 'string' && p.outputDirectory.length > 0 && p.outputDirectory.length <= 32768 && !p.outputDirectory.includes('\0')) &&
        id(p.id) &&
        ['wav', 'flac'].includes(String(p.audioFormat)) &&
        ['txt', 'csv', 'json'].includes(String(p.chordFormat)) &&
        Array.isArray(p.stems) &&
        p.stems.length <= 11 &&
        p.stems.every(validStudyTrack) &&
        new Set(p.stems).size === p.stems.length
      )
    default:
      return false
  }
}

/** Parent vocals and either subdivision are mutually exclusive in the mixer. */
export function studyMixGains(
  mix: StudyMix,
  available: StudyStem[]
): Partial<Record<StudyTrack, number>> {
  const allowed: StudyTrack[] =
    mix.mode === 'original'
      ? ['original']
      : (available
          .filter((stem) => !['vocals', 'lead', 'backing', 'singerA', 'singerB'].includes(stem))
          .concat(
            mix.mode === 'instruments'
              ? ['vocals']
              : mix.mode === 'leadBacking'
                ? ['lead', 'backing']
                : ['singerA', 'singerB']
          ) as StudyTrack[])
  const parent = mix.tracks.vocals
  const children =
    mix.mode === 'leadBacking'
      ? ['lead', 'backing']
      : mix.mode === 'twoSingers'
        ? ['singerA', 'singerB']
        : []
  const childSolo = children.some((stem) => mix.tracks[stem as StudyTrack]?.solo)
  const solo =
    allowed.some((stem) => mix.tracks[stem]?.solo) || (!!children.length && !!parent?.solo)
  return Object.fromEntries(
    allowed.map((stem) => {
      const setting = mix.tracks[stem]
      const child = children.includes(stem)
      return [
        stem,
        setting?.mute ||
        (child && parent?.mute) ||
        (child && childSolo && !setting?.solo) ||
        (solo && !setting?.solo && !(child && parent?.solo))
          ? 0
          : (setting?.gain ?? 1) * (child ? (parent?.gain ?? 1) : 1)
      ]
    })
  )
}
