# Phrase score layout — 2026-10-31

Lyric scores now start on the first recognized vocal attack and stop at the last
release. Music21 represents the first measure as a pickup and the last as a
partial measure. Native LilyPond engraving preserves interior rests and ties;
the staff serializer retains the original bar phase without emitting leading
rests. Raw MIDI pitches, audio seconds, quantized durations and lyric identities
are unchanged. Player, desktop lyrics and native CLI exports share the score data.

Recognition and engraving are independent jobs/caches: `vocal-notes.json` holds
model results and timed lyrics; `vocal-score.json` holds the derived phrase layout
and a signature over the recognition file plus the layout algorithm. A failed or
missing layout can be rendered again without rerunning recognition. Child process
requests/results are temporary; atomic native caches remain authoritative.

The earlier combined melody/layout cache reader, proposed legacy relayout path,
implicit stage inference and old chord-checkpoint fallback were removed. No
runtime conversion or migration of old analysis is provided for this prerelease.

Verified:

- Full Qinghuaci: 68 native rows, 442 unchanged notes; every exported row starts
  and ends with a pitched note, and every native SVG maps back to the correct
  original note identities. Interior rest and cross-bar tie tests passed.
- New real 28-second voiced input: six-track separation, lyric-aligned melody
  recognition, chord recognition and engraving completed with 78 notes / 12 rows.
- Deleting only its score cache and requesting melody again regenerated the
  score while the recognition file bytes **and modification time** stayed unchanged.
  The playing selection and queue also stayed unchanged.
- Native numbered/staff PDF exports were rendered through Poppler and visually
  checked. Boundary padding is absent; true interior rests remain visible.
- 79 related TypeScript tests, 7 phrase/alignment Python tests, 6 worker/cache
  tests and 2 real resource/probe lifecycle checks passed, with no skips.
- Core/Node/Vue typechecks, renderer budgets and packaged dependency closure
  passed. All four packaged Python modules match the final source byte-for-byte.

The desktop shared projection was regression tested; no separate live desktop
window screenshot was taken during this change. Recognition accuracy was not
reevaluated against human pitch labels: this change concerns score construction
and cache boundaries.

Player: `dist/phrase-score/win-unpacked/TwilightEcho.exe`.
Machine-readable details: `docs/phrase-score-validation-20261031.json`.
