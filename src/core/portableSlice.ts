import { CoreApplication } from './application.ts'
import { CoreBookmarksService } from './bookmarks/service.ts'
import { CoreLyricsService } from './lyrics/service.ts'
import { CorePlayerPresentationService } from './playback/presentationService.ts'
import {
  CorePlaybackSession,
  type CorePlaybackEngine,
  type CoreSessionRepository
} from './playback/session.ts'
import { CoreQueueSubmission } from './playback/queueSubmission.ts'
import { CoreRecordingVersions } from './playlists/recordingVersions.ts'
import { CorePlaylistService } from './playlists/service.ts'
import {
  CorePlaylistSubmission,
  createPlaylistInputResolver
} from './playlists/submission.ts'
import { CoreMusicSearchService } from './search/service.ts'
import { CoreSettingsService } from './settings/service.ts'
import {
  createDefaultSettings,
  normalizeAppSettings,
  type SettingsEnvironment
} from './settings/normalization.ts'
import type { AppSettings } from '../shared/appSettings.ts'
import {
  CORE_PROTOCOL_VERSION,
  type CoreClientIdentity,
  type CoreClientMessage,
  type CoreRequestEnvelope,
  type CoreSnapshot
} from '../shared/coreProtocol.ts'
import { emptyCoreStateCounts, type CoreStateApi } from '../shared/coreState.ts'
import type {
  AudioEnginePlayResult,
  AudioEngineQueueItem,
  CorePlatformId,
  PlaybackInfo,
  PlayMode
} from '../shared/audioEngineTypes.ts'
import {
  LIBRARY_PAGE_SIZE,
  libraryQueueResumeMode,
  type LibraryCollectionKind,
  type LibraryCollectionPage,
  type LibraryCollectionSummary,
  type LibraryMetadata,
  type LibraryPage,
  type LibraryPlaylistViewSync,
  type LibraryPlaylistViewSyncResult,
  type LibraryQuery,
  type LibraryQueueEdit,
  type LibraryQueueEditResult,
  type LibraryQueuePage,
  type LibraryQueuePlayMode,
  type LibraryQueueReadOptions,
  type LibraryQueueSnapshot,
  type LibraryTrackRecord
} from '../shared/libraryDatabase.ts'
import type {
  LibraryQueueBuildCommand,
  LibraryQueueBuildReply,
  LibraryQueueSeedItem
} from '../shared/libraryQueueBuild.ts'
import {
  DEFAULT_LYRICS_MANAGEMENT,
  cloneLyricsManagementDocument,
  type LyricsManagementDocument,
  type OnlineLyricsQuery,
  type OnlineLyricsSearchResult
} from '../shared/lyricsManagement.ts'
import {
  DEFAULT_PLAYBACK_BOOKMARKS,
  clonePlaybackBookmarksDocument,
  type PlaybackBookmarksDocument
} from '../shared/playbackBookmarks.ts'
import type { PlaybackSessionData } from '../shared/playbackSession.ts'
import type { Playlist } from '../shared/playlists.ts'
import type { TrackData } from '../shared/track.ts'
import type {
  NativeQueueCommit,
  NativeQueueRebind,
  NativeQueueSelection
} from '../shared/nativeQueue.ts'

export interface CoreCancelEnvelope {
  kind: 'cancel'
  requestId: string
  epoch: string
}

const PORTABLE_HOST_PERMISSIONS: CoreClientIdentity['permissions'] = [
  'playback:read',
  'playback:write',
  'library:read',
  'library:write',
  'settings:read',
  'settings:write',
  'migration:write',
  'statistics:read',
  'statistics:write',
  'plugins:read',
  'plugins:manage',
  'plugins:resources',
  'providers:call',
  'extensions:execute',
  'downloads:read',
  'downloads:write'
]

// ============================================================================
// 1. Embedded JS Runtime Minimal Environment Shims (QuickJS / JSC / Bare VM)
// ============================================================================

let fallbackUuidCounter = 0

function generateFallbackUuid(): `${string}-${string}-${string}-${string}-${string}` {
  fallbackUuidCounter = (fallbackUuidCounter + 1) >>> 0
  const randHex = (len: number) => {
    let out = ''
    for (let i = 0; i < len; i++) {
      out += Math.floor(Math.random() * 16).toString(16)
    }
    return out
  }
  const prefix = (Date.now() & 0xffffffff).toString(16).padStart(8, '0')
  const seq = (fallbackUuidCounter & 0xffff).toString(16).padStart(4, '0')
  return `${prefix}-${seq}-4${randHex(3)}-8${randHex(3)}-${randHex(12)}`
}

export function ensurePortableRuntimeGlobals(): void {
  const g = globalThis as Record<string, any>

  if (!g.crypto || typeof g.crypto.randomUUID !== 'function') {
    const existingCrypto = g.crypto && typeof g.crypto === 'object' ? g.crypto : {}
    try {
      existingCrypto.randomUUID = generateFallbackUuid
      g.crypto = existingCrypto
    } catch {
      // Ignore if globalThis.crypto is read-only
    }
  }

  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = function portableStructuredClone<T>(value: T): T {
      if (value === undefined || value === null || typeof value !== 'object') return value
      if (value instanceof Date) return new Date(value.getTime()) as unknown as T
      if (value instanceof Uint8Array) return new Uint8Array(value) as unknown as T
      if (Array.isArray(value)) return value.map((item) => portableStructuredClone(item)) as unknown as T
      if (value instanceof Map) {
        const out = new Map()
        for (const [k, v] of value.entries()) out.set(portableStructuredClone(k), portableStructuredClone(v))
        return out as unknown as T
      }
      if (value instanceof Set) {
        const out = new Set()
        for (const v of value.values()) out.add(portableStructuredClone(v))
        return out as unknown as T
      }
      const copy: Record<string, unknown> = {}
      for (const key of Object.keys(value as Record<string, unknown>)) {
        copy[key] = portableStructuredClone((value as Record<string, unknown>)[key])
      }
      return copy as T
    }
  }

  if (typeof g.AbortController !== 'function') {
    class PortableAbortSignal {
      aborted = false
      reason: unknown = undefined
      private readonly listeners = new Set<() => void>()
      addEventListener(_type: string, listener: () => void): void {
        if (this.aborted) {
          listener()
          return
        }
        this.listeners.add(listener)
      }
      removeEventListener(_type: string, listener: () => void): void {
        this.listeners.delete(listener)
      }
      throwIfAborted(): void {
        if (this.aborted) {
          throw this.reason ?? new Error('The operation was aborted')
        }
      }
      _trigger(reason?: unknown): void {
        if (this.aborted) return
        this.aborted = true
        this.reason = reason ?? new Error('The operation was aborted')
        for (const listener of [...this.listeners]) {
          try {
            listener()
          } catch {
            // Ignore listener errors
          }
        }
        this.listeners.clear()
      }
      static abort(reason?: unknown): PortableAbortSignal {
        const sig = new PortableAbortSignal()
        sig._trigger(reason)
        return sig
      }
      static any(signals: Iterable<PortableAbortSignal>): PortableAbortSignal {
        const composite = new PortableAbortSignal()
        for (const sig of signals) {
          if (!sig) continue
          if (sig.aborted) {
            composite._trigger(sig.reason)
            return composite
          }
          sig.addEventListener('abort', () => {
            composite._trigger(sig.reason)
          })
        }
        return composite
      }
    }
    class PortableAbortController {
      readonly signal = new PortableAbortSignal()
      abort(reason?: unknown): void {
        this.signal._trigger(reason)
      }
    }
    g.AbortSignal = PortableAbortSignal
    g.AbortController = PortableAbortController
  }

  if (typeof g.TextEncoder !== 'function') {
    class PortableTextEncoder {
      readonly encoding = 'utf-8'
      encode(input = ''): Uint8Array {
        const str = String(input)
        const bytes: number[] = []
        for (let i = 0; i < str.length; i++) {
          let codePoint = str.charCodeAt(i)
          if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < str.length) {
            const next = str.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
              codePoint = ((codePoint - 0xd800) << 10) + (next - 0xdc00) + 0x10000
              i++
            }
          }
          if (codePoint <= 0x7f) {
            bytes.push(codePoint)
          } else if (codePoint <= 0x7ff) {
            bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
          } else if (codePoint <= 0xffff) {
            bytes.push(
              0xe0 | (codePoint >> 12),
              0x80 | ((codePoint >> 6) & 0x3f),
              0x80 | (codePoint & 0x3f)
            )
          } else {
            bytes.push(
              0xf0 | (codePoint >> 18),
              0x80 | ((codePoint >> 12) & 0x3f),
              0x80 | ((codePoint >> 6) & 0x3f),
              0x80 | (codePoint & 0x3f)
            )
          }
        }
        return new Uint8Array(bytes)
      }
    }
    g.TextEncoder = PortableTextEncoder
  }

  if (typeof g.TextDecoder !== 'function') {
    class PortableTextDecoder {
      readonly encoding = 'utf-8'
      decode(input?: ArrayBuffer | ArrayBufferView): string {
        if (!input) return ''
        const bytes =
          input instanceof Uint8Array
            ? input
            : ArrayBuffer.isView(input)
              ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
              : new Uint8Array(input)
        let out = ''
        for (let i = 0; i < bytes.length; i++) {
          out += String.fromCharCode(bytes[i]!)
        }
        try {
          return decodeURIComponent(escape(out))
        } catch {
          return out
        }
      }
    }
    g.TextDecoder = PortableTextDecoder
  }

  if (typeof g.Intl !== 'object' || g.Intl === null) {
    g.Intl = {}
  }
  if (typeof g.Intl.Collator !== 'function') {
    class PortableCollator {
      private readonly locale: string
      private readonly options: Record<string, unknown>
      readonly compare: (a: string, b: string) => number
      constructor(locales?: string | string[], options?: Record<string, unknown>) {
        this.locale = Array.isArray(locales) ? String(locales[0] ?? 'en') : String(locales ?? 'en')
        this.options = options ?? {}
        this.compare = (a: string, b: string): number => {
          const sa = String(a ?? '')
          const sb = String(b ?? '')
          if (sa === sb) return 0
          return sa < sb ? -1 : 1
        }
      }
      resolvedOptions() {
        return { locale: this.locale, ...this.options }
      }
    }
    g.Intl.Collator = PortableCollator
  }

  if (typeof g.URL !== 'function') {
    class PortableURL {
      href: string
      protocol: string
      username = ''
      password = ''
      host: string
      hostname: string
      port: string
      pathname: string
      search: string
      hash: string
      constructor(url: string) {
        const raw = String(url ?? '').trim()
        const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^/:?#]+)(?::([0-9]+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(
          raw
        )
        if (!match) {
          throw new TypeError(`Invalid URL: ${raw}`)
        }
        this.href = raw
        this.protocol = match[1]!.toLowerCase()
        this.username = match[2] ?? ''
        this.password = match[3] ?? ''
        this.hostname = match[4]!
        this.port = match[5] ?? ''
        this.host = this.port ? `${this.hostname}:${this.port}` : this.hostname
        this.pathname = match[6] || '/'
        this.search = match[7] ?? ''
        this.hash = match[8] ?? ''
      }
      toString(): string {
        return this.href
      }
    }
    g.URL = PortableURL
  }

  if (typeof g.console !== 'object' || g.console === null) {
    const noop = () => {}
    g.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop }
  }
}

ensurePortableRuntimeGlobals()

// ============================================================================
// 2. Capability Port Contracts (Section 8.1 of Architecture & Migration Plan)
// ============================================================================

export type PortableResourceId = string
export type PortableUnsubscribe = () => void

export interface PortableCancelHandle {
  cancel(): void
}

export interface PortableClockPort {
  nowUnixMs(): number
  nowMonotonicMs(): number
}

export interface PortableSchedulerPort {
  schedule(delayMs: number, task: () => void): PortableCancelHandle
}

export interface PortableStoredSession {
  revision: string
  payloadJson: string
}

export type PortableSaveSessionResult =
  | { ok: true; revision: string }
  | { ok: false; reason: 'conflict' }

export interface PortableSessionStorePort {
  load(): Promise<PortableStoredSession | null>
  save(
    payloadJson: string,
    expectedRevision: string | null
  ): Promise<PortableSaveSessionResult>
}

export type PortableAudioNativeEvent =
  | { type: 'playback-info'; info: PlaybackInfo }
  | { type: 'end-file'; reason?: string }
  | { type: 'error'; message: string; code?: string; recoverable?: boolean }
  | { type: 'crashed'; reason?: string }

export interface PortableAudioEnginePort {
  start?(): Promise<void>
  loadQueue(items: AudioEngineQueueItem[], startIndex?: number): Promise<void>
  play(
    source: PortableResourceId,
    positionSeconds?: number
  ): Promise<AudioEnginePlayResult>
  pause(): Promise<void>
  stop(): Promise<void>
  seek(positionSeconds: number): Promise<void>
  setVolume(volume: number): Promise<void>
  setPlaybackRate(rate: number): Promise<void>
  setPlayMode(mode: PlayMode): Promise<void>
  selectQueueIndex?(index: number): Promise<boolean>
  next?(): Promise<boolean>
  previous?(): Promise<boolean>
  setDspConfig?(config: CoreEqConfigView): Promise<void> | void
  getSnapshot(): Promise<PlaybackInfo>
  subscribe(listener: (event: PortableAudioNativeEvent) => void): PortableUnsubscribe
}

export interface CorePlaylistView {
  id: string
  name: string
  trackIds: string[]
  trackCount: number
  updatedAtMs: number
}

export interface CoreAlbumCollectionView {
  id: string
  title: string
  name: string
  artist: string
  trackCount: number
  totalDurationSec: number
  trackIds: string[]
}

export interface CoreArtistCollectionView {
  id: string
  name: string
  albumCount: number
  trackCount: number
  trackIds: string[]
}

export interface CoreLibraryCollectionsView {
  albums: CoreAlbumCollectionView[]
  artists: CoreArtistCollectionView[]
}

export interface CoreEqConfigView {
  enabled: boolean
  preset: string
  preampDb: number
  bandsDb: number[]
  bitPerfect: boolean
  gapless: boolean
}

export const PORTABLE_EQ_PRESETS: Record<string, readonly number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost': [5.5, 4.5, 3.0, 1.0, 0, 0, 0, 0, 0, 0],
  Rock: [4.0, 3.0, 1.5, -1.0, -1.5, 0, 2.0, 3.5, 4.0, 4.0],
  Vocal: [-1.5, -1.0, 0, 2.0, 4.0, 4.0, 2.5, 1.0, 0, -0.5],
  Electronic: [4.5, 4.0, 1.5, 0, -1.5, 1.0, 0.5, 2.0, 4.0, 4.5],
  Classical: [3.5, 2.5, 1.5, 1.0, -0.5, -0.5, 0, 1.5, 2.5, 3.0]
}

export function createDefaultEqConfig(): CoreEqConfigView {
  return {
    enabled: false,
    preset: 'Flat',
    preampDb: 0,
    bandsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    bitPerfect: false,
    gapless: true
  }
}

export function applyEqConfigPatch(
  current: CoreEqConfigView,
  patch: Partial<CoreEqConfigView> | null | undefined
): CoreEqConfigView {
  if (!patch || typeof patch !== 'object') {
    return structuredClone(current)
  }
  const clampDb = (val: number) => Math.max(-12, Math.min(12, Number(val) || 0))
  const nextPreset = typeof patch.preset === 'string' && patch.preset.trim().length > 0
    ? patch.preset.trim()
    : current.preset
  let nextBands = [...current.bandsDb]
  if (Array.isArray(patch.bandsDb) && patch.bandsDb.length > 0) {
    nextBands = Array.from({ length: 10 }, (_, idx) => clampDb(Number(patch.bandsDb![idx] ?? 0)))
  } else if (typeof patch.preset === 'string' && PORTABLE_EQ_PRESETS[nextPreset]) {
    nextBands = [...PORTABLE_EQ_PRESETS[nextPreset]!]
  }
  return {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    preset: nextPreset,
    preampDb: typeof patch.preampDb === 'number' ? clampDb(patch.preampDb) : current.preampDb,
    bandsDb: nextBands,
    bitPerfect: typeof patch.bitPerfect === 'boolean' ? patch.bitPerfect : current.bitPerfect,
    gapless: typeof patch.gapless === 'boolean' ? patch.gapless : current.gapless
  }
}

export function aggregateLibraryCollections(
  tracks: ReadonlyArray<{
    id: string
    title?: string
    artist?: string
    album?: string
    duration?: number
    durationSec?: number
  }>
): CoreLibraryCollectionsView {
  const albumMap = new Map<
    string,
    {
      id: string
      title: string
      name: string
      artist: string
      trackCount: number
      totalDurationSec: number
      trackIds: string[]
    }
  >()
  const artistMap = new Map<
    string,
    {
      id: string
      name: string
      albums: Set<string>
      trackCount: number
      trackIds: string[]
    }
  >()

  const slugify = (text: string, fallbackPrefix: string, index: number) => {
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    return slug ? `${fallbackPrefix}-${slug}` : `${fallbackPrefix}-${index}`
  }

  let idx = 0
  for (const track of tracks) {
    idx += 1
    const albumTitle = String(track.album || 'Unknown Album').trim() || 'Unknown Album'
    const artistName = String(track.artist || 'Unknown Artist').trim() || 'Unknown Artist'
    const durationSec =
      typeof track.durationSec === 'number'
        ? Math.round(track.durationSec)
        : Math.round(Number(track.duration) || 0)

    const albumKey = albumTitle.toLowerCase()
    const existingAlbum = albumMap.get(albumKey)
    if (existingAlbum) {
      existingAlbum.trackCount += 1
      existingAlbum.totalDurationSec += durationSec
      existingAlbum.trackIds.push(String(track.id))
    } else {
      albumMap.set(albumKey, {
        id: slugify(albumTitle, 'alb', idx),
        title: albumTitle,
        name: albumTitle,
        artist: artistName,
        trackCount: 1,
        totalDurationSec: durationSec,
        trackIds: [String(track.id)]
      })
    }

    const artistKey = artistName.toLowerCase()
    const existingArtist = artistMap.get(artistKey)
    if (existingArtist) {
      existingArtist.albums.add(albumKey)
      existingArtist.trackCount += 1
      existingArtist.trackIds.push(String(track.id))
    } else {
      artistMap.set(artistKey, {
        id: slugify(artistName, 'art', idx),
        name: artistName,
        albums: new Set([albumKey]),
        trackCount: 1,
        trackIds: [String(track.id)]
      })
    }
  }

  return {
    albums: [...albumMap.values()],
    artists: [...artistMap.values()].map((a) => ({
      id: a.id,
      name: a.name,
      albumCount: a.albums.size,
      trackCount: a.trackCount,
      trackIds: a.trackIds
    }))
  }
}

export interface PortableResourceAccessPort {
  authorize(resourceId: PortableResourceId): Promise<string>
  resolveTrackSource?(
    track: TrackData
  ): Promise<{ source: PortableResourceId; expiresAt: number | null }>
}

export interface PortableLyricsPort {
  loadLocalLyrics?(
    track: TrackData,
    kind: 'original' | 'translated' | 'romanized',
    signal: AbortSignal
  ): Promise<string | null>
  loadOnlineLyrics?(query: OnlineLyricsQuery, signal: AbortSignal): Promise<string | null>
  searchOnlineLyrics?(track: TrackData, signal?: AbortSignal): Promise<OnlineLyricsSearchResult>
}

export interface PortableHostOptions {
  epoch?: string
  platform?: CorePlatformId
  clock?: PortableClockPort
  scheduler?: PortableSchedulerPort
  sessionStore: PortableSessionStorePort
  audioEngine: PortableAudioEnginePort
  resourceAccess?: PortableResourceAccessPort
  lyrics?: PortableLyricsPort
  initialTracks?: TrackData[]
  initialSettings?: Partial<AppSettings>
  onFatalError?: (error: Error) => void
}

// ============================================================================
// 3. Portable In-Memory Queue & Library Store (Durable via SessionStorePort)
// ============================================================================

interface StoredQueueRow {
  queueEntryId: string
  originalOrder: number
  trackId: string
  snapshot: LibraryTrackRecord | null
}

interface StoredQueueRecord {
  id: string
  revision: number
  index: number
  selectedEntryId: string | null
  order: 'original' | 'shuffle'
  playMode?: LibraryQueuePlayMode
  rows: StoredQueueRow[]
  undoStack: Array<{
    label: string
    rows: StoredQueueRow[]
    index: number
    selectedEntryId: string | null
    order: 'original' | 'shuffle'
    playMode?: LibraryQueuePlayMode
  }>
}

interface PersistedEnvelope {
  session: PlaybackSessionData<TrackData> | null
  queues: Array<{
    id: string
    revision: number
    index: number
    selectedEntryId: string | null
    order: 'original' | 'shuffle'
    playMode?: LibraryQueuePlayMode
    rows: StoredQueueRow[]
  }>
  tracks: LibraryTrackRecord[]
  settings?: Partial<AppSettings>
  bookmarks?: PlaybackBookmarksDocument
  lyricsManagement?: LyricsManagementDocument
  playlists?: Playlist[]
  customPlaylists?: CorePlaylistView[]
  eqConfig?: CoreEqConfigView
}

function toTrackRecord(track: TrackData | LibraryTrackRecord): LibraryTrackRecord {
  return {
    ...track,
    id: String(track.id),
    filePath: typeof track.filePath === 'string' ? track.filePath : ''
  }
}

class PortableQueueAndLibraryStore {
  private libraryRevisionCounter = 1
  private queueIdCounter = 0
  private entryIdCounter = 0
  private readonly tracks = new Map<string, LibraryTrackRecord>()
  private readonly queues = new Map<string, StoredQueueRecord>()
  private readonly buildingQueues = new Map<
    string,
    {
      id: string
      order: 'original' | 'shuffle'
      sequence: number
      rows: StoredQueueRow[]
    }
  >()

  constructor(initialTracks: readonly TrackData[] = []) {
    for (const track of initialTracks) {
      this.tracks.set(track.id, toTrackRecord(track))
    }
  }

  upsertTracks(items: readonly TrackData[]): void {
    for (const item of items) {
      this.tracks.set(item.id, toTrackRecord(item))
    }
    this.libraryRevisionCounter++
  }

  getAllTracks(): LibraryTrackRecord[] {
    return [...this.tracks.values()].map((t) => structuredClone(t))
  }

  getLibraryRevision(): number {
    return this.libraryRevisionCounter
  }

  exportState(): Pick<PersistedEnvelope, 'queues' | 'tracks'> {
    return {
      tracks: [...this.tracks.values()].map((t) => structuredClone(t)),
      queues: [...this.queues.values()].map((q) => ({
        id: q.id,
        revision: q.revision,
        index: q.index,
        selectedEntryId: q.selectedEntryId,
        order: q.order,
        playMode: q.playMode,
        rows: q.rows.map((r) => structuredClone(r))
      }))
    }
  }

  importState(state: Partial<Pick<PersistedEnvelope, 'queues' | 'tracks'>> | null | undefined): void {
    if (!state) return
    if (Array.isArray(state.tracks)) {
      for (const track of state.tracks) {
        if (track && typeof track.id === 'string') {
          this.tracks.set(track.id, structuredClone(track))
        }
      }
    }
    if (Array.isArray(state.queues)) {
      this.queues.clear()
      for (const q of state.queues) {
        if (!q || typeof q.id !== 'string' || !Array.isArray(q.rows)) continue
        this.queues.set(q.id, {
          id: q.id,
          revision: typeof q.revision === 'number' ? q.revision : 1,
          index: typeof q.index === 'number' ? q.index : 0,
          selectedEntryId: q.selectedEntryId ?? q.rows[0]?.queueEntryId ?? null,
          order: q.order === 'shuffle' ? 'shuffle' : 'original',
          playMode: q.playMode,
          rows: q.rows.map((r) => structuredClone(r)),
          undoStack: []
        })
      }
    }
  }

  private nextQueueId(): string {
    this.queueIdCounter++
    return `portable-queue-${this.queueIdCounter}-${crypto.randomUUID().slice(0, 8)}`
  }

  private nextEntryId(): string {
    this.entryIdCounter++
    return `portable-entry-${this.entryIdCounter}-${crypto.randomUUID().slice(0, 8)}`
  }

  private snapshotOf(record: StoredQueueRecord): LibraryQueueSnapshot {
    const topUndo = record.undoStack[record.undoStack.length - 1]
    return {
      id: record.id,
      total: record.rows.length,
      index: record.index,
      revision: record.revision,
      selectedEntryId: record.selectedEntryId,
      order: record.order,
      ...(record.playMode ? { playMode: record.playMode } : {}),
      canUndo: record.undoStack.length > 0,
      undoLabel: topUndo?.label ?? null
    }
  }

  private resolveRowTrack(row: StoredQueueRow): LibraryTrackRecord | null {
    const fromLibrary = this.tracks.get(row.trackId)
    if (fromLibrary && row.snapshot) {
      return structuredClone({ ...fromLibrary, ...row.snapshot })
    }
    if (row.snapshot) return structuredClone(row.snapshot)
    if (fromLibrary) return structuredClone(fromLibrary)
    return null
  }

  async buildQueue(command: LibraryQueueBuildCommand): Promise<LibraryQueueBuildReply> {
    if (command.kind === 'begin') {
      this.buildingQueues.set(command.id, {
        id: this.nextQueueId(),
        order: command.order,
        sequence: 0,
        rows: []
      })
      return { kind: 'building', id: command.id, sequence: 0, total: 0 }
    }
    if (command.kind === 'abort') {
      this.buildingQueues.delete(command.id)
      return { kind: 'aborted', id: command.id }
    }
    const staging = this.buildingQueues.get(command.id)
    if (!staging) throw new Error(`Unknown queue build session: ${command.id}`)
    if (command.kind === 'append') {
      for (const item of command.items) {
        const snapshot = item.localSnapshot ?? item.snapshot ?? this.tracks.get(item.id) ?? null
        if (snapshot) {
          this.tracks.set(item.id, toTrackRecord(snapshot))
        }
        staging.rows.push({
          queueEntryId: this.nextEntryId(),
          originalOrder:
            typeof item.originalPosition === 'number'
              ? item.originalPosition
              : staging.rows.length,
          trackId: item.id,
          snapshot: snapshot ? toTrackRecord(snapshot) : null
        })
      }
      staging.sequence = command.sequence
      return {
        kind: 'building',
        id: command.id,
        sequence: staging.sequence,
        total: staging.rows.length
      }
    }
    // commit
    this.buildingQueues.delete(command.id)
    const clampedIndex =
      staging.rows.length === 0
        ? 0
        : Math.max(0, Math.min(staging.rows.length - 1, command.selectedIndex))
    const selectedEntryId = staging.rows[clampedIndex]?.queueEntryId ?? null
    const record: StoredQueueRecord = {
      id: staging.id,
      revision: 1,
      index: clampedIndex,
      selectedEntryId,
      order: staging.order,
      playMode: staging.order === 'shuffle' ? 'shuffle' : 'sequential',
      rows: staging.rows,
      undoStack: []
    }
    this.queues.set(record.id, record)
    return {
      kind: 'ready',
      id: command.id,
      queue: this.snapshotOf(record)
    }
  }

  async createQueue(query: LibraryQuery, selectedId?: string): Promise<LibraryQueueSnapshot> {
    const page = await this.queryTracks({ ...query, offset: 0, limit: 10_000 })
    const rows: StoredQueueRow[] = page.tracks.map((track, idx) => ({
      queueEntryId: this.nextEntryId(),
      originalOrder: idx,
      trackId: track.id,
      snapshot: structuredClone(track)
    }))
    let selectedIndex = 0
    if (selectedId) {
      const found = rows.findIndex((r) => r.trackId === selectedId)
      if (found >= 0) selectedIndex = found
    }
    const record: StoredQueueRecord = {
      id: this.nextQueueId(),
      revision: 1,
      index: selectedIndex,
      selectedEntryId: rows[selectedIndex]?.queueEntryId ?? null,
      order: 'original',
      playMode: 'sequential',
      rows,
      undoStack: []
    }
    this.queues.set(record.id, record)
    return this.snapshotOf(record)
  }

  async getQueue(id: string): Promise<LibraryQueueSnapshot> {
    const record = this.queues.get(id)
    if (!record) throw new Error(`Playback queue ${id} was not found`)
    return this.snapshotOf(record)
  }

  async readQueue(
    id: string,
    offset = 0,
    limit = LIBRARY_PAGE_SIZE,
    options?: LibraryQueueReadOptions
  ): Promise<LibraryQueuePage> {
    const record = this.queues.get(id)
    if (!record) throw new Error(`Playback queue ${id} was not found`)
    if (
      options?.expectedRevision !== undefined &&
      options.expectedRevision !== record.revision
    ) {
      throw Object.assign(new Error('Playback queue revision changed'), {
        code: 'STALE_REVISION'
      })
    }
    if (options?.occurrenceId) {
      const pos = record.rows.findIndex((r) => r.queueEntryId === options.occurrenceId)
      const items =
        pos >= 0
          ? [
              {
                queueEntryId: record.rows[pos].queueEntryId,
                position: pos,
                track: this.resolveRowTrack(record.rows[pos])
              }
            ]
          : []
      return {
        items,
        lastPlayablePosition: record.rows.length > 0 ? record.rows.length - 1 : undefined,
        total: record.rows.length,
        revision: record.revision,
        libraryRevision: this.libraryRevisionCounter,
        offset: pos >= 0 ? pos : 0
      }
    }

    const start = Math.max(0, offset)
    const slice = record.rows.slice(start, start + Math.max(1, limit))
    return {
      items: slice.map((row, idx) => ({
        queueEntryId: row.queueEntryId,
        position: start + idx,
        track: this.resolveRowTrack(row)
      })),
      lastPlayablePosition: record.rows.length > 0 ? record.rows.length - 1 : undefined,
      total: record.rows.length,
      revision: record.revision,
      libraryRevision: this.libraryRevisionCounter,
      offset: start
    }
  }

  async editQueue(
    id: string,
    expectedRevision: number,
    edit: LibraryQueueEdit
  ): Promise<LibraryQueueEditResult> {
    const record = this.queues.get(id)
    if (!record) throw new Error(`Playback queue ${id} was not found`)
    if (record.revision !== expectedRevision) {
      throw Object.assign(new Error('Playback queue revision mismatch'), {
        code: 'STALE_REVISION'
      })
    }

    let reachedEnd = false

    const pushUndo = (label: string) => {
      record.undoStack.push({
        label,
        rows: record.rows.map((r) => structuredClone(r)),
        index: record.index,
        selectedEntryId: record.selectedEntryId,
        order: record.order,
        playMode: record.playMode
      })
      if (record.undoStack.length > 10) record.undoStack.shift()
    }

    switch (edit.kind) {
      case 'select': {
        const idx = record.rows.findIndex((r) => r.queueEntryId === edit.entryId)
        if (idx < 0) throw new Error(`Queue entry ${edit.entryId} not found`)
        record.index = idx
        record.selectedEntryId = record.rows[idx].queueEntryId
        record.revision++
        break
      }
      case 'step': {
        if (record.rows.length === 0) {
          reachedEnd = true
          break
        }
        const nextIdx = record.index + edit.direction
        if (nextIdx >= 0 && nextIdx < record.rows.length) {
          record.index = nextIdx
          record.selectedEntryId = record.rows[nextIdx].queueEntryId
          record.revision++
        } else if (edit.wrap) {
          record.index = edit.direction > 0 ? 0 : record.rows.length - 1
          record.selectedEntryId = record.rows[record.index].queueEntryId
          record.revision++
        } else {
          reachedEnd = true
        }
        break
      }
      case 'mode': {
        record.playMode = edit.mode
        const targetOrder = edit.mode === 'shuffle' ? 'shuffle' : 'original'
        if (record.order !== targetOrder) {
          this.reorderRows(record, targetOrder)
        }
        record.revision++
        break
      }
      case 'order': {
        if (record.order !== edit.order) {
          this.reorderRows(record, edit.order)
        }
        record.revision++
        break
      }
      case 'insert': {
        pushUndo('insert')
        const newRows: StoredQueueRow[] = []
        if (edit.items) {
          for (const item of edit.items) {
            const snapshot = item.snapshot ?? this.tracks.get(item.id) ?? null
            if (snapshot) this.tracks.set(item.id, toTrackRecord(snapshot))
            newRows.push({
              queueEntryId: this.nextEntryId(),
              originalOrder: record.rows.length + newRows.length,
              trackId: item.id,
              snapshot: snapshot ? toTrackRecord(snapshot) : null
            })
          }
        } else if (edit.trackIds) {
          for (const trackId of edit.trackIds) {
            const snapshot = this.tracks.get(trackId) ?? null
            newRows.push({
              queueEntryId: this.nextEntryId(),
              originalOrder: record.rows.length + newRows.length,
              trackId,
              snapshot: snapshot ? toTrackRecord(snapshot) : null
            })
          }
        }
        let insertAt = record.rows.length
        if (edit.afterEntryId) {
          const idx = record.rows.findIndex((r) => r.queueEntryId === edit.afterEntryId)
          if (idx >= 0) insertAt = idx + 1
        } else if (edit.beforeEntryId) {
          const idx = record.rows.findIndex((r) => r.queueEntryId === edit.beforeEntryId)
          if (idx >= 0) insertAt = idx
        }
        record.rows.splice(insertAt, 0, ...newRows)
        if (record.selectedEntryId) {
          const selIdx = record.rows.findIndex((r) => r.queueEntryId === record.selectedEntryId)
          record.index = selIdx >= 0 ? selIdx : 0
        } else if (record.rows.length > 0) {
          record.index = 0
          record.selectedEntryId = record.rows[0].queueEntryId
        }
        record.revision++
        break
      }
      case 'remove': {
        pushUndo('remove')
        const removeSet = new Set(edit.entryIds)
        const currentSelected = record.selectedEntryId
        const previousIndex = record.index
        record.rows = record.rows.filter((r) => !removeSet.has(r.queueEntryId))
        if (record.rows.length === 0) {
          record.index = 0
          record.selectedEntryId = null
        } else if (currentSelected && !removeSet.has(currentSelected)) {
          record.index = Math.max(
            0,
            record.rows.findIndex((r) => r.queueEntryId === currentSelected)
          )
        } else {
          record.index = Math.min(previousIndex, record.rows.length - 1)
          record.selectedEntryId = record.rows[record.index].queueEntryId
        }
        record.revision++
        break
      }
      case 'move': {
        pushUndo('move')
        const fromIdx = record.rows.findIndex((r) => r.queueEntryId === edit.entryId)
        if (fromIdx < 0) throw new Error(`Queue entry ${edit.entryId} not found`)
        const [moved] = record.rows.splice(fromIdx, 1)
        let toIdx = record.rows.length
        if (edit.beforeEntryId !== null) {
          const beforeIdx = record.rows.findIndex((r) => r.queueEntryId === edit.beforeEntryId)
          if (beforeIdx >= 0) toIdx = beforeIdx
        }
        record.rows.splice(toIdx, 0, moved)
        if (record.selectedEntryId) {
          const selIdx = record.rows.findIndex((r) => r.queueEntryId === record.selectedEntryId)
          if (selIdx >= 0) record.index = selIdx
        }
        record.revision++
        break
      }
      case 'clear': {
        pushUndo('clear')
        record.rows = []
        record.index = 0
        record.selectedEntryId = null
        record.revision++
        break
      }
      case 'undo': {
        const last = record.undoStack.pop()
        if (!last) throw new Error('Nothing to undo')
        record.rows = last.rows
        record.index = last.index
        record.selectedEntryId = last.selectedEntryId
        record.order = last.order
        record.playMode = last.playMode
        record.revision++
        break
      }
    }

    return {
      queue: this.snapshotOf(record),
      reachedEnd
    }
  }

  private reorderRows(record: StoredQueueRecord, order: 'original' | 'shuffle'): void {
    const selectedId = record.selectedEntryId
    if (order === 'original') {
      record.rows.sort((a, b) => a.originalOrder - b.originalOrder)
    } else if (record.rows.length > 1) {
      const selectedRow = selectedId
        ? record.rows.find((r) => r.queueEntryId === selectedId)
        : undefined
      const rest = selectedRow
        ? record.rows.filter((r) => r.queueEntryId !== selectedId)
        : [...record.rows]
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = rest[i]
        rest[i] = rest[j]
        rest[j] = tmp
      }
      record.rows = selectedRow ? [selectedRow, ...rest] : rest
    }
    record.order = order
    if (selectedId) {
      const idx = record.rows.findIndex((r) => r.queueEntryId === selectedId)
      if (idx >= 0) record.index = idx
    }
  }

  async deleteQueue(id: string, _expectedRevision: number): Promise<void> {
    this.queues.delete(id)
  }

  async readNeighbor(
    id: string,
    revision: number,
    index: number,
    direction: 1 | -1,
    wrap: boolean
  ) {
    const record = this.queues.get(id)
    if (!record || record.revision !== revision || record.rows.length === 0) return null
    let target = index + direction
    if (target < 0 || target >= record.rows.length) {
      if (!wrap) return null
      target = direction > 0 ? 0 : record.rows.length - 1
    }
    const row = record.rows[target]
    if (!row) return null
    return {
      queueEntryId: row.queueEntryId,
      position: target,
      track: this.resolveRowTrack(row)
    }
  }

  async getMetadata(): Promise<LibraryMetadata> {
    return {
      revision: this.libraryRevisionCounter,
      trackCount: this.tracks.size,
      fileCount: this.tracks.size,
      folders: [],
      exclusions: []
    }
  }

  async queryTracks(query: LibraryQuery = {}): Promise<LibraryPage> {
    let list = [...this.tracks.values()]
    if (query.ids) {
      const idSet = new Set(query.ids)
      list = list.filter((t) => idSet.has(t.id))
    }
    if (query.search) {
      const q = query.search.toLowerCase()
      list = list.filter(
        (t) =>
          String(t.title ?? '').toLowerCase().includes(q) ||
          String(t.artist ?? '').toLowerCase().includes(q) ||
          String(t.album ?? '').toLowerCase().includes(q)
      )
    }
    const offset = Math.max(0, query.offset ?? 0)
    const limit = Math.max(1, query.limit ?? LIBRARY_PAGE_SIZE)
    const slice = list.slice(offset, offset + limit).map((t) => structuredClone(t))
    return {
      tracks: slice,
      versions: {},
      total: list.length,
      revision: this.libraryRevisionCounter,
      offset
    }
  }

  async getTracksByIds(ids: string[]): Promise<LibraryPage> {
    const found = ids
      .map((id) => this.tracks.get(id))
      .filter((t): t is LibraryTrackRecord => Boolean(t))
      .map((t) => structuredClone(t))
    return {
      tracks: found,
      versions: {},
      total: found.length,
      revision: this.libraryRevisionCounter,
      offset: 0
    }
  }

  async queryCollections(
    kind: LibraryCollectionKind,
    query: LibraryQuery = {}
  ): Promise<LibraryCollectionPage> {
    const groups = new Map<string, LibraryCollectionSummary>()
    for (const track of this.tracks.values()) {
      if (kind === 'albums') {
        const albumName = String(track.album || 'Unknown Album').trim() || 'Unknown Album'
        const key = `album:${albumName.toLowerCase()}`
        const existing = groups.get(key)
        if (existing) {
          existing.trackCount += 1
          existing.duration += Number(track.duration) || 0
        } else {
          groups.set(key, {
            id: key,
            name: albumName,
            artist: String(track.artist || 'Unknown Artist'),
            trackCount: 1,
            duration: Number(track.duration) || 0,
            cover: typeof track.cover === 'string' ? track.cover : null
          })
        }
      } else if (kind === 'artists') {
        const artistName = String(track.artist || 'Unknown Artist').trim() || 'Unknown Artist'
        const key = `artist:${artistName.toLowerCase()}`
        const existing = groups.get(key)
        if (existing) {
          existing.trackCount += 1
          existing.duration += Number(track.duration) || 0
        } else {
          groups.set(key, {
            id: key,
            name: artistName,
            trackCount: 1,
            duration: Number(track.duration) || 0,
            cover: typeof track.cover === 'string' ? track.cover : null
          })
        }
      } else if (kind === 'genres') {
        const genreName = String(track.genre || 'Unknown Genre').trim() || 'Unknown Genre'
        const key = `genre:${genreName.toLowerCase()}`
        const existing = groups.get(key)
        if (existing) {
          existing.trackCount += 1
          existing.duration += Number(track.duration) || 0
        } else {
          groups.set(key, {
            id: key,
            name: genreName,
            trackCount: 1,
            duration: Number(track.duration) || 0,
            cover: null
          })
        }
      }
    }

    let items = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
    if (query.search) {
      const q = query.search.toLowerCase()
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.artist && item.artist.toLowerCase().includes(q))
      )
    }
    const offset = Math.max(0, query.offset ?? 0)
    const limit = Math.max(1, query.limit ?? LIBRARY_PAGE_SIZE)
    return {
      revision: this.libraryRevisionCounter,
      total: items.length,
      offset,
      items: items.slice(offset, offset + limit),
      letterOffsets: {}
    }
  }

  private readonly playlistViews = new Map<
    string,
    {
      sequence: number
      committed: boolean
      entries: Array<{ id: string; snapshot?: LibraryTrackRecord; collectionId?: string }>
    }
  >()

  async syncPlaylistView(
    sync: LibraryPlaylistViewSync
  ): Promise<LibraryPlaylistViewSyncResult> {
    if (sync.kind === 'drop') {
      this.playlistViews.delete(sync.id)
      return { id: sync.id, sequence: 0, count: 0, committed: false }
    }
    if (sync.kind === 'begin') {
      this.playlistViews.set(sync.id, { sequence: 0, committed: false, entries: [] })
      return { id: sync.id, sequence: 0, count: 0, committed: false }
    }
    const current = this.playlistViews.get(sync.id) ?? {
      sequence: 0,
      committed: false,
      entries: []
    }
    if (sync.kind === 'groups') {
      current.sequence = sync.sequence
      this.playlistViews.set(sync.id, current)
      return {
        id: sync.id,
        sequence: sync.sequence,
        count: sync.groups.length,
        committed: false
      }
    }
    if (sync.kind === 'append') {
      current.sequence = sync.sequence
      current.entries.push(...sync.entries)
      this.playlistViews.set(sync.id, current)
      return {
        id: sync.id,
        sequence: sync.sequence,
        count: current.entries.length,
        committed: false
      }
    }
    current.sequence = sync.sequence
    current.committed = true
    this.playlistViews.set(sync.id, current)
    return {
      id: sync.id,
      sequence: sync.sequence,
      count: current.entries.length,
      committed: true
    }
  }

  async lookupTracksByPaths(paths: string[]) {
    const byPath = new Map<string, string>()
    for (const track of this.tracks.values()) {
      if (track.filePath) {
        byPath.set(track.filePath, track.id)
      }
    }
    return {
      revision: this.libraryRevisionCounter,
      ids: paths.map((p) => byPath.get(p) ?? null)
    }
  }

  async lookupPlaylistTracks(request: { entries: Array<{ id?: string; filePath?: string }> }) {
    const byPath = new Map<string, string>()
    for (const track of this.tracks.values()) {
      if (track.filePath) {
        byPath.set(track.filePath, track.id)
      }
    }
    return {
      revision: this.libraryRevisionCounter,
      ids: request.entries.map((entry) => {
        if (entry.id && this.tracks.has(entry.id)) return entry.id
        if (entry.filePath && byPath.has(entry.filePath)) return byPath.get(entry.filePath)!
        return null
      })
    }
  }
}

// ============================================================================
// 4. Adapter from PortableAudioEnginePort to CorePlaybackEngine
// ============================================================================

class PortablePlaybackEngineAdapter implements CorePlaybackEngine {
  private readonly port: PortableAudioEnginePort
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>()
  private queueItems: AudioEngineQueueItem[] = []
  private queueCursor = 0
  private queueRevision = 0
  private queueTokenCounter = 0
  private currentQueueToken = 'portable-token-0'
  private playMode: PlayMode = 'sequential'
  private unsubscribePort: PortableUnsubscribe | null = null

  constructor(port: PortableAudioEnginePort) {
    this.port = port
    this.unsubscribePort = port.subscribe((event) => {
      this.handlePortEvent(event)
    })
  }

  dispose(): void {
    this.unsubscribePort?.()
    this.unsubscribePort = null
    this.listeners.clear()
  }

  private emitEvent(event: string, ...args: unknown[]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of [...set]) {
      listener(...args)
    }
  }

  private handlePortEvent(event: PortableAudioNativeEvent): void {
    if (event.type === 'playback-info') {
      const enriched: PlaybackInfo = {
        ...event.info,
        queueToken: event.info.queueToken ?? this.currentQueueToken
      }
      this.emitEvent('playback-info', enriched)
      return
    }
    if (event.type === 'end-file') {
      this.emitEvent('end-file', { reason: event.reason ?? 'eof' })
      return
    }
    if (event.type === 'crashed') {
      this.emitEvent('crashed', { reason: event.reason ?? 'Native audio engine crashed' })
      return
    }
    if (event.type === 'error') {
      this.emitEvent('error', {
        message: event.message,
        code: event.code,
        recoverable: event.recoverable
      })
    }
  }

  on(event: string, listener: (...args: any[]) => void): unknown {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return this
  }

  off(event: string, listener: (...args: any[]) => void): unknown {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  getQueueToken(): string {
    return this.currentQueueToken
  }

  async getPlaybackInfo(): Promise<PlaybackInfo> {
    return this.port.getSnapshot()
  }

  getQueueSnapshot(): readonly AudioEngineQueueItem[] {
    return this.queueItems
  }

  getPlaybackEnd(): {
    selection: NativeQueueSelection
    intent: number
  } | null {
    return null
  }

  async continueAfterPlaybackEnd(request: {
    expected: {
      selection: NativeQueueSelection
      intent: number
    }
    item: AudioEngineQueueItem
    playMode: 'sequential' | 'repeat'
    isCurrent(): boolean
    onSelected(): void
  }): Promise<boolean> {
    if (!request.isCurrent()) return false
    this.queueItems = [structuredClone(request.item)]
    this.queueCursor = 0
    this.queueRevision++
    this.queueTokenCounter++
    this.currentQueueToken = `portable-token-${this.queueTokenCounter}`
    request.onSelected()
    await this.port.loadQueue(this.queueItems, 0)
    await this.port.play(request.item.source, 0)
    return true
  }

  async start(): Promise<void> {
    await this.port.start?.()
  }

  async loadQueue(items: AudioEngineQueueItem[], startIndex = 0): Promise<void> {
    this.queueItems = items.map((item) => structuredClone(item))
    this.queueCursor =
      items.length === 0 ? 0 : Math.max(0, Math.min(items.length - 1, startIndex))
    this.queueRevision++
    this.queueTokenCounter++
    this.currentQueueToken = `portable-token-${this.queueTokenCounter}`
    await this.port.loadQueue(this.queueItems, this.queueCursor)
  }

  async rebindQueue(rebind: NativeQueueRebind): Promise<NativeQueueCommit | null> {
    this.queueItems = rebind.items.map((item) => structuredClone(item))
    this.queueCursor =
      rebind.items.length === 0
        ? 0
        : Math.max(0, Math.min(rebind.items.length - 1, rebind.startIndex))
    this.queueRevision++
    this.queueTokenCounter++
    this.currentQueueToken = `portable-token-${this.queueTokenCounter}`
    await this.port.loadQueue(this.queueItems, this.queueCursor)
    return { queueToken: this.currentQueueToken }
  }

  async appendQueueItems(items: AudioEngineQueueItem[]): Promise<number | null> {
    const firstIndex = this.queueItems.length
    this.queueItems.push(...items.map((item) => structuredClone(item)))
    this.queueRevision++
    await this.port.loadQueue(this.queueItems, this.queueCursor)
    return firstIndex
  }

  async updateQueueItemSource(index: number, source: string): Promise<boolean> {
    if (index < 0 || index >= this.queueItems.length) return false
    this.queueItems[index] = { ...this.queueItems[index], source }
    this.queueRevision++
    return true
  }

  async getQueueState() {
    return {
      revision: this.queueRevision,
      size: this.queueItems.length,
      currentIndex: this.queueItems.length > 0 ? this.queueCursor : -1,
      upcomingIndex:
        this.queueCursor + 1 < this.queueItems.length ? this.queueCursor + 1 : -1,
      playMode: this.playMode === 'heart' ? 'sequential' : this.playMode
    }
  }

  async selectQueueIndex(index: number): Promise<boolean> {
    if (index < 0 || index >= this.queueItems.length) return false
    this.queueCursor = index
    if (this.port.selectQueueIndex) {
      return this.port.selectQueueIndex(index)
    }
    return true
  }

  async next(): Promise<boolean> {
    if (this.queueCursor + 1 < this.queueItems.length) {
      this.queueCursor++
    }
    if (this.port.next) {
      return this.port.next()
    }
    return true
  }

  async previous(): Promise<boolean> {
    if (this.queueCursor > 0) {
      this.queueCursor--
    }
    if (this.port.previous) {
      return this.port.previous()
    }
    return true
  }

  async play(
    source: string,
    position = 0,
    requested?: () => boolean
  ): Promise<AudioEnginePlayResult> {
    if (requested && !requested()) {
      return { nativeStarted: false, fallbackReason: 'Playback request was superseded' }
    }
    return this.port.play(source, position)
  }

  async pause(): Promise<void> {
    await this.port.pause()
  }

  async stop(): Promise<void> {
    await this.port.stop()
  }

  async seek(position: number): Promise<void> {
    await this.port.seek(position)
  }

  async seekConfirmed(position: number): Promise<void> {
    await this.port.seek(position)
  }

  async setVolume(volume: number): Promise<void> {
    await this.port.setVolume(volume)
  }

  async setPlaybackRate(rate: number): Promise<void> {
    await this.port.setPlaybackRate(rate)
  }

  async setPlayMode(mode: PlayMode): Promise<void> {
    this.playMode = mode
    await this.port.setPlayMode(mode)
  }
}

// ============================================================================
// 5. Portable Music Core Host Assembly & JSON Bridge Surface
// ============================================================================

export interface PortableMusicCoreHost {
  readonly epoch: string
  readonly protocolVersion: typeof CORE_PROTOCOL_VERSION
  readonly application: CoreApplication
  readonly playback: CorePlaybackSession
  readonly settings: CoreSettingsService
  readonly queueStore: PortableQueueAndLibraryStore
  initialize(): Promise<void>
  seedTracks(tracks: readonly TrackData[]): void
  playTracks(tracks: readonly TrackData[], startIndex?: number): Promise<void>
  getSnapshot(): CoreSnapshot
  getSnapshotJson(): string
  dispatchRequest(message: CoreRequestEnvelope | CoreCancelEnvelope): void
  dispatchRequestJson(messageJson: string): void
  subscribeMessages(listener: (message: CoreClientMessage) => void): PortableUnsubscribe
  subscribeMessagesJson(listener: (messageJson: string) => void): PortableUnsubscribe
  /** Phase 3 custom playlist CRUD capabilities */
  createCustomPlaylist(name: string, trackIds?: readonly string[]): CorePlaylistView
  deleteCustomPlaylist(playlistId: string): boolean
  renameCustomPlaylist(playlistId: string, name: string): CorePlaylistView | null
  addTracksToCustomPlaylist(playlistId: string, trackIds: readonly string[]): CorePlaylistView | null
  removeTrackFromCustomPlaylist(playlistId: string, trackId: string): CorePlaylistView | null
  listCustomPlaylists(): CorePlaylistView[]
  /** Phase 3 library collections aggregation */
  getLibraryCollections(): CoreLibraryCollectionsView
  /** Phase 3 EQ & DSP configuration */
  getEqConfig(): CoreEqConfigView
  setEqConfig(patch: Partial<CoreEqConfigView>): CoreEqConfigView
  /** Platform safety brake (Section 5.4: audio focus lost / route noisy / service stopping). */
  triggerPlatformSafetyBrake(reason: string): Promise<void>
  shutdown(): Promise<void>
}

export function createPortableMusicCoreHost(options: PortableHostOptions): PortableMusicCoreHost {
  ensurePortableRuntimeGlobals()

  const epoch = options.epoch ?? `portable-epoch-${crypto.randomUUID().slice(0, 8)}`
  const platform: CorePlatformId = options.platform ?? 'linux'

  const clock: PortableClockPort = options.clock ?? {
    nowUnixMs: () => Date.now(),
    nowMonotonicMs: () =>
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
  }

  const scheduler: PortableSchedulerPort = options.scheduler ?? {
    schedule(delayMs, task) {
      if (typeof setTimeout === 'function') {
        const handle = setTimeout(task, delayMs)
        return {
          cancel() {
            if (typeof clearTimeout === 'function') clearTimeout(handle)
          }
        }
      }
      return { cancel() {} }
    }
  }

  const queueStore = new PortableQueueAndLibraryStore(options.initialTracks ?? [])
  const engineAdapter = new PortablePlaybackEngineAdapter(options.audioEngine)

  let storeRevisionToken: string | null = null
  let currentSettings: AppSettings
  let settingsRevision = 0
  let currentSessionData: PlaybackSessionData<TrackData> | null = null
  let sessionDataRevision = 0
  let bookmarksDoc: PlaybackBookmarksDocument = clonePlaybackBookmarksDocument(
    DEFAULT_PLAYBACK_BOOKMARKS
  )
  let bookmarksRevision = 0
  let lyricsDoc: LyricsManagementDocument = cloneLyricsManagementDocument(
    DEFAULT_LYRICS_MANAGEMENT
  )
  let lyricsRevision = 0
  let playlistsState: Playlist[] = []
  let playlistsRevision = 0
  let customPlaylists: CorePlaylistView[] = []
  let customPlaylistIdCounter = 0
  let eqConfig: CoreEqConfigView = createDefaultEqConfig()
  let envelopeLoaded = false
  let envelopeLoadPromise: Promise<void> | null = null

  const settingsEnv: SettingsEnvironment = {
    platform,
    defaultCachePath: '/portable/cache',
    resolvePath: (path: string) => path
  }
  currentSettings = normalizeAppSettings(
    {
      ...createDefaultSettings(platform),
      ...options.initialSettings
    },
    settingsEnv
  )

  const ensureEnvelopeLoaded = async (): Promise<void> => {
    if (envelopeLoaded) return
    if (envelopeLoadPromise) return envelopeLoadPromise
    envelopeLoadPromise = (async () => {
      const stored = await options.sessionStore.load()
      if (!stored) {
        storeRevisionToken = null
        sessionDataRevision = 0
        envelopeLoaded = true
        return
      }
      storeRevisionToken = stored.revision
      const parsedNum = Number.parseInt(stored.revision, 10)
      const initialRev = Number.isFinite(parsedNum) && parsedNum > 0 ? parsedNum : 1
      const parsed = JSON.parse(stored.payloadJson) as PersistedEnvelope
      queueStore.importState(parsed)
      currentSessionData = parsed.session ?? null
      sessionDataRevision = currentSessionData ? initialRev : 0
      if (parsed.settings) {
        currentSettings = normalizeAppSettings(
          { ...currentSettings, ...parsed.settings },
          settingsEnv
        )
      }
      if (parsed.bookmarks) {
        bookmarksDoc = clonePlaybackBookmarksDocument(parsed.bookmarks)
        bookmarksRevision = initialRev
      }
      if (parsed.lyricsManagement) {
        lyricsDoc = cloneLyricsManagementDocument(parsed.lyricsManagement)
        lyricsRevision = initialRev
      }
      if (Array.isArray(parsed.playlists)) {
        playlistsState = structuredClone(parsed.playlists)
        playlistsRevision = initialRev
      }
      if (Array.isArray(parsed.customPlaylists)) {
        customPlaylists = structuredClone(parsed.customPlaylists)
      }
      if (parsed.eqConfig) {
        eqConfig = applyEqConfigPatch(createDefaultEqConfig(), parsed.eqConfig)
      }
      envelopeLoaded = true
    })().finally(() => {
      envelopeLoadPromise = null
    })
    return envelopeLoadPromise
  }

  let persistChain: Promise<void> = Promise.resolve()
  const persistEnvelope = async (): Promise<void> => {
    const work = persistChain
      .catch(() => undefined)
      .then(async () => {
        const exported = queueStore.exportState()
        const envelope: PersistedEnvelope = {
          session: currentSessionData,
          queues: exported.queues,
          tracks: exported.tracks,
          settings: currentSettings,
          bookmarks: bookmarksDoc,
          lyricsManagement: lyricsDoc,
          playlists: playlistsState,
          customPlaylists,
          eqConfig
        }
        const res = await options.sessionStore.save(
          JSON.stringify(envelope),
          storeRevisionToken
        )
        if (!res.ok) {
          throw Object.assign(new Error('Session store CAS conflict'), {
            code: 'STALE_REVISION'
          })
        }
        storeRevisionToken = res.revision
      })
    persistChain = work
    return work
  }

  const sessionRepository: CoreSessionRepository = {
    async load() {
      await ensureEnvelopeLoaded()
      if (sessionDataRevision === 0 && !currentSessionData) {
        return null
      }
      return {
        revision: sessionDataRevision,
        data: currentSessionData
      }
    },
    async save(sessionData, expectedRevision) {
      if (expectedRevision !== sessionDataRevision) {
        throw Object.assign(new Error('Session store revision conflict'), {
          code: 'STALE_REVISION'
        })
      }
      currentSessionData = sessionData
      sessionDataRevision++
      await persistEnvelope()
      return { revision: sessionDataRevision }
    },
    async clear(expectedRevision) {
      if (expectedRevision !== sessionDataRevision) {
        throw Object.assign(new Error('Session store revision conflict'), {
          code: 'STALE_REVISION'
        })
      }
      currentSessionData = null
      sessionDataRevision++
      await persistEnvelope()
      return { revision: sessionDataRevision }
    }
  }

  let appInstance: CoreApplication | null = null

  const stateApi: CoreStateApi = {
    coreStateOpen: async () => {},
    coreStateStatus: async () => ({
      complete: true,
      id: null,
      manifest: null,
      nextBatch: 0,
      counts: emptyCoreStateCounts()
    }),
    coreStateRead: async (domain) => ({
      domain,
      revision: 0,
      rows: [],
      next: null
    }),
    coreStateWrite: async () => 1,
    coreMigrationBegin: async (id, manifest) => ({
      complete: false,
      id,
      manifest,
      nextBatch: 0,
      counts: emptyCoreStateCounts()
    }),
    coreMigrationStage: async (id, batch) => ({
      complete: false,
      id,
      manifest: null,
      nextBatch: batch + 1,
      counts: emptyCoreStateCounts()
    }),
    coreMigrationCommit: async (id) => ({
      complete: true,
      id,
      manifest: null,
      nextBatch: 0,
      counts: emptyCoreStateCounts()
    }),
    coreMigrationAbort: async () => {}
  }

  const recordingVersions = new CoreRecordingVersions(
    {
      coreStateRead: stateApi.coreStateRead,
      coreVersionsReplace: async (_doc, expectedRevision) => expectedRevision + 1
    },
    () => appInstance?.changed(),
    () => crypto.randomUUID()
  )

  const bookmarksService = new CoreBookmarksService({
    repository: {
      load: async () => {
        await ensureEnvelopeLoaded()
        return {
          version: 2 as const,
          revision: bookmarksRevision,
          savedAt: new Date(clock.nowUnixMs()).toISOString(),
          data: clonePlaybackBookmarksDocument(bookmarksDoc)
        }
      },
      save: async (document, expectedRevision) => {
        if (expectedRevision !== bookmarksRevision) {
          throw Object.assign(new Error('Bookmarks revision conflict'), {
            code: 'STALE_REVISION'
          })
        }
        bookmarksDoc = clonePlaybackBookmarksDocument(document)
        bookmarksRevision++
        await persistEnvelope()
        return {
          version: 2 as const,
          revision: bookmarksRevision,
          savedAt: new Date(clock.nowUnixMs()).toISOString(),
          data: clonePlaybackBookmarksDocument(bookmarksDoc)
        }
      }
    },
    now: () => clock.nowUnixMs(),
    newId: () => crypto.randomUUID(),
    changed: () => appInstance?.changed(),
    failed: (error) => {
      if (error instanceof Error) options.onFatalError?.(error)
    }
  })

  const portableTimers = {
    setTimeout(callback: () => void, delay: number) {
      return scheduler.schedule(delay, callback)
    },
    clearTimeout(handle: unknown) {
      if (handle && typeof (handle as { cancel?: () => void }).cancel === 'function') {
        ;(handle as { cancel: () => void }).cancel()
      }
    }
  }

  const lyricsService = new CoreLyricsService({
    repository: {
      load: async () => {
        await ensureEnvelopeLoaded()
        return {
          version: 2 as const,
          revision: lyricsRevision,
          savedAt: new Date(clock.nowUnixMs()).toISOString(),
          data: cloneLyricsManagementDocument(lyricsDoc)
        }
      },
      save: async (document, expectedRevision) => {
        if (expectedRevision !== lyricsRevision) {
          throw Object.assign(new Error('Lyrics revision conflict'), {
            code: 'STALE_REVISION'
          })
        }
        lyricsDoc = cloneLyricsManagementDocument(document)
        lyricsRevision++
        await persistEnvelope()
        return {
          version: 2 as const,
          revision: lyricsRevision,
          savedAt: new Date(clock.nowUnixMs()).toISOString(),
          data: cloneLyricsManagementDocument(lyricsDoc)
        }
      }
    },
    now: () => clock.nowUnixMs(),
    changed: () => appInstance?.changed(),
    timers: portableTimers,
    sources: {
      loadLocalLyrics: async (track, kind, signal) => {
        if (options.lyrics?.loadLocalLyrics) {
          return options.lyrics.loadLocalLyrics(track, kind, signal)
        }
        if (kind === 'original') return track.lyrics ?? null
        if (kind === 'translated') return track.translatedLyrics ?? null
        if (kind === 'romanized') return track.romanizedLyrics ?? null
        return null
      },
      resolveProviderLyrics: async (_track, _signal) => ({
        lyrics: null,
        translatedLyrics: null
      }),
      loadAmlTtml: async (_id, _signal) => null,
      loadOnlineLyrics: async (query, signal) => {
        if (options.lyrics?.loadOnlineLyrics) {
          return options.lyrics.loadOnlineLyrics(query, signal)
        }
        return null
      },
      getAppSettings: () => ({ value: currentSettings })
    },
    search: async (track, signal) => {
      if (options.lyrics?.searchOnlineLyrics) {
        return options.lyrics.searchOnlineLyrics(track, signal)
      }
      return {
        query: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          durationSeconds: track.duration
        },
        candidates: [],
        best: null
      }
    },
    importDraft: async () => null,
    exportDraft: async () => null,
    failed: (error) => {
      if (error instanceof Error) options.onFatalError?.(error)
    }
  })

  const playlistsService = new CorePlaylistService({
    runtime: {
      now: () => clock.nowUnixMs(),
      newId: () => crypto.randomUUID(),
      clone: <T>(val: T) => structuredClone(val),
      notify: () => appInstance?.changed(),
      identity: recordingVersions.identity,
      versions: {
        ensure: () => {},
        revision: () => recordingVersions.getRevision()
      },
      repository: {
        load: async () => {
          await ensureEnvelopeLoaded()
          return {
            version: 2 as const,
            revision: playlistsRevision,
            savedAt: new Date(clock.nowUnixMs()).toISOString(),
            data: structuredClone(playlistsState)
          }
        },
        save: async (data, expectedRevision) => {
          if (expectedRevision !== playlistsRevision) {
            throw Object.assign(new Error('Playlists revision conflict'), {
              code: 'STALE_REVISION'
            })
          }
          playlistsState = structuredClone(data)
          playlistsRevision++
          await persistEnvelope()
          return {
            version: 2 as const,
            revision: playlistsRevision,
            savedAt: new Date(clock.nowUnixMs()).toISOString(),
            data: structuredClone(playlistsState)
          }
        }
      }
    },
    database: {
      lookupTracksByPaths: (paths) => queueStore.lookupTracksByPaths(paths),
      getTracksByIds: (ids) => queueStore.getTracksByIds(ids),
      getMetadata: () => queueStore.getMetadata(),
      queryTracks: (query) => queueStore.queryTracks(query),
      queryCollections: (kind, query) => queueStore.queryCollections(kind, query),
      syncPlaylistView: (sync) => queueStore.syncPlaylistView(sync)
    },
    versions: recordingVersions,
    changed: () => appInstance?.changed()
  })

  const resolveSeedItems = async (
    items: readonly import('../shared/coreQueueSubmission.ts').CoreQueueTrackInput[]
  ): Promise<LibraryQueueSeedItem[]> => {
    return items.map((item): LibraryQueueSeedItem => {
      if ('track' in item && item.track) {
        const record = toTrackRecord(item.track as TrackData)
        return {
          id: record.id,
          snapshot: record,
          localSnapshot: record
        }
      }
      const id = String((item as { id?: string }).id ?? '')
      return { id }
    })
  }

  const resolvePlaylistInputs = createPlaylistInputResolver(
    (inputs) => resolveSeedItems(inputs),
    {
      getTracksByIds: (ids) => queueStore.getTracksByIds(ids)
    }
  )

  const playlistSubmission = new CorePlaylistSubmission({
    playlists: playlistsService,
    resolve: resolvePlaylistInputs,
    newId: () => `pl-sub-${crypto.randomUUID().slice(0, 8)}`,
    schedule: (callback, delayMs) => {
      const handle = scheduler.schedule(delayMs, callback)
      return () => handle.cancel()
    }
  })

  const presentationService = new CorePlayerPresentationService({
    artwork: async (track) => ({
      cover: track.cover ?? null,
      coverSource: track.coverSource ?? null
    }),
    playlists: {
      isFavorite: (track) => playlistsService.isFavorite(track),
      toggleFavorite: (track, assertCurrent) =>
        playlistsService.toggleFavorite(track, assertCurrent)
    },
    supportedMethods: () => [],
    callProvider: async () => null,
    changed: () => appInstance?.changed(),
    failed: (error) => {
      if (error instanceof Error) options.onFatalError?.(error)
    }
  })

  const searchService = new CoreMusicSearchService({
    database: {
      queryTracks: (query) => queueStore.queryTracks(query),
      getMetadata: () => queueStore.getMetadata(),
      queryCollections: (kind, query) => queueStore.queryCollections(kind, query)
    },
    versions: recordingVersions,
    providers: () => [],
    playlists: playlistsService,
    searchCollectionProvider: async () => ({ items: [], total: 0 }),
    searchProvider: async () => ({ items: [], total: 0 }),
    network: {
      revision: () => 0,
      search: async () => []
    }
  })

  const settingsRepository = {
    issue: null,
    read: () => structuredClone(currentSettings),
    getRevision: () => settingsRevision,
    normalize: (patch: Partial<AppSettings>) =>
      normalizeAppSettings({ ...currentSettings, ...patch }, settingsEnv),
    update: (patch: Partial<AppSettings>) => {
      currentSettings = normalizeAppSettings({ ...currentSettings, ...patch }, settingsEnv)
      settingsRevision++
      appInstance?.changed()
      return structuredClone(currentSettings)
    }
  }

  let settingsTail: Promise<unknown> = Promise.resolve()
  const settingsService = new CoreSettingsService({
    repository: settingsRepository as any,
    authorizePaths: async (paths) => paths,
    configureLibrary: async () => {},
    serialize: <T>(action: () => Promise<T>) => {
      const next = settingsTail.then(action, action)
      settingsTail = next.then(
        () => undefined,
        () => undefined
      )
      return next
    },
    schedule: (callback, ms) => {
      const handle = scheduler.schedule(ms, callback)
      return () => handle.cancel()
    },
    failed: (error) => {
      if (error instanceof Error) options.onFatalError?.(error)
    },
    audio: {
      setAutoMixMode: async () => true,
      invalidateAutoMixSource: () => {},
      stop: async () => {
        await engineAdapter.stop()
      }
    }
  })

  const playbackSession = new CorePlaybackSession({
    engine: engineAdapter,
    queues: {
      buildQueue: (cmd) => queueStore.buildQueue(cmd),
      createQueue: (query, selectedId) => queueStore.createQueue(query, selectedId),
      getQueue: (id) => queueStore.getQueue(id),
      readQueue: (id, offset, limit, opts) => queueStore.readQueue(id, offset, limit, opts),
      editQueue: (id, rev, edit) => queueStore.editQueue(id, rev, edit),
      deleteQueue: (id, rev) => queueStore.deleteQueue(id, rev),
      readNeighbor: (id, rev, idx, dir, wrap) =>
        queueStore.readNeighbor(id, rev, idx, dir, wrap),
      libraryRevision: async () => queueStore.getLibraryRevision(),
      importLegacyPlaybackQueue: (cmd) =>
        queueStore.buildQueue(cmd as unknown as LibraryQueueBuildCommand),
      restoreNamedPlaybackQueue: (cmd) =>
        queueStore.buildQueue(cmd as unknown as LibraryQueueBuildCommand),
      restoreHeartBaseQueue: async (base) => {
        const snapshot = await queueStore.getQueue(base.id)
        if (!snapshot) {
          throw new Error(`Heart base queue not found: ${base.id}`)
        }
        return { queue: snapshot, matched: true }
      }
    },
    resolver: {
      resolve: async (rawTrack) => {
        const track = rawTrack as TrackData
        if (options.resourceAccess?.resolveTrackSource) {
          return options.resourceAccess.resolveTrackSource(track)
        }
        return {
          source: track.filePath || track.streamUrl || `resource://${track.id}`,
          expiresAt: null
        }
      }
    },
    authorize: async (source) => {
      if (options.resourceAccess) {
        return options.resourceAccess.authorize(source)
      }
      return source
    },
    repository: sessionRepository,
    resumeMode: () => currentSettings.playbackResumeMode,
    now: () => clock.nowUnixMs(),
    schedule: (callback, delayMs) => {
      const handle = scheduler.schedule(delayMs, callback)
      return () => handle.cancel()
    },
    observePlayback: (track, info) => {
      bookmarksService.observe(track, info)
      lyricsService.observe(track)
      presentationService.observe(track)
    },
    changed: () => {
      appInstance?.changed()
    },
    fatal: (error) => {
      options.onFatalError?.(error)
    }
  })

  const queueSubmission = new CoreQueueSubmission({
    playback: playbackSession,
    resolve: (items) => resolveSeedItems(items),
    newId: () => `sub-${crypto.randomUUID().slice(0, 8)}`,
    schedule: (callback, delayMs) => {
      const handle = scheduler.schedule(delayMs, callback)
      return () => handle.cancel()
    }
  })

  const application = new CoreApplication({
    epoch,
    playback: playbackSession,
    queueSubmission,
    playlistSubmission,
    resolvePlaylistInputs,
    presentation: presentationService,
    settings: settingsService,
    bookmarks: bookmarksService,
    lyrics: lyricsService,
    recordingVersions,
    playlists: playlistsService,
    search: searchService,
    libraryRevision: () => queueStore.getLibraryRevision(),
    library: {
      getMetadata: () => queueStore.getMetadata(),
      queryTracks: (query) => queueStore.queryTracks(query),
      readLibraryQueue: (id, offset, limit, opts) =>
        queueStore.readQueue(id, offset, limit, opts),
      queryCollections: (kind, query) => queueStore.queryCollections(kind, query),
      getTracksByIds: (ids) => queueStore.getTracksByIds(ids),
      lookupTracksByPaths: (paths) => queueStore.lookupTracksByPaths(paths),
      lookupPlaylistTracks: (req) => queueStore.lookupPlaylistTracks(req)
    },
    state: stateApi,
    scan: {
      initialize: async () => {},
      activate: () => {},
      snapshot: () => null,
      start: async () => {
        throw new Error('Local directory scan is managed by the platform scanner adapter')
      },
      pause: async () => false,
      resume: async () => null,
      cancel: async () => false,
      enqueueDirectories: async () => {},
      startup: async () => {},
      poll: async () => undefined,
      shutdown: async () => {}
    },
    statistics: {
      initialize: async () => {},
      getRevision: () => 0,
      historySnapshot: () => new Map(),
      summary: () => ({
        revision: 0,
        trackCount: 0,
        days: {},
        persistence: { dirty: false, failureCount: 0, error: null }
      }),
      page: () => ({ revision: 0, total: 0, offset: 0, items: [] }),
      overview: async () => ({
        revision: 0,
        trackCount: 0,
        days: {},
        persistence: { dirty: false, failureCount: 0, error: null },
        recorded: { seconds: 0, plays: 0, trackCount: 0, formats: [] },
        artists: [],
        history: { mode: 'sqlite', ready: true, pending: false, revision: 0, error: '' }
      }),
      previewClear: (_range, revision) => ({
        revision,
        dayCount: 0,
        seconds: 0,
        trackCount: 0,
        hasUndatedTracks: false
      }),
      observe: () => {},
      clear: async () => {},
      flush: async () => {},
      shutdown: async () => {}
    },
    ready: () => {}
  })

  appInstance = application

  const messageSubscribers = new Set<(message: CoreClientMessage) => void>()
  const hostClientIdentity: CoreClientIdentity = {
    id: 'portable-host-client',
    role: 'system',
    permissions: [...PORTABLE_HOST_PERMISSIONS]
  }
  application.connect(hostClientIdentity, (message) => {
    for (const sub of [...messageSubscribers]) {
      sub(message)
    }
  })

  const dispatchEnvelope = (message: CoreRequestEnvelope | CoreCancelEnvelope) => {
    if (message.kind === 'cancel') {
      application.cancel(hostClientIdentity.id, message.requestId, message.epoch)
    } else {
      void application.request(hostClientIdentity.id, message)
    }
  }

  const createCustomPlaylist = (name: string, trackIds: readonly string[] = []): CorePlaylistView => {
    customPlaylistIdCounter += 1
    const cleanName = String(name || 'Untitled Playlist').trim() || 'Untitled Playlist'
    const uniqueTracks = [...new Set(trackIds.map((id) => String(id)).filter((id) => id.length > 0))]
    const created: CorePlaylistView = {
      id: `pl-${clock.nowUnixMs()}-${customPlaylistIdCounter}`,
      name: cleanName,
      trackIds: uniqueTracks,
      trackCount: uniqueTracks.length,
      updatedAtMs: clock.nowUnixMs()
    }
    customPlaylists.push(created)
    playlistsRevision++
    void persistEnvelope()
    application.changed()
    return structuredClone(created)
  }

  const deleteCustomPlaylist = (playlistId: string): boolean => {
    const idx = customPlaylists.findIndex((p) => p.id === playlistId)
    if (idx < 0) return false
    customPlaylists.splice(idx, 1)
    playlistsRevision++
    void persistEnvelope()
    application.changed()
    return true
  }

  const renameCustomPlaylist = (playlistId: string, name: string): CorePlaylistView | null => {
    const target = customPlaylists.find((p) => p.id === playlistId)
    if (!target) return null
    const cleanName = String(name || '').trim()
    if (!cleanName) return structuredClone(target)
    target.name = cleanName
    target.updatedAtMs = clock.nowUnixMs()
    playlistsRevision++
    void persistEnvelope()
    application.changed()
    return structuredClone(target)
  }

  const addTracksToCustomPlaylist = (
    playlistId: string,
    trackIds: readonly string[]
  ): CorePlaylistView | null => {
    const target = customPlaylists.find((p) => p.id === playlistId)
    if (!target) return null
    const merged = new Set(target.trackIds)
    for (const rawId of trackIds) {
      const id = String(rawId || '').trim()
      if (id.length > 0) merged.add(id)
    }
    target.trackIds = [...merged]
    target.trackCount = target.trackIds.length
    target.updatedAtMs = clock.nowUnixMs()
    playlistsRevision++
    void persistEnvelope()
    application.changed()
    return structuredClone(target)
  }

  const removeTrackFromCustomPlaylist = (
    playlistId: string,
    trackId: string
  ): CorePlaylistView | null => {
    const target = customPlaylists.find((p) => p.id === playlistId)
    if (!target) return null
    target.trackIds = target.trackIds.filter((id) => id !== trackId)
    target.trackCount = target.trackIds.length
    target.updatedAtMs = clock.nowUnixMs()
    playlistsRevision++
    void persistEnvelope()
    application.changed()
    return structuredClone(target)
  }

  return {
    epoch,
    protocolVersion: CORE_PROTOCOL_VERSION,
    application,
    playback: playbackSession,
    settings: settingsService,
    queueStore,
    async initialize() {
      await ensureEnvelopeLoaded()
      await application.initialize()
    },
    seedTracks(tracks) {
      queueStore.upsertTracks(tracks)
      application.changed()
    },
    async playTracks(tracks, startIndex = 0) {
      queueStore.upsertTracks(tracks)
      await playbackSession.fromPages(
        async (append) => {
          await append(
            tracks.map((track) => {
              const record = toTrackRecord(track)
              return {
                id: record.id,
                snapshot: record,
                localSnapshot: record
              }
            })
          )
        },
        {
          selectedIndex: startIndex
        }
      )
      await playbackSession.flush()
    },
    getSnapshot() {
      return application.snapshot(hostClientIdentity)
    },
    getSnapshotJson() {
      return JSON.stringify(application.snapshot(hostClientIdentity))
    },
    dispatchRequest(message) {
      dispatchEnvelope(message)
    },
    dispatchRequestJson(messageJson) {
      const parsed = JSON.parse(messageJson) as CoreRequestEnvelope | CoreCancelEnvelope
      dispatchEnvelope(parsed)
    },
    subscribeMessages(listener) {
      messageSubscribers.add(listener)
      return () => {
        messageSubscribers.delete(listener)
      }
    },
    subscribeMessagesJson(listener) {
      const wrapped = (message: CoreClientMessage) => {
        listener(JSON.stringify(message))
      }
      messageSubscribers.add(wrapped)
      return () => {
        messageSubscribers.delete(wrapped)
      }
    },
    createCustomPlaylist,
    deleteCustomPlaylist,
    renameCustomPlaylist,
    addTracksToCustomPlaylist,
    removeTrackFromCustomPlaylist,
    listCustomPlaylists() {
      return structuredClone(customPlaylists)
    },
    getLibraryCollections() {
      return aggregateLibraryCollections(queueStore.getAllTracks())
    },
    getEqConfig() {
      return structuredClone(eqConfig)
    },
    setEqConfig(patch) {
      eqConfig = applyEqConfigPatch(eqConfig, patch)
      void options.audioEngine.setDspConfig?.(structuredClone(eqConfig))
      void persistEnvelope()
      application.changed()
      return structuredClone(eqConfig)
    },
    async triggerPlatformSafetyBrake(_reason) {
      await playbackSession.pause()
      await playbackSession.flush()
    },
    async shutdown() {
      application.disconnect(hostClientIdentity.id)
      messageSubscribers.clear()
      await application.shutdown()
      engineAdapter.dispose()
    }
  }
}

export { CORE_PROTOCOL_VERSION, libraryQueueResumeMode }

// ============================================================================
// Embedded JS Bridge Host (`globalThis.__TWILIGHT_PORTABLE_CORE__`)
// ============================================================================

interface EmbeddedTrackView {
  id: string
  queueEntryId?: string
  title: string
  artist: string
  artists?: string[]
  album: string
  source?: string
  duration: number
  format?: string
  sampleRate?: number
  bitDepth?: number
  bitrate?: number
}

interface EmbeddedBookmarkView {
  id: string
  trackId: string
  positionSec: number
  label: string
  createdAtMs: number
}

interface EmbeddedLyricLine {
  timeMs: number
  text: string
  translation?: string | null
}

interface EmbeddedAudioSnapshot {
  engineSessionId: string
  state: string
  positionMs: number
  durationMs: number | null
  volume: number
  playbackRate: number
  playMode: string
  queueIndex: number
  codec: string | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  outputBackend: string | null
  actualSampleRate: number | null
  actualBitDepth: number | null
  outputPerfect: boolean
}

const EMBEDDED_DEMO_TRACKS: readonly EmbeddedTrackView[] = [
  {
    id: 'track-twilight-overture',
    queueEntryId: 'occ-0-track-twilight-overture',
    title: 'Twilight Overture (Hi-Res Master)',
    artist: 'Aether Ensemble',
    artists: ['Aether Ensemble'],
    album: 'Echoes of Dusk',
    source: 'content://media/external/audio/media/1001',
    duration: 248.0,
    format: 'FLAC',
    sampleRate: 96000,
    bitDepth: 24,
    bitrate: 2822
  },
  {
    id: 'track-nocturne-in-cobalt',
    queueEntryId: 'occ-1-track-nocturne-in-cobalt',
    title: 'Nocturne in Cobalt',
    artist: 'Lumina Quartet',
    artists: ['Lumina Quartet'],
    album: 'Midnight Resonance',
    source: 'content://media/external/audio/media/1002',
    duration: 312.0,
    format: 'FLAC',
    sampleRate: 192000,
    bitDepth: 24,
    bitrate: 4608
  },
  {
    id: 'track-solstice-drift',
    queueEntryId: 'occ-2-track-solstice-drift',
    title: 'Solstice Drift',
    artist: 'Kairo & Sorel',
    artists: ['Kairo', 'Sorel'],
    album: 'Horizon Line',
    source: 'content://media/external/audio/media/1003',
    duration: 196.0,
    format: 'WAV',
    sampleRate: 48000,
    bitDepth: 24,
    bitrate: 2304
  }
]

const EMBEDDED_DEMO_LYRICS: Record<string, readonly EmbeddedLyricLine[]> = {
  'track-twilight-overture': [
    { timeMs: 0, text: 'Twilight Overture — Aether Ensemble', translation: '暮光序曲 — 以太合奏团' },
    { timeMs: 6500, text: 'When the amber sun sinks beneath the glass horizon', translation: '当琥珀色的夕阳沉入琉璃地平线' },
    { timeMs: 14000, text: 'Strings awaken in the hush of the concert hall', translation: '弦音在音乐厅的静谧中苏醒' },
    { timeMs: 22400, text: 'A distant echo answers from the northern ridge', translation: '远方的回声自北岭应和' }
  ],
  'track-nocturne-in-cobalt': [
    { timeMs: 0, text: 'Nocturne in Cobalt — Lumina Quartet', translation: '钴蓝夜曲 — 流光四重奏' },
    { timeMs: 8000, text: 'Cobalt rain traces silver lines on the windowpane', translation: '钴蓝色的雨在窗棂勾勒银线' }
  ],
  'track-solstice-drift': [
    { timeMs: 0, text: 'Solstice Drift — Kairo & Sorel', translation: '至日漂流 — Kairo & Sorel' },
    { timeMs: 5800, text: 'Warm analog waves meet the winter solstice wind', translation: '温暖的模拟声浪邂逅冬至的微风' }
  ]
}

interface EmbeddedBridgeState {
  epoch: string
  protocolVersion: number
  sequence: number
  queueRevision: number
  libraryRevision: number
  playlistsRevision: number
  lyricsRevision: number
  sessionStoreRevision: string | null
  lastRequestId: string | null
  libraryTracks: EmbeddedTrackView[]
  queueTracks: EmbeddedTrackView[]
  currentQueueIndex: number
  currentPlayMode: string
  favoriteTrackIds: string[]
  bookmarks: EmbeddedBookmarkView[]
  playlists: CorePlaylistView[]
  eqConfig: CoreEqConfigView
  customLyrics: Record<
    string,
    { trackId: string; source: string; synced: boolean; lines: EmbeddedLyricLine[] }
  >
  latestAudioSnapshot: EmbeddedAudioSnapshot
  idCounter: number
}

function parseEmbeddedLrcLines(rawText: string): { synced: boolean; lines: EmbeddedLyricLine[] } {
  const rawLines = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
  const timedMap = new Map<number, EmbeddedLyricLine>()
  const untimed: EmbeddedLyricLine[] = []
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim()
    if (!trimmed) continue
    const matches = [...trimmed.matchAll(timeRegex)]
    if (matches.length === 0) {
      if (!/^\[(ti|ar|al|by|offset):/i.test(trimmed)) {
        untimed.push({ timeMs: untimed.length * 4000, text: trimmed, translation: null })
      }
      continue
    }
    const textContent = trimmed.replace(timeRegex, '').trim()
    if (!textContent) continue
    for (const match of matches) {
      const minutes = Number(match[1] || 0)
      const seconds = Number(match[2] || 0)
      const fracRaw = match[3] || '0'
      const millis =
        fracRaw.length === 1
          ? Number(fracRaw) * 100
          : fracRaw.length === 2
            ? Number(fracRaw) * 10
            : Number(fracRaw.slice(0, 3))
      const timeMs = minutes * 60_000 + seconds * 1000 + millis
      const existing = timedMap.get(timeMs)
      if (existing) {
        if (!existing.translation) {
          existing.translation = textContent
        }
      } else {
        timedMap.set(timeMs, { timeMs, text: textContent, translation: null })
      }
    }
  }

  if (timedMap.size > 0) {
    const sorted = [...timedMap.values()].sort((a, b) => a.timeMs - b.timeMs)
    return { synced: true, lines: sorted }
  }
  return { synced: false, lines: untimed }
}

function createInitialEmbeddedBridgeState(): EmbeddedBridgeState {
  return {
    epoch: 'epoch-js-default',
    protocolVersion: CORE_PROTOCOL_VERSION,
    sequence: 1,
    queueRevision: 1,
    libraryRevision: 1,
    playlistsRevision: 1,
    lyricsRevision: 1,
    sessionStoreRevision: null,
    lastRequestId: null,
    libraryTracks: structuredClone(EMBEDDED_DEMO_TRACKS) as EmbeddedTrackView[],
    queueTracks: structuredClone(EMBEDDED_DEMO_TRACKS) as EmbeddedTrackView[],
    currentQueueIndex: 0,
    currentPlayMode: 'sequence',
    favoriteTrackIds: [],
    bookmarks: [],
    playlists: [],
    eqConfig: createDefaultEqConfig(),
    customLyrics: {},
    latestAudioSnapshot: {
      engineSessionId: 'tae-embedded-session',
      state: 'paused',
      positionMs: 0,
      durationMs: 248000,
      volume: 1.0,
      playbackRate: 1.0,
      playMode: 'sequence',
      queueIndex: 0,
      codec: 'FLAC',
      sampleRate: 96000,
      bitDepth: 24,
      channels: 2,
      outputBackend: 'oboe',
      actualSampleRate: 96000,
      actualBitDepth: 24,
      outputPerfect: true
    },
    idCounter: 0
  }
}

let activeEmbeddedHostState: EmbeddedBridgeState = createInitialEmbeddedBridgeState()

function getHostBridge(): {
  invokePort?: (portName: string, methodName: string, argsJson: string) => string
  emitCoreEvent?: (eventJson: string) => void
} | null {
  const g = globalThis as Record<string, any>
  if (g.__TWILIGHT_HOST_BRIDGE__ && typeof g.__TWILIGHT_HOST_BRIDGE__ === 'object') {
    return g.__TWILIGHT_HOST_BRIDGE__
  }
  return null
}

function invokeHostBridgePort(
  portName: string,
  methodName: string,
  args: Record<string, unknown> = {}
): { ok: boolean; value?: any; error?: { code: string; message: string; retryable?: boolean } } | null {
  const bridge = getHostBridge()
  if (!bridge || typeof bridge.invokePort !== 'function') return null
  try {
    const raw = bridge.invokePort(portName, methodName, JSON.stringify(args))
    if (typeof raw === 'string' && raw.length > 0) {
      return JSON.parse(raw)
    }
  } catch {
    // Ignore host bridge invocation failure in fallback environments
  }
  return null
}

function nowEmbeddedUnixMs(): number {
  const res = invokeHostBridgePort('clock', 'nowUnixMs', {})
  if (res && res.ok && typeof res.value === 'number') {
    return res.value
  }
  return Date.now()
}

function buildEmbeddedLyricsForTrack(track: EmbeddedTrackView) {
  const custom = activeEmbeddedHostState.customLyrics[track.id]
  if (custom && Array.isArray(custom.lines) && custom.lines.length > 0) {
    return {
      trackId: track.id,
      source: custom.source || 'online',
      synced: custom.synced !== false,
      lines: [...custom.lines]
    }
  }
  const demoLines = EMBEDDED_DEMO_LYRICS[track.id]
  if (demoLines) {
    return {
      trackId: track.id,
      source: 'embedded',
      synced: true,
      lines: [...demoLines]
    }
  }
  const durationSec = Math.max(30, Number(track.duration) || 30)
  const stepMs = Math.round(Math.max(4, durationSec / 7) * 1000)
  return {
    trackId: track.id,
    source: 'generated',
    synced: true,
    lines: [
      { timeMs: 0, text: `♪ ${track.title} — ${track.artist}`, translation: `专辑：${track.album}` },
      { timeMs: stepMs, text: 'Streaming through Twilight Echo Audio Core', translation: '通过 Twilight Echo 原生音频核心播放' },
      { timeMs: stepMs * 2, text: 'Every detail rendered in pure resolution', translation: '每一处细节皆以纯净解析呈现' }
    ]
  }
}

function fetchEmbeddedOnlineLyrics(
  trackId: string,
  title: string,
  artist: string,
  album: string,
  customUrl?: string
): { trackId: string; source: string; synced: boolean; lines: EmbeddedLyricLine[] } | null {
  const st = activeEmbeddedHostState
  const targetUrl =
    customUrl && customUrl.trim().length > 0
      ? customUrl.trim()
      : `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}&album_name=${encodeURIComponent(album)}`
  const netRes = invokeHostBridgePort('network', 'request', {
    url: targetUrl,
    method: 'GET',
    timeoutMs: 8000,
    headers: { Accept: 'application/json, text/plain;q=0.9' }
  })
  const rawBody =
    netRes && netRes.ok && netRes.value
      ? typeof netRes.value.bodyUtf8 === 'string'
        ? netRes.value.bodyUtf8
        : typeof netRes.value.bodyText === 'string'
          ? netRes.value.bodyText
          : null
      : null
  if (rawBody !== null) {
    const status = Number(netRes?.value?.statusCode ?? 200)
    const bodyText = rawBody.trim()
    if (status >= 200 && status < 300 && bodyText.length > 0) {
      let rawLrc = bodyText
      try {
        const parsedJson = JSON.parse(bodyText)
        if (parsedJson && typeof parsedJson === 'object') {
          rawLrc = String(parsedJson.syncedLyrics || parsedJson.plainLyrics || parsedJson.lrc || '')
        }
      } catch {
        // Treat bodyText directly as LRC text
      }
      const parsedLrc = parseEmbeddedLrcLines(rawLrc)
      if (parsedLrc.lines.length > 0) {
        const record = {
          trackId,
          source: 'online',
          synced: parsedLrc.synced,
          lines: parsedLrc.lines
        }
        st.customLyrics[trackId] = record
        st.lyricsRevision += 1
        return record
      }
    }
  }
  return null
}

function buildEmbeddedSnapshot(errorMessage: string | null = null) {
  const st = activeEmbeddedHostState
  const currentTrack = st.queueTracks[st.currentQueueIndex] ?? null
  const nextIndex = st.queueTracks.length > 0 ? (st.currentQueueIndex + 1) % st.queueTracks.length : -1
  const nextTrack = nextIndex >= 0 ? st.queueTracks[nextIndex] : null
  const upcomingTrack = nextTrack
    ? {
        id: nextTrack.id,
        queueEntryId: nextTrack.queueEntryId || `occ-${nextIndex}-${nextTrack.id}`,
        title: nextTrack.title,
        artist: nextTrack.artist,
        album: nextTrack.album,
        duration: nextTrack.duration
      }
    : null

  const audio = st.latestAudioSnapshot
  const mappedState =
    audio.state === 'playing' || audio.state === 'paused' || audio.state === 'loading' || audio.state === 'error'
      ? audio.state
      : 'stopped'

  const routeRes = invokeHostBridgePort('audioDevice', 'getActiveRoute', {})
  const activeRoute = routeRes && routeRes.ok && routeRes.value ? routeRes.value : null
  const resolvedOutputBackend =
    activeRoute && typeof activeRoute.routeType === 'string' && activeRoute.routeType !== 'speaker'
      ? `${audio.outputBackend || 'oboe'}:${activeRoute.routeType}`
      : audio.outputBackend || 'oboe'
  const routeSampleRate =
    activeRoute && typeof activeRoute.activeSampleRate === 'number' && activeRoute.activeSampleRate > 0
      ? activeRoute.activeSampleRate
      : activeRoute && typeof activeRoute.sampleRateHz === 'number' && activeRoute.sampleRateHz > 0
        ? activeRoute.sampleRateHz
        : null
  const resolvedActualSampleRate = routeSampleRate || audio.actualSampleRate || 96000
  const routeBitDepth =
    activeRoute && typeof activeRoute.maxBitDepth === 'number' && activeRoute.maxBitDepth > 0
      ? activeRoute.maxBitDepth
      : activeRoute && typeof activeRoute.bitDepth === 'number' && activeRoute.bitDepth > 0
        ? activeRoute.bitDepth
        : null
  const resolvedActualBitDepth = routeBitDepth || audio.actualBitDepth || 24
  const routeBitPerfectCapable =
    activeRoute && typeof activeRoute.isUsbHiResCapable === 'boolean'
      ? activeRoute.isUsbHiResCapable
      : activeRoute && typeof activeRoute.isBitPerfectCapable === 'boolean'
        ? activeRoute.isBitPerfectCapable
        : true

  const collections = aggregateLibraryCollections(st.libraryTracks)

  return {
    protocolVersion: st.protocolVersion,
    epoch: st.epoch,
    sequence: st.sequence,
    phase: 'ready',
    playback: {
      state: mappedState,
      position: (audio.positionMs || 0) / 1000,
      duration:
        audio.durationMs && audio.durationMs > 0
          ? audio.durationMs / 1000
          : currentTrack?.duration ?? 0,
      volume: audio.volume ?? 1.0,
      playbackRate: audio.playbackRate ?? 1.0,
      playMode: st.currentPlayMode,
      queueIndex: st.currentQueueIndex,
      queueRevision: st.queueRevision,
      upcomingQueueIndex: nextIndex >= 0 ? nextIndex : null,
      nativePlaybackActive: mappedState === 'playing',
      codec: audio.codec || currentTrack?.format || 'FLAC',
      bitrate: currentTrack?.bitrate || 1411,
      sourceSampleRate: audio.sampleRate || currentTrack?.sampleRate || 96000,
      sourceBitDepth: audio.bitDepth || currentTrack?.bitDepth || 24,
      sourceChannels: audio.channels || 2,
      outputBackend: resolvedOutputBackend,
      actualSampleRate: resolvedActualSampleRate,
      actualBitDepth: resolvedActualBitDepth,
      actualChannels: 2,
      outputPerfect: Boolean(st.eqConfig.bitPerfect && !st.eqConfig.enabled && routeBitPerfectCapable),
      gaplessActive: st.eqConfig.gapless,
      preloadReady: upcomingTrack !== null,
      upcomingTrack
    },
    track: currentTrack,
    queue: {
      id: 'default',
      revision: st.queueRevision,
      total: st.queueTracks.length,
      index: st.currentQueueIndex,
      occurrenceId: currentTrack
        ? currentTrack.queueEntryId || `occ-${st.currentQueueIndex}-${currentTrack.id}`
        : null
    },
    error: errorMessage,
    libraryRevision: st.libraryRevision,
    playlistsRevision: st.playlistsRevision,
    lyricsRevision: st.lyricsRevision,
    favoriteTrackIds: [...st.favoriteTrackIds],
    bookmarks: [...st.bookmarks],
    playlists: structuredClone(st.playlists),
    albums: collections.albums,
    artists: collections.artists,
    eqConfig: structuredClone(st.eqConfig),
    currentLyrics: currentTrack ? buildEmbeddedLyricsForTrack(currentTrack) : null,
    libraryTrackCount: st.libraryTracks.length
  }
}

function persistEmbeddedSession() {
  const st = activeEmbeddedHostState
  const payload = JSON.stringify({
    queueRevision: st.queueRevision,
    currentQueueIndex: st.currentQueueIndex,
    playMode: st.currentPlayMode,
    favoriteTrackIds: st.favoriteTrackIds,
    bookmarks: st.bookmarks,
    playlists: st.playlists,
    eqConfig: st.eqConfig
  })
  const res = invokeHostBridgePort('sessionStore', 'save', {
    payloadJson: payload,
    expectedRevision: st.sessionStoreRevision
  })
  if (res && res.ok && res.value) {
    if (res.value.ok && typeof res.value.revision === 'string') {
      st.sessionStoreRevision = res.value.revision
    } else if (typeof res.value.actualRevision === 'string') {
      st.sessionStoreRevision = res.value.actualRevision
    }
  }
}

function publishEmbeddedEvent(errorMessage: string | null = null) {
  const st = activeEmbeddedHostState
  st.sequence += 1
  const snapshot = buildEmbeddedSnapshot(errorMessage)
  const bridge = getHostBridge()
  if (bridge && typeof bridge.emitCoreEvent === 'function') {
    try {
      bridge.emitCoreEvent(
        JSON.stringify({
          epoch: st.epoch,
          sequence: st.sequence,
          snapshot
        })
      )
    } catch {
      // Ignore bridge emit error
    }
  }
  return snapshot
}

const globalNamespace = globalThis as Record<string, unknown>
globalNamespace.__TWILIGHT_PORTABLE_CORE__ = {
  CORE_PROTOCOL_VERSION,
  PORTABLE_EQ_PRESETS,
  createPortableMusicCoreHost,
  createHost: createPortableMusicCoreHost,
  ensurePortableRuntimeGlobals,
  aggregateLibraryCollections,
  applyEqConfigPatch,
  parseEmbeddedLrcLines,
  bootHost(rawConfig?: string | { epoch?: string; protocolVersion?: number }) {
    const cfg =
      typeof rawConfig === 'string' && rawConfig.trim().length > 0
        ? (JSON.parse(rawConfig) as { epoch?: string; protocolVersion?: number })
        : typeof rawConfig === 'object' && rawConfig !== null
          ? rawConfig
          : {}
    activeEmbeddedHostState = createInitialEmbeddedBridgeState()
    if (cfg.epoch) activeEmbeddedHostState.epoch = cfg.epoch
    if (cfg.protocolVersion) activeEmbeddedHostState.protocolVersion = cfg.protocolVersion

    // Restore persisted session from host bridge if available
    const loaded = invokeHostBridgePort('sessionStore', 'load', {})
    if (loaded && loaded.ok && loaded.value && typeof loaded.value.payloadJson === 'string') {
      activeEmbeddedHostState.sessionStoreRevision = loaded.value.revision ?? null
      try {
        const parsed = JSON.parse(loaded.value.payloadJson)
        if (typeof parsed.queueRevision === 'number') activeEmbeddedHostState.queueRevision = parsed.queueRevision
        if (typeof parsed.currentQueueIndex === 'number') activeEmbeddedHostState.currentQueueIndex = parsed.currentQueueIndex
        if (typeof parsed.playMode === 'string') activeEmbeddedHostState.currentPlayMode = parsed.playMode
        if (Array.isArray(parsed.favoriteTrackIds)) activeEmbeddedHostState.favoriteTrackIds = parsed.favoriteTrackIds
        if (Array.isArray(parsed.bookmarks)) activeEmbeddedHostState.bookmarks = parsed.bookmarks
        if (Array.isArray(parsed.playlists)) activeEmbeddedHostState.playlists = parsed.playlists
        if (parsed.eqConfig) {
          activeEmbeddedHostState.eqConfig = applyEqConfigPatch(createDefaultEqConfig(), parsed.eqConfig)
        }
      } catch {
        // Ignore malformed stored session
      }
    }

    if (activeEmbeddedHostState.queueTracks.length > 0) {
      invokeHostBridgePort('audioEngine', 'loadQueue', {
        tracks: activeEmbeddedHostState.queueTracks,
        startIndex: activeEmbeddedHostState.currentQueueIndex
      })
    }
    const snapRes = invokeHostBridgePort('audioEngine', 'getSnapshot', {})
    if (snapRes && snapRes.ok && snapRes.value && typeof snapRes.value === 'object') {
      activeEmbeddedHostState.latestAudioSnapshot = {
        ...activeEmbeddedHostState.latestAudioSnapshot,
        ...snapRes.value
      }
    }
    publishEmbeddedEvent()

    return JSON.stringify({
      ok: true,
      epoch: activeEmbeddedHostState.epoch,
      protocolVersion: activeEmbeddedHostState.protocolVersion
    })
  },
  handleRequest(
    rawEnvelope?:
      | string
      | {
          kind?: string
          requestId?: string
          epoch?: string
          name?: string
          expectedRevision?: number | null
          payload?: Record<string, any>
        }
  ) {
    const env =
      typeof rawEnvelope === 'string' && rawEnvelope.trim().length > 0
        ? (JSON.parse(rawEnvelope) as {
            kind?: string
            requestId?: string
            epoch?: string
            name?: string
            expectedRevision?: number | null
            payload?: Record<string, any>
          })
        : typeof rawEnvelope === 'object' && rawEnvelope !== null
          ? rawEnvelope
          : {}
    const st = activeEmbeddedHostState
    const requestId = env.requestId ?? 'req-unknown'
    st.lastRequestId = requestId
    const name = env.name ?? ''
    const payload = env.payload ?? {}

    if (env.kind === 'query') {
      if (name === 'core.getSnapshot' || name === 'state.snapshot') {
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: buildEmbeddedSnapshot()
        })
      }
      if (name === 'playback.getQueueWindow' || name === 'queue.page') {
        const offset = Number(payload.offset ?? 0)
        const limit = Number(payload.limit ?? 50)
        const items = st.queueTracks.slice(offset, offset + limit).map((track, idx) => {
          const absIndex = offset + idx
          return {
            occurrenceId: track.queueEntryId || `occ-${absIndex}-${track.id}`,
            index: absIndex,
            track
          }
        })
        const currentTrack = st.queueTracks[st.currentQueueIndex]
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: {
            queueId: 'default',
            revision: st.queueRevision,
            total: st.queueTracks.length,
            offset,
            limit,
            currentIndex: st.currentQueueIndex,
            currentOccurrenceId: currentTrack
              ? currentTrack.queueEntryId || `occ-${st.currentQueueIndex}-${currentTrack.id}`
              : null,
            items
          }
        })
      }
      if (name === 'search.songs') {
        const q = String(payload.query ?? '').trim().toLowerCase()
        const matched = q
          ? st.libraryTracks.filter(
              (t) =>
                t.title.toLowerCase().includes(q) ||
                t.artist.toLowerCase().includes(q) ||
                t.album.toLowerCase().includes(q)
            )
          : [...st.libraryTracks]
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: {
            query: String(payload.query ?? '').trim(),
            total: matched.length,
            items: matched
          }
        })
      }
      if (name === 'lyrics.current') {
        const targetId = payload.trackId ? String(payload.trackId) : null
        const targetTrack = targetId
          ? st.libraryTracks.find((t) => t.id === targetId) || st.queueTracks.find((t) => t.id === targetId)
          : st.queueTracks[st.currentQueueIndex]
        const lyricsView = targetTrack
          ? buildEmbeddedLyricsForTrack(targetTrack)
          : { trackId: targetId || 'none', source: 'none', synced: false, lines: [] }
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: lyricsView
        })
      }
      if (name === 'library.collections') {
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: aggregateLibraryCollections(st.libraryTracks)
        })
      }
      if (name === 'playlists.list') {
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: structuredClone(st.playlists)
        })
      }
      if (name === 'audio.getEq') {
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: structuredClone(st.eqConfig)
        })
      }
      if (name === 'audioDevice.getRoute') {
        const routeRes = invokeHostBridgePort('audioDevice', 'getActiveRoute', {})
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value:
            routeRes && routeRes.ok && routeRes.value
              ? routeRes.value
              : {
                  routeId: 'route-speaker-default',
                  routeType: 'speaker',
                  productName: 'Built-in Speaker',
                  sampleRateHz: 48000,
                  bitDepth: 16,
                  channels: 2,
                  isBitPerfectCapable: false
                }
        })
      }
      if (name === 'audioDevice.listDevices') {
        const listRes = invokeHostBridgePort('audioDevice', 'listOutputDevices', {})
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: listRes && listRes.ok && Array.isArray(listRes.value) ? listRes.value : []
        })
      }
      if (name === 'lyrics.fetchOnline') {
        const targetId = payload.trackId ? String(payload.trackId) : null
        const targetTrack = targetId
          ? st.libraryTracks.find((t) => t.id === targetId) || st.queueTracks.find((t) => t.id === targetId)
          : st.queueTracks[st.currentQueueIndex]
        const resolvedTrackId = targetTrack?.id || targetId || 'unknown'
        const fetched = fetchEmbeddedOnlineLyrics(
          resolvedTrackId,
          String(payload.title || targetTrack?.title || ''),
          String(payload.artist || targetTrack?.artist || ''),
          String(payload.album || targetTrack?.album || ''),
          typeof payload.url === 'string' ? payload.url : undefined
        )
        const fallbackView = targetTrack
          ? buildEmbeddedLyricsForTrack(targetTrack)
          : { trackId: resolvedTrackId, source: 'none', synced: false, lines: [] }
        return JSON.stringify({
          requestId,
          epoch: st.epoch,
          ok: true,
          value: fetched || fallbackView
        })
      }
      return JSON.stringify({
        requestId,
        epoch: st.epoch,
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: `Unsupported query: ${name}`,
          retryable: false
        }
      })
    }

    // Optimistic concurrency check for queue-mutating commands
    const requiresRevCheck =
      name === 'playback.selectQueueIndex' ||
      name === 'playback.replaceQueue' ||
      name === 'queue.select' ||
      name === 'queue.edit'
    if (
      requiresRevCheck &&
      env.expectedRevision !== undefined &&
      env.expectedRevision !== null &&
      env.expectedRevision !== st.queueRevision
    ) {
      return JSON.stringify({
        requestId,
        epoch: st.epoch,
        ok: false,
        error: {
          code: 'STALE_REVISION',
          message: `Expected queue revision ${env.expectedRevision}, but authoritative revision is ${st.queueRevision}`,
          retryable: true
        }
      })
    }

    // Handle commands
    switch (name) {
      case 'playback.play': {
        const positionSec = typeof payload.position === 'number' ? payload.position : undefined
        const activeTrack = st.queueTracks[st.currentQueueIndex]
        if (activeTrack) {
          const uriRes = invokeHostBridgePort('resourceAccess', 'resolveNativeUri', {
            resourceId: activeTrack.source || activeTrack.id
          })
          if (uriRes && !uriRes.ok && uriRes.error?.code === 'PERMISSION_EXPIRED') {
            return JSON.stringify({
              requestId,
              epoch: st.epoch,
              ok: false,
              error: {
                code: 'PERMISSION_EXPIRED',
                message: uriRes.error.message,
                retryable: false
              }
            })
          }
        }
        invokeHostBridgePort('audioEngine', 'play', positionSec !== undefined ? { position: positionSec } : {})
        st.latestAudioSnapshot.state = 'playing'
        if (positionSec !== undefined) {
          st.latestAudioSnapshot.positionMs = Math.round(positionSec * 1000)
        }
        break
      }
      case 'playback.pause': {
        invokeHostBridgePort('audioEngine', 'pause', {})
        st.latestAudioSnapshot.state = 'paused'
        break
      }
      case 'playback.stop': {
        invokeHostBridgePort('audioEngine', 'stop', {})
        st.latestAudioSnapshot.state = 'idle'
        st.latestAudioSnapshot.positionMs = 0
        break
      }
      case 'playback.seek': {
        const posSec = Number(payload.position ?? 0)
        const posMs = Math.max(0, Math.round(posSec * 1000))
        invokeHostBridgePort('audioEngine', 'seek', { positionMs: posMs })
        st.latestAudioSnapshot.positionMs = posMs
        break
      }
      case 'playback.next': {
        if (st.queueTracks.length > 0) {
          st.currentQueueIndex = (st.currentQueueIndex + 1) % st.queueTracks.length
          st.lyricsRevision += 1
          invokeHostBridgePort('audioEngine', 'next', {})
          persistEmbeddedSession()
        }
        break
      }
      case 'playback.previous': {
        if (st.queueTracks.length > 0) {
          st.currentQueueIndex =
            st.currentQueueIndex - 1 < 0 ? st.queueTracks.length - 1 : st.currentQueueIndex - 1
          st.lyricsRevision += 1
          invokeHostBridgePort('audioEngine', 'previous', {})
          persistEmbeddedSession()
        }
        break
      }
      case 'playback.setVolume':
      case 'playback.volume': {
        const vol = Math.max(0, Math.min(1, Number(payload.volume ?? 1)))
        invokeHostBridgePort('audioEngine', 'setVolume', { volume: vol })
        st.latestAudioSnapshot.volume = vol
        break
      }
      case 'playback.setPlayMode':
      case 'playback.mode': {
        const mode = String(payload.mode || 'sequence')
        st.currentPlayMode = mode
        invokeHostBridgePort('audioEngine', 'setPlayMode', { mode })
        persistEmbeddedSession()
        break
      }
      case 'playback.selectQueueIndex':
      case 'queue.select': {
        const idx = Number(payload.index ?? 0)
        if (idx >= 0 && idx < st.queueTracks.length) {
          st.currentQueueIndex = idx
          st.queueRevision += 1
          st.lyricsRevision += 1
          invokeHostBridgePort('audioEngine', 'selectQueueIndex', { index: idx })
          persistEmbeddedSession()
        }
        break
      }
      case 'playback.replaceQueue': {
        const incoming = Array.isArray(payload.tracks) ? (payload.tracks as EmbeddedTrackView[]) : []
        const startIndex = Number(payload.startIndex ?? 0)
        const playImmediately = payload.play !== false && payload.play !== 'false'
        if (incoming.length > 0) {
          st.queueTracks = structuredClone(incoming)
          st.currentQueueIndex = Math.max(0, Math.min(st.queueTracks.length - 1, startIndex))
          st.queueRevision += 1
          st.lyricsRevision += 1
          invokeHostBridgePort('audioEngine', 'loadQueue', {
            tracks: st.queueTracks,
            startIndex: st.currentQueueIndex
          })
          if (playImmediately) {
            invokeHostBridgePort('audioEngine', 'play', { position: 0 })
            st.latestAudioSnapshot.state = 'playing'
            st.latestAudioSnapshot.positionMs = 0
          }
          persistEmbeddedSession()
        }
        break
      }
      case 'library.syncTracks': {
        const scanned = Array.isArray(payload.tracks) ? (payload.tracks as EmbeddedTrackView[]) : []
        const merged = new Map<string, EmbeddedTrackView>()
        for (const t of EMBEDDED_DEMO_TRACKS) merged.set(t.id, structuredClone(t))
        for (const t of scanned) {
          if (t && typeof t.id === 'string') merged.set(t.id, structuredClone(t))
        }
        st.libraryTracks = [...merged.values()]
        st.libraryRevision += 1
        if (scanned.length > 0) {
          st.queueTracks = structuredClone(st.libraryTracks)
          st.currentQueueIndex = Math.max(0, Math.min(st.queueTracks.length - 1, st.currentQueueIndex))
          st.queueRevision += 1
          st.lyricsRevision += 1
          invokeHostBridgePort('audioEngine', 'loadQueue', {
            tracks: st.queueTracks,
            startIndex: st.currentQueueIndex
          })
        }
        persistEmbeddedSession()
        break
      }
      case 'playlists.toggleFavorite': {
        const trackId = String(payload.trackId || '').trim()
        if (trackId) {
          const idx = st.favoriteTrackIds.indexOf(trackId)
          if (idx >= 0) {
            st.favoriteTrackIds.splice(idx, 1)
          } else {
            st.favoriteTrackIds.push(trackId)
          }
          st.playlistsRevision += 1
          persistEmbeddedSession()
        }
        break
      }
      case 'playlists.create': {
        st.idCounter += 1
        const plName = String(payload.name || 'Untitled Playlist').trim() || 'Untitled Playlist'
        const rawIds = Array.isArray(payload.trackIds) ? payload.trackIds : []
        const trackIds = [...new Set(rawIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))]
        const created: CorePlaylistView = {
          id: `pl-${nowEmbeddedUnixMs()}-${st.idCounter}`,
          name: plName,
          trackIds,
          trackCount: trackIds.length,
          updatedAtMs: nowEmbeddedUnixMs()
        }
        st.playlists.push(created)
        st.playlistsRevision += 1
        persistEmbeddedSession()
        break
      }
      case 'playlists.delete': {
        const playlistId = String(payload.playlistId || '').trim()
        const idx = st.playlists.findIndex((p) => p.id === playlistId)
        if (idx >= 0) {
          st.playlists.splice(idx, 1)
          st.playlistsRevision += 1
          persistEmbeddedSession()
        }
        break
      }
      case 'playlists.rename': {
        const playlistId = String(payload.playlistId || '').trim()
        const newName = String(payload.name || '').trim()
        const target = st.playlists.find((p) => p.id === playlistId)
        if (target && newName) {
          target.name = newName
          target.updatedAtMs = nowEmbeddedUnixMs()
          st.playlistsRevision += 1
          persistEmbeddedSession()
        }
        break
      }
      case 'playlists.addTracks': {
        const playlistId = String(payload.playlistId || '').trim()
        const rawIds = Array.isArray(payload.trackIds) ? payload.trackIds : []
        const target = st.playlists.find((p) => p.id === playlistId)
        if (target) {
          const merged = new Set(target.trackIds)
          for (const r of rawIds) {
            const id = String(r || '').trim()
            if (id) merged.add(id)
          }
          target.trackIds = [...merged]
          target.trackCount = target.trackIds.length
          target.updatedAtMs = nowEmbeddedUnixMs()
          st.playlistsRevision += 1
          persistEmbeddedSession()
        }
        break
      }
      case 'playlists.removeTrack': {
        const playlistId = String(payload.playlistId || '').trim()
        const trackId = String(payload.trackId || '').trim()
        const target = st.playlists.find((p) => p.id === playlistId)
        if (target && trackId) {
          target.trackIds = target.trackIds.filter((id) => id !== trackId)
          target.trackCount = target.trackIds.length
          target.updatedAtMs = nowEmbeddedUnixMs()
          st.playlistsRevision += 1
          persistEmbeddedSession()
        }
        break
      }
      case 'bookmarks.add': {
        const activeTrack = st.queueTracks[st.currentQueueIndex]
        const trackId = String(payload.trackId || activeTrack?.id || '').trim()
        const positionSec =
          typeof payload.positionSec === 'number'
            ? payload.positionSec
            : (st.latestAudioSnapshot.positionMs || 0) / 1000
        const label = String(payload.label || `Bookmark @ ${Math.round(positionSec)}s`).trim()
        if (trackId) {
          st.idCounter += 1
          st.bookmarks.push({
            id: `bm-${nowEmbeddedUnixMs()}-${st.idCounter}`,
            trackId,
            positionSec,
            label,
            createdAtMs: nowEmbeddedUnixMs()
          })
          persistEmbeddedSession()
        }
        break
      }
      case 'bookmarks.remove': {
        const bmId = String(payload.bookmarkId || '').trim()
        if (bmId) {
          st.bookmarks = st.bookmarks.filter((b) => b.id !== bmId)
          persistEmbeddedSession()
        }
        break
      }
      case 'audio.setEq': {
        st.eqConfig = applyEqConfigPatch(st.eqConfig, payload as Partial<CoreEqConfigView>)
        invokeHostBridgePort('audioEngine', 'setDspConfig', {
          configJson: JSON.stringify(st.eqConfig)
        })
        persistEmbeddedSession()
        break
      }
      case 'lyrics.fetchOnline': {
        const targetId = payload.trackId ? String(payload.trackId) : null
        const targetTrack = targetId
          ? st.libraryTracks.find((t) => t.id === targetId) || st.queueTracks.find((t) => t.id === targetId)
          : st.queueTracks[st.currentQueueIndex]
        const resolvedTrackId = targetTrack?.id || targetId || 'unknown'
        fetchEmbeddedOnlineLyrics(
          resolvedTrackId,
          String(payload.title || targetTrack?.title || ''),
          String(payload.artist || targetTrack?.artist || ''),
          String(payload.album || targetTrack?.album || ''),
          typeof payload.url === 'string' ? payload.url : undefined
        )
        break
      }
      case 'lyrics.importLrc': {
        const activeTrack = st.queueTracks[st.currentQueueIndex]
        const trackId = String(payload.trackId || activeTrack?.id || '').trim()
        const rawLrc = String(payload.lrcText || payload.content || '').trim()
        if (trackId && rawLrc) {
          const parsedLrc = parseEmbeddedLrcLines(rawLrc)
          if (parsedLrc.lines.length > 0) {
            st.customLyrics[trackId] = {
              trackId,
              source: 'imported',
              synced: parsedLrc.synced,
              lines: parsedLrc.lines
            }
            st.lyricsRevision += 1
          }
        }
        break
      }
      case 'playback.platformInterruption': {
        const shouldPause = payload.shouldPause !== false && payload.shouldPause !== 'false'
        if (shouldPause) {
          invokeHostBridgePort('audioEngine', 'pause', {})
          st.latestAudioSnapshot.state = 'paused'
        }
        break
      }
      case 'settings.edit': {
        persistEmbeddedSession()
        break
      }
      default:
        break
    }

    const snapRes = invokeHostBridgePort('audioEngine', 'getSnapshot', {})
    if (snapRes && snapRes.ok && snapRes.value && typeof snapRes.value === 'object') {
      st.latestAudioSnapshot = {
        ...st.latestAudioSnapshot,
        ...snapRes.value
      }
    }

    const updatedSnapshot = publishEmbeddedEvent()
    return JSON.stringify({
      requestId,
      epoch: st.epoch,
      ok: true,
      value: {
        snapshot: updatedSnapshot
      }
    })
  },
  onAudioEngineEvent(rawEvent?: string | Record<string, any>) {
    const evt =
      typeof rawEvent === 'string' && rawEvent.trim().length > 0
        ? (JSON.parse(rawEvent) as Record<string, any>)
        : typeof rawEvent === 'object' && rawEvent !== null
          ? rawEvent
          : {}
    const st = activeEmbeddedHostState
    if (evt.type === 'track-ended' && st.queueTracks.length > 0) {
      if (st.currentPlayMode === 'single') {
        invokeHostBridgePort('audioEngine', 'seek', { positionMs: 0 })
        invokeHostBridgePort('audioEngine', 'play', { position: 0 })
      } else {
        st.currentQueueIndex = (st.currentQueueIndex + 1) % st.queueTracks.length
        st.lyricsRevision += 1
        invokeHostBridgePort('audioEngine', 'selectQueueIndex', { index: st.currentQueueIndex })
      }
      const snapRes = invokeHostBridgePort('audioEngine', 'getSnapshot', {})
      if (snapRes && snapRes.ok && snapRes.value && typeof snapRes.value === 'object') {
        st.latestAudioSnapshot = {
          ...st.latestAudioSnapshot,
          ...snapRes.value
        }
      }
    } else if (evt.snapshot && typeof evt.snapshot === 'object') {
      st.latestAudioSnapshot = {
        ...st.latestAudioSnapshot,
        ...evt.snapshot
      }
      if (
        typeof evt.snapshot.queueIndex === 'number' &&
        evt.snapshot.queueIndex >= 0 &&
        evt.snapshot.queueIndex < st.queueTracks.length
      ) {
        st.currentQueueIndex = evt.snapshot.queueIndex
      }
    }
    const updatedSnapshot = publishEmbeddedEvent(typeof evt.message === 'string' ? evt.message : null)
    return JSON.stringify({
      ok: true,
      epoch: st.epoch,
      sequence: st.sequence,
      snapshot: updatedSnapshot
    })
  },
  cancelRequest(rawCancel?: string | { requestId?: string }) {
    const cancel =
      typeof rawCancel === 'string' && rawCancel.trim().length > 0
        ? (JSON.parse(rawCancel) as { requestId?: string })
        : typeof rawCancel === 'object' && rawCancel !== null
          ? rawCancel
          : {}
    return JSON.stringify({
      ok: true,
      cancelledRequestId: cancel.requestId ?? null,
      epoch: activeEmbeddedHostState.epoch
    })
  }
}
