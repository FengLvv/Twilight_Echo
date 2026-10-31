# Twilight Echo CLI-Anything

Control the real Twilight Echo application from an agent or terminal. The harness
exposes all 387 registered Core operations across 52 domains, plus background
analysis, batch processing, native score exports and preview bundles.

Python is a client of the running application. Playback, provider credentials,
library state, audio processing, model inference and engraving stay in Twilight
Echo. The harness does not create another music database or analysis queue.

## Install and start

Requires Python 3.10+ and a **CLI-enabled build** of Twilight Echo. Older builds do
not expose the agent endpoint. Install from this repository:

```powershell
python -m pip install -e ./agent-harness
cli-anything-twilightecho --help
cli-anything-twilightecho --json app start --executable C:/Apps/TwilightEcho/TwilightEcho.exe
cli-anything-twilightecho --json doctor
```

`app start` uses a hidden application window by default. `--visible` starts a
normal player window. If an instance is already running in the selected profile,
the command connects to it. `app stop` requests normal save/quit; it never kills
the application to bypass persistence failures.

An existing headless instance keeps its launch mode. To use native pickers,
stop that instance normally, then run `app start --visible`.

Use root `--profile ABSOLUTE_DIRECTORY` or `TWILIGHT_ECHO_PROFILE` to select a
profile. The default is the normal TwilightEcho user-data directory. Set
`TWILIGHT_ECHO_EXE` to avoid repeating `--executable`. Model inference requires the
existing music-study environment: configure it in the app, or set
`TWILIGHT_MUSIC_STUDY_HOME` before launching a new profile. CPU/GPU support and
model licensing are unchanged.

On this workstation the installed command is:
`D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe`.
Its directory is in the user PATH; open a new terminal to inherit that change.

## Discover the whole application

```powershell
cli-anything-twilightecho --json capabilities --compact
cli-anything-twilightecho --json capabilities --domain playback
cli-anything-twilightecho --json describe queue.submit
cli-anything-twilightecho playback --help
cli-anything-twilightecho audio dsp edit --help
```

Core operation names map to nested kebab-case commands: `audio.dsp.edit` becomes
`audio dsp edit`, `study.transcribeMelody` becomes `study transcribe-melody`.
Primitive fields have named options; complex values accept JSON. Every leaf also
accepts `--payload JSON`, `--payload @file.json`, or `--payload -` for stdin.
For new backend operations use `call EXACT.OPERATION --payload ...` directly.

| Function | Command domains |
|---|---|
| Playback, queues, presentation | playback, player, queue, sleep, heart, personalized, automix, visualization |
| Audio output, DSP, analysis | audio, analysis, opra, study |
| Local and unified music data | library, catalog, albums, genres, tags, ratings, preferences, focus, exploration, liked, playlists, versions, bookmarks, scan, metadata, identification, imports |
| Online and connected sources | providers, ncm, search, streams, radio, podcasts, network, downloads, comments, cast, remote |
| Application and personal state | settings, themes, plugins, extensions, lyrics, statistics, workspace, cache, backup, migration, lifecycle, state |
| Agent workflows | app, music, preview, doctor, capabilities, describe, call |

Examples using real Core commands:

```powershell
cli-anything-twilightecho --json state snapshot
cli-anything-twilightecho --json playback volume --volume 0.3
cli-anything-twilightecho --json player lyrics
cli-anything-twilightecho --json audio dsp
cli-anything-twilightecho --json settings state
cli-anything-twilightecho --json catalog query --kind recording --limit 20
cli-anything-twilightecho --json providers list
cli-anything-twilightecho --json providers call --provider-id ncm --method searchSongs --args '["青花瓷",10,0]'
```

Provider calls require an enabled provider and its normal account/access rights.
Login, purchases and availability follow the app. Account mutations are real
actions; a successful CLI transport is not permission to publish or send content.

## Analyze, retrieve and export

```powershell
cli-anything-twilightecho --json music analyze --file D:/Music/song.flac --lyrics D:/Music/song.lrc --wait
cli-anything-twilightecho --json music analyze --ncm-id 186016 --stages six,chords,melody
cli-anything-twilightecho --json music wait --id PROJECT_ID
cli-anything-twilightecho --json music result --id PROJECT_ID --from 45 --to 75
cli-anything-twilightecho --json music artifacts --id PROJECT_ID
cli-anything-twilightecho --json music export --id PROJECT_ID --directory D:/Scores --notation staff
cli-anything-twilightecho --json music export --id PROJECT_ID --directory D:/Scores --notation numbered
cli-anything-twilightecho --json music export-stems --id PROJECT_ID --directory D:/Stems --audio-format flac
```

Sources are an explicit file, an NCM numeric ID, a catalog/local song ID, or
`--song-id current`. File analysis reads embedded tags and an adjacent `.lrc`
unless `--lyrics` is supplied. An ID-only NCM submission initially uses the ID as
its title; use `call agent.music.submit` with a provider `input` obtained from a
search result to retain known title/artist/duration metadata.

Default stages are `six,chords,melody`. `melody` requires timed original lyrics;
lyrics are not transcribed from speech. Additional accepted stages are
`originalChords`, `leadBacking`, `twoSingers`. Voice splitting remains opt-in and
reuses the existing vocal stem. For an existing project:

```powershell
cli-anything-twilightecho --json study split-vocals --id PROJECT_ID --kind leadBacking
cli-anything-twilightecho --json study split-vocals --id PROJECT_ID --kind twoSingers
```

Jobs persist in the app. A submitted job continues after the CLI exits. A wait
timeout does not cancel it; resume with `music wait`. Submission reuses validated
analysis cache and does not replace the playing song or queue. Explicit
`study.transport`, queue and playback commands control playback separately.

`music result` returns real chord labels, estimated key/Roman degrees, note MIDI
pitches, audio timestamps, quantized beats/durations, and aligned lyric/line IDs
where available. Time-window results clip chord ranges but preserve original note
boundaries; note statistics are computed from the selected interval. Model
outputs and inferred major/minor keys are estimates, not confirmed music theory
or vocal technique judgments. Instrument WAV paths are available through
`music artifacts`; audio can be exported through `music export-stems`.

Score exports use the same player components and native Electron printing:

- per-lyric-row SVG and the full PDF;
- `score.json` with raw timed notes and absolute artifact paths;
- `analysis.json` with key, chords, and melody data;
- original pitch-bearing MIDI/MusicXML under `source/` when available.

Each export creates a unique child directory. The neutral `.layout.musicxml`
engraving template is deliberately excluded. PDF embeds the rendered fonts;
standalone SVG text may use fallback fonts on a different machine. `--key auto`
uses shared chord/key inference; explicit keys use `0:major` through `11:minor`
(0=C), e.g. `--key 1:major` for Db major. Export does not modify recognized notes
or the player's display preferences.

## Batch

Create `songs.json`:

```json
[
  {"file":"song-a.flac","lyricsFile":"song-a.lrc"},
  {"ncmId":"186016","stages":["six","chords","melody"]},
  {"songId":"local-song-id","stages":["six","chords"]}
]
```

```powershell
cli-anything-twilightecho --json music batch D:/Music/songs.json --wait --export-directory D:/Scores --notation staff
```

Paths in a manifest resolve relative to its directory. Items are reported in
input order, including individual failures. Any failed item makes the exit code
nonzero; inspect `value.items` even when the process fails. `--export-directory`
waits and exports each successful score. Include `melody` for score export;
six/chords-only jobs have no vocal score to export.

## Preview producer and consumer

```powershell
cli-anything-twilightecho --json preview recipes
cli-anything-twilightecho --json preview capture --id PROJECT_ID --notation staff --directory D:/Previews
cli-anything-twilightecho --json preview latest --id PROJECT_ID --notation staff --directory D:/Previews
cli-hub previews inspect BUNDLE_DIRECTORY
```

`preview capture` publishes a CLI-Anything `preview-bundle/v1` containing real
native SVG/PDF artifacts. It caches by actual analysis, notation and tonality.
`preview latest` only inspects existing bundles. `cli-hub` is an optional separate
consumer, not bundled here. Live/poll sessions and diff are not implemented.

## Agent reliability and boundaries

Use root `--json` for `{ok,value}` / `{ok:false,error:{code,message}}` envelopes.
Read exit codes. Use `--timeout 150` for large score exports. Root `--dry-run`
shows planned calls without executing them. Running without subcommands enters
the CLI-Anything REPL; `exit` leaves the shell without closing the application.

Read schemas rather than guessing nested edit variants. Revision-bearing edits
must use fresh state from their domain. On `STALE_REVISION`, read again and
re-evaluate the intended change. Volume preferences are debounced; `lifecycle
flush` completes pending persistence before an unrelated settings transaction.
Commands are not blindly replayed after connection timeouts. Query current state
to determine whether an ambiguous operation completed.

Native picker operations are marked `interactive` by `describe`/`capabilities`.
In headless mode they return `INTERACTIVE_REQUIRED` instead of opening a hidden
dialog. Use an explicit-path agent action where available, or start a visible
app and complete the dialog. `agent.files.authorize` represents an explicit local
CLI file/directory selection and uses the app's native path grants. Legacy
backup/theme/DSP file pickers and account login may still need visible UI.
The CLI does not bypass revision checks, filesystem grants or provider access.

The endpoint listens only on 127.0.0.1, requires a random per-instance credential
from the selected profile and rejects browser-origin calls. Discovery tokens are
not included in `doctor` or command output. Keep profile files private to your OS
account. No separate LAN-control service is enabled.

## Development and verification

```powershell
node scripts/generate-agent-commands.cjs
node scripts/generate-agent-commands.cjs --check
python -m pytest agent-harness/cli_anything/twilightecho/tests/test_core.py -v
```

Real E2E tests also require `CLI_ANYTHING_FORCE_INSTALLED=1`, the installed command
on PATH, and `TWILIGHT_ECHO_TEST_PROFILE`, `TWILIGHT_ECHO_TEST_PROJECT`,
`TWILIGHT_ECHO_TEST_EXE`, `TWILIGHT_ECHO_TEST_MEDIA`. Run only against a prepared
isolated profile: tests change playback, settings and DSP and create real jobs.
See `tests/TEST.md` for recorded results and coverage limits.

CLI-Anything helper attribution/license: repository `HKUDS/CLI-Anything`, Apache-2.0,
included at `agent-harness/CLI-ANYTHING-LICENSE`. Twilight Echo retains its own
project and model licenses.
