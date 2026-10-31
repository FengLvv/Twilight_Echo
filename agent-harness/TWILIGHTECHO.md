# Twilight Echo Agent CLI

## Scope and backend

This harness follows HKUDS/CLI-Anything's Codex build workflow. Target: the complete
Twilight Echo Core API, with first-class asynchronous music analysis and native
score export. It calls the real running application; Python does not reimplement
playback, provider access, separation, transcription, or score engraving.

Core owns playback, queues, catalog/library, NCM/provider sessions, lyrics, DSP,
settings, themes, plugins, network sources, downloads, metadata, statistics and
durable analysis jobs. Renderer state is a projection. No second music database
or independent analysis scheduler is introduced.

## Transport and introspection

A local-only authenticated application endpoint publishes discovery metadata in
the current application profile. The token stays in that file and is never
printed by discovery commands. The API forwards registered Core operations through
the application-owned Core connection and its existing validators and revisions.
Browser-origin requests are rejected. No LAN remote-control setup is required.

The command manifest is generated from the actual Core protocol and TypeScript
input types. The Python CLI exposes every registered operation as a domain
subcommand, and supports raw calls for forward-compatible operation names.
`capabilities`, `describe`, `doctor` and JSON errors support agent self-correction.
Operations that require an existing native picker are identified explicitly;
headless alternatives accept paths where implemented instead of pretending a
picker completed.

## Music workflow

Analysis submission accepts explicit sources and stage lists without changing
the active playback selection. Jobs share existing cache validation, source
resolution, worker queue, cancel/retry and checkpoints. Timed lyrics can be
supplied explicitly or resolved through existing provider/local lyric services.
Multi-voice stages remain opt-in.

Agents can retrieve full or time-windowed chords and vocal notes, source/stem
artifact manifests, key/degree context, and pitch/rhythm statistics. These are
model estimates, not fabricated musicological conclusions. Score exports use the
same native Vue/abcjs/LilyPond-derived rendering as the player and include
machine-readable notes plus MIDI/MusicXML where available.

## CLI behavior

`cli-anything-twilightecho` provides one-shot Click commands and a default ReplSkin
REPL. All commands support JSON output; mutations support dry-run. Core owns
persistence, so the harness is a stateless service wrapper and does not create a
second session/project authority or claim undo support the backend lacks.
Batch submissions report each result and can be polled without leaving a terminal
process alive. Mutations are not automatically retried after ambiguous timeouts.

## Validation

The test plan precedes test code in `cli_anything/twilightecho/tests/TEST.md`.
Release tests must exercise the installed command with
`CLI_ANYTHING_FORCE_INSTALLED=1`, a real isolated-profile application, actual
analysis artifacts and native exported scores. No real account writes or public
publishing are part of validation. Existing user data and unrelated dirty work
must remain untouched.
