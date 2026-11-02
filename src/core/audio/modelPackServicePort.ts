import type {
  CoreModelPackDecode,
  CoreModelPackPlatformOperations,
  CoreModelPackStatus
} from '../../shared/coreModelPack.ts'
interface Options {
  root: string
  chooseArchive(signal: AbortSignal): Promise<string | null>
  decode(request: CoreModelPackDecode, signal: AbortSignal): Promise<void>
  probe(
    directory: string,
    signal: AbortSignal
  ): Promise<CoreModelPackPlatformOperations['automix.probeInstall']['output']>
  changed(): void
  installed(enableAfterInstall: boolean): Promise<void>
  checkpointSha256?: string
}
/** An accepted installation belongs to Core, not to its initiating connection. */
export declare class CoreModelPackService {
  constructor(options: Options)
  state(): CoreModelPackStatus
  start(enableAfterInstall: boolean): CoreModelPackStatus
  cancel(): CoreModelPackStatus
  shutdown(): Promise<void>
}
/** Disk tickets keep multi-GB entry bytes out of IPC and keep 7za in main. */
export type {}
