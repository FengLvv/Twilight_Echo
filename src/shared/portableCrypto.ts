import {
  PortableBuffer,
  bytesToBase64,
  bytesToHex,
  type PortableBufferEncoding
} from './portableBytes.ts'

function fillRandomBytes(target: Uint8Array): Uint8Array {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const maxChunk = 65536
    for (let offset = 0; offset < target.byteLength; offset += maxChunk) {
      const slice = target.subarray(offset, Math.min(offset + maxChunk, target.byteLength))
      webCrypto.getRandomValues(slice)
    }
    return target
  }
  for (let i = 0; i < target.byteLength; i += 1) {
    target[i] = Math.floor(Math.random() * 256)
  }
  return target
}

export function randomBytes(size: number): PortableBuffer {
  const buf = PortableBuffer.alloc(size)
  fillRandomBytes(buf)
  return buf
}

export function randomUUID(): `${string}-${string}-${string}-${string}-${string}` {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }
  const bytes = randomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytesToHex(bytes)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function randomInt(minOrMax: number, maybeMax?: number): number {
  const min = maybeMax === undefined ? 0 : Math.ceil(minOrMax)
  const max = maybeMax === undefined ? Math.floor(minOrMax) : Math.floor(maybeMax)
  if (max <= min) {
    throw new RangeError('max must be greater than min')
  }
  const range = max - min
  const bytes = randomBytes(4)
  const uint32 =
    ((bytes[0]! << 24) >>> 0) + ((bytes[1]! << 16) >>> 0) + ((bytes[2]! << 8) >>> 0) + bytes[3]!
  return min + (uint32 % range)
}

export function timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) {
    throw new RangeError('Input buffers must have the same byte length')
  }
  const viewA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const viewB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  let diff = 0
  for (let i = 0; i < viewA.byteLength; i += 1) {
    diff |= viewA[i]! ^ viewB[i]!
  }
  return diff === 0
}

// --- Pure JS SHA-256 ---
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

function sha256Bytes(data: Uint8Array): PortableBuffer {
  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19

  const bitLenHi = Math.floor(data.length / 0x20000000)
  const bitLenLo = (data.length << 3) >>> 0
  const paddedLen = (data.length + 9 + 63) & ~63
  const padded = new Uint8Array(paddedLen)
  padded.set(data)
  padded[data.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(paddedLen - 8, bitLenHi, false)
  dv.setUint32(paddedLen - 4, bitLenLo, false)

  const w = new Uint32Array(64)
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = dv.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0

      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const out = PortableBuffer.alloc(32)
  out.writeUInt32BE(h0, 0)
  out.writeUInt32BE(h1, 4)
  out.writeUInt32BE(h2, 8)
  out.writeUInt32BE(h3, 12)
  out.writeUInt32BE(h4, 16)
  out.writeUInt32BE(h5, 20)
  out.writeUInt32BE(h6, 24)
  out.writeUInt32BE(h7, 28)
  return out
}

// --- Pure JS SHA-1 ---
function rotl(x: number, n: number): number {
  return (x << n) | (x >>> (32 - n))
}

function sha1Bytes(data: Uint8Array): PortableBuffer {
  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const bitLenHi = Math.floor(data.length / 0x20000000)
  const bitLenLo = (data.length << 3) >>> 0
  const paddedLen = (data.length + 9 + 63) & ~63
  const padded = new Uint8Array(paddedLen)
  padded.set(data)
  padded[data.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(paddedLen - 8, bitLenHi, false)
  dv.setUint32(paddedLen - 4, bitLenLo, false)

  const w = new Uint32Array(80)
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = dv.getUint32(offset + i * 4, false)
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1) >>> 0
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let i = 0; i < 80; i += 1) {
      let f = 0
      let k = 0
      if (i < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (i < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30) >>> 0
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const out = PortableBuffer.alloc(20)
  out.writeUInt32BE(h0, 0)
  out.writeUInt32BE(h1, 4)
  out.writeUInt32BE(h2, 8)
  out.writeUInt32BE(h3, 12)
  out.writeUInt32BE(h4, 16)
  return out
}

// --- Pure JS MD5 ---
const MD5_S = new Uint8Array([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
])

const MD5_K = new Uint32Array(64)
for (let i = 0; i < 64; i += 1) {
  MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
}

function md5Bytes(data: Uint8Array): PortableBuffer {
  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const bitLenLo = (data.length << 3) >>> 0
  const bitLenHi = Math.floor(data.length / 0x20000000)
  const paddedLen = (data.length + 9 + 63) & ~63
  const padded = new Uint8Array(paddedLen)
  padded.set(data)
  padded[data.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(paddedLen - 8, bitLenLo, true)
  dv.setUint32(paddedLen - 4, bitLenHi, true)

  const m = new Uint32Array(16)
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let j = 0; j < 16; j += 1) {
      m[j] = dv.getUint32(offset + j * 4, true)
    }

    let A = a0
    let B = b0
    let C = c0
    let D = d0

    for (let i = 0; i < 64; i += 1) {
      let F = 0
      let g = 0
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      const sum = (A + F + MD5_K[i]! + m[g]!) >>> 0
      A = D
      D = C
      C = B
      B = (B + rotl(sum, MD5_S[i]!)) >>> 0
    }

    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }

  const out = PortableBuffer.alloc(16)
  out.writeUInt32LE(a0, 0)
  out.writeUInt32LE(b0, 4)
  out.writeUInt32LE(c0, 8)
  out.writeUInt32LE(d0, 12)
  return out
}

export type PortableHashAlgorithm = 'sha256' | 'sha1' | 'md5'
export type PortableHashDigestEncoding = 'hex' | 'base64' | 'base64url'

export class PortableHash {
  private readonly algorithm: PortableHashAlgorithm
  private readonly chunks: Uint8Array[] = []

  constructor(algorithm: PortableHashAlgorithm) {
    this.algorithm = algorithm
  }

  update(data: string | ArrayBufferView | Uint8Array, inputEncoding?: PortableBufferEncoding): this {
    if (typeof data === 'string') {
      this.chunks.push(PortableBuffer.from(data, inputEncoding ?? 'utf8'))
    } else if (data instanceof Uint8Array) {
      const copy = new Uint8Array(data.byteLength)
      copy.set(data)
      this.chunks.push(copy)
    } else {
      const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      const copy = new Uint8Array(view.byteLength)
      copy.set(view)
      this.chunks.push(copy)
    }
    return this
  }

  digest(): PortableBuffer
  digest(encoding: PortableHashDigestEncoding): string
  digest(encoding?: PortableHashDigestEncoding): PortableBuffer | string {
    const merged = PortableBuffer.concat(this.chunks)
    let raw: PortableBuffer
    switch (this.algorithm) {
      case 'sha256':
        raw = sha256Bytes(merged)
        break
      case 'sha1':
        raw = sha1Bytes(merged)
        break
      case 'md5':
        raw = md5Bytes(merged)
        break
    }
    if (!encoding) return raw
    if (encoding === 'hex') return bytesToHex(raw)
    if (encoding === 'base64') return bytesToBase64(raw, false)
    if (encoding === 'base64url') return bytesToBase64(raw, true)
    return raw.toString(encoding)
  }
}

export function createHash(algorithm: PortableHashAlgorithm | string): PortableHash {
  const normalized = algorithm.toLowerCase().replace('-', '')
  if (normalized === 'sha256') return new PortableHash('sha256')
  if (normalized === 'sha1') return new PortableHash('sha1')
  if (normalized === 'md5') return new PortableHash('md5')
  throw new Error(`Unsupported portable hash algorithm: ${algorithm}`)
}
