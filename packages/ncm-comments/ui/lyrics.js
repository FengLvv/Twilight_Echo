export function parseLyrics(value) {
  if (/<(?:\w+:)?tt(?:\s|>)/i.test(String(value ?? ''))) return parseTtml(String(value))
  const lines = []
  let offset = 0
  for (const raw of String(value ?? '')
    .slice(0, 1000000)
    .split(/\r?\n/)) {
    const adjusted = raw.match(/^\[offset:([+-]?\d+)\]/i)
    if (adjusted) {
      offset = Number(adjusted[1]) / 1000
      continue
    }
    const times = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (/^\[(ar|ti|al|by|re|ve|length):/i.test(raw)) continue
    const text = raw
      .replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '')
      .replace(/<\d+:\d+(?:\.\d+)?>/g, '')
      .trim()
    if (!text) continue
    if (!times.length) {
      if (!/^\[[a-z]+:/i.test(raw)) lines.push({ time: null, text })
      continue
    }
    for (const match of times)
      lines.push({
        time: Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] ?? '0'}`),
        text
      })
  }
  return lines
    .slice(0, 5000)
    .map((line) => ({ ...line, time: line.time == null ? null : Math.max(0, line.time + offset) }))
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))
}

function parseTtml(value) {
  const decode = (text) =>
    text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (source, entity) => {
      if (!entity.startsWith('#'))
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity.toLowerCase()] ?? source
      const point =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : source
    })
  const time = (value) => {
    if (!value) return null
    if (/^\d+(\.\d+)?ms$/.test(value)) return parseFloat(value) / 1000
    if (/^\d+(\.\d+)?s$/.test(value)) return parseFloat(value)
    if (/^\d+:\d+(?::\d+(?:\.\d+)?)?(?:\.\d+)?$/.test(value))
      return value.split(':').reduce((total, part) => total * 60 + Number(part), 0)
    return null
  }
  return [...value.slice(0, 1000000).matchAll(/<(?:\w+:)?p\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?p>/gi)]
    .slice(0, 5000)
    .map((match) => ({
      time: time(match[1].match(/\bbegin\s*=\s*["']([^"']+)["']/i)?.[1]),
      text: decode(
        match[2].replace(/<(?:\w+:)?br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
      ).trim()
    }))
    .filter((line) => line.text)
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity))
}

export function currentLyric(lines, position) {
  let active = -1
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].time != null && lines[index].time <= position) active = index
  }
  return active
}
