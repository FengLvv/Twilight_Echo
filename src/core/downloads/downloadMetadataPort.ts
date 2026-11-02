import type { DownloadPreferences } from '../../shared/downloadPreferences.ts'
import type {
  ProviderDownloadQuality,
  ProviderDownloadTrackInput
} from '../../shared/providerDownloads.ts'
export type DownloadCover = {
  bytes: Uint8Array
  mime: string
}
export type FetchDownloadCover = (
  handle: string,
  signal: AbortSignal
) => Promise<DownloadCover | null>
export declare function detectedDownloadQuality(format: {
  lossless?: boolean
  sampleRate?: number
  bitsPerSample?: number
  codec?: string
}): ProviderDownloadQuality | null
export declare function downloadLyricFiles(raw: unknown): Array<{
  suffix: string
  text: string
}>
export declare function prepareDownloadedMetadata(options: {
  partPath: string
  targetPath: string
  track: ProviderDownloadTrackInput
  preferences: DownloadPreferences
  getLyrics: () => Promise<unknown>
  signal: AbortSignal
  fetchCover?: FetchDownloadCover
}): Promise<{
  actualQuality: ProviderDownloadQuality | null
  warning: string | null
  lyrics: Array<{
    suffix: string
    text: string
  }>
}>
export declare function saveDownloadedLyrics(
  targetPath: string,
  lyrics: Array<{
    suffix: string
    text: string
  }>
): Promise<string | null>
