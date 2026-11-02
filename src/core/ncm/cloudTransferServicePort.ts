import type {
  CoreCloudTransferPage,
  CoreCloudTransferProviderMethod,
  CoreCloudTransferQuery,
  CoreCloudTransferState
} from '../../shared/coreCloudTransfer.ts'
import type {
  NcmCloudDownloadRequest,
  NcmCloudDownloadResult,
  NcmCloudSelectedFile,
  NcmCloudTransferProgress,
  NcmCloudUploadResult
} from '../../shared/ncmCloud.ts'
export interface CoreNcmCloudTransferOptions {
  chooseUploadFiles(clientId: string, signal?: AbortSignal): Promise<string[]>
  chooseDownloadFile(
    clientId: string,
    fileName: string,
    signal?: AbortSignal
  ): Promise<string | null>
  callProvider<T>(
    method: CoreCloudTransferProviderMethod,
    args: unknown[],
    signal?: AbortSignal,
    idempotencyKey?: string
  ): Promise<T>
  now(): number
  newId(): string
  changed(): void
  /** Compatibility IPC subscriber. New clients read the revisioned Core projection. */
  progress?(clientId: string, update: NcmCloudTransferProgress): void
  fetch?: typeof fetch
}
/** Selected-file grants belong to a client; accepted transfer work belongs to Core. */
export declare class CoreNcmCloudTransferService {
  constructor(options: CoreNcmCloudTransferOptions)
  state(): CoreCloudTransferState
  page(query: CoreCloudTransferQuery): CoreCloudTransferPage
  chooseUploadFiles(clientId: string, signal?: AbortSignal): Promise<NcmCloudSelectedFile[]>
  upload(clientId: string, handle: string): NcmCloudUploadResult
  download(
    clientId: string,
    request: NcmCloudDownloadRequest,
    signal?: AbortSignal
  ): Promise<NcmCloudDownloadResult>
  cancel(transferId: string, clientId?: string): boolean
  observeAccount(account: number | null): Promise<void>
  disconnect(clientId: string): void
  shutdown(): Promise<void>
}
