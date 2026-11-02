import type { LyricLine, LyricVoiceLayer } from './lyricTypes.ts'

/** The same primary voice is used by notation input and both lyric displays.
 * Background-only rows stay available for display but have no lead score.
 */
export function primaryLyricVoice(line: Pick<LyricLine, 'time' | 'text' | 'words' | 'voices'>):
  Pick<LyricLine, 'time' | 'text' | 'words'> & { endTime?: number | null } | undefined {
  if (line.voices?.length) return line.voices.find((voice: LyricVoiceLayer) => voice.role === 'lead')
  return line
}
