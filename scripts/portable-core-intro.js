// Prepended to dist/portable-core/music-core.js. Embedded engines (QuickJS,
// JavaScriptCore) start without the Web/Node globals the Core relies on.
//
// When the host sets `globalThis.__TWILIGHT_HOST_EVENT_LOOP__ = true` before
// evaluating the bundle, Promise jobs and timers run on a JS-owned loop that
// the host pumps through `globalThis.__TWILIGHT_EVENT_LOOP__`. Engines such as
// Cash QuickJS never run their native pending-job queue, so native promises
// would otherwise stall forever. The bundle is built with async functions
// lowered to generators, so every await goes through the global Promise.
;(function (g) {
  'use strict'

  function define(target, name, value) {
    Object.defineProperty(target, name, {
      value: value,
      writable: true,
      configurable: true,
      enumerable: false
    })
  }

  // ---------------------------------------------------------------------------
  // Host-pumped event loop
  // ---------------------------------------------------------------------------
  if (g.__TWILIGHT_HOST_EVENT_LOOP__ === true && !g.__TWILIGHT_EVENT_LOOP__) {
    var microtasks = []
    var microtaskHead = 0
    var loopErrors = []
    var MAX_LOOP_ERRORS = 64

    var recordLoopError = function (prefix, error) {
      var message
      try {
        message =
          error && typeof error === 'object' && typeof error.message === 'string'
            ? (error.name ? error.name + ': ' : '') + error.message
            : String(error)
      } catch (_) {
        message = 'Unprintable error'
      }
      if (loopErrors.length < MAX_LOOP_ERRORS) loopErrors.push(prefix + message)
    }

    var enqueueMicrotask = function (job) {
      microtasks.push(job)
    }

    var pendingMicrotasks = function () {
      return microtasks.length - microtaskHead
    }

    var unhandled = []

    var runMicrotasks = function () {
      var ran = 0
      while (microtaskHead < microtasks.length) {
        var job = microtasks[microtaskHead]
        microtasks[microtaskHead] = undefined
        microtaskHead++
        ran++
        try {
          job()
        } catch (error) {
          recordLoopError('Uncaught microtask error: ', error)
        }
        if (ran > 5000000) {
          microtasks = []
          microtaskHead = 0
          throw new Error('Portable Core microtask queue did not settle')
        }
      }
      microtasks = []
      microtaskHead = 0
      if (unhandled.length > 0) {
        var rejected = unhandled
        unhandled = []
        for (var i = 0; i < rejected.length; i++) {
          if (!rejected[i]._handled) recordLoopError('Unhandled rejection: ', rejected[i]._value)
        }
      }
      return ran
    }

    // Promises/A+ with ES2021 statics. Reactions run on the host microtask
    // queue in FIFO order, which matches native job ordering for one realm.
    var PENDING = 0
    var FULFILLED = 1
    var REJECTED = 2

    var HostPromise = function Promise(executor) {
      if (!(this instanceof HostPromise)) throw new TypeError("Promise constructor cannot be invoked without 'new'")
      if (typeof executor !== 'function') throw new TypeError('Promise resolver is not a function')
      this._state = PENDING
      this._value = undefined
      this._reactions = []
      this._handled = false
      var fns = resolvingFunctions(this)
      try {
        executor(fns.resolve, fns.reject)
      } catch (error) {
        fns.reject(error)
      }
    }

    var settlePromise = function (promise, state, value) {
      if (promise._state !== PENDING) return
      promise._state = state
      promise._value = value
      var reactions = promise._reactions
      promise._reactions = null
      for (var i = 0; i < reactions.length; i++) scheduleReaction(promise, reactions[i])
      if (state === REJECTED && !promise._handled) unhandled.push(promise)
    }

    var resolvePromise = function (promise, value) {
      if (value === promise) {
        settlePromise(promise, REJECTED, new TypeError('Chaining cycle detected for promise'))
        return
      }
      if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
        var then
        try {
          then = value.then
        } catch (error) {
          settlePromise(promise, REJECTED, error)
          return
        }
        if (typeof then === 'function') {
          var fns = resolvingFunctions(promise)
          enqueueMicrotask(function () {
            try {
              then.call(value, fns.resolve, fns.reject)
            } catch (error) {
              fns.reject(error)
            }
          })
          return
        }
      }
      settlePromise(promise, FULFILLED, value)
    }

    var resolvingFunctions = function (promise) {
      var done = false
      return {
        resolve: function (value) {
          if (done) return
          done = true
          resolvePromise(promise, value)
        },
        reject: function (reason) {
          if (done) return
          done = true
          settlePromise(promise, REJECTED, reason)
        }
      }
    }

    var scheduleReaction = function (promise, reaction) {
      enqueueMicrotask(function () {
        var fulfilled = promise._state === FULFILLED
        var handler = fulfilled ? reaction.onFulfilled : reaction.onRejected
        if (typeof handler !== 'function') {
          if (fulfilled) reaction.resolve(promise._value)
          else reaction.reject(promise._value)
          return
        }
        var result
        try {
          result = handler(promise._value)
        } catch (error) {
          reaction.reject(error)
          return
        }
        reaction.resolve(result)
      })
    }

    var newCapability = function () {
      var capability = {}
      capability.promise = new HostPromise(function (resolve, reject) {
        capability.resolve = resolve
        capability.reject = reject
      })
      return capability
    }

    define(HostPromise.prototype, 'then', function then(onFulfilled, onRejected) {
      var capability = newCapability()
      var reaction = {
        onFulfilled: onFulfilled,
        onRejected: onRejected,
        resolve: capability.resolve,
        reject: capability.reject
      }
      this._handled = true
      if (this._state === PENDING) this._reactions.push(reaction)
      else scheduleReaction(this, reaction)
      return capability.promise
    })
    define(HostPromise.prototype, 'catch', function (onRejected) {
      return this.then(undefined, onRejected)
    })
    define(HostPromise.prototype, 'finally', function (onFinally) {
      if (typeof onFinally !== 'function') return this.then(onFinally, onFinally)
      return this.then(
        function (value) {
          return HostPromise.resolve(onFinally()).then(function () {
            return value
          })
        },
        function (reason) {
          return HostPromise.resolve(onFinally()).then(function () {
            throw reason
          })
        }
      )
    })
    if (typeof Symbol === 'function' && Symbol.toStringTag) {
      Object.defineProperty(HostPromise.prototype, Symbol.toStringTag, {
        value: 'Promise',
        configurable: true
      })
    }

    define(HostPromise, 'resolve', function resolve(value) {
      if (value instanceof HostPromise) return value
      return new HostPromise(function (resolveValue) {
        resolveValue(value)
      })
    })
    define(HostPromise, 'reject', function reject(reason) {
      return new HostPromise(function (_resolve, rejectValue) {
        rejectValue(reason)
      })
    })
    define(HostPromise, 'all', function all(iterable) {
      return new HostPromise(function (resolve, reject) {
        var items = Array.from(iterable)
        var results = new Array(items.length)
        var remaining = items.length
        if (remaining === 0) {
          resolve(results)
          return
        }
        items.forEach(function (item, index) {
          HostPromise.resolve(item).then(function (value) {
            results[index] = value
            remaining--
            if (remaining === 0) resolve(results)
          }, reject)
        })
      })
    })
    define(HostPromise, 'allSettled', function allSettled(iterable) {
      return new HostPromise(function (resolve) {
        var items = Array.from(iterable)
        var results = new Array(items.length)
        var remaining = items.length
        if (remaining === 0) {
          resolve(results)
          return
        }
        items.forEach(function (item, index) {
          HostPromise.resolve(item).then(
            function (value) {
              results[index] = { status: 'fulfilled', value: value }
              remaining--
              if (remaining === 0) resolve(results)
            },
            function (reason) {
              results[index] = { status: 'rejected', reason: reason }
              remaining--
              if (remaining === 0) resolve(results)
            }
          )
        })
      })
    })
    define(HostPromise, 'race', function race(iterable) {
      return new HostPromise(function (resolve, reject) {
        Array.from(iterable).forEach(function (item) {
          HostPromise.resolve(item).then(resolve, reject)
        })
      })
    })
    define(HostPromise, 'any', function any(iterable) {
      return new HostPromise(function (resolve, reject) {
        var items = Array.from(iterable)
        var errors = new Array(items.length)
        var remaining = items.length
        var fail = function () {
          var Aggregate = g.AggregateError
          reject(
            typeof Aggregate === 'function'
              ? new Aggregate(errors, 'All promises were rejected')
              : new Error('All promises were rejected')
          )
        }
        if (remaining === 0) {
          fail()
          return
        }
        items.forEach(function (item, index) {
          HostPromise.resolve(item).then(resolve, function (reason) {
            errors[index] = reason
            remaining--
            if (remaining === 0) fail()
          })
        })
      })
    })

    // Timers: due time, then creation order. Callbacks scheduled while a pass
    // runs wait for the next pass, so a zero-delay re-arm cannot spin forever.
    var timers = []
    var activeTimers = {}
    var nextTimerId = 1
    var timerSequence = 0

    var insertTimer = function (timer) {
      var low = 0
      var high = timers.length
      while (low < high) {
        var mid = (low + high) >>> 1
        var other = timers[mid]
        if (other.due < timer.due || (other.due === timer.due && other.seq < timer.seq)) low = mid + 1
        else high = mid
      }
      timers.splice(low, 0, timer)
    }

    var addTimer = function (callback, delay, args, repeat) {
      if (typeof callback !== 'function') throw new TypeError('Timer callback must be a function')
      var ms = Number(delay)
      ms = isFinite(ms) && ms > 0 ? Math.floor(ms) : 0
      var timer = {
        id: nextTimerId++,
        seq: timerSequence++,
        due: Date.now() + ms,
        interval: repeat ? Math.max(1, ms) : 0,
        callback: callback,
        args: args
      }
      activeTimers[timer.id] = timer
      insertTimer(timer)
      return timer.id
    }

    var cancelTimer = function (id) {
      var key = typeof id === 'object' && id !== null && typeof id.id === 'number' ? id.id : id
      if (activeTimers[key]) delete activeTimers[key]
    }

    var runDueTimers = function (now) {
      var at = typeof now === 'number' ? now : Date.now()
      var passLimit = timerSequence
      var ran = 0
      while (timers.length > 0) {
        var timer = timers[0]
        if (activeTimers[timer.id] !== timer) {
          timers.shift()
          continue
        }
        if (timer.due > at || timer.seq >= passLimit) break
        timers.shift()
        if (timer.interval > 0) {
          timer.due = Math.max(at, timer.due + timer.interval)
          timer.seq = timerSequence++
          insertTimer(timer)
        } else {
          delete activeTimers[timer.id]
        }
        ran++
        try {
          timer.callback.apply(undefined, timer.args)
        } catch (error) {
          recordLoopError('Uncaught timer error: ', error)
        }
        runMicrotasks()
      }
      return ran
    }

    var nextTimerDelay = function (now) {
      var at = typeof now === 'number' ? now : Date.now()
      while (timers.length > 0 && activeTimers[timers[0].id] !== timers[0]) timers.shift()
      if (timers.length === 0) return -1
      return Math.max(0, timers[0].due - at)
    }

    g.Promise = HostPromise
    g.queueMicrotask = function queueMicrotask(callback) {
      if (typeof callback !== 'function') throw new TypeError('queueMicrotask expects a function')
      enqueueMicrotask(function () {
        callback()
      })
    }
    g.setTimeout = function setTimeout(callback, delay) {
      return addTimer(callback, delay, Array.prototype.slice.call(arguments, 2), false)
    }
    g.setInterval = function setInterval(callback, delay) {
      return addTimer(callback, delay, Array.prototype.slice.call(arguments, 2), true)
    }
    g.clearTimeout = cancelTimer
    g.clearInterval = cancelTimer

    var logs = []
    var pushLog = function (level) {
      return function () {
        var parts = []
        for (var i = 0; i < arguments.length; i++) {
          var part = arguments[i]
          try {
            parts.push(
              typeof part === 'string'
                ? part
                : part instanceof Error
                  ? part.name + ': ' + part.message
                  : JSON.stringify(part)
            )
          } catch (_) {
            parts.push(String(part))
          }
        }
        if (logs.length < 256) logs.push({ level: level, message: parts.join(' ').slice(0, 4096) })
      }
    }
    if (typeof g.console !== 'object' || g.console === null) {
      g.console = {
        log: pushLog('info'),
        info: pushLog('info'),
        debug: pushLog('debug'),
        warn: pushLog('warn'),
        error: pushLog('error')
      }
    }

    g.__TWILIGHT_EVENT_LOOP__ = {
      runMicrotasks: runMicrotasks,
      runDueTimers: runDueTimers,
      nextTimerDelay: nextTimerDelay,
      pendingMicrotasks: pendingMicrotasks,
      takeErrors: function () {
        var out = loopErrors
        loopErrors = []
        return out
      },
      takeLogs: function () {
        var out = logs
        logs = []
        return out
      }
    }
  }

  // ---------------------------------------------------------------------------
  // ES2021-ES2023 built-ins missing from older embedded engines
  // ---------------------------------------------------------------------------
  if (typeof Object.hasOwn !== 'function') {
    define(Object, 'hasOwn', function hasOwn(object, key) {
      if (object === null || object === undefined) throw new TypeError('Cannot convert undefined or null to object')
      return Object.prototype.hasOwnProperty.call(object, key)
    })
  }

  var typedArrayPrototype =
    typeof Uint8Array === 'function' ? Object.getPrototypeOf(Uint8Array.prototype) : null
  var indexedPrototypes = [Array.prototype, String.prototype]
  if (typedArrayPrototype) indexedPrototypes.push(typedArrayPrototype)
  var listPrototypes = [Array.prototype]
  if (typedArrayPrototype) listPrototypes.push(typedArrayPrototype)

  indexedPrototypes.forEach(function (proto) {
    if (typeof proto.at === 'function') return
    define(proto, 'at', function at(index) {
      var length = this.length >>> 0
      var relative = Math.trunc(Number(index)) || 0
      var k = relative >= 0 ? relative : length + relative
      return k < 0 || k >= length ? undefined : this[k]
    })
  })
  listPrototypes.forEach(function (proto) {
    if (typeof proto.findLast !== 'function') {
      define(proto, 'findLast', function findLast(predicate, thisArg) {
        for (var i = (this.length >>> 0) - 1; i >= 0; i--) {
          if (predicate.call(thisArg, this[i], i, this)) return this[i]
        }
        return undefined
      })
    }
    if (typeof proto.findLastIndex !== 'function') {
      define(proto, 'findLastIndex', function findLastIndex(predicate, thisArg) {
        for (var i = (this.length >>> 0) - 1; i >= 0; i--) {
          if (predicate.call(thisArg, this[i], i, this)) return i
        }
        return -1
      })
    }
  })

  if (typeof String.prototype.replaceAll !== 'function') {
    define(String.prototype, 'replaceAll', function replaceAll(search, replacement) {
      if (search instanceof RegExp) {
        if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp')
        return String(this).replace(search, replacement)
      }
      var pattern = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      return String(this).replace(pattern, replacement)
    })
  }

  if (typeof g.AggregateError !== 'function') {
    var PortableAggregateError = function AggregateError(errors, message) {
      var error = new Error(message === undefined ? '' : String(message))
      Object.setPrototypeOf(error, PortableAggregateError.prototype)
      define(error, 'errors', Array.from(errors || []))
      return error
    }
    PortableAggregateError.prototype = Object.create(Error.prototype)
    define(PortableAggregateError.prototype, 'constructor', PortableAggregateError)
    define(PortableAggregateError.prototype, 'name', 'AggregateError')
    g.AggregateError = PortableAggregateError
  }

  var BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  if (typeof g.btoa !== 'function') {
    g.btoa = function btoa(input) {
      var text = String(input)
      var out = ''
      for (var i = 0; i < text.length; i += 3) {
        var a = text.charCodeAt(i)
        var b = text.charCodeAt(i + 1)
        var c = text.charCodeAt(i + 2)
        if (a > 255 || b > 255 || c > 255) throw new Error('btoa: character out of Latin1 range')
        var bits = (a << 16) | ((b || 0) << 8) | (c || 0)
        out += BASE64.charAt((bits >> 18) & 63) + BASE64.charAt((bits >> 12) & 63)
        out += i + 1 < text.length ? BASE64.charAt((bits >> 6) & 63) : '='
        out += i + 2 < text.length ? BASE64.charAt(bits & 63) : '='
      }
      return out
    }
  }
  if (typeof g.atob !== 'function') {
    g.atob = function atob(input) {
      var text = String(input).replace(/[\t\n\f\r ]+/g, '')
      if (text.length % 4 === 0) text = text.replace(/==?$/, '')
      if (text.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(text)) throw new Error('atob: invalid base64 input')
      var out = ''
      var buffer = 0
      var bitCount = 0
      for (var i = 0; i < text.length; i++) {
        buffer = (buffer << 6) | BASE64.indexOf(text.charAt(i))
        bitCount += 6
        if (bitCount >= 8) {
          bitCount -= 8
          out += String.fromCharCode((buffer >> bitCount) & 255)
        }
      }
      return out
    }
  }

  // ---------------------------------------------------------------------------
  // Web platform subset
  // ---------------------------------------------------------------------------
  if (!g.crypto || typeof g.crypto.randomUUID !== 'function') {
    var cryptoObject = g.crypto && typeof g.crypto === 'object' ? g.crypto : {}
    try {
      cryptoObject.randomUUID = function randomUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (slot) {
          var nibble = Math.floor(Math.random() * 16)
          return (slot === 'x' ? nibble : (nibble & 3) | 8).toString(16)
        })
      }
      g.crypto = cryptoObject
    } catch (_) {
      // A frozen host crypto object keeps its own implementation.
    }
  }

  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = function structuredClone(value) {
      var seen = typeof Map === 'function' ? new Map() : null
      var clone = function (input) {
        if (input === null || typeof input !== 'object') return input
        if (seen && seen.has(input)) return seen.get(input)
        var out
        if (input instanceof Date) out = new Date(input.getTime())
        else if (input instanceof RegExp) out = new RegExp(input.source, input.flags)
        else if (typeof ArrayBuffer === 'function' && input instanceof ArrayBuffer) out = input.slice(0)
        else if (typeof ArrayBuffer === 'function' && ArrayBuffer.isView(input)) {
          out = input instanceof DataView
            ? new DataView(input.buffer.slice(0), input.byteOffset, input.byteLength)
            : new input.constructor(input)
        } else if (input instanceof Map) {
          out = new Map()
          if (seen) seen.set(input, out)
          input.forEach(function (entry, key) {
            out.set(clone(key), clone(entry))
          })
          return out
        } else if (input instanceof Set) {
          out = new Set()
          if (seen) seen.set(input, out)
          input.forEach(function (entry) {
            out.add(clone(entry))
          })
          return out
        } else if (Array.isArray(input)) {
          out = new Array(input.length)
          if (seen) seen.set(input, out)
          for (var i = 0; i < input.length; i++) out[i] = clone(input[i])
          return out
        } else if (input instanceof Error) {
          out = new Error(input.message)
          out.name = input.name
        } else {
          out = {}
          if (seen) seen.set(input, out)
          var keys = Object.keys(input)
          for (var k = 0; k < keys.length; k++) out[keys[k]] = clone(input[keys[k]])
          return out
        }
        if (seen) seen.set(input, out)
        return out
      }
      return clone(value)
    }
  }

  if (typeof g.Intl !== 'object' || g.Intl === null) g.Intl = {}
  if (typeof g.Intl.Collator !== 'function') {
    // Approximates the ICU collator for sorting: base sensitivity folds case,
    // and numeric collation compares digit runs by value.
    var PortableCollator = function Collator(locales, options) {
      if (!(this instanceof PortableCollator)) return new PortableCollator(locales, options)
      var settings = options || {}
      var locale = Array.isArray(locales) ? String(locales[0] || 'en') : String(locales || 'en')
      var foldCase = settings.sensitivity === 'base' || settings.sensitivity === 'accent'
      var numeric = settings.numeric === true
      this.resolvedOptions = function () {
        return {
          locale: locale,
          usage: settings.usage || 'sort',
          sensitivity: settings.sensitivity || 'variant',
          numeric: numeric
        }
      }
      this.compare = function (left, right) {
        var a = String(left === undefined || left === null ? '' : left)
        var b = String(right === undefined || right === null ? '' : right)
        if (foldCase) {
          a = a.toLowerCase()
          b = b.toLowerCase()
        }
        if (numeric) {
          var chunk = /(\d+|\D+)/g
          var aa = a.match(chunk) || []
          var bb = b.match(chunk) || []
          for (var i = 0; i < Math.min(aa.length, bb.length); i++) {
            var x = aa[i]
            var y = bb[i]
            if (x === y) continue
            var xn = /^\d/.test(x)
            var yn = /^\d/.test(y)
            if (xn && yn) {
              var diff = Number(x) - Number(y)
              if (diff !== 0) return diff < 0 ? -1 : 1
              return x.length < y.length ? -1 : 1
            }
            return x < y ? -1 : 1
          }
          if (aa.length !== bb.length) return aa.length < bb.length ? -1 : 1
          return 0
        }
        if (a === b) return 0
        return a < b ? -1 : 1
      }
    }
    g.Intl.Collator = PortableCollator
  }

  if (typeof g.TextEncoder !== 'function') {
    g.TextEncoder = function TextEncoder() {
      this.encoding = 'utf-8'
      this.encode = function (input) {
        var text = String(input === undefined ? '' : input)
        var bytes = []
        for (var i = 0; i < text.length; i++) {
          var cp = text.charCodeAt(i)
          if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
            var next = text.charCodeAt(i + 1)
            if (next >= 0xdc00 && next <= 0xdfff) {
              cp = ((cp - 0xd800) << 10) + (next - 0xdc00) + 0x10000
              i++
            }
          }
          if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd
          if (cp <= 0x7f) bytes.push(cp)
          else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
          else if (cp <= 0xffff) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
          else
            bytes.push(
              0xf0 | (cp >> 18),
              0x80 | ((cp >> 12) & 0x3f),
              0x80 | ((cp >> 6) & 0x3f),
              0x80 | (cp & 0x3f)
            )
        }
        return new Uint8Array(bytes)
      }
    }
  }
  if (typeof g.TextDecoder !== 'function') {
    g.TextDecoder = function TextDecoder() {
      this.encoding = 'utf-8'
      this.decode = function (input) {
        if (!input) return ''
        var bytes =
          input instanceof Uint8Array
            ? input
            : ArrayBuffer.isView(input)
              ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
              : new Uint8Array(input)
        var out = ''
        var i = 0
        while (i < bytes.length) {
          var b0 = bytes[i]
          var cp = 0xfffd
          var need = 0
          if (b0 < 0x80) cp = b0
          else if (b0 >= 0xc2 && b0 <= 0xdf) {
            need = 1
            cp = b0 & 0x1f
          } else if (b0 >= 0xe0 && b0 <= 0xef) {
            need = 2
            cp = b0 & 0x0f
          } else if (b0 >= 0xf0 && b0 <= 0xf4) {
            need = 3
            cp = b0 & 0x07
          }
          i++
          var valid = true
          for (var k = 0; k < need; k++) {
            var bk = bytes[i]
            if (bk === undefined || (bk & 0xc0) !== 0x80) {
              valid = false
              break
            }
            cp = (cp << 6) | (bk & 0x3f)
            i++
          }
          if (!valid || (need === 2 && cp < 0x800) || (need === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) {
            cp = 0xfffd
          }
          if (cp > 0xffff) {
            cp -= 0x10000
            out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
          } else {
            out += String.fromCharCode(cp)
          }
        }
        return out
      }
    }
  }

  if (typeof g.DOMException !== 'function') {
    var PortableDOMException = function DOMException(message, name) {
      var error = new Error(message === undefined ? '' : String(message))
      Object.setPrototypeOf(error, PortableDOMException.prototype)
      define(error, 'name', name === undefined ? 'Error' : String(name))
      define(error, 'code', 0)
      return error
    }
    PortableDOMException.prototype = Object.create(Error.prototype)
    define(PortableDOMException.prototype, 'constructor', PortableDOMException)
    g.DOMException = PortableDOMException
  }
  var makeAbortError = function (name, message) {
    return new g.DOMException(message, name)
  }
  if (typeof g.AbortController !== 'function') {
    var PortableAbortSignal = function AbortSignal() {
      this.aborted = false
      this.reason = undefined
      this.onabort = null
      this._listeners = []
    }
    PortableAbortSignal.prototype.addEventListener = function (type, listener) {
      if (type !== 'abort' || typeof listener !== 'function') return
      if (this._listeners.indexOf(listener) < 0) this._listeners.push(listener)
    }
    PortableAbortSignal.prototype.removeEventListener = function (type, listener) {
      var index = this._listeners.indexOf(listener)
      if (index >= 0) this._listeners.splice(index, 1)
    }
    PortableAbortSignal.prototype.throwIfAborted = function () {
      if (this.aborted) throw this.reason
    }
    PortableAbortSignal.prototype._trigger = function (reason) {
      if (this.aborted) return
      this.aborted = true
      this.reason = reason === undefined ? makeAbortError('AbortError', 'This operation was aborted') : reason
      var event = { type: 'abort', target: this }
      var listeners = this._listeners.slice()
      this._listeners.length = 0
      if (typeof this.onabort === 'function') {
        try {
          this.onabort(event)
        } catch (_) {
          // Listener failures never stop the abort fan-out.
        }
      }
      for (var i = 0; i < listeners.length; i++) {
        try {
          listeners[i].call(this, event)
        } catch (_) {
          // Listener failures never stop the abort fan-out.
        }
      }
    }
    PortableAbortSignal.abort = function (reason) {
      var signal = new PortableAbortSignal()
      signal._trigger(reason)
      return signal
    }
    g.AbortSignal = PortableAbortSignal
    g.AbortController = function AbortController() {
      var signal = new PortableAbortSignal()
      this.signal = signal
      this.abort = function (reason) {
        signal._trigger(reason)
      }
    }
  }
  if (typeof g.AbortSignal === 'function' && typeof g.AbortSignal.any !== 'function') {
    g.AbortSignal.any = function any(signals) {
      var controller = new g.AbortController()
      var follow = function (signal) {
        if (controller.signal.aborted) return
        if (signal.aborted) {
          controller.abort(signal.reason)
          return
        }
        // One closure per source: the composite reports the signal that fired.
        signal.addEventListener('abort', function () {
          controller.abort(signal.reason)
        })
      }
      Array.from(signals || []).forEach(function (signal) {
        if (signal) follow(signal)
      })
      return controller.signal
    }
  }
  if (typeof g.AbortSignal === 'function' && typeof g.AbortSignal.timeout !== 'function') {
    g.AbortSignal.timeout = function timeout(ms) {
      var controller = new g.AbortController()
      g.setTimeout(function () {
        controller.abort(makeAbortError('TimeoutError', 'The operation timed out'))
      }, ms)
      return controller.signal
    }
  }

  if (typeof g.URL !== 'function') {
    var PortableURL = function URL(url, base) {
      var raw = String(url === undefined ? '' : url).trim()
      if (base !== undefined && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
        var parent = new PortableURL(String(base))
        if (raw.charAt(0) === '/') raw = parent.protocol + '//' + parent.host + raw
        else raw = parent.protocol + '//' + parent.host + parent.pathname.replace(/[^/]*$/, '') + raw
      }
      var match = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/:?#]*)(?::([0-9]+))?(\/[^?#]*)?(\?[^#]*)?(#.*)?$/.exec(raw)
      if (!match || (!match[4] && match[1].toLowerCase() !== 'file:')) throw new TypeError('Invalid URL: ' + raw)
      this.protocol = match[1].toLowerCase()
      this.username = match[2] || ''
      this.password = match[3] || ''
      this.hostname = match[4].toLowerCase()
      this.port = match[5] || ''
      this.host = this.port ? this.hostname + ':' + this.port : this.hostname
      this.pathname = match[6] || '/'
      this.search = match[7] && match[7] !== '?' ? match[7] : ''
      this.hash = match[8] && match[8] !== '#' ? match[8] : ''
      this.origin = this.hostname ? this.protocol + '//' + this.host : 'null'
      var auth = this.username ? this.username + (this.password ? ':' + this.password : '') + '@' : ''
      this.href = this.protocol + '//' + auth + this.host + this.pathname + this.search + this.hash
    }
    PortableURL.prototype.toString = function () {
      return this.href
    }
    PortableURL.prototype.toJSON = function () {
      return this.href
    }
    g.URL = PortableURL
  }

  if (typeof g.console !== 'object' || g.console === null) {
    var noop = function () {
      // Embedded runtimes without a console intentionally discard diagnostics.
    }
    g.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop }
  }
  if (typeof g.performance !== 'object' || g.performance === null) {
    g.performance = {
      now: function () {
        return Date.now()
      }
    }
  }
  if (typeof g.queueMicrotask !== 'function') {
    g.queueMicrotask = function queueMicrotask(callback) {
      g.Promise.resolve().then(callback)
    }
  }
})(globalThis)
