import { coreAudioMetadata } from '../ports/index.ts'

// eslint-disable-next-line @typescript-eslint/no-namespace -- Preserve the Taglib.File/Tag type API without importing the Node module.
export declare namespace Taglib {
  interface Tag {
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
  interface File {
    tag: Tag
    save(): void
    dispose(): void
    [key: string]: any
  }
}

/** node-taglib-sharp costs ~100 ms to load; only tag writes and downloads need it. */
export function loadTaglib(): typeof coreAudioMetadata.taglib {
  return coreAudioMetadata.taglib
}
