import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'study.components', 'study.componentPlan', 'study.componentInstall', 'study.componentTask',
  'study.componentRemove', 'study.componentDirectory', 'study.componentImport', 'study.componentDismiss',
  'study.state',
  'study.cache',
  'study.automation',
  'study.setAutomation',
  'study.runtime',
  'study.setCachePolicy',
  'study.clearAudioCache',
  'study.exportSources',
  'study.submit',
  'study.song',
  'study.songSummary',
  'study.lyricsDisplay',
  'study.setLyricsDisplay',
  'study.analyze',
  'study.transcribeMelody',
  'study.splitVocals',
  'study.chordsVisible',
  'study.project',
  'study.create',
  'study.cancel',
  'study.retry',
  'study.delete',
  'study.edit',
  'study.mix',
  'study.transport',
  'study.export',
  'study.choosePack',
  'study.analyzeChords'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { identity } = context
  const playback = context.dependencies.playback
  if (identity.role !== 'desktop') throw failure('FORBIDDEN', '分轨工作台只对桌面窗口开放')
  const study = context.dependencies.musicStudy
  if (!study) throw failure('NOT_READY', '分轨工作台尚未就绪')
  switch (request.name) {
    case 'study.components': return study.components?.state()
    case 'study.componentPlan': return study.components?.plan(request.payload.features)
    case 'study.componentInstall': return study.components?.install(request.payload.features)
    case 'study.componentTask': return study.components?.action({ action: 'task', id: request.payload.id, task: request.payload.action })
    case 'study.componentRemove': return study.components?.action({ action: 'remove', id: request.payload.id })
    case 'study.componentDirectory': return study.components?.action({ action: 'directory' })
    case 'study.componentImport': return study.components?.action({ action: 'import' })
    case 'study.componentDismiss': return study.dismissComponents(request.payload.owner)
    case 'study.state':
      return study.state(request.payload)
    case 'study.cache':
      return study.cache()
    case 'study.automation':
      return study.automation()
    case 'study.setAutomation':
      return study.setAutomation(request.payload)
    case 'study.runtime':
      return study.runtime()
    case 'study.setCachePolicy':
      return study.setCachePolicy(request.payload)
    case 'study.clearAudioCache':
      return study.clearAudioCache()
    case 'study.exportSources':
      return study.exportSources(request.payload.id, request.payload.outputDirectory)
    case 'study.submit':
      return study.submit(request.payload)
    case 'study.song':
      return study.song(request.payload.songId)
    case 'study.songSummary':
      return study.songSummary(request.payload.songId)
    case 'study.lyricsDisplay':
      return study.lyricsDisplay(request.payload.songId)
    case 'study.setLyricsDisplay': {
      const current = playback.snapshot()
      if (current.track?.id !== request.payload.songId) throw failure('CANCELLED', '当前歌曲已变化')
      study.bindLyrics(
        current.track.id,
        current.queue?.occurrenceId ?? null,
        current.playback?.state === 'playing'
      )
      return study.setLyricsDisplay(request.payload)
    }
    case 'study.analyze':
      return study.analyze(request.payload.songId)
    case 'study.transcribeMelody':
      return study.transcribeMelody(request.payload.songId)
    case 'study.splitVocals':
      return study.splitVocals(request.payload.id, request.payload.kind)
    case 'study.chordsVisible':
      return study.chordsVisible(request.payload.id, request.payload.visible)
    case 'study.project':
      return study.project(request.payload.id)
    case 'study.create':
      return study.create(request.payload)
    case 'study.cancel':
      return study.cancel(request.payload.id)
    case 'study.retry':
      return study.retry(request.payload.id)
    case 'study.delete':
      return study.remove(request.payload.id)
    case 'study.edit':
      return study.edit(request.payload)
    case 'study.mix':
      return study.setMix(request.payload)
    case 'study.transport':
      return study.transport(request.payload)
    case 'study.export':
      return study.export(request.payload)
    case 'study.choosePack':
      return study.choosePack()
    case 'study.analyzeChords':
      return study.analyzeChords(request.payload.id, request.payload.stems)
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
