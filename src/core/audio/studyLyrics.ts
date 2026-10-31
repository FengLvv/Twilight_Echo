import type { CoreLyricsContent } from '../../shared/coreLyrics.ts'
import { buildLyricLines } from '../../shared/lyrics/lyricLineBuilder.ts'

/** Freeze the selected original lyrics in audio seconds before the job is queued. */
export function studyLyrics(content: CoreLyricsContent, songId: string, duration?: number): string {
  if (content.current?.trackId !== songId) throw new Error('当前歌曲已变化，请重试')
  return studyLyricsFromText(content.effective?.original, duration, content.offsetSeconds)
}

export function studyLyricsFromText(original: Parameters<typeof buildLyricLines>[0], duration?: number, offsetSeconds = 0): string {
  const lines = buildLyricLines(original, null)
  const selected = lines.flatMap((line, id) => {
    if (!line.timed || line.time === null || !/[\p{L}\p{N}]/u.test(line.text) ||
      /^(?:作词|作曲|编曲|制作人|词|曲|混音|录音|演唱|词曲|lyricist|composer|arranger)\s*[:：]/i.test(line.text.trim())) return []
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
