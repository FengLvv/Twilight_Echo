import { decodeLyrics } from '../../shared/lyricsEncoding.ts'
import { importLyricsFromDialog } from './importLyrics.ts'
import { saveLyricsFromDialog, type LyricsFileOperations } from './saveLyrics.ts'

export interface LyricDraftIoPort {
  readFile(path: string): Promise<Uint8Array>
  statSize(path: string): Promise<number>
}

export async function importLyricDraft(
  choose: () => Promise<string | null>,
  io: LyricDraftIoPort,
  signal?: AbortSignal
): Promise<string | null> {
  const file = await choose()
  signal?.throwIfAborted()
  return importLyricsFromDialog(
    { canceled: file == null, filePaths: file ? [file] : [] },
    async (path) => decodeLyrics(await io.readFile(path)).text,
    async (path) => await io.statSize(path)
  )
}
export async function exportLyricDraft(
  choose: () => Promise<string | null>,
  contents: string,
  operations: LyricsFileOperations,
  signal?: AbortSignal
): Promise<string | null> {
  const file = await choose()
  signal?.throwIfAborted()
  const saved = await saveLyricsFromDialog(
    { canceled: file == null, filePath: file ?? '' },
    contents,
    operations
  )
  return saved?.filePath ?? null
}
