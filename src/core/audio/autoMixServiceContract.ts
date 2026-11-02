import type { AppSettings } from '../../shared/appSettings.ts'
import type { CoreAutoMixCapabilities } from '../../shared/coreAutoMix.ts'
import type { CorePlatformOperations } from '../../shared/corePlatform.ts'
import type { ProviderPlaybackIdentityRegistry } from './providerPlaybackIdentity.ts'
import type {
  TwilightAutoMixCoordinator,
  TwilightAutoMixCoordinatorDependencies
} from './twilightAutoMixCoordinatorContract.ts'
interface CoreAutoMixOptions {
  root: string
  settings(): Pick<AppSettings, 'autoMixStemMode' | 'autoMixStemDevice' | 'autoMixStemCacheMiB'>
  engine: {
    setAutoMixCoordinator(coordinator: TwilightAutoMixCoordinator | null): void
    getAutoMixContext: TwilightAutoMixCoordinatorDependencies['context']
    selectAutoMix: NonNullable<TwilightAutoMixCoordinatorDependencies['select']>
    prepareAutoMix: TwilightAutoMixCoordinatorDependencies['prepare']
    submitAutoMix: TwilightAutoMixCoordinatorDependencies['submit']
    cancelAutoMix: TwilightAutoMixCoordinatorDependencies['cancel']
    getAutoMixNativeStatus: TwilightAutoMixCoordinatorDependencies['status']
    reportAutoMixAnalysisState: NonNullable<TwilightAutoMixCoordinatorDependencies['onState']>
    clearAutoMixAnalysisState(): void
    invalidateAutoMixSource(): void
  }
  authorize: TwilightAutoMixCoordinatorDependencies['authorize']
  analysis: {
    analyze: TwilightAutoMixCoordinatorDependencies['analyze']
    cancel: TwilightAutoMixCoordinatorDependencies['cancelAnalysis']
  }
  identities: ProviderPlaybackIdentityRegistry
  useSources<T>(action: () => Promise<T>): Promise<T>
  environment(): Promise<CorePlatformOperations['automix.environment']['output']>
  probe(
    directory: string,
    signal: AbortSignal
  ): Promise<CorePlatformOperations['automix.probe']['output']>
  runWorker(
    request: CorePlatformOperations['automix.runWorker']['input'],
    signal: AbortSignal
  ): Promise<void>
  now(): number
}
/** Preparation belongs to the same native session, not to an attached window. */
export declare class CoreAutoMixService {
  constructor(options: CoreAutoMixOptions)
  activate(): void
  capabilities(refresh: boolean): Promise<CoreAutoMixCapabilities>
  maintain<T>(action: () => Promise<T>): Promise<T>
  shutdown(): Promise<void>
}
export type {}
