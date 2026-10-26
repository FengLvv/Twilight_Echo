export interface ParsedPath {
  root: string
  dir: string
  base: string
  ext: string
  name: string
}

export interface PortablePathImplementation {
  readonly sep: string
  readonly delimiter: string
  normalize(p: string): string
  isAbsolute(p: string): boolean
  join(...paths: string[]): string
  resolve(...paths: string[]): string
  relative(from: string, to: string): string
  dirname(p: string): string
  basename(p: string, suffix?: string): string
  extname(p: string): string
  parse(p: string): ParsedPath
  format(pathObject: Partial<ParsedPath>): string
}

let defaultIsWindows = (() => {
  try {
    const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator
    if (nav?.platform && /win/i.test(nav.platform)) return true
    if (nav?.userAgent && /windows/i.test(nav.userAgent)) return true
  } catch {
    // ignore
  }
  return false
})()

let defaultCwdProvider: () => string = () => (defaultIsWindows ? 'C:\\' : '/')

export function configurePortablePathPlatform(options: {
  isWindows: boolean
  cwd?: () => string
}): void {
  defaultIsWindows = options.isWindows
  if (options.cwd) {
    defaultCwdProvider = options.cwd
  }
}

function normalizeArrayPosix(parts: string[], allowAboveRoot: boolean): string[] {
  const res: string[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!
    if (!p || p === '.') continue
    if (p === '..') {
      if (res.length > 0 && res[res.length - 1] !== '..') {
        res.pop()
      } else if (allowAboveRoot) {
        res.push('..')
      }
    } else {
      res.push(p)
    }
  }
  return res
}

export const posix: PortablePathImplementation = {
  sep: '/',
  delimiter: ':',

  normalize(p: string): string {
    if (p.length === 0) return '.'
    const isAbs = p.charCodeAt(0) === 47
    const trailingSlash = p.charCodeAt(p.length - 1) === 47
    const segments = normalizeArrayPosix(p.split('/'), !isAbs)
    let out = segments.join('/')
    if (!out && !isAbs) {
      out = '.'
    }
    if (out && trailingSlash) {
      out += '/'
    }
    return (isAbs ? '/' : '') + out
  },

  isAbsolute(p: string): boolean {
    return p.length > 0 && p.charCodeAt(0) === 47
  },

  join(...paths: string[]): string {
    if (paths.length === 0) return '.'
    let joined: string | undefined
    for (const arg of paths) {
      if (arg.length > 0) {
        if (joined === undefined) joined = arg
        else joined += `/${arg}`
      }
    }
    if (joined === undefined) return '.'
    return posix.normalize(joined)
  },

  resolve(...paths: string[]): string {
    let resolvedPath = ''
    let resolvedAbsolute = false
    for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i -= 1) {
      const path = i >= 0 ? paths[i]! : defaultCwdProvider().replace(/\\/g, '/')
      if (path.length === 0) continue
      resolvedPath = `${path}/${resolvedPath}`
      resolvedAbsolute = path.charCodeAt(0) === 47
    }
    resolvedPath = normalizeArrayPosix(resolvedPath.split('/'), !resolvedAbsolute).join('/')
    return (resolvedAbsolute ? '/' : '') + resolvedPath || '.'
  },

  relative(from: string, to: string): string {
    if (from === to) return ''
    const fromOrig = posix.resolve(from)
    const toOrig = posix.resolve(to)
    if (fromOrig === toOrig) return ''
    const fromParts = fromOrig.split('/').filter(Boolean)
    const toParts = toOrig.split('/').filter(Boolean)
    const length = Math.min(fromParts.length, toParts.length)
    let samePartsLength = length
    for (let i = 0; i < length; i += 1) {
      if (fromParts[i] !== toParts[i]) {
        samePartsLength = i
        break
      }
    }
    const outputParts: string[] = []
    for (let i = samePartsLength; i < fromParts.length; i += 1) {
      outputParts.push('..')
    }
    outputParts.push(...toParts.slice(samePartsLength))
    return outputParts.join('/')
  },

  dirname(p: string): string {
    if (p.length === 0) return '.'
    const hasRoot = p.charCodeAt(0) === 47
    let end = -1
    let matchedSlash = true
    for (let i = p.length - 1; i >= 1; i -= 1) {
      if (p.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          end = i
          break
        }
      } else {
        matchedSlash = false
      }
    }
    if (end === -1) return hasRoot ? '/' : '.'
    if (hasRoot && end === 1) return '//'
    return p.slice(0, end)
  },

  basename(p: string, suffix?: string): string {
    let start = 0
    let end = -1
    let matchedSlash = true
    for (let i = p.length - 1; i >= 0; i -= 1) {
      if (p.charCodeAt(i) === 47) {
        if (!matchedSlash) {
          start = i + 1
          break
        }
      } else if (end === -1) {
        matchedSlash = false
        end = i + 1
      }
    }
    if (end === -1) return ''
    const base = p.slice(start, end)
    if (suffix && base.endsWith(suffix)) {
      return base.slice(0, base.length - suffix.length)
    }
    return base
  },

  extname(p: string): string {
    const base = posix.basename(p)
    const dotIndex = base.lastIndexOf('.')
    if (dotIndex <= 0) return ''
    return base.slice(dotIndex)
  },

  parse(p: string): ParsedPath {
    if (p.length === 0) {
      return { root: '', dir: '', base: '', ext: '', name: '' }
    }
    const root = p.charCodeAt(0) === 47 ? '/' : ''
    const dir = posix.dirname(p)
    const base = posix.basename(p)
    const ext = posix.extname(p)
    const name = ext ? base.slice(0, base.length - ext.length) : base
    return {
      root,
      dir: dir === '.' && !p.startsWith('./') && !root ? '' : dir,
      base,
      ext,
      name
    }
  },

  format(pathObject: Partial<ParsedPath>): string {
    const dir = pathObject.dir || pathObject.root || ''
    const base = pathObject.base || `${pathObject.name || ''}${pathObject.ext || ''}`
    if (!dir) return base
    return dir === pathObject.root ? `${dir}${base}` : `${dir}/${base}`
  }
}

function splitWindowsRoot(p: string): { device: string; isUnc: boolean; isAbsolute: boolean; tail: string } {
  const len = p.length
  if (len === 0) return { device: '', isUnc: false, isAbsolute: false, tail: '' }
  const normalized = p.replace(/\//g, '\\')
  if (normalized.startsWith('\\\\')) {
    const parts = normalized.slice(2).split('\\')
    if (parts.length >= 2 && parts[0] && parts[1]) {
      const device = `\\\\${parts[0]}\\${parts[1]}`
      const rest = normalized.slice(device.length)
      return {
        device,
        isUnc: true,
        isAbsolute: true,
        tail: rest.startsWith('\\') ? rest.slice(1) : rest
      }
    }
  }
  if (len >= 2 && /^[A-Za-z]:/.test(normalized)) {
    const device = normalized.slice(0, 2)
    const rest = normalized.slice(2)
    const isAbs = rest.startsWith('\\')
    return {
      device,
      isUnc: false,
      isAbsolute: isAbs,
      tail: isAbs ? rest.slice(1) : rest
    }
  }
  if (normalized.startsWith('\\')) {
    return {
      device: '',
      isUnc: false,
      isAbsolute: true,
      tail: normalized.replace(/^\\+/, '')
    }
  }
  return {
    device: '',
    isUnc: false,
    isAbsolute: false,
    tail: normalized
  }
}

export const win32: PortablePathImplementation = {
  sep: '\\',
  delimiter: ';',

  normalize(p: string): string {
    if (p.length === 0) return '.'
    const { device, isAbsolute, tail } = splitWindowsRoot(p)
    const trailingSlash = /[\\/]$/.test(p)
    let tailNorm = normalizeArrayPosix(tail.split(/\\+/), !isAbsolute).join('\\')
    if (!tailNorm && !isAbsolute) {
      tailNorm = '.'
    }
    if (tailNorm && trailingSlash && tailNorm !== '.') {
      tailNorm += '\\'
    }
    return `${device}${isAbsolute ? '\\' : ''}${tailNorm}`
  },

  isAbsolute(p: string): boolean {
    if (p.length === 0) return false
    if (p.startsWith('/') || p.startsWith('\\')) return true
    return /^[A-Za-z]:[\\/]/.test(p)
  },

  join(...paths: string[]): string {
    if (paths.length === 0) return '.'
    const filtered = paths.filter((p) => p.length > 0)
    if (filtered.length === 0) return '.'
    return win32.normalize(filtered.join('\\'))
  },

  resolve(...paths: string[]): string {
    let resolvedDevice = ''
    let resolvedTail = ''
    let resolvedAbsolute = false

    for (let i = paths.length - 1; i >= -1; i -= 1) {
      const path = i >= 0 ? paths[i]! : defaultCwdProvider()
      if (!path || path.length === 0) continue
      const { device, isAbsolute, tail } = splitWindowsRoot(path)
      if (device && resolvedDevice && device.toLowerCase() !== resolvedDevice.toLowerCase()) {
        continue
      }
      if (!resolvedDevice && device) {
        resolvedDevice = device
      }
      if (!resolvedAbsolute) {
        resolvedTail = `${tail}\\${resolvedTail}`
        resolvedAbsolute = isAbsolute
      }
      if (resolvedDevice && resolvedAbsolute) {
        break
      }
    }

    const normTail = normalizeArrayPosix(resolvedTail.split(/\\+/), !resolvedAbsolute).join('\\')
    return `${resolvedDevice}${resolvedAbsolute ? '\\' : ''}${normTail}` || '.'
  },

  relative(from: string, to: string): string {
    const fromOrig = win32.resolve(from)
    const toOrig = win32.resolve(to)
    if (fromOrig.toLowerCase() === toOrig.toLowerCase()) return ''
    const fromRoot = splitWindowsRoot(fromOrig)
    const toRoot = splitWindowsRoot(toOrig)
    if (fromRoot.device.toLowerCase() !== toRoot.device.toLowerCase()) {
      return toOrig
    }
    const fromParts = fromRoot.tail.split('\\').filter(Boolean)
    const toParts = toRoot.tail.split('\\').filter(Boolean)
    const length = Math.min(fromParts.length, toParts.length)
    let samePartsLength = length
    for (let i = 0; i < length; i += 1) {
      if (fromParts[i]!.toLowerCase() !== toParts[i]!.toLowerCase()) {
        samePartsLength = i
        break
      }
    }
    const outputParts: string[] = []
    for (let i = samePartsLength; i < fromParts.length; i += 1) {
      outputParts.push('..')
    }
    outputParts.push(...toParts.slice(samePartsLength))
    return outputParts.join('\\')
  },

  dirname(p: string): string {
    if (p.length === 0) return '.'
    const { device, isAbsolute, tail } = splitWindowsRoot(p)
    const root = `${device}${isAbsolute ? '\\' : ''}`
    const trimmedTail = tail.replace(/\\+$/, '')
    if (!trimmedTail) {
      return root || '.'
    }
    const lastSep = trimmedTail.lastIndexOf('\\')
    if (lastSep === -1) {
      return root || '.'
    }
    return `${root}${trimmedTail.slice(0, lastSep)}`
  },

  basename(p: string, suffix?: string): string {
    const { tail } = splitWindowsRoot(p)
    const trimmed = tail.replace(/\\+$/, '')
    if (!trimmed) return ''
    const lastSep = trimmed.lastIndexOf('\\')
    const base = lastSep === -1 ? trimmed : trimmed.slice(lastSep + 1)
    if (suffix && base.endsWith(suffix)) {
      return base.slice(0, base.length - suffix.length)
    }
    return base
  },

  extname(p: string): string {
    const base = win32.basename(p)
    const dotIndex = base.lastIndexOf('.')
    if (dotIndex <= 0) return ''
    return base.slice(dotIndex)
  },

  parse(p: string): ParsedPath {
    if (p.length === 0) {
      return { root: '', dir: '', base: '', ext: '', name: '' }
    }
    const { device, isAbsolute } = splitWindowsRoot(p)
    const root = `${device}${isAbsolute ? '\\' : ''}`
    const dir = win32.dirname(p)
    const base = win32.basename(p)
    const ext = win32.extname(p)
    const name = ext ? base.slice(0, base.length - ext.length) : base
    return {
      root,
      dir: dir === '.' && !p.startsWith('.\\') && !p.startsWith('./') && !root ? '' : dir,
      base,
      ext,
      name
    }
  },

  format(pathObject: Partial<ParsedPath>): string {
    const dir = pathObject.dir || pathObject.root || ''
    const base = pathObject.base || `${pathObject.name || ''}${pathObject.ext || ''}`
    if (!dir) return base
    return dir === pathObject.root ? `${dir}${base}` : `${dir}\\${base}`
  }
}

function activeImpl(samplePath?: string): PortablePathImplementation {
  if (defaultIsWindows) return win32
  if (samplePath && (/^[A-Za-z]:[\\/]/.test(samplePath) || samplePath.includes('\\'))) {
    return win32
  }
  return posix
}

export function getSep(): string {
  return defaultIsWindows ? '\\' : '/'
}

export const sep: string = defaultIsWindows ? '\\' : '/'
export const delimiter: string = defaultIsWindows ? ';' : ':'

export function normalize(p: string): string {
  return activeImpl(p).normalize(p)
}

export function isAbsolute(p: string): boolean {
  return activeImpl(p).isAbsolute(p)
}

export function join(...paths: string[]): string {
  return activeImpl(paths[0]).join(...paths)
}

export function resolve(...paths: string[]): string {
  return activeImpl(paths[0]).resolve(...paths)
}

export function relative(from: string, to: string): string {
  return activeImpl(from).relative(from, to)
}

export function dirname(p: string): string {
  return activeImpl(p).dirname(p)
}

export function basename(p: string, suffix?: string): string {
  return activeImpl(p).basename(p, suffix)
}

export function extname(p: string): string {
  return activeImpl(p).extname(p)
}

export function parse(p: string): ParsedPath {
  return activeImpl(p).parse(p)
}

export function format(pathObject: Partial<ParsedPath>): string {
  return activeImpl(pathObject.dir || pathObject.root).format(pathObject)
}

export function fileURLToPath(urlInput: string | URL): string {
  const url = typeof urlInput === 'string' ? new URL(urlInput) : urlInput
  if (url.protocol !== 'file:') {
    throw new TypeError('The URL must be of scheme file')
  }
  const pathname = decodeURIComponent(url.pathname)
  if (url.hostname && (defaultIsWindows || /^\/[A-Za-z]:/.test(pathname))) {
    return `\\\\${url.hostname}${pathname.replace(/\//g, '\\')}`
  }
  if (/^\/[A-Za-z]:/.test(pathname)) {
    return pathname.slice(1).replace(/\//g, '\\')
  }
  return defaultIsWindows ? pathname.replace(/\//g, '\\') : pathname
}

export function pathToFileURL(filePath: string): URL {
  const resolved = resolve(filePath)
  if (resolved.startsWith('\\\\')) {
    const parts = resolved.slice(2).split('\\')
    const host = parts.shift() || ''
    const rest = parts.map((segment) => encodeURIComponent(segment)).join('/')
    return new URL(`file://${host}/${rest}`)
  }
  const normalized = resolved.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  const encoded = normalized
    .split('/')
    .map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/')
  return new URL(`${prefix}${encoded}`)
}

const portablePath = {
  posix,
  win32,
  get sep() {
    return defaultIsWindows ? '\\' : '/'
  },
  get delimiter() {
    return defaultIsWindows ? ';' : ':'
  },
  normalize,
  isAbsolute,
  join,
  resolve,
  relative,
  dirname,
  basename,
  extname,
  parse,
  format,
  fileURLToPath,
  pathToFileURL
}

export default portablePath
