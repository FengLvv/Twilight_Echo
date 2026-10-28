import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const FONT_REGISTRY_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
const USER_FONT_REGISTRY_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
const REGISTRY_TIMEOUT_MS = 15000
const MAX_FONTS = 8192

/**
 * The renderer cannot answer this itself: `queryLocalFonts()` needs a permission
 * grant and the session denies every permission by design
 * (`security/electronSecurity.ts`), so the family list comes from the registry
 * through main instead.
 *
 * This module deliberately imports no Electron surface so the parser stays
 * unit-testable under plain `node --test`.
 */

/**
 * Registry value names carry the technical suffix Windows shows in the Fonts
 * folder — "Arial Bold Italic (TrueType)". Strip the format tag and the trailing
 * style words so the list reads like a font menu rather than a file listing.
 */
const STYLE_SUFFIX =
  /\s+(?:thin|extra\s?light|ultra\s?light|light|regular|normal|medium|semi\s?bold|demi\s?bold|bold|extra\s?bold|ultra\s?bold|black|heavy|italic|oblique)+$/i

/**
 * Japanese OpenType fonts (Morisawa / Fontworks FOT-, A-OTF, etc.) register
 * per-weight GDI names like "FOT-TsukuMin Pro M" or "FOT-筑紫明朝 Pro M", while
 * Chromium/DirectWrite matches the typographic family name ("FOT-TsukuMin Pro")
 * plus CSS `font-weight`.
 */
const OPENTYPE_PRO_WEIGHT_SUFFIX =
  /\b(Pro|Std|Pr5|Pr6N?|StdN)\s+(?:UL|EL|L|R|M|DB|B|EB|H|U)$/i

let gbkReverseMap: Map<number, number> | null = null
let fatalShiftJisDecoder: TextDecoder | null = null

function getGbkReverseMap(): Map<number, number> {
  if (gbkReverseMap) return gbkReverseMap
  const map = new Map<number, number>()
  try {
    const decoder = new TextDecoder('gbk')
    const pair = new Uint8Array(2)
    for (let hi = 0x81; hi <= 0xfe; hi++) {
      for (let lo = 0x40; lo <= 0xfe; lo++) {
        if (lo === 0x7f) continue
        pair[0] = hi
        pair[1] = lo
        const ch = decoder.decode(pair)
        if (ch.length === 1 && ch.charCodeAt(0) !== 0xfffd) {
          map.set(ch.charCodeAt(0), (hi << 8) | lo)
        }
      }
    }
  } catch {
    // If ICU lacks GBK support in a minimal runtime, leave map empty.
  }
  gbkReverseMap = map
  return map
}

/**
 * Windows GDI sometimes decodes Shift-JIS `name` records using the active system
 * ANSI codepage (GBK/CP936 on Simplified Chinese Windows) when writing the Fonts
 * registry value name, turning "FOT-筑紫明朝 Pro M" into "FOT-拀巼柧挬 Pro M".
 * Shift-JIS Kanji/Kana lead bytes (0x81..0x9F) fall into GBK's rare GBK/3 zone
 * rather than standard GB2312 (0xB0..0xF7), allowing deterministic recovery.
 */
export function repairShiftJisGbkMojibake(input: string): string {
  let hasNonAscii = false
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) >= 0x80) {
      hasNonAscii = true
      break
    }
  }
  if (!hasNonAscii) return input

  const reverseMap = getGbkReverseMap()
  if (reverseMap.size === 0) return input

  const bytes: number[] = []
  let hasGbk3Lead = false
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
      continue
    }
    const packed = reverseMap.get(code)
    if (packed === undefined) return input
    const hi = packed >> 8
    const lo = packed & 0xff
    const validSjisLead = (hi >= 0x81 && hi <= 0x9f) || (hi >= 0xe0 && hi <= 0xef)
    const validSjisTrail = lo >= 0x40 && lo <= 0xfc && lo !== 0x7f
    if (!validSjisLead || !validSjisTrail) return input
    if (hi >= 0x81 && hi <= 0x9f) hasGbk3Lead = true
    bytes.push(hi, lo)
  }

  if (!hasGbk3Lead) return input
  try {
    fatalShiftJisDecoder ??= new TextDecoder('shift_jis', { fatal: true })
    return fatalShiftJisDecoder.decode(new Uint8Array(bytes))
  } catch {
    return input
  }
}

function isValidSjisPair(hi: number, lo: number): boolean {
  return (
    ((hi >= 0x81 && hi <= 0x9f) || (hi >= 0xe0 && hi <= 0xfc)) &&
    lo >= 0x40 &&
    lo <= 0xfc &&
    lo !== 0x7f
  )
}

function decodeOpenTypeNameString(
  buf: Buffer,
  platformId: number,
  encodingId: number,
  languageId: number
): string {
  if (platformId === 0 || platformId === 3) {
    // Legacy Windows Shift-JIS (encodingId 2) fonts sometimes store 16-bit words
    // as 0x00-padded ASCII plus raw 2-byte Shift-JIS pairs instead of UTF-16BE.
    if (platformId === 3 && encodingId === 2 && buf.length >= 2 && buf.length % 2 === 0) {
      let allPaddedSjis = true
      let hasSjisDoubleByte = false
      const unpadded: number[] = []
      for (let i = 0; i + 1 < buf.length; i += 2) {
        const hi = buf[i]!
        const lo = buf[i + 1]!
        if (hi === 0x00) {
          unpadded.push(lo)
        } else if (isValidSjisPair(hi, lo)) {
          hasSjisDoubleByte = true
          unpadded.push(hi, lo)
        } else {
          allPaddedSjis = false
          break
        }
      }
      if (allPaddedSjis && hasSjisDoubleByte) {
        try {
          fatalShiftJisDecoder ??= new TextDecoder('shift_jis', { fatal: true })
          return fatalShiftJisDecoder.decode(new Uint8Array(unpadded)).replace(/\0+/g, '').trim()
        } catch {
          // Fall through to UTF-16BE decoding.
        }
      }
    }

    const swapped = Buffer.allocUnsafe(buf.length - (buf.length % 2))
    for (let i = 0; i + 1 < swapped.length; i += 2) {
      swapped[i] = buf[i + 1]!
      swapped[i + 1] = buf[i]!
    }
    return swapped.toString('utf16le').replace(/\0+/g, '').trim()
  }

  if (platformId === 1) {
    let encoding: string | null = null
    if (encodingId === 1 || languageId === 11) encoding = 'shift_jis'
    else if (encodingId === 25 || languageId === 33) encoding = 'gb18030'
    else if (encodingId === 2 || languageId === 19) encoding = 'big5'
    else if (encodingId === 3 || languageId === 23) encoding = 'euc-kr'
    else if (encodingId === 0) return buf.toString('latin1').replace(/\0+/g, '').trim()
    if (encoding) {
      try {
        return new TextDecoder(encoding, { fatal: true }).decode(buf).replace(/\0+/g, '').trim()
      } catch {
        return ''
      }
    }
  }

  return ''
}

function readNameTableFromFont(fd: number, tableOffset: number): string[] {
  const header = Buffer.allocUnsafe(6)
  if (fs.readSync(fd, header, 0, 6, tableOffset) < 6) return []
  const count = header.readUInt16BE(2)
  const stringOffset = header.readUInt16BE(4)
  if (count === 0 || count > 2000) return []
  const recordsBuf = Buffer.allocUnsafe(count * 12)
  if (fs.readSync(fd, recordsBuf, 0, recordsBuf.length, tableOffset + 6) < recordsBuf.length) {
    return []
  }

  // Name ID 16 (Typographic Family) and Name ID 21 (WWS Family) are the exact
  // family names DirectWrite and Chromium match in CSS `font-family`. Fall back
  // to Name ID 1 (legacy 4-style Family) only when the face has no Name ID 16/21.
  const id16 = new Set<string>()
  const id21 = new Set<string>()
  const id1 = new Set<string>()

  for (let i = 0; i < count; i++) {
    const off = i * 12
    const platformId = recordsBuf.readUInt16BE(off)
    const encodingId = recordsBuf.readUInt16BE(off + 2)
    const languageId = recordsBuf.readUInt16BE(off + 4)
    const nameId = recordsBuf.readUInt16BE(off + 6)
    const length = recordsBuf.readUInt16BE(off + 8)
    const strOff = recordsBuf.readUInt16BE(off + 10)
    if (nameId !== 1 && nameId !== 16 && nameId !== 21) continue
    if (length === 0 || length > 512) continue

    const strBuf = Buffer.allocUnsafe(length)
    const absOff = tableOffset + stringOffset + strOff
    if (fs.readSync(fd, strBuf, 0, length, absOff) < length) continue
    const decoded = decodeOpenTypeNameString(strBuf, platformId, encodingId, languageId)
    if (!decoded || decoded.startsWith('@') || decoded.startsWith('.') || decoded.length > 96) {
      continue
    }
    if (decoded.includes('\ufffd')) continue
    if (nameId === 16) id16.add(decoded)
    else if (nameId === 21) id21.add(decoded)
    else if (nameId === 1) {
      const normalized = normalizeFamilyName(decoded)
      if (normalized) id1.add(normalized)
    }
  }

  if (id16.size > 0) return [...id16]
  if (id21.size > 0) return [...id21]
  return [...id1]
}

function readSfntFamilies(fd: number, sfntOffset: number): string[] {
  const header = Buffer.allocUnsafe(12)
  if (fs.readSync(fd, header, 0, 12, sfntOffset) < 12) return []
  const numTables = header.readUInt16BE(4)
  if (numTables === 0 || numTables > 200) return []
  const dirBuf = Buffer.allocUnsafe(numTables * 16)
  if (fs.readSync(fd, dirBuf, 0, dirBuf.length, sfntOffset + 12) < dirBuf.length) return []
  for (let i = 0; i < numTables; i++) {
    const off = i * 16
    const tag = dirBuf.toString('ascii', off, off + 4)
    if (tag === 'name') {
      const tableOffset = dirBuf.readUInt32BE(off + 8)
      return readNameTableFromFont(fd, tableOffset)
    }
  }
  return []
}

export function extractFontFamiliesFromFile(filePath: string): string[] {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const magicBuf = Buffer.allocUnsafe(12)
    if (fs.readSync(fd, magicBuf, 0, 12, 0) < 12) return []
    const tag = magicBuf.toString('ascii', 0, 4)
    if (tag === 'ttcf') {
      const numFonts = magicBuf.readUInt32BE(8)
      if (numFonts === 0 || numFonts > 128) return []
      const offsetsBuf = Buffer.allocUnsafe(numFonts * 4)
      if (fs.readSync(fd, offsetsBuf, 0, offsetsBuf.length, 12) < offsetsBuf.length) return []
      const all = new Set<string>()
      for (let i = 0; i < numFonts; i++) {
        const sfntOffset = offsetsBuf.readUInt32BE(i * 4)
        for (const name of readSfntFamilies(fd, sfntOffset)) all.add(name)
      }
      return [...all]
    }
    return readSfntFamilies(fd, 0)
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // Ignore close errors on read-only descriptor.
      }
    }
  }
}

function resolveWindowsFontFilePath(rawFile: string): string | null {
  const trimmed = rawFile.trim()
  if (!trimmed) return null
  if (path.isAbsolute(trimmed)) {
    return fs.existsSync(trimmed) ? trimmed : null
  }
  const winDir = process.env['WINDIR'] || 'C:\\Windows'
  const systemCandidate = path.join(winDir, 'Fonts', trimmed)
  if (fs.existsSync(systemCandidate)) return systemCandidate
  const localAppData = process.env['LOCALAPPDATA']
  if (localAppData) {
    const userCandidate = path.join(localAppData, 'Microsoft', 'Windows', 'Fonts', trimmed)
    if (fs.existsSync(userCandidate)) return userCandidate
  }
  return null
}

export interface ParseWindowsFontFamiliesOptions {
  resolveFileFamilies?: (rawFile: string) => string[]
}

export function parseWindowsFontFamilies(
  registryOutput: string,
  options?: ParseWindowsFontFamiliesOptions
): string[] {
  const families = new Set<string>()
  const fileCache = new Map<string, string[]>()
  const resolveFile = options?.resolveFileFamilies

  for (const rawLine of registryOutput.split(/\r?\n/)) {
    // `reg query /s` prints "    <name>    REG_SZ    <file>".
    const match = /^\s{2,}(.+?)\s{4,}REG_[A-Z_]+\s{4,}(.*)$/.exec(rawLine)
    if (!match) continue

    const rawFile = match[2]?.trim() ?? ''
    if (rawFile && resolveFile) {
      let fileFamilies = fileCache.get(rawFile)
      if (fileFamilies === undefined) {
        fileFamilies = resolveFile(rawFile)
        fileCache.set(rawFile, fileFamilies)
      }
      if (fileFamilies.length > 0) {
        for (const family of fileFamilies) {
          if (family) families.add(family)
        }
        continue
      }
    }

    // Drop the format tag: "(TrueType)", "(OpenType)", "(All res)".
    const name = match[1]
      .trim()
      .replace(/\s*\([^)]*\)\s*$/, '')
      .trim()
    if (!name) continue

    // A single entry can register several localized names: "宋体 & 新宋体".
    for (const candidate of name.split('&')) {
      const family = normalizeFamilyName(candidate)
      if (family) families.add(family)
    }
  }

  return [...families].sort((left, right) => left.localeCompare(right)).slice(0, MAX_FONTS)
}

function normalizeFamilyName(candidate: string): string | null {
  const trimmed = repairShiftJisGbkMojibake(candidate.trim())
  if (!trimmed) return null
  // Vertical-writing aliases duplicate a family that is already in the list.
  if (trimmed.startsWith('@')) return null
  if (trimmed.length > 96) return null

  // Repeat: "Arial Bold Italic" needs two passes to reach "Arial".
  let family = trimmed
  let previous: string
  do {
    previous = family
    family = family
      .replace(STYLE_SUFFIX, '')
      .replace(OPENTYPE_PRO_WEIGHT_SUFFIX, '$1')
      .trim()
  } while (family !== previous && family)

  // A font whose whole name is a style word ("Bold") must survive rather than
  // be stripped down to nothing.
  return family || trimmed
}

/** Share a query in flight; transient failures must not cache an empty catalog. */
export function createFontFamilyLoader(query: () => Promise<string[]>) {
  let cachedFonts: string[] | null = null
  let pending: Promise<string[]> | null = null
  let generation = 0
  return {
    list(): Promise<string[]> {
      if (cachedFonts) return Promise.resolve(cachedFonts)
      if (pending) return pending
      const queryGeneration = generation
      const task = Promise.resolve()
        .then(query)
        .then((fonts) => {
          if (queryGeneration === generation && fonts.length > 0) cachedFonts = fonts
          return fonts
        })
        .catch(() => [])
        .finally(() => {
          if (pending === task) pending = null
        })
      pending = task
      return task
    },
    clear(): void {
      generation++
      cachedFonts = null
      pending = null
    }
  }
}

async function queryInstalledFontFamilies(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  // Read both hives with one PowerShell startup; a missing per-user key is normal.
  const paths = [FONT_REGISTRY_KEY, USER_FONT_REGISTRY_KEY]
    .map((key) => "'Registry::" + key + "'")
    .join(',')
  const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); foreach ($path in @(${paths})) { $key = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue; if ($null -eq $key) { continue }; foreach ($name in $key.GetValueNames()) { '    ' + $name + '    REG_SZ    ' + $key.GetValue($name) } }`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      timeout: REGISTRY_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    }
  )
  return parseWindowsFontFamilies(stdout, {
    resolveFileFamilies(rawFile) {
      const resolved = resolveWindowsFontFilePath(rawFile)
      return resolved ? extractFontFamiliesFromFile(resolved) : []
    }
  })
}

const fontLoader = createFontFamilyLoader(queryInstalledFontFamilies)

export function listInstalledFontFamilies(): Promise<string[]> {
  return fontLoader.list()
}

/** Exposed for tests; installing a font mid-session is rare enough to ignore. */
export function clearInstalledFontCache(): void {
  fontLoader.clear()
}
