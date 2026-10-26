import { CoreApplication } from './application.ts'
import {
  CorePlaybackSession,
  type CorePlaybackEngine,
  type CoreSessionRepository
} from './playback/session.ts'
import { CoreQueueSubmission } from './playback/queueSubmission.ts'
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
  type LibraryMetadata,
  type LibraryPage,
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
import type { PlaybackSessionData } from '../shared/playbackSession.ts'
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
  getSnapshot(): Promise<PlaybackInfo>
  subscribe(listener: (event: PortableAudioNativeEvent) => void): PortableUnsubscribe
}

export interface PortableResourceAccessPort {
  authorize(resourceId: PortableResourceId): Promise<string>
  resolveTrackSource?(
    track: TrackData
  ): Promise<{ source: PortableResourceId; expiresAt: number | null }>
}

export interface PortableHostOptions {
  epoch?: string
  platform?: CorePlatformId
  clock?: PortableClockPort
  scheduler?: PortableSchedulerPort
  sessionStore: PortableSessionStorePort
  audioEngine: PortableAudioEnginePort
  resourceAccess?: PortableResourceAccessPort
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

  let storeRevisionNum = 0
  let storeRevisionToken: string | null = null
  let currentSettings: AppSettings
  let settingsRevision = 0

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

  const sessionRepository: CoreSessionRepository = {
    async load() {
      const stored = await options.sessionStore.load()
      if (!stored) {
        storeRevisionNum = 0
        storeRevisionToken = null
        return null
      }
      storeRevisionToken = stored.revision
      const parsedNum = Number.parseInt(stored.revision, 10)
      storeRevisionNum = Number.isFinite(parsedNum) && parsedNum > 0 ? parsedNum : 1
      const parsed = JSON.parse(stored.payloadJson) as PersistedEnvelope
      queueStore.importState(parsed)
      if (parsed.settings) {
        currentSettings = normalizeAppSettings(
          { ...currentSettings, ...parsed.settings },
          settingsEnv
        )
      }
      return {
        revision: storeRevisionNum,
        data: parsed.session ?? null
      }
    },
    async save(sessionData, expectedRevision) {
      if (expectedRevision !== storeRevisionNum) {
        throw Object.assign(new Error('Session store revision conflict'), {
          code: 'STALE_REVISION'
        })
      }
      const exported = queueStore.exportState()
      const envelope: PersistedEnvelope = {
        session: sessionData,
        queues: exported.queues,
        tracks: exported.tracks,
        settings: currentSettings
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
      storeRevisionNum++
      return { revision: storeRevisionNum }
    },
    async clear(expectedRevision) {
      if (expectedRevision !== storeRevisionNum) {
        throw Object.assign(new Error('Session store revision conflict'), {
          code: 'STALE_REVISION'
        })
      }
      const exported = queueStore.exportState()
      const envelope: PersistedEnvelope = {
        session: null,
        queues: exported.queues,
        tracks: exported.tracks,
        settings: currentSettings
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
      storeRevisionNum++
      return { revision: storeRevisionNum }
    }
  }

  let appInstance: CoreApplication | null = null

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
    changed: () => {
      appInstance?.changed()
    },
    fatal: (error) => {
      options.onFatalError?.(error)
    }
  })

  const queueSubmission = new CoreQueueSubmission({
    playback: playbackSession,
    resolve: async (items) => {
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
    },
    newId: () => `sub-${crypto.randomUUID().slice(0, 8)}`,
    schedule: (callback, delayMs) => {
      const handle = scheduler.schedule(delayMs, callback)
      return () => handle.cancel()
    }
  })

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

  const application = new CoreApplication({
    epoch,
    playback: playbackSession,
    queueSubmission,
    settings: settingsService,
    libraryRevision: () => queueStore.getLibraryRevision(),
    library: {
      getMetadata: () => queueStore.getMetadata(),
      queryTracks: (query) => queueStore.queryTracks(query),
      readLibraryQueue: (id, offset, limit, opts) =>
        queueStore.readQueue(id, offset, limit, opts),
      queryCollections: async () => ({
        revision: queueStore.getLibraryRevision(),
        total: 0,
        offset: 0,
        items: [],
        letterOffsets: {}
      }),
      getTracksByIds: (ids) => queueStore.getTracksByIds(ids),
      lookupTracksByPaths: async (paths) => ({
        revision: queueStore.getLibraryRevision(),
        ids: paths.map(() => null)
      }),
      lookupPlaylistTracks: async ({ entries }) => ({
        revision: queueStore.getLibraryRevision(),
        ids: entries.map(() => null)
      })
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

  return {
    epoch,
    protocolVersion: CORE_PROTOCOL_VERSION,
    application,
    playback: playbackSession,
    settings: settingsService,
    queueStore,
    async initialize() {
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

let activeEmbeddedHostState: {
  epoch: string
  protocolVersion: number
  lastRequestId: string | null
} = {
  epoch: 'epoch-js-default',
  protocolVersion: CORE_PROTOCOL_VERSION,
  lastRequestId: null
}

const globalNamespace = globalThis as Record<string, unknown>
globalNamespace.__TWILIGHT_PORTABLE_CORE__ = {
  CORE_PROTOCOL_VERSION,
  createPortableMusicCoreHost,
  createHost: createPortableMusicCoreHost,
  ensurePortableRuntimeGlobals,
  bootHost(rawConfig?: string | { epoch?: string; protocolVersion?: number }) {
    const cfg =
      typeof rawConfig === 'string' && rawConfig.trim().length > 0
        ? (JSON.parse(rawConfig) as { epoch?: string; protocolVersion?: number })
        : typeof rawConfig === 'object' && rawConfig !== null
          ? rawConfig
          : {}
    if (cfg.epoch) activeEmbeddedHostState.epoch = cfg.epoch
    if (cfg.protocolVersion) activeEmbeddedHostState.protocolVersion = cfg.protocolVersion
    return JSON.stringify({
      ok: true,
      epoch: activeEmbeddedHostState.epoch,
      protocolVersion: activeEmbeddedHostState.protocolVersion
    })
  },
  handleRequest(rawEnvelope?: string | { requestId?: string; name?: string }) {
    const env =
      typeof rawEnvelope === 'string' && rawEnvelope.trim().length > 0
        ? (JSON.parse(rawEnvelope) as { requestId?: string; name?: string })
        : typeof rawEnvelope === 'object' && rawEnvelope !== null
          ? rawEnvelope
          : {}
    activeEmbeddedHostState.lastRequestId = env.requestId ?? null
    return JSON.stringify({
      ok: true,
      requestId: activeEmbeddedHostState.lastRequestId,
      epoch: activeEmbeddedHostState.epoch
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
