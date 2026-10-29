import { normalizeCandidate, normalizeComment, songId } from './domain.mjs'

const ORIGIN = 'https://music.163.com'
const abortError = () => new Error('请求已取消')

/** Shared work is cancelled only after its final subscriber leaves. */
export class RequestPool {
  constructor({ concurrency = 2, timeout = 15000, now = Date.now } = {}) {
    this.concurrency = concurrency
    this.timeout = timeout
    this.now = now
    this.active = 0
    this.tasks = new Map()
    this.cache = new Map()
    this.queue = []
  }

  request(key, work, { signal, ttl = 0, force = false } = {}) {
    if (signal?.aborted) return Promise.reject(abortError())
    const cached = this.cache.get(key)
    if (!force && cached?.expires > this.now()) return Promise.resolve(cached.value)
    let task = this.tasks.get(key)
    if (!task) {
      task = { key, work, ttl, controller: new AbortController(), subscribers: new Set() }
      this.tasks.set(key, task)
      this.queue.push(task)
    }
    const pending = new Promise((resolve, reject) => {
      const subscriber = {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', cancel)
      }
      const cancel = () => {
        subscriber.cleanup()
        task.subscribers.delete(subscriber)
        reject(abortError())
        if (!task.subscribers.size) {
          task.controller.abort(abortError())
          if (this.tasks.get(key) === task) this.tasks.delete(key)
        }
      }
      task.subscribers.add(subscriber)
      signal?.addEventListener('abort', cancel, { once: true })
    })
    this.drain()
    return pending
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift()
      if (task.controller.signal.aborted) continue
      this.active++
      const timer = setTimeout(
        () => task.controller.abort(new Error('请求超时，请重试')),
        this.timeout
      )
      const timedOut = new Promise((_, reject) =>
        task.controller.signal.addEventListener(
          'abort',
          () => reject(task.controller.signal.reason),
          { once: true }
        )
      )
      Promise.race([Promise.resolve().then(() => task.work(task.controller.signal)), timedOut])
        .then(
          (value) => {
            if (task.controller.signal.aborted) throw task.controller.signal.reason
            if (task.ttl) {
              this.cache.delete(task.key)
              this.cache.set(task.key, { value, expires: this.now() + task.ttl })
              while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value)
            }
            for (const subscriber of task.subscribers) subscriber.resolve(value)
          },
          (error) => {
            throw error
          }
        )
        .catch((error) => {
          for (const subscriber of task.subscribers) subscriber.reject(error)
        })
        .finally(() => {
          clearTimeout(timer)
          for (const subscriber of task.subscribers) subscriber.cleanup()
          if (this.tasks.get(task.key) === task) this.tasks.delete(task.key)
          this.active--
          this.drain()
        })
    }
  }

  close() {
    for (const task of this.tasks.values()) task.controller.abort(abortError())
    this.cache.clear()
  }
}

async function limitedBytes(response, limit, signal) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('响应过大')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('服务器返回空响应')
  const chunks = []
  let size = 0
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error('响应过大')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

export class NcmClient {
  constructor({ fetcher = (...args) => fetch(...args), pool = new RequestPool() } = {}) {
    this.fetcher = fetcher
    this.pool = pool
  }

  json(path, { signal, ttl = 300000, force = false } = {}) {
    return this.pool.request(
      path,
      async (abort) => {
        const response = await this.fetcher(ORIGIN + path, {
          signal: abort,
          redirect: 'error',
          headers: {
            Referer: ORIGIN + '/',
            'User-Agent': 'Mozilla/5.0',
            Accept: 'application/json'
          }
        })
        if (!response.ok) throw new Error(`网易云服务暂不可用（HTTP ${response.status}）`)
        let data
        const body = await limitedBytes(response, 2 * 1024 * 1024, abort)
        try {
          data = JSON.parse(body.toString('utf8'))
        } catch {
          throw new Error('网易云返回了非 JSON 数据，请稍后重试')
        }
        if (Number(data?.code) !== 200)
          throw new Error(`网易云请求未成功（${data?.code ?? '未知状态'}）`)
        return data
      },
      { signal, ttl, force }
    )
  }

  async search(query, signal) {
    const text = String(query ?? '')
      .trim()
      .slice(0, 200)
    if (!text) return []
    const data = await this.json(
      `/api/search/get?s=${encodeURIComponent(text)}&type=1&limit=20&offset=0`,
      { signal }
    )
    if (!Array.isArray(data.result?.songs) && data.result?.songCount !== 0)
      throw new Error('网易云返回了无效的搜索结果')
    const seen = new Set()
    return (data.result?.songs ?? [])
      .map(normalizeCandidate)
      .filter((item) => item && !seen.has(item.id) && seen.add(item.id))
      .slice(0, 20)
  }

  async detail(id, signal) {
    id = songId(id)
    if (!id) throw new Error('网易云歌曲 ID 无效')
    const data = await this.json(
      `/api/song/detail/?id=${id}&ids=${encodeURIComponent(JSON.stringify([id]))}`,
      { signal }
    )
    const song = data.songs?.find((item) => String(item.id) === id)
    const result = normalizeCandidate(song)
    if (!result) throw new Error('没有找到这首网易云歌曲，请检查链接或 ID')
    return result
  }

  async comments(id, sort, offset = 0, signal, force = false) {
    id = songId(id)
    if (
      !id ||
      !['hot', 'latest'].includes(sort) ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1000000
    )
      throw new Error('评论请求参数无效')
    const route = sort === 'hot' ? 'hotcomments' : 'comments'
    const data = await this.json(
      `/api/v1/resource/${route}/R_SO_4_${id}?limit=20&offset=${offset}`,
      { signal, force }
    )
    const raw = sort === 'hot' ? data.hotComments : data.comments
    if (!Array.isArray(raw)) throw new Error('网易云返回了无效的评论列表')
    const total = Math.max(0, Number(data.total) || 0)
    return {
      items: raw.map(normalizeComment).filter(Boolean),
      total,
      nextOffset: offset + raw.length,
      hasMore:
        raw.length > 0 && (typeof data.more === 'boolean' ? data.more : offset + raw.length < total)
    }
  }

  invalidateComments(id) {
    id = songId(id)
    if (!id) return
    const matches = (key) => ['comments', 'hotcomments'].some(route =>
      key.startsWith(`/api/v1/resource/${route}/R_SO_4_${id}?`))
    for (const key of this.pool.cache.keys()) if (matches(key)) this.pool.cache.delete(key)
    for (const [key, task] of this.pool.tasks) if (matches(key)) {
      task.controller.abort(abortError())
      this.pool.tasks.delete(key)
    }
  }

  image(value, signal) {
    let url
    try {
      url = new URL(value)
      if (
        !/^p\d+\.music\.126\.net$/.test(url.hostname) ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port
      )
        throw new Error()
      url.protocol = 'https:'
      url.search = '?param=96y96'
    } catch {
      return Promise.resolve(null)
    }
    return this.pool.request(
      `image:${url.href}`,
      async (abort) => {
        const response = await this.fetcher(url.href, { signal: abort, redirect: 'error' })
        const rawType = response.headers.get('content-type')?.split(';')[0].trim()
        const type = rawType === 'image/jpg' ? 'image/jpeg' : rawType
        if (!response.ok || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type))
          return null
        const bytes = await limitedBytes(response, 96 * 1024, abort)
        return `data:${type};base64,${bytes.toString('base64')}`
      },
      { signal, ttl: 30 * 60 * 1000 }
    )
  }

  close() {
    this.pool.close()
  }
}
