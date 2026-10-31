import registry from '../../../resources/music-study/models.json' with { type: 'json' }
import vocal from '../../../resources/music-study/vocal_models.json' with { type: 'json' }
export const VOCAL_MODEL_HASHES: Record<string, string> = vocal.files
export const STUDY_MODEL_HASHES: Record<string, string> = { ...registry.files, ...vocal.files }
