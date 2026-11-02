import type { CorePlatformId } from '../../shared/audioEngineTypes.ts'
import type {
  Vst3CatalogEntry,
  Vst3CatalogState,
  Vst3HelpersAvailability,
  Vst3ScanDescriptor
} from '../../shared/dspGraph.ts'
export interface Vst3ModuleScanner {
  scan(modulePath: string): Promise<Vst3ScanDescriptor>
}
export interface Vst3ModuleResolution {
  modulePath: string | null
  classId: string
  reason: string
}
export declare class Vst3CatalogService {
  constructor(
    root: string,
    scanner: Vst3ModuleScanner,
    standardSearchPaths: string[],
    environment: {
      platform: CorePlatformId
      helpers: Vst3HelpersAvailability
      now(): number
    }
  )
  initialize(): Promise<void>
  getState(): Promise<Vst3CatalogState>
  getHelpersAvailability(): Vst3HelpersAvailability
  setEnabled(enabled: boolean): Promise<Vst3CatalogState>
  setSearchPaths(paths: string[]): Promise<Vst3CatalogState>
  scan(): Promise<Vst3CatalogState>
  clearQuarantine(id: string): Promise<Vst3CatalogState>
  quarantine(id: string, reason: string): Promise<void>
  find(id: string): Promise<Vst3CatalogEntry | null>
  /**
   * Resolves only catalog-owned modules for the audio engine. Renderer graph
   * JSON is never allowed to nominate an arbitrary executable bundle path.
   */
  resolveAvailableModule(catalogId: string, classId: string): Vst3ModuleResolution
}
