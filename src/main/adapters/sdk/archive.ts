import type { Buffer as PortableBuffer } from 'node:buffer'
export interface ArchiveTools {
  yauzl: {
    open(path: string, optionsOrCallback: any, callback?: any): void
    fromBuffer(buffer: Uint8Array, optionsOrCallback: any, callback?: any): void
    fromFd(fd: number, optionsOrCallback: any, callback?: any): void
    fromRandomAccessReader(reader: any, totalSize: number, options: any, callback: any): void
    [key: string]: any
  }
  extractZip(source: string, options: { dir: string; [key: string]: any }): Promise<void>
  crc32: {
    (buf: Uint8Array | string, partialCrc?: Uint8Array | number): PortableBuffer
    unsigned(buf: Uint8Array | string, partialCrc?: number): number
    signed(buf: Uint8Array | string, partialCrc?: number): number
  }
}
import { lazySdk, defaultSdk } from './load.ts'
const yauzl = lazySdk(() => defaultSdk('yauzl'))
const extractZip = lazySdk(() => defaultSdk('extract-zip'))
const crc32 = lazySdk(() => {
  const fn = defaultSdk('buffer-crc32')
  const bytes = (b: Uint8Array | string) =>
    typeof b === 'string' || Buffer.isBuffer(b)
      ? b
      : Buffer.from(b.buffer, b.byteOffset, b.byteLength)
  return Object.assign((b: Uint8Array | string, p?: Uint8Array | number) => fn(bytes(b), p), {
    unsigned: (b: Uint8Array | string, p?: number) => fn.unsigned(bytes(b), p),
    signed: (b: Uint8Array | string, p?: number) => fn.signed(bytes(b), p)
  })
})
export const coreArchive: ArchiveTools = {
  get yauzl() {
    return yauzl()
  },
  get extractZip() {
    return extractZip()
  },
  get crc32() {
    return crc32()
  }
}
