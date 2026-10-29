import { parseLyrics, currentLyric } from './lyrics.js'

export function createLyricsPage({ rpc, call, onCommentsVisible }) {
  const element = (tag, className, text) => {
    const node = document.createElement(tag)
    node.className = className
    if (text) node.textContent = text
    return node
  }
  const comments = document.querySelector('main')
  comments.classList.add('page-comments')
  comments.id = 'page-comments'
  comments.prepend(element('h2', 'page-comments-title', '评论'))
  const stage = element('section', 'page-stage')
  stage.setAttribute('aria-label', '当前歌曲与歌词')
  const top = element('div', 'page-top')
  const back = element('button', 'page-back', '‹ 返回播放器')
  back.type = 'button'
  back.onclick = () => rpc('host.exit').catch(() => {})
  top.append(back)
  const grid = element('div', 'page-stage-grid')
  const meta = element('div', 'page-record')
  const cover = element('div', 'page-record-cover', '♫')
  const title = element('h1', 'page-record-title', '让音乐先响起')
  const artist = element('p', 'page-record-artist', '在播放器中选择一首歌曲')
  const album = element('p', 'page-record-album')
  const progress = element('p', 'page-record-progress')
  meta.append(cover, title, artist, album, progress)
  const viewport = element('div', 'page-lyrics')
  viewport.setAttribute('role', 'region')
  viewport.setAttribute('aria-label', '当前歌曲歌词')
  viewport.tabIndex = 0
  const linesRoot = element('div', 'page-lyric-lines')
  viewport.append(linesRoot)
  const hint = element('button', 'page-comments-hint', '向下查看评论 ↓')
  hint.type = 'button'
  hint.onclick = () =>
    comments.scrollIntoView({
      behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth',
      block: 'start'
    })
  grid.append(meta, viewport)
  stage.append(top, grid, hint)
  comments.before(stage)
  let id = '',
    lines = [],
    lineNodes = [],
    previous = -2,
    sequence = 0,
    manualUntil = 0,
    lastLyrics = '',
    lastPlayer = null
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.target === comments) onCommentsVisible(entry.isIntersecting)
    },
    { threshold: 0 }
  )
  observer.observe(comments)
  viewport.addEventListener(
    'wheel',
    () => {
      manualUntil = Date.now() + 5000
    },
    { passive: true }
  )
  viewport.addEventListener(
    'touchstart',
    () => {
      manualUntil = Date.now() + 5000
    },
    { passive: true }
  )

  async function refreshLyrics() {
    const generation = ++sequence,
      expected = id
    try {
      const document = await rpc('player.lyrics')
      if (generation !== sequence || expected !== id || (document.id && document.id !== id)) return
      const key = JSON.stringify([document.lyrics, document.translatedLyrics])
      if (key === lastLyrics) return
      lastLyrics = key
      lines = parseLyrics(document.lyrics)
      const translations = parseLyrics(document.translatedLyrics)
      lineNodes = lines.map((line) => {
        const row = element('div', 'page-lyric-row')
        row.append(element('p', '', line.text))
        const translated =
          line.time == null
            ? null
            : translations.find(
                (item) => item.time != null && Math.abs(item.time - line.time) < 0.1
              )
        if (translated && translated.text !== line.text)
          row.append(element('p', 'page-lyric-translation', translated.text))
        return row
      })
      if (!lineNodes.length)
        lineNodes.push(
          element('p', 'page-no-lyrics', id ? '暂无可显示的歌词' : '播放歌曲后，歌词会显示在这里')
        )
      linesRoot.replaceChildren(...lineNodes)
      previous = -2
      if (lastPlayer) onPlayer(lastPlayer)
    } catch {
      if (expected === id)
        linesRoot.replaceChildren(element('p', 'page-no-lyrics', '歌词暂不可用，可返回播放器查看'))
    }
  }
  function onPlayer(value) {
    lastPlayer = value
    const track = value?.currentTrack
    if ((track?.id ?? '') !== id) {
      if (id) window.scrollTo(0, 0)
      id = track?.id ?? ''
      title.textContent = track?.title || '让音乐先响起'
      artist.textContent = track?.artist || '在播放器中选择一首歌曲'
      album.textContent = track?.album || ''
      cover.replaceChildren(document.createTextNode('♫'))
      lines = []
      previous = -2
      lastLyrics = ''
      linesRoot.replaceChildren(
        element('p', 'page-no-lyrics', track ? '正在读取歌词…' : '播放歌曲后，歌词会显示在这里')
      )
      viewport.scrollTop = 0
      if (track) {
        void refreshLyrics()
        const expected = id
        call('cover', { track, key: 'page-cover' })
          .then((data) => {
            if (!data || expected !== id) return
            const img = element('img', '')
            img.alt = `${track.title}封面`
            img.src = data
            cover.replaceChildren(img)
          })
          .catch(() => {})
      }
    }
    const position = Number(value?.currentTime) || 0
    const duration = Number(value?.duration) || Number(track?.duration) || 0
    const format = (time) =>
      `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}`
    progress.textContent = track ? `${format(position)} / ${format(duration)}` : ''
    const active = currentLyric(lines, position)
    if (active === previous) return
    previous = active
    for (const [index, node] of lineNodes.entries()) {
      node.classList.toggle('active', index === active)
      if (index === active) node.setAttribute('aria-current', 'true')
      else node.removeAttribute('aria-current')
    }
    if (active >= 0 && Date.now() > manualUntil && scrollY < stage.offsetHeight / 2) {
      viewport.scrollTo({
        top: lineNodes[active].offsetTop - viewport.clientHeight * 0.4,
        behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth'
      })
    }
  }
  return {
    onPlayer,
    refreshLyrics,
    dispose() {
      observer.disconnect()
      sequence++
    }
  }
}
