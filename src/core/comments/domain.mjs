export function songId(value) {
  const id = String(value ?? '').trim()
  return /^[1-9]\d{0,15}$/.test(id) ? id : null
}

export function parseSongLink(value) {
  const direct = songId(value)
  if (direct) return direct
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['music.163.com', 'y.music.163.com'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null
    const target = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url
    if (!['/song', '/m/song'].includes(target.pathname)) return null
    return songId(target.searchParams.get('id'))
  } catch {
    return null
  }
}

export function explicitSongId(track) {
  return (
    songId(track?.ncmSongId) ?? (track?.id?.startsWith('ncm:') ? songId(track.id.slice(4)) : null)
  )
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '')
}

export function versionHint(track) {
  const text = `${track.title ?? ''} ${track.album ?? ''}`.normalize('NFKC').toLowerCase()
  const rules = [
    ['live', /\blive\b|现场/],
    ['remaster', /\bremaster(?:ed)?\b|重制/],
    ['instrumental', /\binstrumental\b|伴奏|纯音乐/],
    ['acoustic', /\bacoustic\b|\bunplugged\b|不插电/],
    ['cover', /\bcover\b|翻唱/],
    ['remix', /\bremix\b|混音/]
  ]
  return rules
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name)
    .join(':')
}

export function trackFingerprint(track) {
  return JSON.stringify([
    normalizeText(track.title),
    normalizeText(track.artist),
    normalizeText(track.album),
    Number(track.duration) || 0,
    track.cueRange ?? null
  ])
}

export function validateTrack(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > 512
  )
    throw new Error('歌曲标识无效')
  const track = { id: value.id }
  for (const key of ['title', 'artist', 'album']) {
    track[key] = typeof value[key] === 'string' ? value[key].slice(0, 512) : ''
  }
  track.duration = Number.isFinite(value.duration) && value.duration > 0 ? value.duration : 0
  if (songId(value.ncmSongId)) track.ncmSongId = songId(value.ncmSongId)
  return track
}

export function normalizeCandidate(value) {
  const id = songId(value?.id)
  if (!id || typeof value.name !== 'string') return null
  const artists = value.artists ?? value.ar ?? []
  const album = value.album ?? value.al ?? {}
  const candidate = {
    id,
    title: value.name.slice(0, 512),
    artist: artists
      .map((artist) => String(artist?.name ?? ''))
      .filter(Boolean)
      .join(' / ')
      .slice(0, 512),
    album: String(album.name ?? '').slice(0, 512),
    duration: Math.max(0, Number(value.duration ?? value.dt) || 0) / 1000,
    coverUrl: String(album.picUrl ?? '')
  }
  return { ...candidate, version: versionHint(candidate) }
}

export function rankCandidates(track, candidates) {
  const score = (candidate) =>
    Number(normalizeText(track.title) === normalizeText(candidate.title)) * 8 +
    Number(normalizeText(track.artist) === normalizeText(candidate.artist)) * 5 +
    Number(normalizeText(track.album) === normalizeText(candidate.album)) * 3 +
    Number(track.duration > 0 && Math.abs(track.duration - candidate.duration) <= 2) * 2
  return [...candidates].sort((a, b) => score(b) - score(a))
}

export function automaticMatch(track, candidates) {
  if (
    ![track.title, track.artist, track.album].every((value) => normalizeText(value)) ||
    !(track.duration > 0)
  )
    return null
  if (
    [track.artist, track.album].some((value) =>
      /^(unknownartist|unknownalbum|未知歌手|未知艺术家|未知专辑)$/.test(normalizeText(value))
    )
  )
    return null
  const matches = candidates.filter(
    (candidate) =>
      ['title', 'artist', 'album'].every(
        (key) => normalizeText(track[key]) === normalizeText(candidate[key])
      ) &&
      candidate.duration > 0 &&
      Math.abs(track.duration - candidate.duration) <= 2 &&
      versionHint(track) === versionHint(candidate)
  )
  return matches.length === 1 ? matches[0] : null
}

export function normalizeComment(value) {
  const id = songId(value?.commentId)
  if (!id || typeof value.content !== 'string') return null
  return {
    id,
    content: value.content.slice(0, 20000),
    nickname: String(value.user?.nickname ?? '网易云用户').slice(0, 200),
    avatarUrl: String(value.user?.avatarUrl ?? ''),
    time: Math.max(0, Number(value.time) || 0),
    likes: Math.max(0, Number(value.likedCount) || 0),
    replies: (Array.isArray(value.beReplied) ? value.beReplied : []).slice(0, 3).map((reply) => ({
      nickname: String(reply.user?.nickname ?? '网易云用户').slice(0, 200),
      content: String(reply.content ?? '原评论已删除').slice(0, 4000)
    }))
  }
}

export function mergeComments(previous, incoming) {
  const seen = new Set(previous.map((comment) => comment.id))
  return [
    ...previous,
    ...incoming.filter((comment) => !seen.has(comment.id) && seen.add(comment.id))
  ]
}
