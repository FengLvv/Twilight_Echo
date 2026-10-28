/** Authenticated LAN bridge capabilities, independent of the desktop's internal command table. */
export const REMOTE_CORE_BRIDGE_VERSION = 1
export const REMOTE_CORE_PAGE_LIMIT = 200
export const REMOTE_CORE_ARTWORK_LIMIT = 8

/** Transport facts supplied by the server, never by the RPC payload or proxy headers. */
export interface RemoteCoreRpcContext {
  encrypted: boolean
}

export interface RemoteProviderSession {
  providerId: 'ncm'
  loggedIn: boolean
  cookie?: string
}

export const REMOTE_CORE_QUERIES = [
  'core.getSnapshot',
  'state.snapshot',
  'playback.getQueueWindow',
  'queue.page',
  'search.songs',
  'playlists.list',
  'catalog.query',
  'catalog.detail',
  'catalog.sources',
  'metadata.entity.detail',
  'library.artwork',
  'library.info',
  'media.resolve',
  'providers.session'
] as const

export const REMOTE_CORE_COMMANDS = [
  'playback.play',
  'playback.pause',
  'playback.stop',
  'playback.seek',
  'playback.next',
  'playback.previous',
  'playback.setVolume',
  'playback.setPlayMode',
  'playback.selectQueueIndex',
  'playback.replaceQueue',
  'catalog.play'
] as const
