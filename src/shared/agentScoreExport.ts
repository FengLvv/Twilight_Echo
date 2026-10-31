import type { RhythmicLyricScore } from './desktopLyrics.ts'
import type { ChordKey } from './lyrics/chordDegrees.ts'

export interface AgentScoreExportData {
  id: string
  title: string
  notation: 'numbered' | 'staff'
  key: ChordKey | null
  rows: Array<RhythmicLyricScore & { lineId: number }>
}
export interface AgentScoreExportReply {
  rows: Array<{ lineId: number; text: string; svg: string }>
  error?: string
}
