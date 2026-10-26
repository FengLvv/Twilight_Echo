import assert from 'node:assert/strict'
import test from 'node:test'
import { observedTrackTags, type LocalLibraryTagObservations } from './localLibraryObservations.ts'

const observations: LocalLibraryTagObservations = {
  audioTags: { version: 1, scope: 'audio_file', title: { value: 'Whole file', origin: 'audio_tag' } },
  tracks: [{ id: 'new-file', identityTags: { version: 1, scope: 'audio_file',
    title: { value: 'Whole file', origin: 'audio_tag' } } }]
}

test('upgrade observations refresh raw tags but retain manual observations', () => {
  assert.equal(observedTrackTags({ id: 'old-file' }, observations)?.title?.value, 'Whole file')
  assert.equal(observedTrackTags({ id: 'old-file', identityTags: { version: 1, scope: 'audio_file',
    title: { value: 'Manual observation', origin: 'manual' } } }, observations)?.title?.value, 'Manual observation')
})

test('a whole-file observation never leaks into a logical CUE or ISO segment', () => {
  for (const track of [{ id: 'old-cue', cueRange: { startSeconds: 0 } },
    { id: 'old-cue', cueSheetPath: 'disc.cue', trackNumber: 1 },
    { id: 'old-iso', subTrack: 'sacd://stereo/1' }])
    assert.equal(observedTrackTags(track, observations), undefined)
})

test('CUE upgrade observations match the original sheet and ordinal, not an audio-file UUID', () => {
  const cue: LocalLibraryTagObservations = { ...observations, tracks: [{
    id: 'stable-cue', cueSheetPath: 'D:/music/disc.cue', trackNumber: 2,
    identityTags: { version: 1, scope: 'cue_track', title: { value: 'Second', origin: 'cue' } }
  }] }
  const old = { id: 'legacy-cue', cueSheetPath: 'D:\\music\\disc.cue', trackNumber: 2 }
  assert.equal(observedTrackTags(old, cue)?.title?.value, 'Second')
  assert.equal(observedTrackTags({ ...old, trackNumber: 1 }, cue), undefined)
  assert.equal(observedTrackTags({ ...old, cueSheetPath: 'other.cue' }, cue), undefined)
})
