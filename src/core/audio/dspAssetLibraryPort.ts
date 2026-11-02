import type { DspAsset, DspAssetKind } from '../../shared/dspGraph.ts'
export interface DspAssetImportOptions {
  kind: DspAssetKind
  sourcePath: string
  name?: string
}
export interface DspAssetBufferImportOptions {
  kind: DspAssetKind
  fileName: string
  data: Uint8Array
  name?: string
}
export type Vst3StateAssetKind = 'vst3Preset' | 'vst3State'
export interface Vst3StateAssetResolution {
  path: string | null
  kind: Vst3StateAssetKind | null
  reason: string
}
export declare class DspAssetLibrary {
  constructor(
    root: string,
    environment: {
      now(): number
      newId(): string
    }
  )
  initialize(): Promise<void>
  list(): Promise<DspAsset[]>
  importFile(options: DspAssetImportOptions): Promise<DspAsset>
  importBuffer(options: DspAssetBufferImportOptions): Promise<DspAsset>
  getPath(id: string): Promise<string>
  /**
   * Used only by the Core graph compiler after initialization. The
   * renderer never receives this filesystem path.
   */
  getKnownPath(id: string): string | null
  /**
   * Resolves only state-bearing VST3 assets for the native helper. This keeps
   * renderer graph JSON from passing arbitrary state file paths to a child
   * process that loads third-party code.
   */
  resolveVst3State(id: string): Vst3StateAssetResolution
  get(id: string): Promise<DspAsset | null>
  reconcileReferences(assetIds: Iterable<string>): Promise<void>
  remove(id: string, force?: boolean): Promise<void>
  entries(ids: Iterable<string>): Promise<
    Array<{
      asset: DspAsset
      path: string
    }>
  >
}
