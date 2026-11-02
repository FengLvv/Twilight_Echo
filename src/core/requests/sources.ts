import { normalizeCloudSongId } from '.././ncm/cloudTransferHelpers.ts'

import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { failure } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'ncm.cloud.chooseUploadFiles',
  'ncm.cloud.upload',
  'ncm.cloud.download',
  'ncm.cloud.cancel',
  'ncm.cloud.state',
  'ncm.cloud.page',
  'cache.info',
  'cache.clear',
  'search.songs',
  'search.collections',
  'downloads.state',
  'downloads.page',
  'downloads.create',
  'downloads.cancel',
  'downloads.retry',
  'downloads.result',
  'downloads.reveal',
  'downloads.indexed',
  'downloads.play',
  'network.state',
  'network.profiles',
  'network.profiles.edit',
  'network.directory',
  'network.library',
  'network.test',
  'network.job',
  'network.removeEntry',
  'network.cover',
  'network.cacheInfo',
  'network.clearCache',
  'network.play',
  'streams.state',
  'radio.stations',
  'radio.directory',
  'radio.edit',
  'podcasts.subscriptions',
  'podcasts.episodes',
  'podcasts.subscribe',
  'podcasts.edit',
  'podcasts.refresh',
  'podcasts.defaultRate',
  'streams.play'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  const playback = context.dependencies.playback
  switch (request.name) {
    case 'ncm.cloud.chooseUploadFiles':
    case 'ncm.cloud.upload':
    case 'ncm.cloud.download':
    case 'ncm.cloud.cancel':
    case 'ncm.cloud.state':
    case 'ncm.cloud.page': {
      const transfers = context.dependencies.cloudTransfers
      if (!transfers) throw failure('FAILED', 'NCM cloud transfers unavailable')
      if (request.kind === 'command' && identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Cloud transfers require the desktop window')
      switch (request.name) {
        case 'ncm.cloud.chooseUploadFiles':
          return transfers.chooseUploadFiles(identity.id, signal)
        case 'ncm.cloud.upload':
          return transfers.upload(identity.id, request.payload.handle)
        case 'ncm.cloud.download':
          if (!identity.permissions.includes('providers:call'))
            throw failure('FORBIDDEN', 'NCM provider access is not granted')
          return transfers.download(
            identity.id,
            {
              ...request.payload,
              cloudSongId: normalizeCloudSongId(request.payload.cloudSongId)
            },
            signal
          )
        case 'ncm.cloud.cancel':
          return transfers.cancel(request.payload.id)
        case 'ncm.cloud.state':
          return transfers.state()
        case 'ncm.cloud.page':
          return transfers.page(request.payload)
      }
      break
    }
    case 'cache.info':
    case 'cache.clear': {
      const cache = context.dependencies.cache
      if (!cache) throw failure('FAILED', 'Music cache runtime unavailable')
      return request.name === 'cache.info' ? cache.info() : cache.clear(signal)
    }
    case 'search.songs':
    case 'search.collections':
      if (request.payload.scope !== 'local' && !identity.permissions.includes('providers:call'))
        throw failure('FORBIDDEN', 'Search provider access is not granted')
      if (!context.dependencies.search) throw failure('FAILED', 'Search runtime unavailable')
      return request.name === 'search.songs'
        ? context.dependencies.search.page(request.payload, signal)
        : context.dependencies.search.collections(request.payload, signal)
    case 'downloads.state':
    case 'downloads.page':
    case 'downloads.create':
    case 'downloads.cancel':
    case 'downloads.retry':
    case 'downloads.result':
    case 'downloads.reveal':
    case 'downloads.indexed':
    case 'downloads.play': {
      const downloads = context.dependencies.downloads
      if (!downloads) throw failure('FAILED', 'Download runtime unavailable')
      switch (request.name) {
        case 'downloads.indexed':
          return downloads.indexed(request.payload.id)
        case 'downloads.reveal':
          return downloads.reveal(request.payload.id)
        case 'downloads.state':
          return downloads.state()
        case 'downloads.page':
          return downloads.page(request.payload)
        case 'downloads.create':
          return downloads.create(request.payload)
        case 'downloads.cancel':
          return downloads.cancel(request.payload.id)
        case 'downloads.retry':
          return downloads.retry(request.payload.id)
        case 'downloads.result':
          if (request.payload.addToLibrary && !identity.permissions.includes('library:write'))
            throw failure('FORBIDDEN', 'Library write capability is not granted')
          return downloads.result(request.payload.id, request.payload.addToLibrary)
        case 'downloads.play': {
          if (!identity.permissions.includes('downloads:read'))
            throw failure('FORBIDDEN', 'Download access is not granted')
          return playback.fromTrack(
            () => downloads.playbackTrack(request.payload.id),
            0,
            request.payload.play !== false,
            signal
          )
        }
      }
      break
    }
    case 'network.state':
    case 'network.profiles':
    case 'network.profiles.edit':
    case 'network.directory':
    case 'network.library':
    case 'network.test':
    case 'network.job':
    case 'network.removeEntry':
    case 'network.cover':
    case 'network.cacheInfo':
    case 'network.clearCache':
    case 'network.play': {
      const network = context.dependencies.network
      if (!network) throw failure('FAILED', 'Network runtime unavailable')
      switch (request.name) {
        case 'network.state':
          return network.state()
        case 'network.profiles':
          return network.listProfiles(request.payload)
        case 'network.profiles.edit':
          return network.edit(request.payload, signal)
        case 'network.directory':
          return network.directory(request.payload, signal)
        case 'network.library':
          return network.library(request.payload)
        case 'network.test':
          return network.test(request.payload.profileId, signal)
        case 'network.job':
          return network.job(request.payload)
        case 'network.removeEntry':
          return network.removeEntry(request.payload, signal)
        case 'network.cover':
          return network.cover(request.payload.profileId, request.payload.entryId)
        case 'network.cacheInfo':
          return network.cacheInfo()
        case 'network.clearCache':
          if (context.dependencies.cache) return context.dependencies.cache.clearNetwork(signal)
          return network.clearCache((action) => playback.maintainSources(action), signal)
        case 'network.play': {
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Network library access is not granted')
          return playback.fromTrack(
            (preparation) => network.playback(request.payload, preparation),
            0,
            request.payload.play !== false,
            signal,
            () => network.assertRevision(request.payload.revision)
          )
        }
      }
      break
    }
    case 'streams.state':
    case 'radio.stations':
    case 'radio.directory':
    case 'radio.edit':
    case 'podcasts.subscriptions':
    case 'podcasts.episodes':
    case 'podcasts.subscribe':
    case 'podcasts.edit':
    case 'podcasts.refresh':
    case 'podcasts.defaultRate':
    case 'streams.play': {
      const streams = context.dependencies.streams
      if (!streams) throw failure('FAILED', 'Streams runtime unavailable')
      switch (request.name) {
        case 'streams.state':
          return streams.state()
        case 'radio.stations':
          return streams.stations(request.payload)
        case 'radio.directory':
          return streams.searchDirectory(request.payload, signal)
        case 'radio.edit':
          return streams.radioEdit(request.payload, signal)
        case 'podcasts.subscriptions':
          return streams.subscriptions(request.payload)
        case 'podcasts.episodes':
          return streams.episodes(request.payload.id, request.payload)
        case 'podcasts.subscribe':
          return streams.subscribe(request.payload.feedUrl, request.payload.revision, signal)
        case 'podcasts.edit':
          return streams.podcastEdit(request.payload, signal)
        case 'podcasts.refresh':
          streams.assertPodcastRevision(request.payload.revision)
          return streams.startRefresh(request.payload.id)
        case 'podcasts.defaultRate':
          return streams.setDefaultRate(request.payload.rate, request.payload.revision, signal)
        case 'streams.play': {
          if (!identity.permissions.includes('library:read'))
            throw failure('FORBIDDEN', 'Stream library access is not granted')
          const source = streams.playback(request.payload)
          return playback.fromTrack(
            source.track,
            source.position,
            request.payload.play !== false,
            signal,
            () => {
              streams.playback(request.payload)
            }
          )
        }
      }
      break
    }
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
