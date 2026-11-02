import { getTrackSource } from '../../shared/trackSourceIdentity.ts'

import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'exploration.query',
  'exploration.lookup',
  'exploration.detail',
  'exploration.relations',
  'exploration.participation',
  'exploration.performance.save',
  'exploration.performance.delete',
  'focus.query',
  'focus.play.status',
  'focus.facets',
  'focus.saved.list',
  'focus.saved.create',
  'focus.saved.rename',
  'focus.saved.update',
  'focus.saved.delete',
  'focus.play',
  'tags.list',
  'tags.entity',
  'tags.members',
  'tags.recordings',
  'tags.create',
  'tags.rename',
  'tags.delete',
  'tags.member.set',
  'tags.play',
  'preferences.detail',
  'preferences.targets',
  'preferences.history',
  'preferences.set',
  'ratings.detail',
  'ratings.targets',
  'ratings.history',
  'ratings.set',
  'albums.browse',
  'albums.sources',
  'catalog.playUnified',
  'genres.tree',
  'genres.browse',
  'genres.members',
  'genres.facets',
  'genres.unmapped',
  'genres.evidence',
  'genres.edit',
  'genres.map',
  'genres.override',
  'catalog.query',
  'catalog.detail',
  'catalog.sources',
  'catalog.status',
  'catalog.refresh',
  'catalog.cancel',
  'catalog.play'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  const playback = context.dependencies.playback
  switch (request.name) {
    case 'exploration.query':
    case 'exploration.lookup':
    case 'exploration.detail':
    case 'exploration.relations':
    case 'exploration.participation':
    case 'exploration.performance.save':
    case 'exploration.performance.delete': {
      const service = context.dependencies.exploration
      if (!service) throw failure('NOT_READY', '人物作品探索尚未就绪')
      switch (request.name) {
        case 'exploration.query':
          return service.query(request.payload)
        case 'exploration.lookup':
          return service.lookup(request.payload)
        case 'exploration.detail':
          return service.detail(request.payload)
        case 'exploration.relations':
          return service.relations(request.payload)
        case 'exploration.participation':
          return service.participation(request.payload)
        case 'exploration.performance.save':
          return service.performanceSave(request.payload)
        case 'exploration.performance.delete':
          return service.performanceDelete(request.payload)
      }
      break
    }
    case 'focus.query':
    case 'focus.play.status':
    case 'focus.facets':
    case 'focus.saved.list':
    case 'focus.saved.create':
    case 'focus.saved.rename':
    case 'focus.saved.update':
    case 'focus.saved.delete':
    case 'focus.play': {
      const focus = context.dependencies.focus
      if (!focus) throw failure('NOT_READY', 'Focus is unavailable')
      switch (request.name) {
        case 'focus.play.status': {
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Library access is not granted')
          return focus.playStatus(request.payload, identity.id, context.dependencies.epoch)
        }
        case 'focus.query':
          return focus.query(request.payload)
        case 'focus.facets':
          return focus.facets(request.payload)
        case 'focus.saved.list':
          return focus.savedList(request.payload)
        case 'focus.saved.create':
          return focus.savedCreate(request.payload)
        case 'focus.saved.rename':
          return focus.savedRename(request.payload)
        case 'focus.saved.update':
          return focus.savedUpdate(request.payload)
        case 'focus.saved.delete':
          return focus.savedDelete(request.payload)
        case 'focus.play': {
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Library access is not granted')
          return focus.play(
            request.payload,
            signal,
            async (track, preparation) => {
              preparation.throwIfAborted()
              if (getTrackSource(track) === 'local') return track
              if (!identity.permissions.includes('providers:call'))
                throw failure('FORBIDDEN', 'Provider access is not granted')
              const resolve = context.dependencies.resolvePlaylistInputs
              if (!resolve) throw failure('NOT_READY', 'Provider resolution is unavailable')
              const tracks = await resolve(
                [
                  {
                    kind: 'provider',
                    track: {
                      id: track.id,
                      source: getTrackSource(track),
                      ncmSongId: track.ncmSongId,
                      title: track.title,
                      artist: track.artist,
                      album: track.album,
                      duration: track.duration
                    }
                  }
                ],
                preparation
              )
              preparation.throwIfAborted()
              if (!tracks[0]) throw failure('FAILED', '来源不可用')
              return tracks[0]
            },
            { requestId: request.requestId, epoch: context.dependencies.epoch, owner: identity.id }
          )
        }
      }
      break
    }
    case 'tags.list':
    case 'tags.entity':
    case 'tags.members':
    case 'tags.recordings':
    case 'tags.create':
    case 'tags.rename':
    case 'tags.delete':
    case 'tags.member.set':
    case 'tags.play': {
      const tags = context.dependencies.tags
      if (!tags) throw failure('NOT_READY', 'Music tags are unavailable')
      switch (request.name) {
        case 'tags.list':
          return tags.list(request.payload)
        case 'tags.entity':
          return tags.entity(request.payload)
        case 'tags.members':
          return tags.members(request.payload)
        case 'tags.recordings':
          return tags.recordings(request.payload)
        case 'tags.create':
          return tags.create(request.payload)
        case 'tags.rename':
          return tags.rename(request.payload)
        case 'tags.delete':
          return tags.delete(request.payload)
        case 'tags.member.set':
          return tags.memberSet(request.payload)
        case 'tags.play': {
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Library access is not granted')
          return tags.play(request.payload, signal, async (track, preparation) => {
            preparation.throwIfAborted()
            if (getTrackSource(track) === 'local') return track
            if (!identity.permissions.includes('providers:call'))
              throw failure('FORBIDDEN', 'Provider access is not granted')
            const resolve = context.dependencies.resolvePlaylistInputs
            if (!resolve) throw failure('NOT_READY', 'Provider resolution is unavailable')
            const tracks = await resolve(
              [
                {
                  kind: 'provider',
                  track: {
                    id: track.id,
                    source: getTrackSource(track),
                    ncmSongId: track.ncmSongId,
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration: track.duration
                  }
                }
              ],
              preparation
            )
            preparation.throwIfAborted()
            if (!tracks[0]) throw failure('FAILED', '来源不可用')
            return tracks[0]
          })
        }
      }
      break
    }
    case 'preferences.detail':
    case 'preferences.targets':
    case 'preferences.history':
    case 'preferences.set': {
      const preferences = context.dependencies.preferences
      if (!preferences) throw failure('NOT_READY', 'Music preferences are unavailable')
      switch (request.name) {
        case 'preferences.detail':
          return preferences.detail(request.payload.entityId)
        case 'preferences.targets':
          return preferences.targets(request.payload)
        case 'preferences.history':
          return preferences.history(request.payload)
        case 'preferences.set':
          return preferences.set(request.payload)
      }
      break
    }
    case 'ratings.detail':
    case 'ratings.targets':
    case 'ratings.history':
    case 'ratings.set': {
      const ratings = context.dependencies.ratings
      if (!ratings) throw failure('NOT_READY', 'Music ratings are unavailable')
      switch (request.name) {
        case 'ratings.detail':
          return ratings.detail(request.payload.entityId)
        case 'ratings.targets':
          return ratings.targets(request.payload)
        case 'ratings.history':
          return ratings.history(request.payload)
        case 'ratings.set':
          return ratings.set(request.payload)
      }
      break
    }
    case 'albums.browse':
    case 'albums.sources': {
      const albums = context.dependencies.albums
      if (!albums) throw failure('NOT_READY', 'Album version browsing is unavailable')
      return request.name === 'albums.browse'
        ? albums.browse(request.payload)
        : albums.sources(request.payload)
    }
    case 'catalog.playUnified': {
      if (!identity.permissions.includes('library:read'))
        throw failure('FORBIDDEN', 'Library access is not granted')
      const unified = context.dependencies.unifiedPlayback
      if (!unified) throw failure('NOT_READY', 'Unified music playback is unavailable')
      return unified.play(request.payload, signal, async (track, preparation) => {
        preparation.throwIfAborted()
        if (getTrackSource(track) === 'local') return track
        if (!identity.permissions.includes('providers:call'))
          throw failure('FORBIDDEN', 'Provider access is not granted')
        const resolve = context.dependencies.resolvePlaylistInputs
        if (!resolve) throw failure('NOT_READY', 'Provider resolution is unavailable')
        const tracks = await resolve(
          [
            {
              kind: 'provider',
              track: {
                id: track.id,
                source: getTrackSource(track),
                ncmSongId: track.ncmSongId,
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: track.duration
              }
            }
          ],
          preparation
        )
        preparation.throwIfAborted()
        if (!tracks[0]) throw failure('FAILED', '来源不可用')
        return tracks[0]
      })
    }
    case 'genres.tree':
    case 'genres.browse':
    case 'genres.members':
    case 'genres.facets':
    case 'genres.unmapped':
    case 'genres.evidence':
    case 'genres.edit':
    case 'genres.map':
    case 'genres.override': {
      const genres = context.dependencies.genres
      if (!genres) throw failure('NOT_READY', 'Music classification is unavailable')
      switch (request.name) {
        case 'genres.tree':
          return genres.tree(request.payload)
        case 'genres.browse':
          return genres.browse(request.payload)
        case 'genres.members':
          return genres.members(request.payload)
        case 'genres.facets':
          return genres.facets(request.payload)
        case 'genres.unmapped':
          return genres.unmapped(request.payload)
        case 'genres.evidence':
          return genres.evidence(request.payload)
        case 'genres.edit':
          return genres.edit(request.payload)
        case 'genres.map':
          return genres.map(request.payload)
        case 'genres.override':
          return genres.override(request.payload)
      }
      break
    }
    case 'catalog.query':
    case 'catalog.detail':
    case 'catalog.sources':
    case 'catalog.status':
    case 'catalog.refresh':
    case 'catalog.cancel':
    case 'catalog.play': {
      const catalog = context.dependencies.catalog
      if (!catalog) throw failure('NOT_READY', 'Music catalog is unavailable')
      switch (request.name) {
        case 'catalog.query':
          return catalog.query(request.payload)
        case 'catalog.detail':
          return catalog.detail(request.payload.id, request.payload.revision)
        case 'catalog.sources':
          return catalog.sources(request.payload)
        case 'catalog.status':
          return catalog.status()
        case 'catalog.refresh':
        case 'catalog.cancel':
          if (identity.role !== 'desktop')
            throw failure('FORBIDDEN', 'Catalog maintenance requires the desktop window')
          return request.name === 'catalog.refresh' ? catalog.refresh() : catalog.cancel()
        case 'catalog.play':
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Library access is not granted')
          return playback.fromTrack(
            async (preparation) => {
              const track = await catalog.resolve(
                request.payload.sourceId,
                request.payload.revision
              )
              preparation.throwIfAborted()
              if (!track) throw failure('FAILED', '来源已不存在，请刷新音乐库')
              if (getTrackSource(track) === 'local')
                return { ...track, sourceSelection: 'explicit' }
              if (!identity.permissions.includes('providers:call'))
                throw failure('FORBIDDEN', 'Provider access is not granted')
              const resolve = context.dependencies.resolvePlaylistInputs
              if (!resolve) throw failure('NOT_READY', 'Provider resolution is unavailable')
              const tracks = await resolve(
                [
                  {
                    kind: 'provider',
                    track: {
                      id: track.id,
                      source: getTrackSource(track),
                      ncmSongId: track.ncmSongId,
                      title: track.title,
                      artist: track.artist,
                      album: track.album,
                      duration: track.duration
                    }
                  }
                ],
                preparation
              )
              if (!tracks[0]) throw failure('FAILED', '来源不可用')
              return { ...tracks[0], sourceSelection: 'explicit' }
            },
            0,
            true,
            signal
          )
      }
      break
    }
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
