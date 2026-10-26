type Listener = (...args: any[]) => void

export class EventEmitter {
  private readonly events = new Map<string | symbol, Listener[]>()
  private readonly onceWrappers = new WeakMap<Listener, Listener>()

  on(event: string | symbol, listener: Listener): this {
    const list = this.events.get(event) ?? []
    list.push(listener)
    this.events.set(event, list)
    return this
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener)
  }

  once(event: string | symbol, listener: Listener): this {
    const wrapper: Listener = (...args: any[]) => {
      this.off(event, wrapper)
      listener(...args)
    }
    this.onceWrappers.set(listener, wrapper)
    return this.on(event, wrapper)
  }

  off(event: string | symbol, listener: Listener): this {
    const list = this.events.get(event)
    if (!list) return this
    const wrapper = this.onceWrappers.get(listener)
    const index = list.findIndex((entry) => entry === listener || (wrapper && entry === wrapper))
    if (index !== -1) {
      list.splice(index, 1)
    }
    if (list.length === 0) {
      this.events.delete(event)
    }
    return this
  }

  removeListener(event: string | symbol, listener: Listener): this {
    return this.off(event, listener)
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) {
      this.events.clear()
    } else {
      this.events.delete(event)
    }
    return this
  }

  emit(event: string | symbol, ...args: any[]): boolean {
    const list = this.events.get(event)
    if (!list || list.length === 0) return false
    const snapshot = [...list]
    for (const listener of snapshot) {
      listener(...args)
    }
    return true
  }

  listenerCount(event: string | symbol): number {
    return this.events.get(event)?.length ?? 0
  }

  listeners(event: string | symbol): Listener[] {
    return [...(this.events.get(event) ?? [])]
  }

  setMaxListeners(_n: number): this {
    return this
  }
}
