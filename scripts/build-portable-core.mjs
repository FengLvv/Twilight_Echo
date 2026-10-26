import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENTRY = path.join(ROOT, 'src/core/portableSlice.ts')
const OUT_DIR = path.join(ROOT, 'dist/portable-core')
const OUT_FILE = path.join(OUT_DIR, 'music-core.js')
const LOCK_FILE = path.join(OUT_DIR, 'core-lock.json')

function resolveGitCommitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return '65688cccf919cbf36d900e92fd0a06eb4fb557c0'
  }
}

const QUICKJS_BOOTSTRAP_INTRO = `
(function(g) {
  var uuidSeq = 0;
  function genUuid() {
    uuidSeq = (uuidSeq + 1) >>> 0;
    function hex(len) {
      var s = '';
      for (var i = 0; i < len; i++) s += Math.floor(Math.random() * 16).toString(16);
      return s;
    }
    var p = (Date.now() & 0xffffffff).toString(16).padStart(8, '0');
    var q = (uuidSeq & 0xffff).toString(16).padStart(4, '0');
    return p + '-' + q + '-4' + hex(3) + '-8' + hex(3) + '-' + hex(12);
  }
  if (!g.crypto || typeof g.crypto.randomUUID !== 'function') {
    var c = (g.crypto && typeof g.crypto === 'object') ? g.crypto : {};
    try { c.randomUUID = genUuid; g.crypto = c; } catch (_) {}
  }
  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = function clone(v) {
      if (v === undefined || v === null || typeof v !== 'object') return v;
      if (v instanceof Date) return new Date(v.getTime());
      if (v instanceof Uint8Array) return new Uint8Array(v);
      if (Array.isArray(v)) return v.map(clone);
      if (v instanceof Map) {
        var m = new Map();
        v.forEach(function(val, k) { m.set(clone(k), clone(val)); });
        return m;
      }
      if (v instanceof Set) {
        var st = new Set();
        v.forEach(function(val) { st.add(clone(val)); });
        return st;
      }
      var out = {};
      var keys = Object.keys(v);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        out[k] = clone(v[k]);
      }
      return out;
    };
  }
  if (typeof g.Intl !== 'object' || g.Intl === null) {
    g.Intl = {};
  }
  if (typeof g.Intl.Collator !== 'function') {
    g.Intl.Collator = function PortableCollator(locales, options) {
      this._locale = Array.isArray(locales) ? String(locales[0] || 'en') : String(locales || 'en');
      this._options = options || {};
      this.compare = function(a, b) {
        var sa = String(a === undefined || a === null ? '' : a);
        var sb = String(b === undefined || b === null ? '' : b);
        if (sa === sb) return 0;
        return sa < sb ? -1 : 1;
      };
      this.resolvedOptions = function() {
        return { locale: this._locale };
      };
    };
  }
  if (typeof g.TextEncoder !== 'function') {
    g.TextEncoder = function PortableTextEncoder() {
      this.encoding = 'utf-8';
      this.encode = function(input) {
        var str = String(input === undefined ? '' : input);
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
          var cp = str.charCodeAt(i);
          if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
            var next = str.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
              cp = ((cp - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
              i++;
            }
          }
          if (cp <= 0x7f) bytes.push(cp);
          else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
          else if (cp <= 0xffff) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        }
        return new Uint8Array(bytes);
      };
    };
  }
  if (typeof g.TextDecoder !== 'function') {
    g.TextDecoder = function PortableTextDecoder() {
      this.encoding = 'utf-8';
      this.decode = function(input) {
        if (!input) return '';
        var bytes = input instanceof Uint8Array ? input : (ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input));
        var out = '';
        for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        try { return decodeURIComponent(escape(out)); } catch (_) { return out; }
      };
    };
  }
  if (typeof g.AbortController !== 'function') {
    function PortableAbortSignal() {
      this.aborted = false;
      this.reason = undefined;
      this._listeners = [];
    }
    PortableAbortSignal.prototype.addEventListener = function(_t, fn) {
      if (this.aborted) { fn(); return; }
      this._listeners.push(fn);
    };
    PortableAbortSignal.prototype.removeEventListener = function(_t, fn) {
      var idx = this._listeners.indexOf(fn);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
    PortableAbortSignal.prototype.throwIfAborted = function() {
      if (this.aborted) throw (this.reason || new Error('Aborted'));
    };
    PortableAbortSignal.prototype._trigger = function(reason) {
      if (this.aborted) return;
      this.aborted = true;
      this.reason = reason || new Error('Aborted');
      var list = this._listeners.slice();
      this._listeners.length = 0;
      for (var i = 0; i < list.length; i++) { try { list[i](); } catch (_) {} }
    };
    PortableAbortSignal.abort = function(r) { var s = new PortableAbortSignal(); s._trigger(r); return s; };
    PortableAbortSignal.any = function(sigs) {
      var c = new PortableAbortSignal();
      if (sigs && typeof sigs[Symbol.iterator] === 'function') {
        for (var s of sigs) {
          if (!s) continue;
          if (s.aborted) { c._trigger(s.reason); return c; }
          s.addEventListener('abort', function() { c._trigger(s.reason); });
        }
      }
      return c;
    };
    g.AbortSignal = PortableAbortSignal;
    g.AbortController = function PortableAbortController() {
      this.signal = new PortableAbortSignal();
      var self = this;
      this.abort = function(reason) { self.signal._trigger(reason); };
    };
  }
  if (typeof g.URL !== 'function') {
    g.URL = function PortableURL(url) {
      var raw = String(url === undefined ? '' : url).trim();
      var m = /^([a-zA-Z][a-zA-Z0-9+.-]*:)\\/\\/(?:([^:@/]+)(?::([^@/]*))?@)?([^/:?#]+)(?::([0-9]+))?(\\/[^?#]*)?(\\?[^#]*)?(#.*)?$/.exec(raw);
      if (!m) throw new TypeError('Invalid URL: ' + raw);
      this.href = raw;
      this.protocol = m[1].toLowerCase();
      this.username = m[2] || '';
      this.password = m[3] || '';
      this.hostname = m[4];
      this.port = m[5] || '';
      this.host = this.port ? (this.hostname + ':' + this.port) : this.hostname;
      this.pathname = m[6] || '/';
      this.search = m[7] || '';
      this.hash = m[8] || '';
      this.toString = function() { return this.href; };
    };
  }
  if (typeof g.console !== 'object' || g.console === null) {
    var noop = function() {};
    g.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop };
  }
  if (typeof g.performance !== 'object' || g.performance === null) {
    g.performance = { now: function() { return Date.now(); } };
  }
  if (typeof g.queueMicrotask !== 'function') {
    g.queueMicrotask = function(cb) { Promise.resolve().then(cb); };
  }
  if (typeof g.setTimeout !== 'function') {
    var nextTimerId = 1;
    g.setTimeout = function(cb, delay) {
      var id = nextTimerId++;
      if (!delay || delay <= 0) {
        Promise.resolve().then(function() { if (typeof cb === 'function') cb(); });
      }
      return id;
    };
    g.clearTimeout = function() {};
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  await build({
    root: ROOT,
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      target: 'es2020',
      lib: {
        entry: ENTRY,
        name: 'TwilightPortableCore',
        formats: ['iife'],
        fileName: () => 'music-core.js'
      },
      rollupOptions: {
        external: [],
        output: {
          intro: QUICKJS_BOOTSTRAP_INTRO
        },
        onwarn(warning, warn) {
          if (warning.code === 'CIRCULAR_DEPENDENCY') return
          warn(warning)
        }
      }
    }
  })

  if (!fs.existsSync(OUT_FILE)) {
    throw new Error(`Expected portable Core bundle was not produced at ${OUT_FILE}`)
  }

  const bundleCode = fs.readFileSync(OUT_FILE, 'utf8')

  // Verify the bundle has zero Node.js runtime imports, require() calls, or Legacy Node I/O shim references
  const forbiddenPatterns = [
    { pattern: /\bnode:[a-z0-9_/]+\b/i, reason: 'node:* builtin module reference' },
    { pattern: /__TWILIGHT_CORE_PORTS__/, reason: 'Legacy Node I/O shim (__TWILIGHT_CORE_PORTS__)' },
    { pattern: /\brequire\s*\(/, reason: 'CommonJS require() call' }
  ]

  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(bundleCode)) {
      throw new Error(`Portable Core bundle validation failed: found forbidden ${reason}`)
    }
  }

  const sha256 = crypto.createHash('sha256').update(bundleCode, 'utf8').digest('hex')
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

  const lockMetadata = {
    upstream: 'https://github.com/Px-asen/Twilight_Echo',
    commit: resolveGitCommitSha(),
    musicCoreVersion: pkg.version ?? '1.4.0-perview',
    audioCoreVersion: '0.1.0',
    protocolVersion: 1,
    hostApiVersion: '1.0.0',
    nativeAbiVersion: '0.1.0',
    bundleFile: 'music-core.js',
    bundleSha256: sha256,
    bundleBytes: Buffer.byteLength(bundleCode, 'utf8')
  }

  fs.writeFileSync(LOCK_FILE, `${JSON.stringify(lockMetadata, null, 2)}\n`, 'utf8')

  if (process.env.SKIP_ANDROID_SYNC !== '1') {
    const androidTargets = [
      path.join(ROOT, 'sdk/android-app'),
      path.resolve(ROOT, '../Twilight_Echo_Android')
    ]
    for (const androidAppRoot of androidTargets) {
      if (fs.existsSync(androidAppRoot)) {
        const androidAssetsCoreDir = path.join(androidAppRoot, 'runtime-host/src/main/assets/core')
        fs.mkdirSync(androidAssetsCoreDir, { recursive: true })
        fs.copyFileSync(OUT_FILE, path.join(androidAssetsCoreDir, 'music-core.js'))
        fs.copyFileSync(LOCK_FILE, path.join(androidAssetsCoreDir, 'core-lock.json'))
        fs.copyFileSync(LOCK_FILE, path.join(androidAppRoot, 'core-lock.json'))
      }
    }
  }

  console.log(
    `[portable-core] Built ${ path.relative(ROOT, OUT_FILE) } (${lockMetadata.bundleBytes} bytes, sha256=${sha256.slice(0, 12)}...)`
  )
}

main().catch((error) => {
  console.error('[portable-core] Build failed:', error)
  process.exitCode = 1
})
