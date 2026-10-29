import type { CommentTrack as TrackData } from '../../shared/ncmComments.ts'
import type { CommentSong } from '../../shared/ncmComments.ts'
export function explicitSongId(track: TrackData): string | null
export function validateTrack(track: unknown): TrackData
export function parseSongLink(value: string | undefined): string | null
export function trackFingerprint(track: TrackData): string
export function automaticMatch(track: TrackData, candidates: CommentSong[]): CommentSong | null
export function rankCandidates(track: TrackData, candidates: CommentSong[]): CommentSong[]
export function normalizeComment(value: unknown): import('../../shared/ncmComments.ts').MusicComment | null
