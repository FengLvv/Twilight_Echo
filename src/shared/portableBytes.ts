export type PortableBufferEncoding =
  | 'utf8'
  | 'utf-8'
  | 'hex'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'ascii'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: false })

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = new Uint8Array(256)
BASE64_LOOKUP.fill(255)
for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
  BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(i)] = i
}
BASE64_LOOKUP['-'.charCodeAt(0)] = 62
BASE64_LOOKUP['_'.charCodeAt(0)] = 63

export function utf8ToBytes(input: string): Uint8Array {
  return textEncoder.encode(input)
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim()
  const len = Math.floor(clean.length / 2)
  const out = new Uint8Array(len)
  let written = 0
  for (let i = 0; i < len * 2; i += 2) {
    const byte = Number.parseInt(clean.slice(i, i + 2), 16)
    if (Number.isNaN(byte)) break
    out[written] = byte
    written += 1
  }
  return written === len ? out : out.subarray(0, written)
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = ''
  const chunkSize = 0x4000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    out += String.fromCharCode(...slice)
  }
  return out
}

export function bytesToAscii(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]! & 0x7f)
  }
  return out
}

export function latin1ToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i) & 0xff
  }
  return out
}

export function utf16leToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length * 2)
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i)
    out[i * 2] = code & 0xff
    out[i * 2 + 1] = (code >>> 8) & 0xff
  }
  return out
}

export function bytesToUtf16le(bytes: Uint8Array): string {
  let out = ''
  const end = bytes.length - (bytes.length % 2)
  for (let i = 0; i < end; i += 2) {
    out += String.fromCharCode(bytes[i]! | (bytes[i + 1]! << 8))
  }
  return out
}

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  let out = ''
  const len = bytes.length
  let i = 0
  while (i + 2 < len) {
    const triplet = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
    out +=
      BASE64_ALPHABET[(triplet >>> 18) & 0x3f]! +
      BASE64_ALPHABET[(triplet >>> 12) & 0x3f]! +
      BASE64_ALPHABET[(triplet >>> 6) & 0x3f]! +
      BASE64_ALPHABET[triplet & 0x3f]!
    i += 3
  }
  const remaining = len - i
  if (remaining === 1) {
    const octet = bytes[i]!
    out +=
      BASE64_ALPHABET[(octet >>> 2) & 0x3f]! +
      BASE64_ALPHABET[(octet & 0x03) << 4]! +
      (urlSafe ? '' : '==')
  } else if (remaining === 2) {
    const duo = (bytes[i]! << 8) | bytes[i + 1]!
    out +=
      BASE64_ALPHABET[(duo >>> 10) & 0x3f]! +
      BASE64_ALPHABET[(duo >>> 4) & 0x3f]! +
      BASE64_ALPHABET[(duo & 0x0f) << 2]! +
      (urlSafe ? '' : '=')
  }
  if (urlSafe) {
    return out.replace(/\+/g, '-').replace(/\//g, '_')
  }
  return out
}

export function base64ToBytes(input: string): Uint8Array {
  const sextets: number[] = []
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)
    if (code === 61 /* '=' */) break
    const val = code < 256 ? BASE64_LOOKUP[code]! : 255
    if (val !== 255) {
      sextets.push(val)
    }
  }
  const byteLength = Math.floor((sextets.length * 3) / 4)
  const out = new Uint8Array(byteLength)
  let outIndex = 0
  let i = 0
  while (i + 3 < sextets.length) {
    const chunk =
      (sextets[i]! << 18) | (sextets[i + 1]! << 12) | (sextets[i + 2]! << 6) | sextets[i + 3]!
    out[outIndex++] = (chunk >>> 16) & 0xff
    out[outIndex++] = (chunk >>> 8) & 0xff
    out[outIndex++] = chunk & 0xff
    i += 4
  }
  const rem = sextets.length - i
  if (rem === 2) {
    const chunk = (sextets[i]! << 12) | (sextets[i + 1]! << 6)
    out[outIndex++] = (chunk >>> 10) & 0xff
  } else if (rem === 3) {
    const chunk = (sextets[i]! << 18) | (sextets[i + 1]! << 12) | (sextets[i + 2]! << 6)
    out[outIndex++] = (chunk >>> 16) & 0xff
    out[outIndex++] = (chunk >>> 8) & 0xff
  }
  return outIndex === out.length ? out : out.subarray(0, outIndex)
}

function encodeString(input: string, encoding: PortableBufferEncoding = 'utf8'): Uint8Array {
  switch (encoding.toLowerCase()) {
    case 'utf8':
    case 'utf-8':
      return utf8ToBytes(input)
    case 'hex':
      return hexToBytes(input)
    case 'base64':
    case 'base64url':
      return base64ToBytes(input)
    case 'latin1':
    case 'binary':
    case 'ascii':
      return latin1ToBytes(input)
    case 'utf16le':
    case 'ucs2':
    case 'ucs-2':
      return utf16leToBytes(input)
    default:
      return utf8ToBytes(input)
  }
}

function decodeBytes(bytes: Uint8Array, encoding: PortableBufferEncoding = 'utf8'): string {
  switch (encoding.toLowerCase()) {
    case 'utf8':
    case 'utf-8':
      return bytesToUtf8(bytes)
    case 'hex':
      return bytesToHex(bytes)
    case 'base64':
      return bytesToBase64(bytes, false)
    case 'base64url':
      return bytesToBase64(bytes, true)
    case 'latin1':
    case 'binary':
      return bytesToLatin1(bytes)
    case 'ascii':
      return bytesToAscii(bytes)
    case 'utf16le':
    case 'ucs2':
    case 'ucs-2':
      return bytesToUtf16le(bytes)
    default:
      return bytesToUtf8(bytes)
  }
}

export class PortableBuffer extends Uint8Array {
  static override from(
    value:
      | string
      | ArrayBufferLike
      | ArrayBufferView
      | ArrayLike<number>
      | Iterable<number>
      | Uint8Array
      | ArrayLike<any>,
    encodingOrOffsetOrMapFn?: PortableBufferEncoding | number | ((v: any, k: number) => number),
    lengthOrThisArg?: any
  ): PortableBuffer {
    if (typeof encodingOrOffsetOrMapFn === 'function') {
      const arr = Uint8Array.from(value as ArrayLike<any>, encodingOrOffsetOrMapFn, lengthOrThisArg)
      return new PortableBuffer(arr.buffer as ArrayBuffer, arr.byteOffset, arr.byteLength)
    }
    const encodingOrOffset = encodingOrOffsetOrMapFn
    const length = typeof lengthOrThisArg === 'number' ? lengthOrThisArg : undefined
    if (typeof value === 'string') {
      const encoding =
        typeof encodingOrOffset === 'string' ? encodingOrOffset : ('utf8' as PortableBufferEncoding)
      const encoded = encodeString(value, encoding)
      return new PortableBuffer(encoded.buffer as ArrayBuffer, encoded.byteOffset, encoded.byteLength)
    }
    if (value instanceof PortableBuffer) {
      const copy = new PortableBuffer(value.byteLength)
      copy.set(value)
      return copy
    }
    if (ArrayBuffer.isView(value)) {
      const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      const copy = new PortableBuffer(view.byteLength)
      copy.set(view)
      return copy
    }
    if (value instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer)) {
      const byteOffset = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0
      const byteLength =
        typeof length === 'number' ? length : Math.max(0, value.byteLength - byteOffset)
      return new PortableBuffer(value as ArrayBuffer, byteOffset, byteLength)
    }
    const arr = Uint8Array.from(value as Iterable<number>)
    return new PortableBuffer(arr.buffer as ArrayBuffer, arr.byteOffset, arr.byteLength)
  }

  static wrap(view: Uint8Array): PortableBuffer {
    if (view instanceof PortableBuffer) return view
    return new PortableBuffer(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
  }

  static alloc(
    size: number,
    fill?: string | number | Uint8Array,
    encoding?: PortableBufferEncoding
  ): PortableBuffer {
    const buf = new PortableBuffer(size)
    if (fill !== undefined && size > 0) {
      if (typeof fill === 'number') {
        buf.fill(fill & 0xff)
      } else {
        const bytes = typeof fill === 'string' ? encodeString(fill, encoding) : fill
        if (bytes.length > 0) {
          for (let i = 0; i < size; i += 1) {
            buf[i] = bytes[i % bytes.length]!
          }
        }
      }
    }
    return buf
  }

  static allocUnsafe(size: number): PortableBuffer {
    return new PortableBuffer(size)
  }

  static concat(list: readonly Uint8Array[], totalLength?: number): PortableBuffer {
    const length =
      typeof totalLength === 'number'
        ? totalLength
        : list.reduce((sum, item) => sum + item.byteLength, 0)
    const out = new PortableBuffer(length)
    let offset = 0
    for (const item of list) {
      if (offset >= length) break
      const writable = Math.min(item.byteLength, length - offset)
      out.set(item.subarray(0, writable), offset)
      offset += writable
    }
    return out
  }

  static isBuffer(obj: unknown): obj is PortableBuffer | Uint8Array {
    return obj instanceof PortableBuffer || obj instanceof Uint8Array
  }

  static byteLength(
    input: string | ArrayBufferView | ArrayBufferLike,
    encoding: PortableBufferEncoding = 'utf8'
  ): number {
    if (typeof input === 'string') {
      return encodeString(input, encoding).byteLength
    }
    return input.byteLength
  }

  static compare(a: Uint8Array, b: Uint8Array): -1 | 0 | 1 {
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i += 1) {
      if (a[i]! !== b[i]!) {
        return a[i]! < b[i]! ? -1 : 1
      }
    }
    if (a.length === b.length) return 0
    return a.length < b.length ? -1 : 1
  }

  override toString(
    encoding: PortableBufferEncoding = 'utf8',
    start = 0,
    end = this.length
  ): string {
    const clampedStart = Math.max(0, Math.min(this.length, start))
    const clampedEnd = Math.max(clampedStart, Math.min(this.length, end))
    const slice = new Uint8Array(this.buffer, this.byteOffset + clampedStart, clampedEnd - clampedStart)
    return decodeBytes(slice, encoding)
  }

  override subarray(begin = 0, end = this.length): PortableBuffer {
    const sub = super.subarray(begin, end)
    return new PortableBuffer(sub.buffer as ArrayBuffer, sub.byteOffset, sub.byteLength)
  }

  override slice(start = 0, end = this.length): PortableBuffer {
    const sub = super.subarray(start, end)
    const copy = new PortableBuffer(sub.byteLength)
    copy.set(sub)
    return copy
  }

  override indexOf(
    value: string | number | Uint8Array,
    byteOffset = 0,
    encoding: PortableBufferEncoding = 'utf8'
  ): number {
    if (typeof value === 'number') {
      return super.indexOf(value & 0xff, byteOffset)
    }
    const needle = typeof value === 'string' ? encodeString(value, encoding) : value
    let start = byteOffset < 0 ? Math.max(0, this.length + byteOffset) : byteOffset
    if (needle.length === 0) {
      return Math.min(start, this.length)
    }
    if (needle.length > this.length - start) {
      return -1
    }
    const maxStart = this.length - needle.length
    outer: for (; start <= maxStart; start += 1) {
      for (let j = 0; j < needle.length; j += 1) {
        if (this[start + j] !== needle[j]) continue outer
      }
      return start
    }
    return -1
  }

  override includes(
    value: string | number | Uint8Array,
    byteOffset = 0,
    encoding: PortableBufferEncoding = 'utf8'
  ): boolean {
    return this.indexOf(value, byteOffset, encoding) !== -1
  }

  equals(other: Uint8Array): boolean {
    if (this.byteLength !== other.byteLength) return false
    for (let i = 0; i < this.byteLength; i += 1) {
      if (this[i] !== other[i]) return false
    }
    return true
  }

  compare(
    target: Uint8Array,
    targetStart = 0,
    targetEnd = target.length,
    sourceStart = 0,
    sourceEnd = this.length
  ): -1 | 0 | 1 {
    return PortableBuffer.compare(
      this.subarray(sourceStart, sourceEnd),
      target.subarray(targetStart, targetEnd)
    )
  }

  copy(
    target: Uint8Array,
    targetStart = 0,
    sourceStart = 0,
    sourceEnd = this.length
  ): number {
    const src = this.subarray(sourceStart, sourceEnd)
    const count = Math.max(0, Math.min(src.length, target.length - targetStart))
    if (count > 0) {
      target.set(src.subarray(0, count), targetStart)
    }
    return count
  }

  write(
    str: string,
    offsetOrEncoding?: number | PortableBufferEncoding,
    lengthOrEncoding?: number | PortableBufferEncoding,
    encoding?: PortableBufferEncoding
  ): number {
    let offset = 0
    let maxLength = this.length
    let enc: PortableBufferEncoding = 'utf8'

    if (typeof offsetOrEncoding === 'string') {
      enc = offsetOrEncoding
    } else if (typeof offsetOrEncoding === 'number') {
      offset = offsetOrEncoding
      maxLength = this.length - offset
      if (typeof lengthOrEncoding === 'string') {
        enc = lengthOrEncoding
      } else if (typeof lengthOrEncoding === 'number') {
        maxLength = Math.min(maxLength, lengthOrEncoding)
        if (encoding) enc = encoding
      }
    }

    const bytes = encodeString(str, enc)
    const writable = Math.max(0, Math.min(bytes.length, maxLength))
    if (writable > 0) {
      this.set(bytes.subarray(0, writable), offset)
    }
    return writable
  }

  private view(): DataView {
    return new DataView(this.buffer, this.byteOffset, this.byteLength)
  }

  readUInt8(offset = 0): number {
    return this.view().getUint8(offset)
  }

  readInt8(offset = 0): number {
    return this.view().getInt8(offset)
  }

  readUInt16LE(offset = 0): number {
    return this.view().getUint16(offset, true)
  }

  readUInt16BE(offset = 0): number {
    return this.view().getUint16(offset, false)
  }

  readInt16LE(offset = 0): number {
    return this.view().getInt16(offset, true)
  }

  readInt16BE(offset = 0): number {
    return this.view().getInt16(offset, false)
  }

  readUInt32LE(offset = 0): number {
    return this.view().getUint32(offset, true)
  }

  readUInt32BE(offset = 0): number {
    return this.view().getUint32(offset, false)
  }

  readInt32LE(offset = 0): number {
    return this.view().getInt32(offset, true)
  }

  readInt32BE(offset = 0): number {
    return this.view().getInt32(offset, false)
  }

  readBigUInt64LE(offset = 0): bigint {
    return this.view().getBigUint64(offset, true)
  }

  readBigUInt64BE(offset = 0): bigint {
    return this.view().getBigUint64(offset, false)
  }

  readFloatLE(offset = 0): number {
    return this.view().getFloat32(offset, true)
  }

  readFloatBE(offset = 0): number {
    return this.view().getFloat32(offset, false)
  }

  readDoubleLE(offset = 0): number {
    return this.view().getFloat64(offset, true)
  }

  readDoubleBE(offset = 0): number {
    return this.view().getFloat64(offset, false)
  }

  writeUInt8(value: number, offset = 0): number {
    this.view().setUint8(offset, value)
    return offset + 1
  }

  writeInt8(value: number, offset = 0): number {
    this.view().setInt8(offset, value)
    return offset + 1
  }

  writeUInt16LE(value: number, offset = 0): number {
    this.view().setUint16(offset, value, true)
    return offset + 2
  }

  writeUInt16BE(value: number, offset = 0): number {
    this.view().setUint16(offset, value, false)
    return offset + 2
  }

  writeInt16LE(value: number, offset = 0): number {
    this.view().setInt16(offset, value, true)
    return offset + 2
  }

  writeInt16BE(value: number, offset = 0): number {
    this.view().setInt16(offset, value, false)
    return offset + 2
  }

  writeUInt32LE(value: number, offset = 0): number {
    this.view().setUint32(offset, value, true)
    return offset + 4
  }

  writeUInt32BE(value: number, offset = 0): number {
    this.view().setUint32(offset, value, false)
    return offset + 4
  }

  writeInt32LE(value: number, offset = 0): number {
    this.view().setInt32(offset, value, true)
    return offset + 4
  }

  writeInt32BE(value: number, offset = 0): number {
    this.view().setInt32(offset, value, false)
    return offset + 4
  }

  writeBigUInt64LE(value: bigint, offset = 0): number {
    this.view().setBigUint64(offset, value, true)
    return offset + 8
  }

  writeBigUInt64BE(value: bigint, offset = 0): number {
    this.view().setBigUint64(offset, value, false)
    return offset + 8
  }

  toJSON(): { type: 'Buffer'; data: number[] } {
    return {
      type: 'Buffer',
      data: Array.from(this)
    }
  }
}
