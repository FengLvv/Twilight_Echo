import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { STUDY_MELODY_ALGORITHM, STUDY_SCORE_LAYOUT, type StudyResult, type StudyStage, type StudyTrack } from '../../shared/musicStudy.ts'
import { VOCAL_MODEL_HASHES } from './studyModelRegistry.ts'

export const studySignature = (keys: string[], parent: string, fingerprints: Record<string, string>) =>
  createHash('sha256').update(JSON.stringify({ keys: keys.map(key => fingerprints[key] ?? key), parent })).digest('hex')

/** Artifact validity follows provenance, never the continued existence of its input WAV. */
export function createStudyCacheValidator() {
  const hashes = new Map<string, { version: string; hash: string }>()
  async function digest(path: string) {
    const info = await stat(path), version = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
    if (hashes.get(path)?.version === version) return hashes.get(path)!.hash
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) hash.update(chunk)
    const value = hash.digest('hex')
    if (hashes.size > 1000) hashes.clear()
    hashes.set(path, { version, hash: value })
    return value
  }
  return async (directory: string, fingerprints: Record<string, string>, source?: string,
    result?: StudyResult, verifyAudio = false): Promise<{ ready: StudyStage[]; sourceChanged?: boolean; notesReady?: boolean }> => {
    if (!result?.cache || !result.sourceSha256) return { ready: [] }
    const input = result.cache.input
    if (source && input) {
      try {
        const current = await stat(source)
        if ((input.path !== source || input.size !== current.size || input.mtimeMs !== current.mtimeMs) &&
            await digest(source) !== input.sha256) return { ready: [], sourceChanged: true }
      } catch { /* Reading committed results remains possible while the source is offline. */ }
    }
    const signature = (keys: string[], parent: string) => studySignature(keys, parent, fingerprints)
    const six = signature(['htdemucs6-reference-seeded-v1', 'torch/hub/checkpoints/5c90dfd2-34c22ccb.th'], result.sourceSha256)
    const ready: StudyStage[] = []
    async function audio(names: StudyTrack[]) {
      try {
        for (const name of names) {
          const expected = result!.cache!.files[name]
          const path = join(directory, name + '.wav'), info = await stat(path)
          if (!expected || expected.bytes !== info.size || verifyAudio && expected.sha256 !== await digest(path)) return false
        }
        return true
      } catch { return false }
    }
    const signatures = result.cache.signatures
    if (signatures.six === six && await audio(['original', 'drums', 'bass', 'other', 'vocals', 'guitar', 'piano'])) ready.push('six')
    if (signatures.leadBacking === signature(['UVR_MDXNET_KARA_2.onnx'], six) && await audio(['lead', 'backing'])) ready.push('leadBacking')
    if (signatures.twoSingers === signature(['duet.safetensors', 'speaker/embedding_model.ckpt'], six) && await audio(['singerA', 'singerB'])) ready.push('twoSingers')
    const chordKeys = ['sheetsage2-mert2-chord-full-paper-v1', 'sheetsage2/model.safetensors', 'mert2/model.safetensors']
    if (result.harmonicStems.length && signatures.chords === signature(chordKeys, six + '|' + result.harmonicStems.join('|'))) ready.push('chords')
    if (signatures.originalChords === signature(chordKeys, result.sourceSha256)) ready.push('originalChords')
    const notesReady = result.melody?.algorithm === STUDY_MELODY_ALGORITHM &&
        signatures.notes === signature([STUDY_MELODY_ALGORITHM, ...Object.keys(VOCAL_MODEL_HASHES).sort()], six + '|' + result.melody.lyricsKey)
    if (notesReady && result.cache.notesHash && signatures.score === STUDY_SCORE_LAYOUT + '|' + result.cache.notesHash)
      ready.push('melody')
    return { ready, notesReady }
  }
}
