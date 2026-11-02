export interface AudioMetadataTools {
  musicMetadata: {
    parseFile(filePath: string, options?: any): Promise<any>
    parseBuffer(buf: Uint8Array, fileInfo?: any, options?: any): Promise<any>
    parseStream(stream: any, fileInfo?: any, options?: any): Promise<any>
    parseFromTokenizer(tokenizer: any, options?: any): Promise<any>
    selectCover(pictures?: any[] | null): any
    orderTags(nativeTags: any): any
    ratingToStars(rating: any): number
    [key: string]: any
  }
  strtok3: {
    fromFile(filePath: string): Promise<any>
    fromBuffer(uint8Array: Uint8Array, fileInfo?: any): any
    fromStream(stream: any, fileInfo?: any): Promise<any>
    [key: string]: any
  }
  taglib: {
    File: {
      createFromPath(path: string): {
        tag: {
          title?: string
          performers?: string[]
          album?: string
          albumArtists?: string[]
          track?: number
          disc?: number
          year?: number
          genres?: string[]
          lyrics?: string
          pictures: unknown[]
          [key: string]: any
        }
        save(): void
        dispose(): void
        [key: string]: any
      }
      createFromAbstraction(abstraction: any): any
      [key: string]: any
    }
    ByteVector: any
    Picture: any
    PictureType: any
    Id3v2Tag: any
    Id3v2Settings: any
    TagTypes: any
    [key: string]: any
  }
}
import { lazySdk, requireSdk, defaultSdk } from './load.ts'
const metadata = lazySdk(() => requireSdk('music-metadata')),
  tokenizer = lazySdk(() => requireSdk('strtok3')),
  tags = lazySdk(() => defaultSdk('node-taglib-sharp'))
export const coreAudioMetadata: AudioMetadataTools = {
  get musicMetadata() {
    return metadata()
  },
  get strtok3() {
    return tokenizer()
  },
  get taglib() {
    return tags()
  }
}
