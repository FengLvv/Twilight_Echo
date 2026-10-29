import { CommentsController } from './controller.js'
import { createLyricsPage } from './page.js'

const $ = (id) => document.getElementById(id)
let port,
  session,
  nextId = 1,
  disposed = false,
  lastTrackKey = '',
  latestTrack = null
const pending = new Map()
const systemTheme = matchMedia('(prefers-color-scheme: dark)')
let appearance = { theme: 'dark', accent: '#a78bfa' }
let reconnecting = false
const pageLayout = document.body.dataset.layout === 'page'
let commentsVisible = !pageLayout
let lastHostReply = Date.now(),
  lastAnnounce = 0,
  bridgeTimer,
  bridgeGeneration = 0
let renderedItems = [],
  renderedTrack = '',
  coverTrack = '',
  toastTimer,
  heartbeatTimer,
  themeTimer
const imageQueue = [],
  imageSlots = new Set()
let activeImages = 0
const imageObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) {
        imageObserver.unobserve(entry.target)
        imageQueue.push(entry.target)
      }
    drainImages()
  },
  { rootMargin: '50px' }
)

function rpc(method, args = {}) {
  if (disposed || !port) return Promise.reject(new Error('面板尚未连接，请重新打开'))
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('请求超时，请重试'))
    }, 20000)
    const message = { id, method, args }
    pending.set(id, { resolve, reject, timer, message })
    port.postMessage(message)
  })
}
function call(operation, args = {}) {
  return rpc('plugin.request', { request: { operation, session, ...args } })
}
const controller = new CommentsController(call, render)
const lyricsPage = pageLayout
  ? createLyricsPage({
      rpc,
      call,
      onCommentsVisible(visible) {
        commentsVisible = visible
        if (visible && session) {
          if (!controller.state.association || controller.state.track?.id !== latestTrack?.id)
            lastTrackKey = ''
          receivePlayer({ currentTrack: latestTrack })
          if (
            controller.state.association?.song &&
            !controller.state.items.length &&
            !controller.state.loading
          )
            void controller.load()
        }
        if (!visible && session) {
          controller.sequence++
          controller.publish({ loading: false })
          void call('cancel').catch(() => {})
        }
      }
    })
  : null

function node(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text != null) element.textContent = text
  return element
}
function button(text, action, className = '') {
  const element = node('button', className, text)
  element.type = 'button'
  element.onclick = action
  return element
}
function toast(text) {
  $('toast').textContent = text
  $('toast').hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    $('toast').hidden = true
  }, 2500)
}
function applyTheme() {
  const mode =
    appearance.theme === 'system'
      ? systemTheme.matches
        ? 'dark'
        : 'light'
      : appearance.theme === 'pureWhite'
        ? 'light'
        : 'dark'
  document.documentElement.dataset.theme = mode
  document.documentElement.dataset.motion = appearance.motion || 'full'
  const palette = appearance.palettes?.[mode === 'light' ? 'pureWhite' : 'dark']
  const mapping = {
    background: '--bg',
    surface: '--surface',
    hover: '--hover',
    text: '--text',
    muted: '--muted',
    border: '--border',
    accent: '--accent',
    font: '--native-font',
    fontSize: '--native-font-size',
    radius: '--native-radius'
  }
  if (palette) {
    for (const [key, variable] of Object.entries(mapping))
      if (palette[key]) document.documentElement.style.setProperty(variable, palette[key])
  } else document.documentElement.style.setProperty('--accent', appearance.accent)
  if (pageLayout)
    window.parent.postMessage(
      { type: 'twilight-experience-tone', tone: mode === 'dark' ? 'night' : 'day' },
      '*'
    )
}
async function theme() {
  try {
    appearance = await call('theme', { key: 'theme' })
    applyTheme()
  } catch {
    /* A theme read cannot hide comments. */
  }
}
async function reconnect() {
  if (reconnecting || disposed || document.hidden) return
  reconnecting = true
  try {
    const opened = await call('open')
    const previous = session
    session = opened.session
    void call('close', { session: previous }).catch(() => {})
    lastTrackKey = ''
    await theme()
    receivePlayer({ currentTrack: latestTrack })
  } catch (error) {
    controller.publish({ error: error.message, loading: false })
  } finally {
    reconnecting = false
  }
}
systemTheme.addEventListener('change', applyTheme)

function drainImages() {
  while (activeImages < 2 && imageQueue.length) {
    const element = imageQueue.shift()
    if (!element.isConnected) continue
    activeImages++
    const generation = controller.sequence
    imageSlots.add(element)
    call('image', { url: element.dataset.image, key: `image:${nextId}` })
      .then((data) => {
        if (!data || disposed || generation !== controller.sequence || !element.isConnected) return
        const img = node('img')
        img.alt = ''
        img.src = data
        img.onerror = () => img.remove()
        element.replaceChildren(img)
      })
      .catch(() => {})
      .finally(() => {
        activeImages--
        imageSlots.delete(element)
        drainImages()
      })
  }
}
function image(element, url) {
  if (url) {
    element.dataset.image = url
    imageObserver.observe(element)
  }
}
function time(value) {
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`
}
function displayCount(value) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function renderComment(comment) {
  const article = node('article', 'comment')
  article.dataset.commentId = comment.id
  const avatar = node('div', 'avatar', comment.nickname.slice(0, 1))
  avatar.setAttribute('aria-hidden', 'true')
  image(avatar, comment.avatarUrl)
  const content = node('div', 'comment-content')
  const top = node('div', 'comment-top')
  const likes = node('span', 'likes', `♡ ${displayCount(comment.likes)}`)
  likes.setAttribute('aria-label', `${displayCount(comment.likes)} 次点赞`)
  top.append(node('span', 'nickname', comment.nickname), likes)
  const body = node('p', 'comment-body collapsed', comment.content)
  content.append(top, body)
  const expand = button(
    '展开',
    () => {
      const collapsed = body.classList.toggle('collapsed')
      expand.textContent = collapsed ? '展开' : '收起'
      expand.setAttribute('aria-expanded', String(!collapsed))
    },
    'text-button expand'
  )
  expand.hidden = true
  expand.setAttribute('aria-expanded', 'false')
  content.append(expand)
  for (const reply of comment.replies)
    content.append(node('blockquote', 'quote', `${reply.nickname}：${reply.content}`))
  const actions = node('div', 'comment-actions')
  const date = node(
    'time',
    '',
    comment.time
      ? new Date(comment.time).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : ''
  )
  if (comment.time) date.dateTime = new Date(comment.time).toISOString()
  actions.append(
    date,
    button('复制', () => copy(comment.content), 'text-button')
  )
  content.append(actions)
  article.append(avatar, content)
  requestAnimationFrame(() => {
    if (article.isConnected) expand.hidden = body.scrollHeight <= body.clientHeight + 1
  })
  return article
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制评论')
  } catch {
    const input = node('textarea')
    input.value = text
    input.style.cssText = 'position:fixed;left:-9999px'
    document.body.append(input)
    input.select()
    const ok = document.execCommand('copy')
    input.remove()
    toast(ok ? '已复制评论' : '请选中正文后按 Ctrl+C 复制')
  }
}

function render(state) {
  const track = state.track
  $('song-title').textContent = track?.title || '网易云评论'
  $('song-artist').textContent = track
    ? [track.artist, track.album].filter(Boolean).join(' · ')
    : '随音乐，看看大家的故事'
  const trackKey = track?.id ?? ''
  if (trackKey !== renderedTrack) {
    renderedTrack = trackKey
    coverTrack = ''
    if (!pageLayout) window.scrollTo(0, 0)
    $('cover').replaceChildren(document.createTextNode('♫'))
    imageQueue.length = 0
    imageObserver.disconnect()
  }
  if (track && session && state.association && coverTrack !== trackKey) {
    coverTrack = trackKey
    const expected = trackKey
    call('cover', { track, key: 'cover' })
      .then((data) => {
        if (!data || disposed || renderedTrack !== expected) return
        const img = node('img')
        img.alt = ''
        img.src = data
        $('cover').replaceChildren(img)
      })
      .catch(() => {})
  }
  const association = state.association
  $('association').hidden = !association?.song
  if (association?.song) {
    const title = node(
      'span',
      '',
      association.kind === 'explicit' ? '网易云歌曲' : association.song.title
    )
    title.append(
      node(
        'small',
        'badge',
        { explicit: '已识别歌曲 ID', manual: '手动关联', auto: '自动关联 · 可更换' }[
          association.kind
        ]
      )
    )
    const actions = node('div', 'association-actions')
    if (association.kind !== 'explicit') {
      actions.append(
        button('更换关联', () => controller.choose('rematch')),
        button('取消', () => controller.choose('unlink'))
      )
    }
    $('association').replaceChildren(title, actions)
  }
  $('matching').hidden = !track || !state.choosing
  if (state.choosing) {
    if (!$('query').value || $('query').dataset.track !== trackKey) {
      $('query').value = `${track.title} ${track.artist}`.trim()
      $('query').dataset.track = trackKey
    }
    const candidates = state.candidates.map((candidate) => {
      const entry = button(
        '',
        () => controller.choose('associate', { value: candidate.id }),
        'candidate'
      )
      entry.append(
        node('strong', '', candidate.title),
        node('small', '', `${candidate.artist} · ${candidate.album} · ${time(candidate.duration)}`)
      )
      if (candidate.version) entry.append(node('small', 'version', candidate.version))
      entry.disabled = state.loading
      return entry
    })
    if (!candidates.length && !state.loading)
      candidates.push(
        node(
          'p',
          'hint',
          association?.kind === 'paused'
            ? '已暂停自动关联。搜索或粘贴链接可重新选择。'
            : '没有唯一可靠的匹配，请搜索或粘贴歌曲链接。'
        )
      )
    $('candidates').replaceChildren(...candidates)
  }
  $('tabs').hidden = !association?.song
  for (const tab of ['hot', 'latest']) {
    $(`tab-${tab}`).setAttribute('aria-selected', String(tab === state.tab))
    $(`tab-${tab}`).tabIndex = tab === state.tab ? 0 : -1
  }
  $('comment-panel').setAttribute('aria-labelledby', `tab-${state.tab}`)
  $('comment-panel').setAttribute('aria-busy', String(state.loading))
  $('count').hidden = !association?.song || (!state.items.length && state.loading)
  $('count').textContent =
    `${state.tab === 'hot' ? '热门评论' : '全部评论'} · ${displayCount(state.total)}`
  $('error').hidden = !state.error
  $('error-text').textContent = state.error
  $('skeleton').hidden = !state.loading || state.items.length > 0
  const empty = !state.loading && !state.error && !state.items.length && !state.choosing
  $('status').hidden = !empty
  if (empty) {
    $('status').replaceChildren(
      node('div', 'empty-symbol', '“'),
      node('h2', '', track ? '还没有评论' : '让音乐先响起'),
      node('p', '', track ? '也许，这首歌的故事才刚开始。' : '播放一首歌曲，在这里阅读它的评论。')
    )
  }
  if (renderedItems !== state.items) {
    const prefix =
      renderedItems.length <= state.items.length &&
      renderedItems.every((item, index) => state.items[index] === item)
    if (!prefix) $('comments').replaceChildren()
    const additions = prefix ? state.items.slice(renderedItems.length) : state.items
    for (const item of additions) $('comments').append(renderComment(item))
    renderedItems = state.items
  }
  $('load-more').hidden = !state.hasMore || state.choosing
  $('load-more').disabled = state.loading
  $('load-more').textContent = state.loading ? '正在加载…' : '加载更多评论'
  $('end').hidden = !state.items.length || state.hasMore || state.loading || state.choosing
  $('refresh').disabled = state.loading
  for (const element of document.querySelectorAll('form button')) element.disabled = state.loading
}

function receivePlayer(value) {
  const track = value?.currentTrack ?? null
  latestTrack = track
  if (session) lyricsPage?.onPlayer(value)
  if (!commentsVisible) return
  const key = JSON.stringify(
    track ? [track.id, track.title, track.artist, track.album, track.duration] : null
  )
  if (key === lastTrackKey || !session) return
  lastTrackKey = key
  void controller.setTrack(track)
}

window.addEventListener('message', async (event) => {
  if (
    event.source !== window.parent ||
    event.data?.type !== 'twilight-experience-connect' ||
    event.data.bridgeVersion !== 2 ||
    !event.ports[0]
  )
    return
  const replacing = !!port
  const generation = ++bridgeGeneration
  if (replacing) {
    port.close()
  }
  port = event.ports[0]
  lastHostReply = Date.now()
  port.onmessage = (message) => {
    lastHostReply = Date.now()
    const data = message.data
    if (data.event === 'player') {
      receivePlayer(data.value)
      return
    }
    if (data.event === 'lyrics') {
      void lyricsPage?.refreshLyrics()
      return
    }
    const work = pending.get(data.id)
    if (!work) return
    pending.delete(data.id)
    clearTimeout(work.timer)
    if (data.error) work.reject(new Error(data.error))
    else work.resolve(data.value)
  }
  port.start()
  // These requests are reads or idempotent private association/settings writes.
  // Retain their caller and sequence fences across a host-owned port refresh.
  if (replacing) for (const work of pending.values()) port.postMessage(work.message)
  if (!bridgeTimer)
    bridgeTimer = setInterval(() => {
      // Baseline hosts can replace an experience descriptor and close its port
      // without remounting the iframe. Re-handshake over the supported protocol.
      if (
        !document.hidden &&
        Date.now() - lastHostReply > 2500 &&
        Date.now() - lastAnnounce > 1000
      ) {
        lastAnnounce = Date.now()
        window.parent.postMessage({ type: 'twilight-experience-ready', bridgeVersion: 2 }, '*')
      }
    }, 500)
  try {
    if (!session) {
      const opened = await call('open')
      if (generation !== bridgeGeneration) return
      session = opened.session
      controller.state.tab = opened.tab
    } else {
      try {
        await call('heartbeat')
      } catch {
        const opened = await call('open')
        session = opened.session
      }
    }
    if (!replacing) document.body.focus({ preventScroll: true })
    if (!heartbeatTimer)
      heartbeatTimer = setInterval(() => {
        if (!document.hidden) void call('heartbeat').catch(() => reconnect())
      }, 500)
    if (!themeTimer)
      themeTimer = setInterval(() => {
        if (!document.hidden) void theme()
      }, 2000)
    await theme()
    if (generation !== bridgeGeneration) return
    receivePlayer(await rpc('player.state'))
  } catch (error) {
    if (generation === bridgeGeneration)
      controller.publish({ error: error.message, loading: false })
  }
})
window.parent.postMessage({ type: 'twilight-experience-ready', bridgeVersion: 2 }, '*')

$('tab-hot').onclick = () => controller.tab('hot')
$('tab-latest').onclick = () => controller.tab('latest')
document.querySelector('[role=tablist]').onkeydown = (event) => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const tab =
      event.key === 'Home'
        ? 'hot'
        : event.key === 'End'
          ? 'latest'
          : controller.state.tab === 'hot'
            ? 'latest'
            : 'hot'
    void controller.tab(tab)
    $(`tab-${tab}`).focus()
  }
}
$('refresh').onclick = () => controller.load(false, true)
$('load-more').onclick = () => controller.load(true)
$('retry').onclick = () =>
  controller.state.association?.song
    ? controller.load(controller.state.retryMore === true, true)
    : controller.setTrack(controller.state.track)
$('search-form').onsubmit = (event) => {
  event.preventDefault()
  void controller.search($('query').value)
}
$('link-form').onsubmit = (event) => {
  event.preventDefault()
  void controller.choose('associate', { value: $('song-link').value })
}
$('search-submit').onclick = () => controller.search($('query').value)
$('associate-song').onclick = () => controller.choose('associate', { value: $('song-link').value })
for (const [id, action] of [
  ['query', () => controller.search($('query').value)],
  ['song-link', () => controller.choose('associate', { value: $('song-link').value })]
]) {
  $(id).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void action()
    }
  })
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    void rpc('host.exit')
  }
})
document.addEventListener('visibilitychange', () => {
  if (!session) return
  if (document.hidden) {
    void call('cancel').catch(() => {})
  } else {
    // A suspended renderer may outlive the short lease: replace its session.
    void reconnect()
  }
})
window.addEventListener('pagehide', () => {
  controller.dispose()
  clearInterval(heartbeatTimer)
  clearInterval(themeTimer)
  clearInterval(bridgeTimer)
  clearTimeout(toastTimer)
  imageObserver.disconnect()
  imageQueue.length = 0
  lyricsPage?.dispose()
  disposed = true
  for (const request of pending.values()) {
    clearTimeout(request.timer)
    request.reject(new Error('面板已关闭'))
  }
  pending.clear()
})
