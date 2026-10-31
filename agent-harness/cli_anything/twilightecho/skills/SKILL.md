---
name: cli-anything-twilightecho
description: Operate the real Twilight Echo player through CLI, including playback, NetEase Cloud Music, lyrics, DSP, settings, plugins, batch stem separation, chord analysis and timed vocal scores. Use when an agent needs to control the app or inspect and export song analysis.
---

# Twilight Echo Agent CLI

Use `cli-anything-twilightecho --json ...`. Core owns persistence, provider
credentials and model jobs. Python is a stateless client; no second project or
music database is needed. Requires a CLI-enabled TwilightEcho build and Python
3.10+. Install from source with `python -m pip install -e ./agent-harness`.
This package has not been published to PyPI.

On this workstation the command is
`D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe`.
Use the absolute path if the process has not inherited its new user PATH.

This workstation's verified CLI-enabled player build is
`C:/Users/vilolu/.codex/worktrees/music-study/twilight_echo/dist/phrase-score/win-unpacked/TwilightEcho.exe`.

## Connect and discover

```powershell
cli-anything-twilightecho --json doctor
cli-anything-twilightecho --json app start --executable C:/Apps/TwilightEcho/TwilightEcho.exe
cli-anything-twilightecho --json capabilities --compact
cli-anything-twilightecho --json describe audio.dsp.edit
```

Root `--profile ABSOLUTE_DIRECTORY` or `TWILIGHT_ECHO_PROFILE` selects user data;
otherwise the normal TwilightEcho profile is used. `TWILIGHT_ECHO_EXE` supplies
the executable. Start defaults to a hidden window; `--visible` allows native UI.
Configure models through the app or set `TWILIGHT_MUSIC_STUDY_HOME` before
starting a new profile. Provider calls use existing account and access rights.
An already running headless instance keeps its launch mode; stop it normally
before restarting with `--visible` when native dialogs are needed.

## Whole application

All registered Core operations have generated commands. Read live
`capabilities --domain DOMAIN` and `describe EXACT.OPERATION` before unfamiliar
calls. Names map to nested kebab-case: `study.splitVocals` becomes `study
split-vocals`. Primitive fields have options; complex values accept JSON.
Every leaf accepts `--payload JSON`, `--payload @file.json`, or `--payload -`.
Raw `call EXACT.OPERATION --payload ...` also supports new/custom operations.

| Area | Domains |
|---|---|
| Playback | playback, player, queue, sleep, heart, personalized, automix, visualization |
| Audio | audio, analysis, opra, study |
| Music data | library, catalog, albums, genres, tags, ratings, preferences, focus, exploration, liked, playlists, versions, bookmarks, scan, metadata, identification, imports |
| Services | providers, ncm, search, streams, radio, podcasts, network, downloads, comments, cast, remote |
| App state | settings, themes, plugins, extensions, lyrics, statistics, workspace, cache, backup, migration, lifecycle, state |

```powershell
cli-anything-twilightecho --json state snapshot
cli-anything-twilightecho --json playback volume --volume 0.3
cli-anything-twilightecho --json player lyrics
cli-anything-twilightecho --json audio dsp
cli-anything-twilightecho --json settings state
cli-anything-twilightecho --json catalog query --kind recording --limit 20
cli-anything-twilightecho --json providers call --provider-id ncm --method searchSongs --args '["青花瓷",10,0]'
```

Revision edits require fresh domain state. On `STALE_REVISION`, re-read and
re-evaluate the intended change. `lifecycle flush` commits debounced volume
persistence before an unrelated settings transaction. Do not blindly retry a
mutation after a timeout; query its actual outcome. Provider writes/publishing
are real user actions, subject to the user's requested scope.

## Analyze and retrieve scores

```powershell
cli-anything-twilightecho --json music analyze --file D:/Music/song.flac --lyrics D:/Music/song.lrc --wait
cli-anything-twilightecho --json music analyze --ncm-id 186016 --stages six,chords,melody
cli-anything-twilightecho --json music wait --id PROJECT_ID
cli-anything-twilightecho --json music result --id PROJECT_ID --from 45 --to 75
cli-anything-twilightecho --json music artifacts --id PROJECT_ID
cli-anything-twilightecho --json music export --id PROJECT_ID --directory D:/Scores --notation staff
cli-anything-twilightecho --json music export-stems --id PROJECT_ID --directory D:/Stems --audio-format flac
```

Choose one `--file`, `--ncm-id`, or `--song-id` (`current` is accepted). File input
reads tags and an adjacent `.lrc`; `--lyrics` overrides it. NCM ID-only submission
initially uses an ID title. To retain known metadata, use `agent.music.submit`
with a provider `input` from a real search result; inspect its schema first.

Defaults: `six,chords,melody`. Melody requires existing **timed original lyrics**;
no speech transcription is invented. Other stages: `originalChords`,
`leadBacking`, `twoSingers`. Additional voice splits remain explicit, reusing
the six-track vocal stem:

```powershell
cli-anything-twilightecho --json study split-vocals --id PROJECT_ID --kind leadBacking
cli-anything-twilightecho --json study split-vocals --id PROJECT_ID --kind twoSingers
```

Submissions do not change playback or queue. Jobs continue after the CLI exits;
wait timeout does not cancel them. Cancel explicitly with `study cancel --id`.
`music result` exposes model-estimated chords, inferred/manual key and Roman
degrees, MIDI pitch/audio seconds, quantized beats/durations and lyric/line IDs.
Time windows clip chord ranges while preserving original note boundaries.
Base explanations on returned evidence. Inferred keys and model pitches do not
prove complex modes, singing technique or a specific singer's identity.

`--notation staff|numbered` uses the same native score components as the player
and desktop lyrics. Each export creates SVG rows, full PDF, `score.json`,
`analysis.json`, and pitch-bearing source MIDI/MusicXML when available. Neutral
`.layout.musicxml` templates are excluded. PDF embeds fonts; standalone SVG can
use fallback fonts elsewhere. `--key auto` uses shared key inference; explicit
keys are `0:major` through `11:minor` (0=C), e.g. `1:major` for Db major.
Export leaves source notes and player display preferences unchanged.

## Batch

Write a JSON array, using paths relative to the manifest directory:

```json
[
  {"file":"song-a.flac","lyricsFile":"song-a.lrc"},
  {"ncmId":"186016","stages":["six","chords","melody"]}
]
```

```powershell
cli-anything-twilightecho --json music batch D:/Music/songs.json --wait --export-directory D:/Scores --notation staff
```

Every item appears in input order, including failures. Inspect `value.items`
even on nonzero exit. Score export requires melody results. Native artifact
manifests and durable cache stay in the app.

## Preview

```powershell
cli-anything-twilightecho --json preview recipes
cli-anything-twilightecho --json preview capture --id PROJECT_ID --notation staff --directory D:/Previews
cli-anything-twilightecho --json preview latest --id PROJECT_ID --notation staff --directory D:/Previews
cli-hub previews inspect BUNDLE_DIRECTORY
```

The producer publishes native SVG/PDF `preview-bundle/v1` artifacts cached by
real analysis/notation/key. Inspect returned absolute `_manifest_path`,
`_bundle_dir` and artifact paths. `cli-hub` is an optional separate consumer.
Live/poll and preview diff are not implemented.

## Output and native boundaries

JSON: `{ok:true,value:...}` or `{ok:false,error:{code,message}}`. Read exit codes
and partial batch results. Root `--dry-run` shows intended calls. Root
`--timeout 150` accommodates large exports. No arguments enters ReplSkin;
`exit` leaves the shell, while `app stop` requests normal save/quit.

Operations marked `interactive` use native pickers and return
`INTERACTIVE_REQUIRED` in headless mode. Use an explicit-path agent action
(discover with `capabilities --domain agent`) where available, or visible UI.
Legacy backup/theme/DSP pickers and login may still need visible interaction.
`agent.files.authorize` applies native path grants for explicit CLI selections.
Do not print endpoint tokens; `doctor` supplies safe status.
