import { copyFile, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import {
  saveLyricsFromDialog as coreSaveLyricsFromDialog,
  writeLyricsAtomically as coreWriteLyricsAtomically,
  type LyricsFileOperations,
  type LyricsSaveDialogResult,
  type SavedLyricsFile
} from '../../core/lyrics/saveLyrics.ts'

export type { LyricsFileOperations, LyricsSaveDialogResult, SavedLyricsFile }

export const nodeLyricsFileOperations: LyricsFileOperations = {
  async exists(filePath) {
    try {
      await stat(filePath)
      return true
    } catch (error: unknown) {
      if ((error as { code?: string } | null)?.code === 'ENOENT') return false
      throw error
    }
  },
  copy: (source, destination) => copyFile(source, destination),
  async writeSynced(filePath, contents) {
    const handle = await open(filePath, 'w', 0o600)
    try {
      await writeFile(handle, contents, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  },
  replace: (source, destination) => rename(source, destination),
  remove: async (filePath) => await rm(filePath, { force: true })
}

export function saveLyricsFromDialog(
  result: LyricsSaveDialogResult,
  contents: string,
  operations: LyricsFileOperations = nodeLyricsFileOperations
): Promise<SavedLyricsFile | null> {
  return coreSaveLyricsFromDialog(result, contents, operations)
}

export function writeLyricsAtomically(
  filePath: string,
  contents: string,
  operations: LyricsFileOperations = nodeLyricsFileOperations
): Promise<SavedLyricsFile> {
  return coreWriteLyricsAtomically(filePath, contents, operations)
}
