import { randomUUID } from 'node:crypto'
import { NcmClient } from './lib/client.mjs'
import { AssociationStore } from './lib/store.mjs'
import { appearanceSettings } from './lib/appearance.mjs'
import {
  automaticMatch,
  explicitSongId,
  parseSongLink,
  rankCandidates,
  trackFingerprint,
  validateTrack
} from './lib/domain.mjs'

export function createService(
  context,
  {
    client = new NcmClient(),
    store = new AssociationStore(context.storagePath),
    now = Date.now,
    leaseMs = 6000
  } = {}
) {
  const sessions = new Map()
  const ready = store.load()
  void ready.catch(() => {}) // Surface a corrupt store through handle(), not an unhandled rejection.
  // The current host does not cancel commands when an iframe is removed.
  // Heartbeats bound orphaned requests even if its final close message is lost.
  const timer = setInterval(() => {
    for (const [id, session] of sessions) if (session.expires < now()) closeSession(id)
  }, 200)
  timer.unref?.()
  function closeSession(id) {
    const session = sessions.get(id)
    if (session) for (const controller of session.requests.values()) controller.abort()
    sessions.delete(id)
  }

  async function handle(request, invocation = {}) {
    await ready
    if (!request || typeof request !== 'object') throw new Error('插件请求无效')
    const { operation, session: sessionId, key = 'default' } = request
    if (operation === 'open') {
      const id = randomUUID()
      sessions.set(id, { expires: now() + leaseMs, requests: new Map() })
      return {
        session: id,
        tab: (await context.settings.get('tab')) === 'latest' ? 'latest' : 'hot'
      }
    }
    if (operation === 'close') {
      closeSession(sessionId)
      return null
    }
    const session = sessions.get(sessionId)
    if (!session || session.expires < now()) {
      closeSession(sessionId)
      throw new Error('面板连接已过期，请重新打开')
    }
    if (operation === 'heartbeat') {
      session.expires = now() + leaseMs
      return null
    }
    if (operation === 'cancel') {
      for (const controller of session.requests.values()) controller.abort()
      session.requests.clear()
      return null
    }
    if (typeof key !== 'string' || key.length > 128) throw new Error('请求标识无效')
    const controller = new AbortController()
    session.requests.get(key)?.abort()
    session.requests.set(key, controller)
    const cancel = () => controller.abort()
    invocation.signal?.addEventListener('abort', cancel, { once: true })
    if (invocation.signal?.aborted) cancel()
    const signal = controller.signal
    const current = () => {
      if (signal.aborted || sessions.get(sessionId) !== session) throw new Error('请求已取消')
    }
    try {
      current()
      switch (operation) {
        case 'theme': {
          const settings = await context.twilight.appSettings.get()
          return appearanceSettings(settings)
        }
        case 'tab':
          if (!['hot', 'latest'].includes(request.tab)) throw new Error('评论排序无效')
          await context.settings.set('tab', request.tab)
          return null
        case 'resolve': {
          let track = validateTrack(request.track)
          if (!explicitSongId(track)) {
            const tracks = await context.twilight.library.getTracksByIds([track.id])
            current()
            const members = Array.isArray(tracks) ? tracks : tracks?.tracks
            const full = members?.find((item) => item.id === track.id)
            if (full) track = validateTrack(full)
          }
          const explicit = explicitSongId(track)
          if (explicit)
            return {
              kind: 'explicit',
              song: {
                id: explicit,
                title: track.title,
                artist: track.artist,
                album: track.album,
                duration: track.duration
              },
              track
            }
          const stored = store.get(track.id)
          const fingerprint = trackFingerprint(track)
          if (stored?.kind === 'paused') return { kind: 'paused', track, candidates: [] }
          if (
            stored?.kind === 'manual' ||
            (stored?.kind === 'auto' && stored.fingerprint === fingerprint)
          )
            return { kind: stored.kind, song: stored.song, track }
          const candidates = rankCandidates(
            track,
            await client.search(`${track.title} ${track.artist}`, signal)
          )
          current()
          const match = automaticMatch(track, candidates)
          if (match) {
            await store.set(track.id, { kind: 'auto', fingerprint, song: match })
            return { kind: 'auto', song: match, track }
          }
          return { kind: 'choose', track, candidates }
        }
        case 'search': {
          const track = validateTrack(request.track)
          return rankCandidates(
            track,
            await client.search(String(request.query ?? '').slice(0, 200), signal)
          )
        }
        case 'associate': {
          const track = validateTrack(request.track)
          const id = parseSongLink(request.value)
          if (!id) throw new Error('请输入网易云歌曲链接或正整数歌曲 ID')
          const song = await client.detail(id, signal)
          current()
          await store.set(track.id, { kind: 'manual', fingerprint: trackFingerprint(track), song })
          return { kind: 'manual', song, track }
        }
        case 'unlink': {
          const track = validateTrack(request.track)
          await store.set(track.id, { kind: 'paused' })
          return { kind: 'paused', track, candidates: [] }
        }
        case 'rematch': {
          const track = validateTrack(request.track)
          const candidates = rankCandidates(
            track,
            await client.search(`${track.title} ${track.artist}`, signal)
          )
          current()
          return { kind: 'choose', track, candidates }
        }
        case 'comments':
          return await client.comments(
            request.songId,
            request.sort,
            request.offset,
            signal,
            request.force === true
          )
        case 'image':
          return await client.image(request.url, signal)
        case 'cover': {
          const track = validateTrack(request.track)
          const cover = await context.twilight.library.getCover(track.id)
          current()
          if (
            typeof cover === 'string' &&
            /^data:image\/(jpeg|png|webp);base64,/.test(cover) &&
            cover.length <= 8 * 1024 * 1024
          )
            return cover
          const id = explicitSongId(track) ?? store.get(track.id)?.song?.id
          return id ? client.image((await client.detail(id, signal)).coverUrl, signal) : null
        }
        default:
          throw new Error('不支持的评论插件操作')
      }
    } finally {
      invocation.signal?.removeEventListener('abort', cancel)
      if (session.requests.get(key) === controller) session.requests.delete(key)
    }
  }
  return {
    handle,
    async close() {
      clearInterval(timer)
      for (const id of sessions.keys()) closeSession(id)
      client.close()
      await store.writes
    }
  }
}

let service
let unsubscribe
export async function activate(context) {
  service = createService(context)
  unsubscribe = context.twilight.experience.onRequest((request, invocation) =>
    service.handle(request, invocation)
  )
  context.twilight.ui.onCommand('ncm-comments.open', () =>
    context.twilight.ui.notify({
      kind: 'info',
      message: '请从侧边栏打开「歌词与评论」。直接播放栏按钮需要更新播放器。'
    })
  )
  await context.twilight.ui.register({
    id: 'comments',
    kind: 'playerBarButton',
    title: '网易云评论',
    icon: 'ph ph-chat-circle-text',
    command: 'ncm-comments.open'
  })
}
export async function deactivate() {
  unsubscribe?.()
  await service?.close()
  service = undefined
}
