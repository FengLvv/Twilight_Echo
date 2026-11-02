import { ShutdownSequence } from '../shared/shutdownSequence.ts'
import type { OutputInfo } from '../shared/audioEngineTypes.ts'
import { isRequestCancelled } from '../shared/cancellation.ts'
import {
  CORE_PROTOCOL_VERSION,
  coreOperation,
  isCoreRequest,
  type CoreClientIdentity,
  type CoreClientMessage,
  type CoreRequestEnvelope,
  type CoreSnapshot
} from '../shared/coreProtocol.ts'
import type { CoreQueueTrackInput } from '../shared/coreQueueSubmission.ts'
import type { CoreStateApi } from '../shared/coreState.ts'
import type { CoreVisualizationEvent } from '../shared/coreVisualization.ts'
import type { LibraryDatabaseApi } from '../shared/libraryDatabase.ts'
import type { PluginNotice } from '../shared/pluginNotice.ts'
import type { CoreAnalysisService } from './audio/analysisServiceContract.ts'
import type { CoreAuditionService } from './audio/auditionService.ts'
import type { CoreAutoMixService } from './audio/autoMixServiceContract.ts'
import type { CoreAudioDiagnosticsService } from './audio/diagnosticsServiceContract.ts'
import type { CoreDspService } from './audio/dspServicePort.ts'
import type { CoreLibraryLoudnessService } from './audio/libraryLoudnessServiceContract.ts'
import type { CoreModelPackService } from './audio/modelPackServicePort.ts'
import type { CoreMusicStudyService } from './audio/musicStudyService.ts'
import type { OpraCatalog } from './audio/opraCatalogPort.ts'
import type { CoreAudioOutputService } from './audio/outputService.ts'
import type { CoreOutputTestService } from './audio/outputTestServiceContract.ts'
import type { CoreAudioRecoveryService } from './audio/recoveryService.ts'
import type { CoreVisualizationService } from './audio/visualizationService.ts'
import type { CoreBookmarksService } from './bookmarks/service.ts'
import type { CoreMusicCacheService } from './cache/service.ts'
import type { CoreCastService } from './cast/service.ts'
import type { CoreCatalogService } from './catalog/service.ts'
import type { CoreUnifiedPlaybackService } from './catalog/unifiedPlayback.ts'
import type { CoreDownloadsService } from './downloads/serviceContract.ts'
import type { CoreAlbumBrowseService } from './library/albumBrowseService.ts'
import type { CoreLibraryBackground } from './library/backgroundContract.ts'
import type { CoreDuplicatesService } from './library/duplicatesService.ts'
import type { CoreMusicExplorationService } from './library/explorationService.ts'
import type { CoreMusicFocusService } from './library/focusService.ts'
import type { CoreGenresService } from './library/genresService.ts'
import type { CoreInboxService } from './library/inboxService.ts'
import type { CoreLibraryHealthService } from './library/libraryHealthService.ts'
import type { CoreLibraryMaintenance } from './library/maintenanceService.ts'
import type { CoreMetadataService } from './library/metadataService.ts'
import type { CoreMusicPreferencesService } from './library/preferencesService.ts'
import type { CoreMusicRatingsService } from './library/ratingsService.ts'
import { executeLibraryArtwork, type CoreLibraryReadDatabase } from './library/readOperations.ts'
import type { CoreScanService } from './library/scanService.ts'
import type { CoreMusicTagsService } from './library/tagsService.ts'
import type { CoreStatisticsService } from './listening/service.ts'
import type { CoreLyricsService } from './lyrics/service.ts'
import type { CoreNcmCloudTransferService } from './ncm/cloudTransferServicePort.ts'
import type { CoreNetworkService } from './network/serviceContract.ts'
import type { CorePersonalBackupService } from './persistence/personalBackupServiceContract.ts'
import type { CorePlayerPresentationService } from './playback/presentationService.ts'
import type { CoreQueueSubmission } from './playback/queueSubmission.ts'
import type { CorePlaybackSession } from './playback/session.ts'
import type { CoreSleepTimer } from './playback/sleepService.ts'
import type { CorePlaylistImportJobs } from './playlists/importJobs.ts'
import type { CorePlaylistPreviews } from './playlists/previews.ts'
import type { CoreRecordingCatalog } from './playlists/recordingCatalog.ts'
import type { CoreRecordingVersions } from './playlists/recordingVersions.ts'
import type { CorePlaylistService } from './playlists/service.ts'
import type { CorePlaylistSourceEdits } from './playlists/sourceEdits.ts'
import type { CorePlaylistSubmission } from './playlists/submission.ts'
import type { CorePluginExperiences } from './plugins/experiencesPort.ts'
import type { TwilightPluginManager } from './plugins/managerPort.ts'
import type { CorePluginMarketplace } from './plugins/marketplaceContract.ts'
import { projectCoreError, projectCoreScan } from './projections.ts'
import type { CoreRemoteService } from './remote/service.ts'
import { dispatchCoreRequest } from './requests/router.ts'
import { failure } from './requests/support.ts'
import type { CoreMusicSearchService } from './search/service.ts'
import type { CoreSettingsBackupService } from './settings/backupService.ts'
import type { CoreSettingsService } from './settings/service.ts'
import type { CoreThemeService } from './settings/themeService.ts'
import type { CoreStreamsService } from './streams/service.ts'
import type { CoreWorkspaceService } from './workspace/service.ts'

interface Client {
  identity: CoreClientIdentity
  send(message: CoreClientMessage): void
  requests: Map<string, AbortController>
  seen: Set<string>
}
export interface CoreApplicationDependencies {
  queryContext?<T>(signal: AbortSignal, read: () => Promise<T>): Promise<T>
  comments?: Pick<
    import('./comments/service.ts').NativeCommentsService,
    'request' | 'account' | 'publish'
  >
  opra?: Pick<OpraCatalog, 'search' | 'getProfile' | 'getStatus' | 'refresh'>
  playlistSources?: CorePlaylistSourceEdits
  revealAudioFile?(path: string): Promise<void>
  remote?: Pick<
    CoreRemoteService,
    'status' | 'setEnabled' | 'rotatePin' | 'decidePairing' | 'revokeDevice' | 'shutdown'
  >
  recordingCatalog?: CoreRecordingCatalog
  catalog?: CoreCatalogService
  genres?: CoreGenresService
  ratings?: CoreMusicRatingsService
  preferences?: CoreMusicPreferencesService
  tags?: CoreMusicTagsService
  exploration?: CoreMusicExplorationService
  focus?: CoreMusicFocusService
  albums?: CoreAlbumBrowseService
  unifiedPlayback?: CoreUnifiedPlaybackService
  resolvePlaylistInputs?: (
    inputs: readonly CoreQueueTrackInput[],
    signal: AbortSignal
  ) => Promise<import('../shared/track.ts').TrackData[]>
  libraryRevision?(): number | null
  diagnostics?: CoreAudioDiagnosticsService
  audioRecovery?: CoreAudioRecoveryService
  artwork?: Parameters<typeof executeLibraryArtwork>[2]
  playlistSubmission?: CorePlaylistSubmission
  presentation?: CorePlayerPresentationService
  outputInfo?(): Promise<OutputInfo>
  queueSubmission?: CoreQueueSubmission
  themes?: CoreThemeService
  visualization?: CoreVisualizationService
  modelPack?: CoreModelPackService
  settingsBackup?: CoreSettingsBackupService
  cloudTransfers?: CoreNcmCloudTransferService
  personalBackup?: CorePersonalBackupService
  duplicates?: CoreDuplicatesService
  inbox?: CoreInboxService
  libraryHealth?: CoreLibraryHealthService
  libraryMaintenance?: CoreLibraryMaintenance
  libraryRepair?: { shutdown(): Promise<void> }
  autoMix?: CoreAutoMixService
  musicStudy?: CoreMusicStudyService
  analysis?: CoreAnalysisService
  libraryLoudness?: CoreLibraryLoudnessService
  sleepTimer?: CoreSleepTimer
  settings?: Pick<
    CoreSettingsService,
    'getRevision' | 'state' | 'edit' | 'initialize' | 'flush' | 'rememberVolume'
  >
  epoch: string
  playback: Omit<
    CorePlaybackSession,
    | 'quiesceForSleep'
    | 'stopForSleep'
    | 'resumeAfterSleep'
    | 'setSleepTimerGain'
    | 'applyBpm'
    | 'clearBpm'
    | 'studySourceTrack'
    | 'studyNextTrack'
    | 'beginStudyAudition'
    | 'replaceStudyAudition'
    | 'studyAuditionState'
    | 'controlStudyAudition'
    | 'updateStudyMixGains'
  >
  library: Pick<LibraryDatabaseApi, 'getMetadata' | 'queryTracks' | 'readLibraryQueue'> &
    CoreLibraryReadDatabase
  state: CoreStateApi
  scan: Omit<CoreScanService, 'maintain'>
  libraryBackground?: Pick<CoreLibraryBackground, 'activate' | 'snapshot' | 'shutdown'>
  metadata?: CoreMetadataService
  statistics: Omit<CoreStatisticsService, 'exportData'>
  pluginExperiences?: CorePluginExperiences
  pluginMarketplace?: CorePluginMarketplace
  plugins?: TwilightPluginManager
  playlists?: CorePlaylistService
  recordingVersions?: CoreRecordingVersions
  imports?: CorePlaylistImportJobs
  importPreviews?: CorePlaylistPreviews
  bookmarks?: CoreBookmarksService
  lyrics?: CoreLyricsService
  workspace?: CoreWorkspaceService
  streams?: CoreStreamsService
  network?: CoreNetworkService
  cache?: CoreMusicCacheService
  audition?: CoreAuditionService
  outputTest?: CoreOutputTestService
  cast?: CoreCastService
  dsp?: CoreDspService
  output?: Pick<
    CoreAudioOutputService,
    | 'getRevision'
    | 'changed'
    | 'state'
    | 'profiles'
    | 'edit'
    | 'editProfiles'
    | 'flush'
    | 'shutdown'
  >
  downloads?: CoreDownloadsService
  search?: Pick<CoreMusicSearchService, 'page' | 'collections' | 'shutdown'>
  ready(): void
}

/** Portable business endpoint; main is a capability gateway, never a second state owner. */
export class CoreApplication {
  private readonly clients = new Map<string, Client>()
  private phase: CoreSnapshot['phase'] = 'starting'
  private sequence = 0
  private pluginsRevision = 0
  private readonly pluginsChanged = () => {
    this.pluginsRevision++
    this.changed()
  }
  private readonly pluginNotice = (notice: PluginNotice) => {
    for (const client of this.clients.values()) {
      if (client.identity.permissions.includes('plugins:read'))
        client.send({ kind: 'plugin-notice', epoch: this.dependencies.epoch, notice })
    }
  }
  private readonly pluginExperienceEvent = (event: {
    pluginId: string
    event: string
    value: unknown
  }) => {
    for (const client of this.clients.values()) {
      if (client.identity.permissions.includes('extensions:execute'))
        client.send({
          kind: 'plugin-experience',
          epoch: this.dependencies.epoch,
          pluginId: event.pluginId,
          event: event.event,
          value: event.value
        })
    }
  }
  private migrationRequired = true
  private active = 0
  private initialized = false
  private readiness: Promise<void> | null = null
  private shuttingDown = false
  private readonly work = new Set<Promise<void>>()
  private readonly dependencies: CoreApplicationDependencies
  constructor(dependencies: CoreApplicationDependencies) {
    this.dependencies = dependencies
    dependencies.plugins?.on('changed', this.pluginsChanged)
    dependencies.plugins?.on('notice', this.pluginNotice)
    dependencies.plugins?.on('experience-event', this.pluginExperienceEvent)
  }
  async initialize(): Promise<void> {
    this.migrationRequired = !(await this.dependencies.state.coreStateStatus()).complete
    await this.dependencies.bookmarks?.initialize()
    await this.dependencies.lyrics?.initialize()
    await this.dependencies.workspace?.initialize()
    await this.dependencies.streams?.initialize()
    await this.dependencies.network?.initialize()
    await this.dependencies.dsp?.initialize()
    await this.dependencies.playback.initialize()
    await this.dependencies.visualization?.initialize()
    await this.dependencies.scan.initialize()
    await this.dependencies.libraryMaintenance?.initialize()
    this.initialized = true
    await this.checkReady()
  }
  private async checkReady(): Promise<void> {
    if (!this.initialized || this.migrationRequired || this.phase === 'ready') return
    return (this.readiness ??= (async () => {
      await this.dependencies.personalBackup?.initialize()
      await this.dependencies.statistics.initialize()
      if (this.shuttingDown) return
      await this.dependencies.recordingVersions?.initialize()
      await this.dependencies.inbox?.initialize()
      await this.dependencies.playlists?.initialize()
      await this.dependencies.plugins?.initialize()
      await this.dependencies.themes?.reconcile()
      await this.dependencies.settings?.initialize()
      await this.dependencies.dsp?.activate()
      this.dependencies.autoMix?.activate()
      this.dependencies.analysis?.activate()
      this.dependencies.musicStudy?.activate()
      this.dependencies.sleepTimer?.activate()
      await this.dependencies.streams?.activate()
      if (this.shuttingDown || this.phase === 'stopped') return
      this.phase = 'ready'
      this.dependencies.scan.activate()
      this.dependencies.libraryBackground?.activate()
      this.dependencies.catalog?.activate()
      this.dependencies.genres?.activate()
      this.dependencies.metadata?.activate()
      this.dependencies.lyrics?.activate()
      this.dependencies.imports?.activate()
      this.changed()
      this.dependencies.ready()
      await this.dependencies.plugins?.broadcastEvent('app:ready', {})
    })().finally(() => {
      this.readiness = null
    }))
  }
  snapshot(identity?: CoreClientIdentity): CoreSnapshot {
    const lyricPlayback = this.dependencies.playback.snapshot()
    this.dependencies.musicStudy?.bindLyrics(
      lyricPlayback.track?.id ?? '',
      lyricPlayback.queue?.occurrenceId ?? null,
      lyricPlayback.playback?.state === 'playing'
    )
    // Graph transactions advance the same catalog revision without running the
    // derived-index job, which may be paused. Publish the latest observed value.
    const catalogRevisions = [
      this.dependencies.catalog?.getRevision(),
      this.dependencies.exploration?.getCatalogRevision()
    ].filter((revision): revision is number => revision != null)
    return structuredClone({
      libraryRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.libraryRevision?.() ?? null)
          : null,
      catalogRevision:
        !identity || identity.permissions.includes('library:read')
          ? catalogRevisions.length
            ? Math.max(...catalogRevisions)
            : null
          : null,
      genresRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.genres?.getRevision() ?? null)
          : null,
      classificationMetadataRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.genres?.getMetadataRevision() ?? null)
          : null,
      ratingsRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.ratings?.getRevision() ?? null)
          : null,
      preferencesRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.preferences?.getRevision() ?? null)
          : null,
      explorationRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.exploration?.getRevision() ?? null)
          : null,
      focusRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.focus?.getRevision() ?? null)
          : null,
      focusHistoryRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.focus?.getHistoryRevision() ?? null)
          : null,
      tagsRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.tags?.getRevision() ?? null)
          : null,
      tagsLinkRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.tags?.getLinkRevision() ?? null)
          : null,
      entityMetadataRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.metadata?.entities?.getRevision() ?? null)
          : null,
      entityMetadataContentRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.metadata?.entities?.getContentRevision() ?? null)
          : null,
      metadataEnrichmentRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.metadata?.getEnrichmentRevision() ?? null)
          : null,
      pluginsRevision:
        !identity || identity.permissions.includes('plugins:read') ? this.pluginsRevision : null,
      presentationRevision:
        !identity || identity.permissions.includes('playback:read')
          ? (this.dependencies.presentation?.getRevision() ?? null)
          : null,
      modelPack:
        !identity || identity.permissions.includes('settings:read')
          ? (this.dependencies.modelPack?.state() ?? null)
          : null,
      cloudTransfers:
        !identity || identity.permissions.includes('downloads:read')
          ? (this.dependencies.cloudTransfers?.state() ?? null)
          : null,
      inbox:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.inbox?.state() ?? null)
          : null,
      libraryLoudness:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.libraryLoudness?.state() ?? null)
          : null,
      loudness:
        !identity || identity.permissions.includes('settings:read')
          ? (this.dependencies.analysis?.status() ?? null)
          : null,
      protocolVersion: CORE_PROTOCOL_VERSION,
      epoch: this.dependencies.epoch,
      sequence: this.sequence,
      phase: this.phase,
      migrationRequired: this.migrationRequired,
      audioRevision:
        !identity || identity.permissions.includes('settings:read')
          ? (this.dependencies.output?.getRevision() ?? null)
          : null,
      settingsRevision:
        !identity || identity.permissions.includes('settings:read')
          ? (this.dependencies.settings?.getRevision() ?? null)
          : null,
      personalBackupRecovery:
        !identity || identity.permissions.includes('settings:read')
          ? (this.dependencies.personalBackup?.recoveryAvailable() ?? false)
          : null,
      sleepTimer:
        !identity || identity.permissions.includes('playback:read')
          ? (this.dependencies.sleepTimer?.state() ?? null)
          : null,
      downloads:
        !identity || identity.permissions.includes('downloads:read')
          ? (this.dependencies.downloads?.state() ?? null)
          : null,
      playlistsRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.playlists?.getRevision() ?? null)
          : null,
      versionsRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.recordingVersions?.getRevision() ?? null)
          : null,
      bookmarksRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.bookmarks?.getRevision() ?? null)
          : null,
      lyricsRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.lyrics?.getRevision() ?? null)
          : null,
      lyricsContentRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.lyrics?.getContentRevision() ?? null)
          : null,
      studyRevision:
        !identity || identity.role === 'desktop'
          ? (this.dependencies.musicStudy?.getRevision() ?? null)
          : null,
      statisticsRevision:
        !identity || identity.permissions.includes('statistics:read')
          ? this.dependencies.statistics.getRevision()
          : null,
      workspaceRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.workspace?.getRevision() ?? null)
          : null,
      workspaceContentRevision:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.workspace?.getContentRevision() ?? null)
          : null,
      streams:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.streams?.state() ?? null)
          : null,
      network:
        !identity || identity.permissions.includes('library:read')
          ? (this.dependencies.network?.state() ?? null)
          : null,
      cast:
        !identity || identity.permissions.includes('playback:read')
          ? (this.dependencies.cast?.state() ?? null)
          : null,
      scan:
        !identity || identity.permissions.includes('library:read')
          ? projectCoreScan(this.dependencies.scan.snapshot())
          : null,
      ...this.dependencies.playback.snapshot(),
      ...(identity && !identity.permissions.includes('playback:read')
        ? {
            playback: null,
            track: null,
            queue: null,
            error: null,
            personalized: null,
            heart: null,
            loading: false,
            isStreamBuffering: false,
            abLoop: null,
            mute: null
          }
        : {})
    })
  }
  connect(identity: CoreClientIdentity, send: (message: CoreClientMessage) => void): void {
    if (this.clients.has(identity.id)) throw new Error('Core client already connected')
    this.clients.set(identity.id, {
      identity: structuredClone(identity),
      send,
      requests: new Map(),
      seen: new Set()
    })
    // Snapshot and subscription registration occur in one JS turn. An event
    // cannot be lost in the snapshot-to-subscription gap.
    this.sendState(this.clients.get(identity.id)!)
  }
  disconnect(clientId: string): void {
    const client = this.clients.get(clientId)
    if (!client) return
    this.clients.delete(clientId)
    void this.dependencies.visualization
      ?.disconnect(clientId)
      .catch((error) => console.error('[core.visualization]', error))
    this.dependencies.cloudTransfers?.disconnect(clientId)
    void this.dependencies.queueSubmission?.disconnect(clientId)
    void this.dependencies.playlistSubmission?.disconnect(clientId)
    for (const controller of client.requests.values())
      controller.abort(new Error('Core client disconnected'))
  }
  changed(): void {
    this.sequence++
    for (const client of this.clients.values()) this.sendState(client)
  }
  sendVisualization(clientId: string, event: CoreVisualizationEvent): void {
    const client = this.clients.get(clientId)
    if (
      event.epoch === this.dependencies.epoch &&
      client?.identity.permissions.includes('playback:read')
    )
      client.send(event)
  }
  private sendState(client: Client): void {
    if (!client.identity.permissions.includes('playback:read')) return
    client.send({
      kind: 'state',
      epoch: this.dependencies.epoch,
      sequence: this.sequence,
      snapshot: this.snapshot(client.identity)
    })
  }
  cancel(clientId: string, requestId: string, epoch: string): void {
    if (epoch === this.dependencies.epoch)
      this.clients
        .get(clientId)
        ?.requests.get(requestId)
        ?.abort(new Error('Core request cancelled'))
  }
  request(clientId: string, raw: CoreRequestEnvelope): Promise<void> {
    const work = this.handleRequest(clientId, raw)
    this.work.add(work)
    void work.then(
      () => this.work.delete(work),
      () => this.work.delete(work)
    )
    return work
  }
  private async handleRequest(clientId: string, raw: CoreRequestEnvelope): Promise<void> {
    const client = this.clients.get(clientId)
    if (!client) return
    const reply = (
      result: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
    ) => {
      if (this.clients.get(clientId) !== client) return
      client.send({
        kind: 'response',
        requestId: typeof raw?.requestId === 'string' ? raw.requestId : '',
        epoch: this.dependencies.epoch,
        ...result
      } as CoreClientMessage)
    }
    let controller: AbortController | null = null
    try {
      if (!isCoreRequest(raw))
        throw failure('INVALID_REQUEST', 'Unknown or malformed Core operation')
      if (raw.epoch !== this.dependencies.epoch)
        throw failure('STALE_EPOCH', 'Core restarted; read a fresh snapshot')
      const operation = coreOperation(raw.name)!
      if (!client.identity.permissions.includes(operation.permission))
        throw failure('FORBIDDEN', 'Core capability is not granted')
      if (client.seen.has(raw.requestId))
        throw failure(
          'OUTCOME_UNKNOWN',
          'Request was already dispatched; refresh state instead of replaying it'
        )
      if (this.active >= 128 || client.requests.size >= 16)
        throw failure('BUSY', 'Core request capacity exceeded')
      if (
        this.phase !== 'ready' &&
        !raw.name.startsWith('migration.') &&
        raw.name !== 'state.snapshot'
      )
        throw failure('NOT_READY', 'Core initialization or browser migration is incomplete')
      if (this.phase === 'stopped' || this.shuttingDown)
        throw failure('NOT_READY', 'Core is shutting down')
      controller = new AbortController()
      client.requests.set(raw.requestId, controller)
      client.seen.add(raw.requestId)
      if (client.seen.size > 1024) client.seen.delete(client.seen.values().next().value!)
      this.active++
      const signal = controller.signal
      const read = () => this.dispatch(raw, signal, client.identity)
      const value =
        raw.kind === 'query' && this.dependencies.queryContext
          ? await this.dependencies.queryContext(controller.signal, read)
          : await read()
      reply({ ok: true, value })
    } catch (error) {
      const e = error as { code?: string; message?: string }
      reply({
        ok: false,
        error: {
          code: isRequestCancelled(error) ? 'CANCELLED' : (e?.code ?? 'FAILED'),
          message: projectCoreError(error)
        }
      })
    } finally {
      if (controller) {
        client.requests.delete(raw.requestId)
        this.active--
      }
    }
  }
  private async dispatch(
    request: CoreRequestEnvelope,
    signal: AbortSignal,
    identity: CoreClientIdentity
  ): Promise<unknown> {
    const playback = this.dependencies.playback

    if (
      request.name === 'liked.play' ||
      request.name === 'heart.refill' ||
      (request.name === 'playback.mode' && request.payload.mode === 'heart')
    ) {
      if (!identity.permissions.includes('providers:call'))
        throw failure('FORBIDDEN', 'Heart provider access is not granted')
      if (request.name === 'liked.play') return playback.startLiked(request.payload, signal)
      if (request.name === 'heart.refill') return playback.refillHeart(request.payload)
    }

    if (request.name === 'personalized.start' || request.name === 'personalized.refill') {
      if (!identity.permissions.includes('providers:call'))
        throw failure('FORBIDDEN', 'Personalized provider access is not granted')
      return request.name === 'personalized.start'
        ? playback.startPersonalized(request.payload, signal)
        : playback.refillPersonalized(request.payload)
    }

    if (request.name.startsWith('playlists.')) {
      await this.dependencies.playlists?.waitForPending()
      signal.throwIfAborted()
    }
    const readMigrationRequired = () => this.migrationRequired
    const writeMigrationRequired = (value: boolean) => { this.migrationRequired = value }
    return dispatchCoreRequest(request, {
      dependencies: this.dependencies,
      signal,
      identity,
      changed: () => this.changed(),
      snapshot: (identity) => this.snapshot(identity),
      checkReady: () => this.checkReady(),
      migration: {
        get required() {
          return readMigrationRequired()
        },
        set required(value: boolean) {
          writeMigrationRequired(value)
        }
      }
    })
  }
  private shutdownSequence: ShutdownSequence | null = null
  async shutdown(): Promise<void> {
    if (this.phase === 'stopped') return
    this.shuttingDown = true
    this.shutdownSequence ??= new ShutdownSequence([
      {
        name: 'catalog:0',
        close: async () => {
          await this.dependencies.catalog?.shutdown()
        }
      },
      {
        name: 'genres:1',
        close: async () => {
          await this.dependencies.genres?.shutdown()
        }
      },
      {
        name: 'remote:2',
        close: async () => {
          await this.dependencies.remote?.shutdown()
        }
      },
      {
        name: 'plugins:3',
        close: async () => {
          this.dependencies.plugins?.off('changed', this.pluginsChanged)
        }
      },
      {
        name: 'plugins:4',
        close: async () => {
          this.dependencies.plugins?.off('notice', this.pluginNotice)
        }
      },
      {
        name: 'plugins:5',
        close: async () => {
          this.dependencies.plugins?.off('experience-event', this.pluginExperienceEvent)
        }
      },
      {
        name: 'queueSubmission:6',
        close: async () => {
          await this.dependencies.queueSubmission?.shutdown()
        }
      },
      {
        name: 'playlistSubmission:7',
        close: async () => {
          await this.dependencies.playlistSubmission?.shutdown()
        }
      },
      {
        name: 'presentation:8',
        close: async () => {
          await this.dependencies.presentation?.shutdown()
        }
      },
      {
        name: 'requests:9',
        close: async () => {
          for (const client of this.clients.values())
            for (const controller of client.requests.values())
              controller.abort(new Error('Core shutting down'))
        }
      },
      {
        name: 'audioRecovery:10',
        close: async () => {
          await this.dependencies.audioRecovery?.shutdown()
        }
      },
      {
        name: 'audition:11',
        close: async () => {
          await this.dependencies.audition?.shutdown()
        }
      },
      {
        name: 'visualization:12',
        close: async () => {
          await this.dependencies.visualization?.shutdown()
        }
      },
      {
        name: 'outputTest:13',
        close: async () => {
          await this.dependencies.outputTest?.stop()
        }
      },
      {
        name: 'sleepTimer:14',
        close: async () => {
          await this.dependencies.sleepTimer?.shutdown()
        }
      },
      {
        name: 'autoMix:15',
        close: async () => {
          await this.dependencies.autoMix?.shutdown()
        }
      },
      {
        name: 'musicStudy:16',
        close: async () => {
          await this.dependencies.musicStudy?.shutdown()
        }
      },
      {
        name: 'modelPack:17',
        close: async () => {
          await this.dependencies.modelPack?.shutdown()
        }
      },
      {
        name: 'analysis:18',
        close: async () => {
          await this.dependencies.analysis?.shutdown()
        }
      },
      {
        name: 'libraryLoudness:19',
        close: async () => {
          await this.dependencies.libraryLoudness?.shutdown()
        }
      },
      {
        name: 'downloads:20',
        close: async () => {
          await this.dependencies.downloads?.shutdown()
        }
      },
      {
        name: 'cloudTransfers:21',
        close: async () => {
          await this.dependencies.cloudTransfers?.shutdown()
        }
      },
      {
        name: 'libraryRepair:22',
        close: async () => {
          await this.dependencies.libraryRepair?.shutdown()
        }
      },
      {
        name: 'duplicates:23',
        close: async () => {
          await this.dependencies.duplicates?.shutdown()
        }
      },
      {
        name: 'inbox:24',
        close: async () => {
          await this.dependencies.inbox?.shutdown()
        }
      },
      {
        name: 'libraryHealth:25',
        close: async () => {
          await this.dependencies.libraryHealth?.shutdown()
        }
      },
      {
        name: 'personalBackup:26',
        close: async () => {
          await this.dependencies.personalBackup?.shutdown()
        }
      },
      {
        name: 'settingsBackup:27',
        close: async () => {
          await this.dependencies.settingsBackup?.shutdown()
        }
      },
      {
        name: 'pluginExperiences:28',
        close: async () => {
          await this.dependencies.pluginExperiences?.shutdown()
        }
      },
      {
        name: 'themes:29',
        close: async () => {
          await this.dependencies.themes?.shutdown()
        }
      },
      {
        name: 'libraryMaintenance:30',
        close: async () => {
          await this.dependencies.libraryMaintenance?.shutdown()
        }
      },
      {
        name: 'search:31',
        close: async () => {
          await Promise.all([
            this.dependencies.search?.shutdown(),
            Promise.allSettled([...this.work, ...(this.readiness ? [this.readiness] : [])]),
            this.dependencies.scan.shutdown(),
            this.dependencies.libraryBackground?.shutdown(),
            this.dependencies.metadata?.shutdown(),
            this.dependencies.lyrics?.shutdown(),
            this.dependencies.streams?.stopRefresh(),
            this.dependencies.network?.shutdown()
          ])
        }
      },
      {
        name: 'plugins:32',
        close: async () => {
          await this.dependencies.plugins?.broadcastEvent('app:before-quit', {})
        }
      },
      {
        name: 'settings:33',
        close: async () => {
          await this.dependencies.settings?.flush()
        }
      },
      {
        name: 'importPreviews:34',
        close: async () => {
          await this.dependencies.importPreviews?.shutdown()
        }
      },
      {
        name: 'imports:35',
        close: async () => {
          await this.dependencies.imports?.shutdown()
        }
      },
      {
        name: 'plugins:36',
        close: async () => {
          await this.dependencies.plugins?.destroy()
        }
      },
      {
        name: 'playlists:37',
        close: async () => {
          await this.dependencies.playlists?.shutdown()
        }
      },
      {
        name: 'recordingVersions:38',
        close: async () => {
          await this.dependencies.recordingVersions?.flush()
        }
      },
      {
        name: 'dsp:39',
        close: async () => {
          await this.dependencies.dsp?.shutdown()
        }
      },
      {
        name: 'output:40',
        close: async () => {
          await this.dependencies.output?.shutdown()
        }
      },
      {
        name: 'playback:41',
        close: async () => {
          await this.dependencies.playback.shutdown()
        }
      },
      {
        name: 'diagnostics:42',
        close: async () => {
          await this.dependencies.diagnostics?.shutdown()
        }
      },
      {
        name: 'streams:43',
        close: async () => {
          await this.dependencies.streams?.shutdown()
        }
      },
      {
        name: 'workspace:44',
        close: async () => {
          await this.dependencies.workspace?.shutdown()
        }
      },
      {
        name: 'bookmarks:45',
        close: async () => {
          await this.dependencies.bookmarks?.shutdown()
        }
      },
      {
        name: 'statistics:46',
        close: async () => {
          await this.dependencies.statistics.shutdown()
        }
      }
    ])
    await this.shutdownSequence.close()
    this.phase = 'stopped'
    this.shuttingDown = false
    this.changed()
  }
}
