export const STUDY_FEATURES = ['six', 'chords', 'leadBacking', 'twoSingers', 'melody', 'lyricFilter', 'btc'] as const
export type StudyFeature = (typeof STUDY_FEATURES)[number]
export const STUDY_FEATURE_COMPONENTS: Record<StudyFeature, string[]> = {
  six: ['engine-main', 'engine-torch', 'demucs'],
  chords: ['engine-main', 'engine-torch', 'sheetsage', 'mert'],
  leadBacking: ['engine-main', 'engine-torch', 'mdx'],
  twoSingers: ['engine-main', 'engine-torch', 'duet', 'ecapa'],
  melody: ['engine-main', 'engine-vocal', 'engine-torch', 'tifa', 'game', 'beat', 'lilypond'],
  lyricFilter: ['engine-vocal', 'lyric'],
  btc: ['engine-main', 'engine-torch', 'btc']
}
export const STUDY_FEATURE_TITLES: Record<StudyFeature, string> = {
  six: '六轨分离', chords: '和弦识别', leadBacking: '主唱／和声分离',
  twoSingers: '双歌手分离', melody: '旋律与曲谱', lyricFilter: '歌词过滤', btc: '轻量和弦对比'
}
export interface StudyComponentAsset { name: string; url: string; bytes: number; sha256: string }
export interface StudyComponent {
  id: string; title: string; version: string; platform: string; installedBytes: number
  archiveBytes: number; archiveSha256: string; parts: StudyComponentAsset[]
}
export interface StudyComponentCatalog {
  schema: 1; version: string; repository: string; tag: string; platform: string; components: StudyComponent[]
}
export type StudyComponentPhase = 'missing' | 'queued' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'paused' | 'interrupted' | 'failed' | 'cancelled'
export interface StudyComponentStatus {
  id: string; phase: StudyComponentPhase; receivedBytes: number; totalBytes: number
  cachedBytes?: number
  error?: string; external?: boolean
}
export interface StudyComponentPlan {
  features: StudyFeature[]; ids: string[]; downloadBytes: number; installedBytes: number; peakBytes: number; directory: string
}
export interface StudyComponentRequest { owner: string; title: string; interactive: boolean; plan: StudyComponentPlan }
export interface StudyComponentState {
  directory: string; supported: boolean; catalog: StudyComponentCatalog; components: StudyComponentStatus[]
  requests: StudyComponentRequest[]; error?: string
}
export interface StudyComponentIO {
  action: 'state' | 'start' | 'task' | 'remove' | 'directory' | 'import'
  ids?: string[]; id?: string; task?: 'pause' | 'resume' | 'cancel' | 'retry'
}
export function componentIds(features: readonly StudyFeature[]): string[] {
  return [...new Set(features.flatMap(feature => STUDY_FEATURE_COMPONENTS[feature]))]
}
export function componentBusy(phase: StudyComponentPhase): boolean {
  return ['queued', 'downloading', 'verifying', 'installing'].includes(phase)
}
export function componentPriority(id: string): number {
  return ['engine-main', 'engine-torch', 'demucs'].includes(id) ? 0
    : ['sheetsage', 'mert', 'btc'].includes(id) ? 1 : ['duet', 'ecapa'].includes(id) ? 3 : 2
}
export function planComponents(state: StudyComponentState, features: StudyFeature[]): StudyComponentPlan {
  const ids = componentIds(features).filter(id => state.components.find(item => item.id === id)?.phase !== 'ready')
  const needed = state.catalog.components.filter(item => ids.includes(item.id))
  const downloadBytes = needed.reduce((total, item) => total + Math.max(0, item.parts.reduce((n, part) => n + part.bytes, 0) - (state.components.find(row => row.id === item.id)?.cachedBytes ?? 0)), 0)
  const installedBytes = needed.reduce((total, item) => total + item.installedBytes, 0)
  return { features, ids, downloadBytes, installedBytes, peakBytes: downloadBytes * 2 + installedBytes + 256 * 1024 ** 2, directory: state.directory }
}
export interface StudyComponentCommands {
  'study.componentInstall': { features: StudyFeature[] }
  'study.componentTask': { id: string; action: 'pause' | 'resume' | 'cancel' | 'retry' }
  'study.componentRemove': { id: string }
  'study.componentDirectory': Record<string, never>
  'study.componentImport': Record<string, never>
  'study.componentDismiss': { owner: string }
}
export interface StudyComponentQueries {
  'study.components': { input: Record<string, never>; output: StudyComponentState }
  'study.componentPlan': { input: { features: StudyFeature[] }; output: StudyComponentPlan }
}
export interface StudyRuntimePaths {
  python?: string; vocalPython?: string; sharedPython?: string; notationHome?: string
  models: Record<string, string>
}
export function validComponentIO(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  const id = (v: unknown) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v)
  if (!Object.keys(p).every(key => ['action', 'ids', 'id', 'task'].includes(key))) return false
  if (['state', 'directory', 'import'].includes(String(p.action))) return Object.keys(p).length === 1
  if (p.action === 'start') return Object.keys(p).length === 2 && Array.isArray(p.ids) && p.ids.length <= 32 && p.ids.every(id)
  if (p.action === 'remove') return Object.keys(p).length === 2 && id(p.id)
  return p.action === 'task' && Object.keys(p).length === 3 && id(p.id) && ['pause', 'resume', 'cancel', 'retry'].includes(String(p.task))
}
export function validComponentPayload(name: string, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Record<string, unknown>
  const keys = (...names: string[]) => Object.keys(p).every(key => names.includes(key))
  const id = (v: unknown) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v)
  switch (name) {
    case 'study.components': case 'study.componentDirectory': case 'study.componentImport': return keys()
    case 'study.componentPlan': case 'study.componentInstall':
      return keys('features') && Array.isArray(p.features) && p.features.length > 0 && p.features.length <= STUDY_FEATURES.length &&
        p.features.every(feature => STUDY_FEATURES.includes(feature as StudyFeature)) && new Set(p.features).size === p.features.length
    case 'study.componentTask': return keys('id', 'action') && id(p.id) && ['pause', 'resume', 'cancel', 'retry'].includes(String(p.action))
    case 'study.componentRemove': return keys('id') && id(p.id)
    case 'study.componentDismiss': return keys('owner') && typeof p.owner === 'string' && p.owner.length > 0 && p.owner.length <= 512
    default: return false
  }
}
