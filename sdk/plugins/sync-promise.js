/* global __hostCall, __PLUGIN_HOST__ */
// Mobile ABI v1 is serial, synchronous host IO on an isolated worker process.
// esbuild lowers async/await to this Promise; it never needs QuickJS pending-job APIs.
globalThis.Promise = class SyncPromise {
  constructor(executor) {
    this.state = 0; this.value = undefined; this.listeners = []
    try { executor(v => this.resolve(v), e => this.settle(2, e)) } catch (e) { this.settle(2, e) }
  }
  resolve(v) {
    if (v === this) return this.settle(2, new TypeError('Promise cycle'))
    if (v && typeof v.then === 'function') { try { v.then(x => this.resolve(x), e => this.settle(2, e)) } catch (e) { this.settle(2, e) }; return }
    this.settle(1, v)
  }
  settle(state, value) { if (this.state) return; this.state = state; this.value = value; this.listeners.splice(0).forEach(f => f()) }
  then(ok, fail) { return new SyncPromise((resolve, reject) => {
    const run = () => { try {
      const fn = this.state === 1 ? ok : fail
      if (typeof fn === 'function') resolve(fn(this.value))
      else (this.state === 1 ? resolve : reject)(this.value)
    } catch (e) { reject(e) } }
    if (this.state) run(); else this.listeners.push(run)
  }) }
  catch(fn) { return this.then(undefined, fn) }
  finally(fn) { return this.then(v => SyncPromise.resolve(fn()).then(() => v), e => SyncPromise.resolve(fn()).then(() => { throw e })) }
  static resolve(v) { return new SyncPromise(resolve => resolve(v)) }
  static reject(e) { return new SyncPromise((_, reject) => reject(e)) }
  static all(values) { return new SyncPromise((resolve, reject) => {
    const result = []; let remaining = values.length
    if (!remaining) resolve(result)
    values.forEach((v, i) => SyncPromise.resolve(v).then(x => { result[i] = x; if (!--remaining) resolve(result) }, reject))
  }) }
}
globalThis.global = globalThis
globalThis.setTimeout = (fn, ms) => { __hostCall('sleep', { ms }); fn(); return 0 }
globalThis.clearTimeout = () => {}
globalThis.TextEncoder = class { encode(value) { return Uint8Array.from(unescape(encodeURIComponent(value)), ch => ch.charCodeAt(0)) } }
globalThis.__hostCall = (method, args = {}) => {
  const result = JSON.parse(__PLUGIN_HOST__.call(method, JSON.stringify(args)))
  if (!result.ok) throw new Error(result.error || '插件宿主调用失败')
  return result.value
}
globalThis.URL = class MobileURL {
  constructor(value) { Object.assign(this, __hostCall('url', { value })) }
  get href() { return this.protocol + '//' + this.host + this.pathname + this.search + this.hash }
  toString() { return this.href }
};
