import { CoreLyricsService } from '../../core/lyrics/service.ts'

import { join } from 'node:path'

import { CorePlaybackSession } from '../../core/playback/session.ts'

import { createPlaylistInputResolver } from '../../core/playlists/submission.ts'

import { CoreMusicStudyService } from '../../core/audio/musicStudyService.ts'

import { studyLyrics } from '../../core/audio/studyLyrics.ts'

import { createStudyRepository } from '../audio/studyRepository.ts'

import { SourceResources } from '../../core/playback/sourceResources.ts'

import { randomUUID } from 'node:crypto'

import { createSourceResolver } from '../../core/playback/sourceResolver.ts'

import { LibraryDatabaseServiceClient } from '../library/libraryDatabaseServiceClient.ts'

import type { CoreProcessConfiguration } from '../../shared/coreProcessProtocol.ts'

import { CorePlatformClient } from '../coreProcess/platformClient.ts'

interface StudyDomainOptions {
  config: Pick<CoreProcessConfiguration, 'root'>
  changed(): void
  platform: CorePlatformClient
  resolveQueueInput: Parameters<typeof createPlaylistInputResolver>[0]
  database: LibraryDatabaseServiceClient
  playback: CorePlaybackSession
  settings: import('../../core/persistence/settingsRepositoryContract.ts').CoreSettingsRepository
  lyrics: CoreLyricsService
  sourceResources: SourceResources
  resolver: ReturnType<typeof createSourceResolver>
}

/** One owner for analysis workers, persisted artifacts and source pins. */
export function createStudyDomain(options: StudyDomainOptions): CoreMusicStudyService {
  const {
    config,
    changed,
    platform,
    resolveQueueInput,
    database,
    playback,
    settings,
    lyrics,
    sourceResources,
    resolver
  } = options
  const studySourcePins = new Map<string, () => void>()
  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay)
    timer.unref()
    return () => clearTimeout(timer)
  }
  return new CoreMusicStudyService({
    repository: createStudyRepository(join(config.root, 'music-study')),
    newId: randomUUID,
    now: Date.now,
    changed: () => changed(),
    schedule,
    source: async (input, current, projectId) => {
      const signal = new AbortController().signal
      if (!input && !current) {
        const chosen = await platform!.call('study.chooseSource', { id: projectId! })
        if (!chosen) return null
        return { title: chosen.title, source: { path: chosen.path, identity: chosen.path } }
      }
      const track = input
        ? (await createPlaylistInputResolver(resolveQueueInput, database!)([input], signal))[0]
        : playback.studySourceTrack()
      if (!track) throw new Error('请先选择一首歌曲')
      if (track.source === 'radio') throw new Error('直播音源无法完整缓存，请选择歌曲或播客文件')
      if (track.subTrack) throw new Error('请先将 SACD 子轨导出为完整音频文件')
      const range = track.cueRange
        ? {
            start: track.cueRange.startSeconds,
            end: track.cueRange.endSeconds,
            virtualPregapSeconds: track.cueRange.virtualPregapSeconds ?? 0,
            duration:
              track.cueRange.endSeconds -
              track.cueRange.startSeconds +
              (track.cueRange.virtualPregapSeconds ?? 0)
          }
        : { duration: track.duration }
      if (!track.source || track.source === 'local') {
        return {
          title: track.title,
          source: { path: track.filePath, identity: track.id, ...range }
        }
      }
      const stableInput: import('../../shared/coreQueueSubmission.ts').CoreQueueTrackInput =
        track.source && track.source !== 'local'
          ? input?.kind === 'network' || input?.kind === 'stream'
            ? input
            : {
                kind: 'provider',
                track: {
                  id: track.id,
                  title: track.title,
                  artist: track.artist,
                  album: track.album,
                  duration: track.duration,
                  source: track.source,
                  ncmSongId: track.ncmSongId
                }
              }
          : {
              kind: 'local',
              id: track.id,
              fallback: {
                filePath: track.filePath,
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: track.duration,
                ...(track.cueRange ? { cueRange: track.cueRange } : {})
              }
            }
      return {
        title: track.title,
        source: {
          path: '',
          input: stableInput,
          identity: track.id,
          versionHint: JSON.stringify([
            track.source,
            track.duration,
            track.source === 'ncm' ? settings.read().ncmPlaybackQuality : null
          ]),
          ...range
        }
      }
    },
    environment: () => platform!.call('study.environment', {}),
    runtime: () => platform!.call('study.runtime', {}),
    runtimeActivity: (busy) => platform!.call('study.runtimeActivity', { busy }),
    audioInventory: () => platform!.call('study.audioInventory', {}),
    removeAudio: (group) => platform!.call('study.removeAudio', { id: group.id, kind: group.kind }),
    exportSources: (record, outputDirectory) =>
      platform!.call('study.exportSources', {
        id: record.id,
        outputDirectory,
        melody: record.result!.melody!,
        lyrics: record.lyrics!
      }),
    next: async () => {
      const value = playback.studyNextTrack()
      if (!value) return null
      const track = value.track
      const input: import('../../shared/coreQueueSubmission.ts').CoreQueueTrackInput =
        !track.source || track.source === 'local'
          ? {
              kind: 'local',
              id: track.id,
              fallback: {
                filePath: track.filePath,
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: track.duration,
                ...(track.cueRange ? { cueRange: track.cueRange } : {})
              }
            }
          : {
              kind: 'provider',
              track: {
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: track.duration,
                source: track.source,
                ncmSongId: track.ncmSongId
              }
            }
      return { key: value.key, input }
    },
    validate: (record, source, verifyAudio) =>
      platform!.call('study.validateCache', {
        id: record.id,
        result: record.result,
        ...(source.path ? { source: source.path } : {}),
        ...(verifyAudio ? { verifyAudio: true } : {})
      }),
    choosePack: () => platform!.call('study.choosePack', {}),
    lyrics: async (songId, input) => {
      const track = input
        ? (
            await createPlaylistInputResolver(resolveQueueInput, database!)(
              [input],
              new AbortController().signal
            )
          )[0]
        : playback.studySourceTrack()
      if (!track) throw new Error('无法解析歌词音源')
      const content = await lyrics.forTrack(track)
      return studyLyrics(content, songId, track.duration > 0 ? track.duration : undefined)
    },
    start: (record, launchSignal) =>
      sourceResources.use(async () => {
        const signal = launchSignal ?? new AbortController().signal
        let source = record.source.path
        const cached = await platform!.call('study.hasSource', { id: record.id }, signal)
        if (cached) source = ''
        else if (record.source.input && !(record.operation === 'melody' && record.notesReady)) {
          const track = (
            await createPlaylistInputResolver(resolveQueueInput, database!)(
              [record.source.input],
              signal
            )
          )[0]
          const resolved = await resolver.resolve(track, signal)
          if (!resolved) throw new Error('音源已失效，请检查登录状态并重试')
          source = await platform!.call('paths.authorizeAudio', { source: resolved.source }, signal)
        }
        signal.throwIfAborted()
        const release = sourceResources.pin([source])
        studySourcePins.set(record.id, release)
        try {
          await platform!.call('study.startWorker', {
            id: record.id,
            runId: record.workerRunId!,
            source,
            start: record.source.start,
            end: record.source.end,
            expectedDuration: record.source.duration,
            virtualPregapSeconds: record.source.virtualPregapSeconds,
            leadBacking: false,
            twoSingers: false,
            operation: record.operation,
            harmonicStems: record.harmonicStems,
            lyrics: record.lyrics,
            previous: record.result,
            budgetBytes: record.budgetBytes
          })
        } catch (error) {
          release()
          studySourcePins.delete(record.id)
          throw error
        }
      }),
    worker: async (id, revision, runId) => {
      for (;;) {
        const status = await platform!.call('study.workerStatus', { id })
        if (runId && status.runId && status.runId !== runId) throw new Error('分析运行身份已变化')
        if (
          status.resultAvailable &&
          status.resultRevision !== undefined &&
          status.resultRevision !== revision
        ) {
          const result = await platform!.call('study.workerResult', {
            id,
            runId: status.runId,
            generation: status.generation,
            resultRevision: status.resultRevision
          })
          if (!result) continue
          return { ...status, result }
        }
        return status
      }
    },
    acknowledge: async (id, status) => {
      if (status.runId && status.generation !== undefined && status.resultRevision !== undefined)
        await platform!.call('study.ackWorkerResult', {
          id,
          runId: status.runId,
          generation: status.generation,
          resultRevision: status.resultRevision,
          terminal: !status.running
        })
      if (!status.running) {
        studySourcePins.get(id)?.()
        studySourcePins.delete(id)
      }
    },
    cancel: async (id) => {
      await platform.callJoined('study.cancelWorker', { id })
    },
    removeFiles: (id) => platform!.call('study.removeFiles', { id }),
    writeMix: (id, gains, frames) => platform!.call('study.writeMix', { id, gains, frames }),
    export: (record, request) =>
      platform!.call('study.exportFiles', { ...request, chords: record.result!.chords }),
    audition: {
      begin: (source, binding) => playback.beginStudyAudition(source, binding),
      replace: (source) => playback.replaceStudyAudition(source),
      update: (gains) => playback.updateStudyMixGains(gains),
      control: (command) => playback.controlStudyAudition(command),
      state: () => playback.studyAuditionState()
    }
  })
}
