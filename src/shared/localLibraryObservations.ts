import { normalizeTrackIdentityTags, type TrackIdentityTags } from './trackIdentification.ts'

/** A new file read may refresh observations, never the user's displayed metadata. */
export interface LocalLibraryTagObservations {
  audioTags: TrackIdentityTags
  tracks: Array<{
    id: string
    cueSheetPath?: string
    trackNumber?: number
    subTrack?: string
    identityTags: TrackIdentityTags
  }>
}

export function observedTrackTags(
  track: Record<string, unknown>,
  observations: LocalLibraryTagObservations | undefined
): TrackIdentityTags | undefined {
  if (!observations) return undefined
  const path = (v: unknown) => String(v ?? '').replaceAll('\\', '/').toLowerCase()
  const cue = !!track.cueRange || !!track.cueSheetPath
  const row = observations.tracks.find((row) =>
    (row.identityTags.scope === 'cue_track') === cue && (row.id === track.id ||
    (track.subTrack !== undefined ? row.subTrack === track.subTrack :
      track.cueSheetPath ? path(row.cueSheetPath) === path(track.cueSheetPath) &&
        row.trackNumber === track.trackNumber : !cue && !row.cueSheetPath && row.subTrack === undefined)))
  const tags = normalizeTrackIdentityTags(row?.identityTags)
  if (!tags) return undefined
  // An explicit manual observation remains authoritative after an upgrade read.
  const old = normalizeTrackIdentityTags(track.identityTags)
  for (const [key, value] of Object.entries(old ?? {}))
    if (value && typeof value === 'object' && 'origin' in value && value.origin === 'manual')
      Object.assign(tags, { [key]: value })
  return tags
}
