export interface LyricWord {
  time: number
  endTime: number | null
  text: string
}

/** Source semantics survive display parsing; unknown structured text is not a credit verdict. */
export type LyricOrigin =
  | { format: 'netease-json'; kind: 'metadata' | 'unknown' }
  | { format: 'amll-ttml'; kind: 'lyric' }

export type LyricVoiceRole = 'lead' | 'background' | 'harmony'
export type LyricVoiceLane = 'center' | 'start' | 'end'

export interface LyricVoiceMetadata {
  role: LyricVoiceRole
  lane: LyricVoiceLane
  speaker?: string
  group?: string
}

export interface LyricAuxiliaryLayer {
  time: number | null
  text: string
  words?: LyricWord[]
}

export interface LyricVoiceLayer extends LyricVoiceMetadata {
  voiceKey: string
  time: number | null
  /** Explicit voice end from TTML, when the source provides one. */
  endTime?: number | null
  text: string
  words?: LyricWord[]
  translation?: LyricAuxiliaryLayer | null
  romanization?: LyricAuxiliaryLayer | null
}

export interface ParsedTimedLyricLine {
  time: number
  text: string
  words?: LyricWord[]
  voice?: LyricVoiceMetadata
  origin?: LyricOrigin
}

export interface LyricLine {
  time: number | null
  text: string
  translation: string | null
  romanization: string | null
  timed: boolean
  words?: LyricWord[]
  rowKey?: string
  voices?: LyricVoiceLayer[]
  origin?: LyricOrigin
}

export interface BuildLyricLinesOptions {
  replaceTtmlTranslation?: boolean
  replaceTtmlRomanization?: boolean
}
