import policy from '../../../resources/music-study/lyric_credits.json' with { type: 'json' }

const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
const compact = (text: string) => normalize(text).replace(/\s/g, '')
const alternatives = (values: string[]) =>
  '(?:' +
  [...new Set(values.map(compact))]
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|') +
  ')'
const instrumentName =
  alternatives(policy.instrumentPrefixes) + '?' + alternatives(policy.instruments)
const instrument = instrumentName + alternatives(policy.instrumentRoles) + '?'
const studio =
  '(?:' + instrumentName + ')?' + alternatives(policy.studioRoles) + '(?:[a-z]|[0-9]{1,2})?'
const role = new RegExp(
  '^(?:' + alternatives(policy.roles) + '|' + instrument + '|' + studio + ')$'
)
const notices = new Set(policy.exactNotices.map(normalize))
const introducer = new RegExp(
  '^(?:' +
    policy.creditIntroducers
      .map((value) => normalize(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')\\s+(.+)',
  'i'
)
const separators = ['&', '/', '、', '+', ',', '及', '与', '和', 'and']

/** A header may repeat a role in another language, e.g. 作词 Lyrics by. */
function creditHeader(value: string): boolean {
  const header = compact(value)
  if (!header || header.length > 160) return false
  const positions = new Set([0])
  for (const start of positions) {
    for (let end = start + 1; end <= header.length; end++) {
      if (!role.test(header.slice(start, end))) continue
      if (end === header.length || header.slice(end) === 'by') return true
      positions.add(end)
      for (const separator of separators)
        if (header.startsWith(separator, end) && end + separator.length < header.length)
          positions.add(end + separator.length)
    }
  }
  return false
}

export function isStudyCredit(text: string): boolean {
  const normalized = normalize(text)
  if (notices.has(normalized)) return true
  const colon = normalized.indexOf(':')
  if (colon >= 0 && creditHeader(normalized.slice(0, colon))) return true
  const by = introducer.exec(text.normalize('NFKC').trim().replace(/\s+/g, ' '))
  if (
    by &&
    /^[\p{Lu}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(
      by[1].replace(/^["'“‘(]+/, '')
    )
  )
    return true
  if (
    policy.studioIntroducers.some((value) => normalized.startsWith(normalize(value) + ' ')) &&
    (/\b(?:studios?|recording|mastering)\b/.test(normalized) ||
      /\([^)]{2,}\).*\b(?:19|20)\d{2}\b/.test(normalized))
  )
    return true
  const dash = /^(.*?)\s+[-–—]\s+\S/.exec(normalized)
  return !!dash && /[a-z]/.test(dash[1]) && creditHeader(dash[1])
}
