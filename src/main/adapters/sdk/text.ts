import type { Buffer as PortableBuffer } from 'node:buffer'
export interface TextTools {
  DOMParser: new (options?: any) => any
  iconv: {
    decode(buf: Uint8Array, encoding: string, options?: any): string
    encode(str: string, encoding: string, options?: any): PortableBuffer
    encodingExists(encoding: string): boolean
    [key: string]: any
  }
  opencc: {
    Converter(options: { from: string; to: string }): (text: string) => string
    [key: string]: any
  }
}
import { lazySdk, requireSdk, defaultSdk } from './load.ts'
const xml = lazySdk(() => requireSdk('@xmldom/xmldom').DOMParser),
  iconv = lazySdk(() => defaultSdk('iconv-lite')),
  opencc = lazySdk(() => defaultSdk('opencc-js'))
export const coreText: TextTools = {
  get DOMParser() {
    return xml()
  },
  get iconv() {
    return iconv()
  },
  get opencc() {
    return opencc()
  }
}
