import type { CoreLyricsContent } from '../../shared/coreLyrics.ts'
import { buildLyricLines } from '../../shared/lyrics/lyricLineBuilder.ts'
import credits from '../../../resources/music-study/lyric_credits.json' with { type: 'json' }

const role = '(?:' + [...credits.roles].sort((a,b) => b.length-a.length)
  .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
const credit = new RegExp('^' + role + '(?:\\s*(?:[&＆/／、+]|及|与)\\s*' + role + ')*\\s*[:：]', 'i')
export const isStudyCredit = (text: string): boolean => credit.test(text.trim().replace(/\s+/g, ' '))

/** Freeze the selected original lyrics in audio seconds before the job is queued. */
export function studyLyrics(content: CoreLyricsContent, songId: string, duration?: number): string {
  if (content.current?.trackId !== songId) throw new Error('当前歌曲已变化，请重试')
  return studyLyricsFromText(content.effective?.original, duration, content.offsetSeconds)
}

export function studyLyricsFromText(original: Parameters<typeof buildLyricLines>[0], duration?: number, offsetSeconds = 0): string {
  const lines = buildLyricLines(original, null)
  const selected = lines.flatMap((line, id) => {
    if (!line.timed || line.time === null || !/[\p{L}\p{N}]/u.test(line.text) ||
      isStudyCredit(line.text)) return []
    if (line.voices?.some(v => v.role !== 'lead'))
      throw new Error('多人重叠歌词暂不支持逐词简谱，请选择主唱歌词')
    const start = Math.max(0, line.time - offsetSeconds)
    const next = lines.slice(id + 1).find(l => l.time !== null && l.time > line.time!)?.time
    const wordEnd = Math.max(0, ...(line.words ?? []).map(w => w.endTime ?? 0))
    const end = Math.min(duration ?? 10800, start + 40, Math.max(start + .1,
      (wordEnd > line.time ? wordEnd : next ?? line.time + 12) - offsetSeconds))
    return end > start ? [{ id, start, end, text: line.text }] : []
  })
  if (!selected.length) throw new Error('请先加载带时间的原文歌词，再生成简谱')
  if (selected.length > 2000 || selected.some(l => l.text.length > 2000))
    throw new Error('歌词过长，无法生成简谱')
  return JSON.stringify(selected)
}
