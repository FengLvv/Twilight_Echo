import { libraryQueueTrack } from '.././playback/libraryTrack.ts'

import { executePlaylistProjection } from '.././playlists/projectionOperations.ts'

import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { projectCoreError } from '.././projections.ts'

import { executePreviewOperation, failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'playlists.addQueueEntries',
  'playlists.saveQueue',
  'playlists.repair',
  'playlists.repair.status',
  'workspace.state',
  'workspace.sessions',
  'workspace.history',
  'workspace.restore',
  'workspace.edit',
  'lyrics.state',
  'lyrics.current',
  'lyrics.entry',
  'lyrics.search',
  'lyrics.edit',
  'lyrics.reload',
  'lyrics.importDraft',
  'lyrics.exportDraft',
  'bookmarks.state',
  'bookmarks.page',
  'bookmarks.edit',
  'bookmarks.seek',
  'imports.previews',
  'imports.preview',
  'imports.previewPage',
  'imports.previewChoices',
  'imports.previewStart',
  'imports.previewFile',
  'imports.previewConfigure',
  'imports.previewSave',
  'imports.previewDiscard',
  'imports.status',
  'imports.bind',
  'imports.previewBind',
  'playlists.replaceSource',
  'playlists.rematch',
  'imports.retry',
  'imports.cancel',
  'playlists.view',
  'versions.catalog',
  'playlists.favorites',
  'versions.page',
  'versions.edit',
  'playlists.list',
  'playlists.entries',
  'playlists.edit',
  'playlists.catalog',
  'playlists.collection',
  'playlists.members',
  'playlists.membership',
  'playlists.state',
  'playlists.export',
  'playlists.importDocument',
  'playlists.flush',
  'playlists.submit'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  const playback = context.dependencies.playback
  switch (request.name) {
    case 'playlists.addQueueEntries': {
      if (!identity.permissions.includes('playback:read'))
        throw failure('FORBIDDEN', 'Playback access is required')
      if (!context.dependencies.playlists) throw failure('NOT_READY', 'Playlists are unavailable')
      const { id, revision, queue, occurrenceIds } = request.payload
      const tracks = [] as ReturnType<typeof libraryQueueTrack>[]
      let libraryRevision: number | undefined
      for (const occurrenceId of occurrenceIds) {
        signal.throwIfAborted()
        const page = await context.dependencies.library.readLibraryQueue(queue.id, 0, 1, {
          expectedRevision: queue.revision,
          occurrenceId
        })
        libraryRevision ??= page.libraryRevision
        if (page.libraryRevision !== libraryRevision)
          throw failure('STALE_REVISION', 'Library changed while reading the queue')
        const item = page.items[0]
        if (!item?.track) throw failure('STALE_REVISION', '队列中的曲目已不存在，请刷新队列')
        tracks.push(libraryQueueTrack(item.track, item.queueEntryId))
      }
      signal.throwIfAborted()
      return context.dependencies.playlists.edit(revision, { kind: 'add', id, tracks }, signal)
    }
    case 'playlists.saveQueue': {
      if (!identity.permissions.includes('playback:read'))
        throw failure('FORBIDDEN', 'Playback access is required')
      if (!context.dependencies.playlists) throw failure('NOT_READY', 'Playlists are unavailable')
      const { name, revision, queue } = request.payload
      return context.dependencies.playlists.saveTrackPages(
        name,
        revision,
        async (append) => {
          let libraryRevision: number | undefined,
            count = 0
          for (let offset = 0; ; offset += 200) {
            signal.throwIfAborted()
            const page = await context.dependencies.library.readLibraryQueue(
              queue.id,
              offset,
              200,
              {
                expectedRevision: queue.revision
              }
            )
            libraryRevision ??= page.libraryRevision
            if (libraryRevision !== page.libraryRevision)
              throw failure('STALE_REVISION', 'Library changed while saving the queue')
            const tracks = page.items.flatMap((item) =>
              item.track ? [libraryQueueTrack(item.track, item.queueEntryId)] : []
            )
            count += tracks.length
            await append(tracks)
            if (offset + 200 >= page.total) break
          }
          if (!count) throw failure('FAILED', '队列中没有可保存的歌曲')
          const current = await context.dependencies.library.readLibraryQueue(queue.id, 0, 1, {
            expectedRevision: queue.revision
          })
          if (current.libraryRevision !== libraryRevision)
            throw failure('STALE_REVISION', 'Library changed while saving the queue')
          return () => {
            signal.throwIfAborted()
          }
        },
        signal
      )
    }
    case 'playlists.repair':
    case 'playlists.repair.status': {
      const playlists = context.dependencies.playlists
      if (!playlists) throw failure('FAILED', 'Playlists unavailable')
      if (request.name === 'playlists.repair.status') return playlists.repairSnapshot()
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'File management requires the desktop window')
      return playlists.startRepair(
        request.payload.id,
        request.payload.revision,
        request.payload.folder,
        signal
      )
    }
    case 'workspace.state':
    case 'workspace.sessions':
    case 'workspace.history':
    case 'workspace.restore':
    case 'workspace.edit': {
      const workspace = context.dependencies.workspace
      if (!workspace) throw failure('FAILED', 'Queue workspace runtime unavailable')
      switch (request.name) {
        case 'workspace.state':
          return workspace.state()
        case 'workspace.sessions':
          return workspace.sessions(request.payload)
        case 'workspace.history':
          return workspace.history(request.payload)
        case 'workspace.restore':
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Library read capability is not granted')
          return workspace.restore(request.payload, signal)
        case 'workspace.edit':
          if (
            !identity.permissions.includes('playback:read') &&
            request.payload.edit.kind === 'saveCurrent'
          )
            throw failure('FORBIDDEN', 'Playback read capability is not granted')
          return workspace.edit(request.payload, signal)
      }
      break
    }
    case 'lyrics.state':
    case 'lyrics.current':
    case 'lyrics.entry':
    case 'lyrics.search':
    case 'lyrics.edit':
    case 'lyrics.reload':
    case 'lyrics.importDraft':
    case 'lyrics.exportDraft': {
      const lyrics = context.dependencies.lyrics
      if (!lyrics) throw failure('FAILED', 'Lyrics runtime unavailable')
      switch (request.name) {
        case 'lyrics.state':
          return lyrics.state()
        case 'lyrics.current':
          return lyrics.content()
        case 'lyrics.entry':
          return lyrics.entry(request.payload.trackId)
        case 'lyrics.search':
          return lyrics.search(request.payload, signal)
        case 'lyrics.edit':
          return lyrics.edit(request.payload, signal)
        case 'lyrics.reload':
          return lyrics.reload(request.payload)
        case 'lyrics.importDraft':
        case 'lyrics.exportDraft':
          if (identity.role !== 'desktop')
            throw failure('FORBIDDEN', 'Lyrics dialogs require the desktop client')
          return request.name === 'lyrics.importDraft'
            ? lyrics.importDraft(signal)
            : lyrics.exportDraft(request.payload.contents, signal)
      }
      break
    }
    case 'bookmarks.state':
      if (!context.dependencies.bookmarks) throw failure('FAILED', 'Bookmark runtime unavailable')
      return context.dependencies.bookmarks.state()
    case 'bookmarks.page':
      if (!context.dependencies.bookmarks) throw failure('FAILED', 'Bookmark runtime unavailable')
      return context.dependencies.bookmarks.page(request.payload)
    case 'bookmarks.edit':
      if (!context.dependencies.bookmarks) throw failure('FAILED', 'Bookmark runtime unavailable')
      return context.dependencies.bookmarks.edit(request.payload, signal)
    case 'bookmarks.seek': {
      if (!identity.permissions.includes('library:read'))
        throw failure('FORBIDDEN', 'Bookmark access is not granted')
      if (!context.dependencies.bookmarks) throw failure('FAILED', 'Bookmark runtime unavailable')
      return playback.seek(
        context.dependencies.bookmarks.position(
          request.payload.id,
          request.payload.revision,
          request.payload.current
        )
      )
    }
    case 'imports.previews':
    case 'imports.preview':
    case 'imports.previewPage':
    case 'imports.previewChoices':
    case 'imports.previewStart':
    case 'imports.previewFile':
    case 'imports.previewConfigure':
    case 'imports.previewSave':
    case 'imports.previewDiscard': {
      const previews = context.dependencies.importPreviews
      if (!previews) throw failure('FAILED', 'Playlist preview runtime unavailable')
      if (request.name === 'imports.previewFile' && identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'File selection requires a desktop window')
      return executePreviewOperation(previews, request, signal)
    }
    case 'imports.status': {
      const status = context.dependencies.imports?.status(request.payload.id)
      return status
        ? { ...status, error: status.error ? projectCoreError(status.error) : null }
        : null
    }
    case 'imports.bind':
    case 'imports.previewBind': {
      const resolve = context.dependencies.resolvePlaylistInputs
      if (!resolve) throw failure('NOT_READY', 'Track sources are unavailable')
      const { id, revision, entryId, input } = request.payload
      const track = input ? (await resolve([input], signal))[0] : null
      if (request.name === 'imports.previewBind') {
        if (!context.dependencies.importPreviews)
          throw failure('NOT_READY', 'Import previews are unavailable')
        return context.dependencies.importPreviews.bind(id, revision, entryId, track)
      }
      if (!context.dependencies.playlists) throw failure('NOT_READY', 'Playlists are unavailable')
      return context.dependencies.playlists.edit(
        revision,
        { kind: 'importBind', id, entryId, track },
        signal
      )
    }
    case 'playlists.replaceSource':
    case 'playlists.rematch': {
      const sources = context.dependencies.playlistSources
      if (!sources) throw failure('NOT_READY', 'Playlist source matching is unavailable')
      return request.name === 'playlists.replaceSource'
        ? sources.replace(
            request.payload.revision,
            request.payload.oldTrackId,
            request.payload.input,
            signal
          )
        : sources.rematch(request.payload.revision, request.payload.input, signal)
    }
    case 'imports.retry':
      if (!context.dependencies.imports) throw failure('FAILED', 'Playlist matching unavailable')
      return context.dependencies.imports.start(
        request.payload.id,
        request.payload.force,
        request.payload.entries
      )
    case 'imports.cancel':
      await context.dependencies.importPreviews?.cancel(request.payload.id)
      return context.dependencies.imports?.stop(request.payload.id)
    case 'playlists.view':
      if (!context.dependencies.playlists) throw failure('FAILED', 'Playlist runtime unavailable')
      return context.dependencies.playlists.view(request.payload, signal)
    case 'versions.catalog':
      if (!context.dependencies.recordingCatalog)
        throw failure('NOT_READY', 'Recording sources are unavailable')
      return context.dependencies.recordingCatalog.page(request.payload, signal)
    case 'playlists.favorites': {
      const { playlists, resolvePlaylistInputs } = context.dependencies
      if (!playlists || !resolvePlaylistInputs)
        throw failure('NOT_READY', 'Playlists are unavailable')
      const tracks = await resolvePlaylistInputs(request.payload.items, signal)
      return playlists.favorites(request.payload.revision, tracks)
    }
    case 'versions.page':
      if (!context.dependencies.recordingVersions)
        throw failure('FAILED', 'Recording versions unavailable')
      return context.dependencies.recordingVersions.page(request.payload)
    case 'versions.edit':
      if (!context.dependencies.recordingVersions)
        throw failure('FAILED', 'Recording versions unavailable')
      return context.dependencies.recordingVersions.edit(request.payload, signal)
    case 'playlists.list':
      if (!context.dependencies.playlists) throw failure('FAILED', 'Playlist runtime unavailable')
      return context.dependencies.playlists.list(
        request.payload.offset,
        request.payload.limit,
        request.payload.revision
      )
    case 'playlists.entries':
      if (!context.dependencies.playlists) throw failure('FAILED', 'Playlist runtime unavailable')
      return context.dependencies.playlists.entries(
        request.payload.id,
        request.payload.revision,
        request.payload.offset,
        request.payload.limit
      )
    case 'playlists.edit':
      if (!context.dependencies.playlists) throw failure('FAILED', 'Playlist runtime unavailable')
      return context.dependencies.playlists.edit(
        request.payload.revision,
        request.payload.edit,
        signal
      )
    case 'playlists.catalog':
    case 'playlists.collection':
    case 'playlists.members':
    case 'playlists.membership':
    case 'playlists.state':
    case 'playlists.export':
    case 'playlists.importDocument':
    case 'playlists.flush':
      if (!context.dependencies.playlists) throw failure('NOT_READY', 'Playlists are unavailable')
      return executePlaylistProjection(context.dependencies.playlists, request, signal)
    case 'playlists.submit':
      if (!context.dependencies.playlistSubmission)
        throw failure('NOT_READY', 'Playlist submission is unavailable')
      return context.dependencies.playlistSubmission.submit(identity.id, request.payload)
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
