import type { OpraCatalogStatus, OpraProfile } from '../../shared/coreOpra.ts'
export declare const OPRA_DATABASE_URL = 'https://opra.roonlabs.net/database_v1.jsonl'
export declare function parseOpraCatalogForTest(text: string): OpraCatalog
export declare class OpraCatalog {
  constructor(cachePath: string)
  static fromText(text: string, cachePath: string): OpraCatalog
  getStatus(): OpraCatalogStatus
  loadFromCache(): Promise<OpraCatalogStatus>
  refresh(): Promise<OpraCatalogStatus>
  search(query: string): Promise<OpraProfile[]>
  getProfile(eqId: string): Promise<OpraProfile | null>
}
