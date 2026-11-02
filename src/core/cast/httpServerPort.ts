import type {
  PlayerRemoteCommand,
  RemoteBrowseRequest,
  RemoteBrowseResult,
  RemoteControlStatus,
  RemotePlaybackSnapshot
} from '../../shared/remoteControl.ts'
import type { RemoteCoreRpcContext } from '../../shared/remoteCoreBridge.ts'
import type { RemoteAuthSession } from './auth.ts'
import type { RemoteDevicePairing } from './devicePairing.ts'
import type { MediaStreamGrantStore } from './mediaTokens.ts'
export type RemoteServerMode = 'full' | 'mediaOnly'
export type RemoteCommandHandler = (command: PlayerRemoteCommand) => Promise<void> | void
export type RemoteBrowseHandler = (request: RemoteBrowseRequest) => Promise<RemoteBrowseResult>
export type RemoteCoreRpcHandler = (
  envelope: Record<string, unknown>,
  principal?: string,
  context?: RemoteCoreRpcContext
) => Promise<Record<string, unknown>>
export type { RemoteCommandError } from '../remote/errors.ts'
export interface RemoteHttpServerOptions {
  serverName?: string
  devicePairing?: RemoteDevicePairing
  confirmDevice?(
    request: import('../../shared/remoteControl.ts').RemotePairingRequest,
    signal: AbortSignal
  ): Promise<boolean>
  discovery?: {
    start(info: { serverId: string; name: string; port: number }): Promise<void>
    stop(): Promise<void>
  }
  staticRoot: string
  addresses(): readonly string[]
  now?: () => number
  useSource?<T>(action: () => Promise<T>): Promise<T>
  onCommand?: RemoteCommandHandler
  onBrowse?: RemoteBrowseHandler
  onCoreRpc?: RemoteCoreRpcHandler
  auth?: RemoteAuthSession
  mediaGrants?: MediaStreamGrantStore
  preferredPort?: number
}
export declare class RemoteHttpServer {
  constructor(options: RemoteHttpServerOptions)
  setCommandHandler(handler: RemoteCommandHandler | null): void
  setBrowseHandler(handler: RemoteBrowseHandler | null): void
  setCoreRpcHandler(handler: RemoteCoreRpcHandler | null): void
  updateCoreStateEvent(event: Record<string, unknown>): void
  getAuth(): RemoteAuthSession
  getMediaGrants(): MediaStreamGrantStore
  isMediaOnly(): boolean
  getStatus(): RemoteControlStatus
  updatePlaybackSnapshot(snapshot: RemotePlaybackSnapshot): void
  getPlaybackSnapshot(): RemotePlaybackSnapshot
  /**
   * Bind the LAN HTTP server.
   * - full: remote UI, PIN pair, command API, media tokens
   * - mediaOnly: media tokens only (cast), no pair/UI/commands; remote stays "off"
   *
   * Mode switches on an already-bound server are in-place: media grants are kept
   * so active cast `/media/{token}` URLs survive remote on/off toggles.
   */
  start(
    preferredPort?: number,
    options?: {
      mode?: RemoteServerMode
    }
  ): Promise<RemoteControlStatus>
  /**
   * Switch surface mode without closing the socket or clearing media grants.
   * Demoting full → mediaOnly revokes remote pair sessions and drops SSE clients.
   */
  applyMode(desiredMode: RemoteServerMode): void
  stop(): Promise<void>
  rotatePin(): string
  decidePairing(requestId: string, allow: boolean): RemoteControlStatus
  revokeDevice(id: string): RemoteControlStatus
  issueMediaUrl(filePath: string, title?: string): string | null
  /** Proxy an upstream http(s) audio URL through the LAN media token endpoint. */
  issueRemoteMediaUrl(
    remoteUrl: string,
    options?: {
      title?: string
      contentType?: string
    }
  ): string | null
}
