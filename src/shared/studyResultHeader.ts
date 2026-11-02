import type { StudyResult } from './musicStudy.ts'

/** Small durable availability/provenance header; never retain score or note arrays. */
export function studyResultHeader(result: StudyResult): StudyResult {
  const { melody, ...header } = result
  return {
    ...header,
    waveforms: {},
    chords: { ...result.chords, segments: [] },
    originalChords: { segments: [] },
    ...(melody
      ? {
          melody: {
            ...melody,
            notes: [],
            scores: [],
            reuse: undefined,
            lyricFilter: melody.lyricFilter
              ? { ...melody.lyricFilter, excluded: [], classifier: undefined }
              : undefined
          }
        }
      : {})
  }
}
