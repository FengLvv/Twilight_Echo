import type { CommentSong } from '../../shared/ncmComments.ts'
export interface SavedAssociation {
  kind: 'manual' | 'auto' | 'paused'
  fingerprint?: string
  song?: CommentSong
}
export declare class AssociationStore {
  constructor(directory: string)
  load(): Promise<void>
  get(id: string): SavedAssociation | undefined
  set(id: string, value: SavedAssociation): Promise<void>
  writes: Promise<void>
}
