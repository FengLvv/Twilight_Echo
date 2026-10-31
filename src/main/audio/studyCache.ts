import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { studyReady, type StudyResult, type StudyStage } from '../../shared/musicStudy.ts'
import { VOCAL_MODEL_HASHES } from './studyModelRegistry.ts'

export function createStudyCacheValidator() {
  const hashes = new Map<string, { version: string; hash: string }>()
  async function digest(path: string) {
    const info = await stat(path),
      version = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
    const previous = hashes.get(path)
    if (previous?.version === version) return previous.hash
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    const value = hash.digest('hex')
    if (hashes.size > 1000) hashes.clear()
    hashes.set(path, { version, hash: value })
    return value
  }
  return async (
    directory: string,
    fingerprints: Record<string, string>,
    source?: string
  ): Promise<{ ready: StudyStage[]; sourceChanged?: boolean }> => {
    if (source) {
      try {
        const current = await stat(source)
        let previous: { path: string; size: number; mtimeMs: number } | undefined
        try {
          previous = JSON.parse(await readFile(join(directory, 'source-info.json'), 'utf8'))
        } catch {}
        if (previous) {
          if (
            previous.path !== source ||
            previous.size !== current.size ||
            previous.mtimeMs !== current.mtimeMs
          )
            return { ready: [], sourceChanged: true }
        } else {
          const captured = (await readdir(directory)).find((name) =>
            /^source\.[a-z0-9]+$/i.test(name)
          )
          if (captured && (await digest(source)) !== (await digest(join(directory, captured))))
            return { ready: [], sourceChanged: true }
        }
      } catch {
        /* A complete captured source remains usable after the original is moved. */
      }
    }
    try {
      const result = JSON.parse(
        await readFile(join(directory, 'result.json'), 'utf8')
      ) as StudyResult
      const stages = JSON.parse(await readFile(join(directory, 'stages.json'), 'utf8'))
      const original = await digest(join(directory, 'original.wav'))
      if (original !== result.sourceSha256) return { ready: [] }
      const signature = (keys: string[], parent: string) =>
        keys.map((key) => fingerprints[key] ?? key).join('|') + '|' + parent
      async function valid(stage: string, names: string[], keys: string[], parent: string) {
        const checkpoint = stages[stage]
        if (checkpoint?.signature !== signature(keys, parent)) return false
        try {
          for (const name of names)
            if (checkpoint.files?.[name] !== (await digest(join(directory, name + '.wav'))))
              return false
          return true
        } catch {
          return false
        }
      }
      if (
        !(await valid(
          'six',
          ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
          ['torch/hub/checkpoints/5c90dfd2-34c22ccb.th'],
          original
        ))
      )
        return { ready: [] }
      const ready: StudyStage[] = ['six'],
        vocals = await digest(join(directory, 'vocals.wav'))
      if (await valid('leadBacking', ['lead', 'backing'], ['UVR_MDXNET_KARA_2.onnx'], vocals))
        ready.push('leadBacking')
      if (
        await valid(
          'twoSingers',
          ['singerA', 'singerB'],
          ['duet.safetensors', 'speaker/embedding_model.ckpt'],
          vocals
        )
      )
        ready.push('twoSingers')
      const chordKeys = ['sheetsage2/model.safetensors', 'mert2/model.safetensors']
      if (studyReady(result, 'melody')) {
        try {
          const notesPath = join(directory, 'vocal-notes.json')
          const cache = JSON.parse(await readFile(notesPath, 'utf8'))
          const score = JSON.parse(await readFile(join(directory, 'vocal-score.json'), 'utf8'))
          if (
            cache.signature ===
            signature(['vocal2midi-tifa-game-medium-rhythm-v1', ...Object.keys(VOCAL_MODEL_HASHES).sort()],
              vocals + '|' + createHash('sha256').update(cache.lyrics ?? '').digest('hex')) &&
            score.signature === 'lyric-phrase-v1|' + await digest(notesPath)
          )
            ready.push('melody')
        } catch {
          /* A missing or invalid melody checkpoint is recomputed on demand. */
        }
      }
      for (const stage of ['chords', 'originalChords'] as const) {
        if (!studyReady(result, stage)) continue
        const names = stage === 'chords' ? result.harmonicStems : ['original']
        if (
          !names.length ||
          names.some((name) => !/^(original|bass|piano|guitar|other|vocals|drums)$/.test(name))
        )
          continue
        const parent = (
          await Promise.all(
            names.map(async (name) => name + ':' + (await digest(join(directory, name + '.wav'))))
          )
        ).join('|')
        try {
          const cache = JSON.parse(await readFile(join(directory, stage + '.json'), 'utf8'))
          if (cache.signature === signature(chordKeys, parent)) ready.push(stage)
        } catch { /* Missing stage checkpoints are never accepted as valid cache. */ }
      }
      return { ready }
    } catch {
      return { ready: [] }
    }
  }
}
