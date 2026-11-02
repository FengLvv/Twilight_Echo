import type { CoreLyricsContent } from '../../shared/coreLyrics.ts'
import { buildLyricLines } from '../../shared/lyrics/lyricLineBuilder.ts'
import { parseTimedLrc } from '../../shared/lyrics/lyricParser.ts'
import { primaryLyricVoice } from '../../shared/lyrics/lyricLead.ts'
import { isStudyCredit } from '../../shared/lyrics/lyricCredits.ts'
export { isStudyCredit } from '../../shared/lyrics/lyricCredits.ts'

/** Freeze the selected original lyrics in audio seconds before the job is queued. */
export function studyLyrics(content: CoreLyricsContent, songId: string, duration?: number): string {
  if (content.current?.trackId !== songId) throw new Error('当前歌曲已变化，请重试')
  return studyLyricsFromText(content.effective?.original, duration, content.offsetSeconds)
}

export function studyLyricRows(original: Parameters<typeof buildLyricLines>[0], duration?: number, offsetSeconds = 0, includeCredits = false) {
  const lines = buildLyricLines(original, null)
  // Empty timed LRC rows end singing before an instrumental gap. They need
  // not become visible lyric rows or change the existing display identities.
  const stops = parseTimedLrc(original,{includeEmpty:true}).filter(line=>!line.text.trim()).map(line=>line.time)
  const selected = lines.flatMap((line, id) => {
    const lead = primaryLyricVoice(line)
    const time = lead?.time
    const structured = line.origin?.format === 'amll-ttml'
    if (!line.timed || time == null || !lead || !/[\p{L}\p{N}]/u.test(lead.text) ||
      (!includeCredits && !structured && (line.origin?.kind === 'metadata' || isStudyCredit(lead.text)))) return []
    const start = Math.max(0, time - offsetSeconds)
    const next = Math.min(lines.slice(id + 1).map(primaryLyricVoice).find(l => l?.time != null && l.time > time)?.time ?? Infinity,
      stops.find(stop=>stop>time) ?? Infinity)
    const wordEnd = Math.max(0, ...(lead.words ?? []).map(w => w.endTime ?? 0)) || (lead.endTime ?? 0)
    const end = Math.min(duration ?? 10800, start + 40, Math.max(start + .1,
      (wordEnd > time ? wordEnd : Number.isFinite(next) ? next : time + 12) - offsetSeconds))
    return end > start ? [{ id, start, end, text: lead.text, ...(line.origin ? { origin: line.origin } : {}) }] : []
  })
  return selected
}

export function studyLyricsFromText(original: Parameters<typeof buildLyricLines>[0], duration?: number, offsetSeconds = 0): string {
  const selected=studyLyricRows(original,duration,offsetSeconds)
  if (!selected.length) throw new Error('请先加载带时间的原文歌词，再生成简谱')
  if (selected.length > 2000 || selected.some(l => l.text.length > 2000))
    throw new Error('歌词过长，无法生成简谱')
  return JSON.stringify(selected)
}
