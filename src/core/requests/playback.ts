import { projectCoreOutput } from '.././audio/outputProjection.ts'

import { type CoreRequestEnvelope } from '../../shared/coreProtocol.ts'

import { projectCoreTrack } from '.././projections.ts'

import { failure, nonnegative, nonnegativeOptional } from './support.ts'
import type { CoreDispatchContext } from './types.ts'

export const operations = [
  'opra.search',
  'opra.profile',
  'opra.status',
  'opra.refresh',
  'player.presentation',
  'player.lyrics',
  'playback.diagnostics',
  'playback.favorite',
  'playback.control',
  'queue.locate',
  'queue.insert',
  'visualization.subscribe',
  'visualization.unsubscribe',
  'sleep.state',
  'sleep.configure',
  'sleep.cancel',
  'cast.state',
  'cast.devices',
  'cast.discover',
  'cast.start',
  'cast.end',
  'remote.status',
  'remote.setEnabled',
  'remote.decidePairing',
  'remote.revokeDevice',
  'remote.rotatePin',
  'playback.rate',
  'queue.page',
  'playback.play',
  'playback.pause',
  'playback.stop',
  'playback.seek',
  'playback.abLoop',
  'playback.mute',
  'playback.next',
  'playback.previous',
  'playback.volume',
  'playback.mode',
  'queue.select',
  'queue.submit',
  'queue.fromQuery',
  'queue.edit',
  'queue.undo',
  'queue.refresh'
] as const
type Request = Extract<CoreRequestEnvelope, { name: (typeof operations)[number] }>
export async function handle(request: Request, context: CoreDispatchContext): Promise<unknown> {
  const { signal, identity } = context
  const playback = context.dependencies.playback
  switch (request.name) {
    case 'opra.search':
    case 'opra.profile':
    case 'opra.status':
    case 'opra.refresh': {
      const opra = context.dependencies.opra
      if (!opra) throw failure('NOT_READY', 'OPRA catalog is unavailable')
      switch (request.name) {
        case 'opra.search':
          return opra.search(request.payload.query.trim())
        case 'opra.profile':
          return opra.getProfile(request.payload.id.trim())
        case 'opra.status':
          return opra.getStatus()
        case 'opra.refresh':
          return opra.refresh()
      }
      break
    }
    case 'player.presentation':
      if (!context.dependencies.presentation)
        throw failure('NOT_READY', 'Player presentation is unavailable')
      return context.dependencies.presentation.snapshot()
    case 'player.lyrics': {
      if (!context.dependencies.lyrics) throw failure('NOT_READY', 'Lyrics are unavailable')
      const content = context.dependencies.lyrics.content()
      return {
        state: context.dependencies.lyrics.state(),
        content,
        analysis:
          context.dependencies.musicStudy && content.current
            ? await context.dependencies.musicStudy.lyricsProjection(content.current.trackId)
            : undefined
      }
    }
    case 'playback.diagnostics':
      if (!context.dependencies.outputInfo)
        throw failure('NOT_READY', 'Output diagnostics are unavailable')
      return projectCoreOutput(await context.dependencies.outputInfo())
    case 'playback.favorite':
      if (!context.dependencies.presentation)
        throw failure('NOT_READY', 'Player presentation is unavailable')
      return context.dependencies.presentation.toggleFavorite(request.payload, signal)
    case 'playback.control':
      if (request.payload.type === 'toggle-favorite') {
        const expected = context.dependencies.presentation?.snapshot().current
        if (!expected) throw failure('NOT_READY', 'There is no selected track')
        return context.dependencies.presentation!.toggleFavorite(expected, signal)
      }
      return playback.control(request.payload, signal)
    case 'queue.locate': {
      const page = await context.dependencies.library.readLibraryQueue(request.payload.id, 0, 1, {
        expectedRevision: request.payload.revision,
        occurrenceId: request.payload.occurrenceId
      })
      return { position: page.items[0]?.position ?? null }
    }
    case 'queue.insert':
      if (!context.dependencies.queueSubmission)
        throw failure('NOT_READY', 'Queue submission is unavailable')
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Queue insertion requires the desktop window')
      return context.dependencies.queueSubmission.insert(request.payload, signal)
    case 'visualization.subscribe':
    case 'visualization.unsubscribe': {
      const visualization = context.dependencies.visualization
      if (!visualization) throw failure('FAILED', 'Visualization unavailable')
      return request.name === 'visualization.subscribe'
        ? visualization.subscribe(identity.id, request.payload)
        : visualization.unsubscribe(identity.id, request.payload.subscriptionId)
    }
    case 'sleep.state':
    case 'sleep.configure':
    case 'sleep.cancel': {
      const timer = context.dependencies.sleepTimer
      if (!timer) throw failure('FAILED', 'Sleep timer unavailable')
      if (request.name === 'sleep.state') return timer.state()
      if (request.name === 'sleep.configure') return timer.configure(request.payload, signal)
      return timer.cancel(request.payload.revision, signal)
    }
    case 'cast.state':
    case 'cast.devices':
    case 'cast.discover':
    case 'cast.start':
    case 'cast.end': {
      const cast = context.dependencies.cast
      if (!cast) throw failure('FAILED', 'Cast runtime unavailable')
      if (request.name === 'cast.state') return cast.state()
      if (request.name === 'cast.devices')
        return cast.page(request.payload.offset, request.payload.limit)
      if (request.name === 'cast.discover') return cast.discover()
      if (request.name === 'cast.start') return playback.startCast(request.payload, signal)
      return playback.endCast(request.payload.revision)
    }
    case 'remote.status':
    case 'remote.setEnabled':
    case 'remote.decidePairing':
    case 'remote.revokeDevice':
    case 'remote.rotatePin': {
      const remote = context.dependencies.remote
      if (!remote) throw failure('NOT_READY', 'Remote control is unavailable')
      if (request.name === 'remote.status') return remote.status()
      if (request.name === 'remote.setEnabled') return remote.setEnabled(request.payload.enabled)
      if (request.name === 'remote.decidePairing')
        return remote.decidePairing(request.payload.requestId, request.payload.allow)
      if (request.name === 'remote.revokeDevice') return remote.revokeDevice(request.payload.id)
      return remote.rotatePin()
    }
    case 'playback.rate': {
      const podcast = playback.snapshot().track?.source === 'podcast'
      await playback.setRate(request.payload.rate)
      const streams = context.dependencies.streams
      if (podcast && streams)
        await streams.setDefaultRate(
          request.payload.rate,
          streams.state().preferencesRevision,
          signal
        )
      return
    }
    case 'queue.page': {
      const { id, revision, offset, limit, search } = request.payload
      const page = await context.dependencies.library.readLibraryQueue(id, offset, limit, {
        expectedRevision: revision,
        search
      })
      return {
        ...page,
        items: page.items.map((item) => ({
          position: item.position,
          queueEntryId: item.queueEntryId,
          logicalQueueEnd: item.logicalQueueEnd,
          track: item.track ? projectCoreTrack(item.track, item.queueEntryId) : null
        }))
      }
    }
    case 'playback.play':
      return playback.play(nonnegativeOptional(request.payload.position), signal)
    case 'playback.pause':
      return playback.pause()
    case 'playback.stop':
      return playback.stop()
    case 'playback.seek':
      return playback.seek(nonnegative(request.payload.position))
    case 'playback.abLoop':
      return playback.configureAbLoop(request.payload)
    case 'playback.mute':
      return playback.configureMute(request.payload.muted)
    case 'playback.next':
      return playback.navigate(1, signal)
    case 'playback.previous':
      return playback.navigate(-1, signal)
    case 'playback.volume': {
      const volume = nonnegative(request.payload.volume)
      if (volume > 1) throw failure('INVALID_REQUEST', 'Volume exceeds unity')
      await playback.setVolume(volume)
      const actual = playback.snapshot().playback
      if (actual && actual.outputBackend !== 'cast')
        context.dependencies.settings?.rememberVolume(actual.volume)
      return
    }
    case 'playback.mode':
      if (!['sequential', 'listLoop', 'repeat', 'shuffle', 'heart'].includes(request.payload.mode))
        throw failure('INVALID_REQUEST', 'Unknown playback mode')
      return playback.setMode(request.payload.mode, signal)
    case 'queue.select':
      return playback.select(request.payload, signal)
    case 'queue.submit':
      if (!context.dependencies.queueSubmission)
        throw failure('NOT_READY', 'Queue submission is unavailable')
      if (identity.role !== 'desktop')
        throw failure('FORBIDDEN', 'Queue submission requires the desktop window')
      return context.dependencies.queueSubmission.submit(identity.id, request.payload)
    case 'queue.fromQuery':
      return playback.fromQuery(
        request.payload.query,
        request.payload.selectedId,
        request.payload.play,
        signal,
        {
          position: request.payload.position,
          randomStart: request.payload.randomStart,
          playMode: request.payload.playMode
        }
      )
    case 'queue.edit':
      return playback.edit(request.payload.id, request.payload.revision, request.payload.edit)
    case 'queue.undo':
      return playback.edit(request.payload.id, request.payload.revision, { kind: 'undo' })
    case 'queue.refresh':
      return playback.refresh()
  }
  throw failure('FAILED', 'Unsupported Core operation')
}
