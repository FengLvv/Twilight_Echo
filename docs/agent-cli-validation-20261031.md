# Twilight Echo Agent CLI validation — 2026-10-31

The application exposes all **387 registered Core operations across 52 domains**
through an authenticated loopback endpoint and generated Click commands. Native
analysis, batch submission, interval context, audio export, SVG/PDF score export
and preview bundles have additional agent-oriented commands.

Delivered player: `dist/agent-cli/win-unpacked/TwilightEcho.exe`.
SHA-256: `44d3ea4cc3237d8a8323c4c9db61d73943f991799b5288c391da9143c175f776`.

Local installed CLI:
`D:/Tools/TwilightEchoToolchain/agent-cli/Scripts/cli-anything-twilightecho.exe`.
Its directory was added to user PATH without replacing existing entries.
The generated skill is also installed at
`C:/Users/vilolu/.codex/skills/cli-anything-twilightecho/SKILL.md`.

## Verified

- 51 Python tests passed: 31 unit cases and 20 installed-command real-backend
  cases, using `CLI_ANYTHING_FORCE_INSTALLED=1` from arbitrary working directories.
- 84 related TypeScript regressions passed with no skips: transport, Core
  protocol, background study/lyrics, shared score mapping and staff spelling.
- Core, Node and Vue typechecks passed; renderer budgets and packaged dependency
  closure passed; manifest `--check` matched the actual registry.
- Real playback queue selection, volume, settings and DSP changes were read back.
  Catalog, plugin/provider and lyric state were read from the running Core.
- Fresh six-track audio separation and native WAV export passed. A fresh voiced
  28-second clip completed six-track separation, timed-lyric melody transcription,
  chord identification, interval retrieval and native score export. Extra singer
  splits remained opt-in. Explicit-source analysis preserved playback/queue.
- Whole-song Qinghuaci exports retain 68 rows and 442 notes in both numbered and
  staff notation. Actual SVG/XML, PDF signatures, raw note identity and source
  MIDI/MusicXML were checked. Poppler-rendered first pages were visually reviewed.
- Native preview capture/latest produced `preview-bundle/v1` artifacts.
- The distributable wheel plus dependencies was installed **offline into a new
  isolated venv**, and that non-editable installation retrieved a real 45–52 second
  chord/vocal interval successfully. The Windows installation script was executed
  with `-NoPath` for that test. Generated skill validation passed.

Full passing Python output is in
`agent-harness/cli_anything/twilightecho/tests/TEST.md`.
Machine-readable scope is in `docs/agent-cli-validation-20261031.json`.

## Limits

All registered operations have routes and schemas; representative domains were
runtime tested. This does not claim every mutation, private account write, device
or native dialog was exercised. Native picker operations require visible UI and
fail explicitly in headless mode. The existing file pickers for backup/theme/DSP
and login remain native. Stem/score exports support explicit paths.

Windows x64 was tested. macOS/Linux packaging and the optional cli-hub consumer
were not tested. Harmonic/vocal results are model estimates, not a ground-truth
musicological evaluation. No real account comments/uploads/publication, source
commit, remote push or public package publishing was performed.

CLI-Anything's official Codex skill/methodology was used from
`.local/cli-anything-source`; the harness helper license is included in the wheel
and delivery directory. User-facing player UI was not expanded for CLI controls.
