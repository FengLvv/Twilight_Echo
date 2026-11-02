import { executeLibraryArtwork, executeLibraryRead } from '.././library/readOperations.ts'

import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { projectCoreScan, projectCoreTrack } from '.././projections.ts'

import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'library.health.start',
  'library.health.status',
  'library.health.page',
  'library.health.repair',
  'library.inbox.refresh',
  'library.inbox.mark',
  'library.inbox.page',
  'library.loudness.prepare',
  'library.loudness.start',
  'library.loudness.cancel',
  'library.loudness.clear',
  'library.loudness.state',
  'library.loudness.page',
  'library.loudness.result',
  'library.duplicates.start',
  'library.duplicates.cancel',
  'library.duplicates.status',
  'library.duplicates.groups',
  'library.duplicates.items',
  'library.duplicates.unavailable',
  'library.selection.open',
  'library.selection.page',
  'library.selection.close',
  'library.remove',
  'library.reset',
  'library.exclusions.clear',
  'library.tags.write',
  'library.tags.restore',
  'library.reveal',
  'statistics.summary',
  'statistics.overview',
  'statistics.previewClear',
  'statistics.tracks',
  'statistics.clear',
  'scan.status',
  'scan.watchers',
  'metadata.status',
  'metadata.entity.policy',
  'identification.start',
  'identification.status',
  'identification.detail',
  'identification.candidates',
  'identification.history',
  'identification.restorePreview',
  'identification.restore',
  'metadata.entity.sources',
  'metadata.entity.requery',
  'identification.inbox',
  'identification.preview',
  'identification.decide',
  'identification.detach',
  'metadata.entity.detail',
  'metadata.entity.jobs',
  'metadata.entity.tasks',
  'metadata.entity.demands',
  'metadata.entity.credits',
  'metadata.entity.resolve',
  'metadata.entity.enrich',
  'metadata.entity.decide',
  'metadata.entity.detach',
  'metadata.entity.override',
  'metadata.entity.sourcePreference',
  'metadata.entity.artworkOverride',
  'metadata.entity.cancel',
  'metadata.start',
  'metadata.cancel',
  'metadata.candidates',
  'metadata.apply',
  'metadata.clear',
  'scan.start',
  'scan.pause',
  'scan.resume',
  'scan.cancel',
  'library.metadata',
  'library.artwork',
  'library.collections',
  'library.byIds',
  'library.paths.lookup',
  'library.recent.resolve',
  'library.tracks'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  switch (request.name) {
    case 'library.health.start':
    case 'library.health.status':
    case 'library.health.page':
    case 'library.health.repair': {
      const health = context.dependencies.libraryHealth
      if (!health) throw failure('FAILED', '音乐库体检服务不可用')
      if (request.kind === 'command' && identity.role !== 'desktop')
        throw failure('FORBIDDEN', '音乐库体检操作需要桌面窗口')
      switch (request.name) {
        case 'library.health.start':
          return health.start()
        case 'library.health.status':
          return health.state()
        case 'library.health.page':
          return health.page(request.payload)
        case 'library.health.repair':
          return health.repair(request.payload)
      }
      break
    }
    case 'library.inbox.refresh':
    case 'library.inbox.mark':
    case 'library.inbox.page': {
      const inbox = context.dependencies.inbox
      if (!inbox) throw failure('FAILED', 'Library inbox unavailable')
      if (request.kind === 'command' && identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Inbox changes require the desktop window')
      if (request.name === 'library.inbox.refresh')
        return inbox.refresh(request.payload.duplicatesId)
      if (request.name === 'library.inbox.mark') return inbox.mark(request.payload)
      return inbox.page(request.payload)
    }
    case 'library.loudness.prepare':
    case 'library.loudness.start':
    case 'library.loudness.cancel':
    case 'library.loudness.clear':
    case 'library.loudness.state':
    case 'library.loudness.page':
    case 'library.loudness.result': {
      const loudness = context.dependencies.libraryLoudness
      if (!loudness) throw failure('FAILED', 'Library loudness unavailable')
      if (request.kind === 'command' && identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Library loudness changes require the desktop window')
      switch (request.name) {
        case 'library.loudness.prepare':
          return loudness.prepare(request.payload, signal)
        case 'library.loudness.start':
          return loudness.start(request.payload.id)
        case 'library.loudness.cancel':
          return loudness.cancel(request.payload.id)
        case 'library.loudness.clear':
          return loudness.clear(request.payload.id)
        case 'library.loudness.state':
          return loudness.state()
        case 'library.loudness.page':
          return loudness.page(request.payload.id, request.payload.offset, request.payload.limit)
        case 'library.loudness.result':
          return loudness.result(request.payload.id, request.payload.index)
      }
      break
    }
    case 'library.duplicates.start':
    case 'library.duplicates.cancel':
    case 'library.duplicates.status':
    case 'library.duplicates.groups':
    case 'library.duplicates.items':
    case 'library.duplicates.unavailable': {
      const duplicates = context.dependencies.duplicates
      if (!duplicates) throw failure('FAILED', 'Duplicate inspection unavailable')
      switch (request.name) {
        case 'library.duplicates.start':
        case 'library.duplicates.cancel':
          if (identity.role !== 'desktop')
            throw failure('FORBIDDEN', 'Duplicate inspection requires the desktop window')
          return request.name === 'library.duplicates.start'
            ? duplicates.start()
            : duplicates.cancel(request.payload.id)
        case 'library.duplicates.status':
          return duplicates.snapshot()
        case 'library.duplicates.groups':
          return duplicates.groups(request.payload)
        case 'library.duplicates.items':
          return duplicates.items(request.payload)
        case 'library.duplicates.unavailable':
          return duplicates.unavailable(request.payload)
      }
      break
    }
    case 'library.selection.open':
    case 'library.selection.page':
    case 'library.selection.close':
    case 'library.remove':
    case 'library.reset':
    case 'library.exclusions.clear':
    case 'library.tags.write':
    case 'library.tags.restore': {
      const maintenance = context.dependencies.libraryMaintenance
      if (!maintenance) throw failure('FAILED', 'Library maintenance unavailable')
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'File management requires the desktop window')
      switch (request.name) {
        case 'library.selection.open':
          return maintenance.open(request.payload, signal)
        case 'library.selection.page':
          return maintenance.page(
            request.payload.id,
            request.payload.cursor,
            request.payload.projection
          )
        case 'library.selection.close':
          return maintenance.close(request.payload.id)
        case 'library.remove':
          return maintenance.remove(request.payload.selectionId, request.payload.mode, signal)
        case 'library.reset':
          return maintenance.reset(request.payload.revision, signal)
        case 'library.exclusions.clear':
          return maintenance.clearExclusions(
            request.payload.revision,
            request.payload.paths,
            signal
          )
        case 'library.tags.write':
          return maintenance.writeTags(request.payload, signal)
        case 'library.tags.restore':
          return maintenance.restoreTags(request.payload.selectionId, signal)
      }
      break
    }
    case 'library.reveal': {
      if (!context.dependencies.revealAudioFile)
        throw failure('NOT_READY', 'File reveal is unavailable')
      const page = await context.dependencies.library.getTracksByIds([request.payload.id])
      const track = page.tracks[0]
      if (!track) throw failure('FAILED', '本地曲目已不存在')
      if (
        request.payload.version !== undefined &&
        page.versions[track.id] !== request.payload.version
      )
        throw failure('STALE_REVISION', '曲目信息已变化，请刷新后重试')
      if (track.source && track.source !== 'local') throw failure('FAILED', '此曲目没有本地文件')
      return context.dependencies.revealAudioFile(track.filePath)
    }
    case 'statistics.summary':
      return context.dependencies.statistics.summary()
    case 'statistics.overview':
      return context.dependencies.statistics.overview(context.dependencies.artwork, signal)
    case 'statistics.previewClear':
      return context.dependencies.statistics.previewClear(
        request.payload.range,
        request.payload.revision
      )
    case 'statistics.tracks':
      return context.dependencies.statistics.pageWithArtwork(
        request.payload,
        context.dependencies.artwork,
        signal
      )
    case 'statistics.clear':
      return context.dependencies.statistics.clear(request.payload.range, request.payload.revision)
    case 'scan.status':
      return projectCoreScan(context.dependencies.scan.snapshot())
    case 'scan.watchers':
      return context.dependencies.libraryBackground?.snapshot() ?? { enabled: false, folders: [] }
    case 'metadata.status':
      return context.dependencies.metadata?.snapshot() ?? null
    case 'metadata.entity.policy':
    case 'identification.start':
    case 'identification.status':
    case 'identification.detail':
    case 'identification.candidates':
    case 'identification.history':
    case 'identification.restorePreview':
    case 'identification.restore':
    case 'metadata.entity.sources':
    case 'metadata.entity.requery':
    case 'identification.inbox':
    case 'identification.preview':
    case 'identification.decide':
    case 'identification.detach':
    case 'metadata.entity.detail':
    case 'metadata.entity.jobs':
    case 'metadata.entity.tasks':
    case 'metadata.entity.demands':
    case 'metadata.entity.credits':
    case 'metadata.entity.resolve':
    case 'metadata.entity.enrich':
    case 'metadata.entity.decide':
    case 'metadata.entity.detach':
    case 'metadata.entity.override':
    case 'metadata.entity.sourcePreference':
    case 'metadata.entity.artworkOverride':
    case 'metadata.entity.cancel': {
      const service = context.dependencies.metadata?.entities
      if (!service) throw failure('NOT_READY', 'Entity metadata service is unavailable')
      switch (request.name) {
        case 'identification.start':
          return service.startIdentification(request.payload)
        case 'identification.status':
          return service.identificationStatus()
        case 'identification.detail':
          return service.identity(request.payload.entityId)
        case 'identification.candidates':
          return service.candidates(request.payload)
        case 'identification.history':
          return service.history(request.payload)
        case 'identification.restorePreview':
          return service.restorePreview(request.payload)
        case 'identification.restore':
          return service.restoreIdentity(request.payload)
        case 'metadata.entity.sources':
          return service.taskSources(request.payload)
        case 'metadata.entity.requery':
          return service.requery(request.payload)
        case 'identification.inbox':
          return service.inbox(request.payload)
        case 'identification.preview':
          return service.preview(request.payload)
        case 'identification.decide':
          return service.decideIdentity(request.payload)
        case 'identification.detach':
          return service.detachIdentity(request.payload.linkId, request.payload.revision)
        case 'metadata.entity.policy':
          return service.policy()
        case 'metadata.entity.detail':
          return service.detail(
            request.payload.entityId,
            request.payload.language,
            request.payload.sourceProvider,
            request.payload.includeAutomaticArtwork
          )
        case 'metadata.entity.jobs':
          return service.jobs(request.payload)
        case 'metadata.entity.tasks':
          return service.tasks(request.payload)
        case 'metadata.entity.demands':
          return service.demands(request.payload)
        case 'metadata.entity.credits':
          return service.credits(request.payload)
        case 'metadata.entity.resolve':
          return service.resolve(request.payload)
        case 'metadata.entity.enrich':
          return service.enrich(request.payload)
        case 'metadata.entity.decide':
          return service.decide(request.payload)
        case 'metadata.entity.detach':
          return service.detach(request.payload.entityId, request.payload.revision)
        case 'metadata.entity.override':
          return service.override(request.payload)
        case 'metadata.entity.sourcePreference':
          return service.sourcePreference(request.payload)
        case 'metadata.entity.artworkOverride':
          return service.artworkOverride(request.payload)
        case 'metadata.entity.cancel':
          return service.cancel(
            request.payload.jobId,
            request.payload.batchId,
            request.payload.generation
          )
      }
      break
    }
    case 'metadata.start':
      if (!context.dependencies.metadata) throw new Error('Metadata service is unavailable')
      context.dependencies.metadata.start()
      return
    case 'metadata.cancel':
      return context.dependencies.metadata?.cancel() ?? false
    case 'metadata.candidates':
      if (!context.dependencies.metadata) throw new Error('Metadata service is unavailable')
      return context.dependencies.metadata.find(request.payload.id, request.payload.version, signal)
    case 'metadata.apply':
      if (!context.dependencies.metadata) throw new Error('Metadata service is unavailable')
      return context.dependencies.metadata.apply(
        request.payload.token,
        request.payload.index,
        signal
      )
    case 'metadata.clear':
      if (!context.dependencies.metadata) throw new Error('Metadata service is unavailable')
      return context.dependencies.metadata.clear(
        request.payload.id,
        request.payload.version,
        signal
      )
    case 'scan.start':
      return projectCoreScan(await context.dependencies.scan.start(request.payload, signal))
    case 'scan.pause':
      return context.dependencies.scan.pause(request.payload.jobId)
    case 'scan.resume':
      return projectCoreScan(await context.dependencies.scan.resume(request.payload.jobId))
    case 'scan.cancel':
      return context.dependencies.scan.cancel(request.payload.jobId)
    case 'library.metadata':
      return context.dependencies.library.getMetadata()
    case 'library.artwork':
      if (!context.dependencies.artwork) throw failure('NOT_READY', 'Artwork is unavailable')
      return executeLibraryArtwork(
        context.dependencies.library,
        request.payload,
        context.dependencies.artwork,
        signal
      )
    case 'library.collections': {
      const entities = context.dependencies.metadata?.entities
      const platformContexts = entities?.platformContexts() ?? {}
      const page = await executeLibraryRead(context.dependencies.library, request, {
        platformContexts,
        now: Date.now()
      })
      if (JSON.stringify(platformContexts) !== JSON.stringify(entities?.platformContexts() ?? {}))
        throw failure('STALE_REVISION', '资料授权已变化，请重新读取')
      return page
    }
    case 'library.byIds':
    case 'library.paths.lookup':
      return executeLibraryRead(context.dependencies.library, request)
    case 'library.recent.resolve': {
      const versions = context.dependencies.recordingVersions
      if (!versions) throw failure('NOT_READY', 'Recording versions unavailable')
      const versionsRevision = versions.getRevision()
      if (request.payload.versionsRevision !== versionsRevision)
        throw failure('STALE_REVISION', '版本记录已变化，请刷新最近播放')
      const versionSnapshot = versions.snapshot()
      const result = await context.dependencies.library.lookupPlaylistTracks(
        {
          entries: request.payload.entries,
          versions: versionSnapshot.tracks.versions,
          resolution: 'recent'
        },
        request.payload.revision
      )
      if (versions.getRevision() !== versionsRevision)
        throw failure('STALE_REVISION', '版本记录已变化，请刷新最近播放')
      return { ...result, versionsRevision }
    }
    case 'library.tracks': {
      const page = await context.dependencies.library.queryTracks(request.payload)
      return { ...page, tracks: page.tracks.map((track) => projectCoreTrack(track)) }
    }
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
