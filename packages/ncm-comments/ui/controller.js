// UI state is independent of DOM/transport so races can be tested deterministically.
export class CommentsController {
  constructor(call, changed = () => {}) {
    this.call = call
    this.changed = changed
    this.sequence = 0
    this.state = {
      track: null,
      association: null,
      tab: 'hot',
      items: [],
      candidates: [],
      total: 0,
      offset: 0,
      hasMore: false,
      loading: false,
      error: '',
      choosing: false
    }
  }
  publish(patch) {
    Object.assign(this.state, patch)
    this.changed(this.state)
  }
  async setTrack(track) {
    const sequence = ++this.sequence
    this.publish({
      track,
      association: null,
      items: [],
      candidates: [],
      offset: 0,
      total: 0,
      hasMore: false,
      error: '',
      choosing: false,
      loading: !!track
    })
    try {
      await this.call('cancel')
      if (sequence !== this.sequence || !track) return
      const association = await this.call('resolve', { track, key: 'resolve' })
      if (sequence !== this.sequence) return
      this.publish({
        track: association.track,
        association,
        candidates: association.candidates ?? [],
        choosing: !association.song,
        loading: false
      })
      if (association.song) await this.load(false)
    } catch (error) {
      if (sequence === this.sequence)
        this.publish({
          loading: false,
          choosing: !!track,
          association: track ? { kind: 'choose', track } : null,
          error: error.message
        })
    }
  }
  async load(more = false, force = false) {
    if (!this.state.association?.song || this.state.loading) return
    const sequence = this.sequence
    this.publish({ loading: true, error: '', retryMore: more })
    try {
      const result = await this.call('comments', {
        songId: this.state.association.song.id,
        sort: this.state.tab,
        offset: more ? this.state.offset : 0,
        force,
        key: 'comments'
      })
      if (sequence !== this.sequence) return
      const previous = more ? this.state.items : []
      const seen = new Set(previous.map((item) => item.id))
      const items = [
        ...previous,
        ...result.items.filter((item) => !seen.has(item.id) && seen.add(item.id))
      ]
      this.publish({
        items,
        total: result.total,
        offset: result.nextOffset,
        hasMore: result.hasMore,
        loading: false
      })
    } catch (error) {
      if (sequence === this.sequence) this.publish({ loading: false, error: error.message })
    }
  }
  async tab(tab) {
    if (this.state.tab === tab) return
    const sequence = ++this.sequence
    this.publish({ tab, items: [], offset: 0, total: 0, hasMore: false, loading: false, error: '' })
    try {
      await this.call('cancel')
      if (sequence !== this.sequence) return
      await this.call('tab', { tab })
      if (sequence === this.sequence) await this.load()
    } catch (error) {
      if (sequence === this.sequence) this.publish({ loading: false, error: error.message })
    }
  }
  async choose(operation, extra = {}) {
    if (!this.state.track) return
    const sequence = ++this.sequence
    this.publish({ loading: true, error: '' })
    try {
      await this.call('cancel')
      if (sequence !== this.sequence) return
      const association = await this.call(operation, {
        track: this.state.track,
        ...extra,
        key: 'association'
      })
      if (sequence !== this.sequence) return
      this.publish({
        association,
        candidates: association.candidates ?? [],
        choosing: !association.song,
        items: [],
        offset: 0,
        hasMore: false,
        total: 0,
        loading: false
      })
      if (association.song) await this.load()
    } catch (error) {
      if (sequence === this.sequence) this.publish({ loading: false, error: error.message })
    }
  }
  async search(query) {
    const sequence = ++this.sequence
    this.publish({ loading: true, error: '', choosing: true })
    try {
      await this.call('cancel')
      if (sequence !== this.sequence) return
      const candidates = await this.call('search', {
        query,
        track: this.state.track,
        key: 'search'
      })
      if (sequence === this.sequence) this.publish({ candidates, loading: false })
    } catch (error) {
      if (sequence === this.sequence) this.publish({ loading: false, error: error.message })
    }
  }
  dispose() {
    this.sequence++
    void this.call('close').catch(() => {})
  }
}
