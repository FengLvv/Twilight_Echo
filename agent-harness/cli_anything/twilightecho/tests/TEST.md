# Test plan — written before test implementation

## Inventory

- `test_core.py`: approximately 25 unit tests for discovery, argument conversion,
  JSON errors, schema-driven commands, dry-run, batch validation, polling and time
  slicing. Synthetic data; no fake claim of backend coverage.
- `test_full_e2e.py`: approximately 12 real application/subprocess tests. The real
  installed CLI and an isolated Twilight Echo profile are required. Missing
  application/backend dependencies fail rather than skip.
- TypeScript tests: transport authentication/lifecycle, registry/manifest coverage,
  source-independent analysis submission, batch stage policy and native score
  export contract.

## Unit scenarios

1. Resolve an explicit profile and standard platform profile; reject malformed,
   expired or non-local endpoint discovery without leaking credentials.
2. Parse primitive, enum, array and object command options; retain complex JSON
   payloads and report invalid input clearly.
3. Discover all registered operations and provide exact per-operation input help.
4. Dry-run returns the planned request without sending a mutation.
5. Produce machine-readable success/failure envelopes with nonzero failure exits.
6. Validate batch manifests, preserve item order and report partial failures.
7. Poll queued/running/completed/failed/cancelled jobs with bounded timeouts.
8. Extract requested analysis intervals, clipping overlapping chord/note intervals
   without changing the original stored data or claiming certainty.

## Real backend workflows

### Whole-application control

Invoke `_resolve_cli('cli-anything-twilightecho')` from arbitrary directories.
Inspect capabilities and schemas, read the real Core snapshot, catalog/provider
state, queue, lyrics, DSP, plugins and settings. Apply reversible volume, seek,
DSP or lyric/settings changes in the isolated profile and read them back. Verify
the registry and CLI command inventory match, rather than testing only help text.

### Analysis as an agent

Use explicit local/provider sources and queued stages without replacing the
current playback selection. Exercise cached whole-song results and at least one
fresh short real-media analysis. Poll actual jobs, read chords/vocal notes for a
time interval and verify timestamps, identities, readiness and artifact files.
Verify batch order and explicit failure reporting. Additional voice separation is
requested only when selected, never implicitly run for every song.

### Native score output

Export numbered and staff scores from real cached notes through the application's
native renderer. Parse SVG/XML, verify pitch/time identities and original lyric
text, check PDF signature and pages, and inspect representative rendered output.
Verify the analysis result file does not change when only exporting or changing
display notation/key. Print absolute artifact paths for manual inspection.

### Agent-only workflow

Complete discovery → choose source/job → submit/wait → retrieve a requested chord
and vocal interval → export scores using only installed CLI subprocesses. Use
JSON throughout. Do not use GUI automation as the CLI implementation or pretend
an unexecuted command passed.

## Results

Verified output and scope are recorded below.



## Verified run — 2026-10-31

Installed-command run: `CLI_ANYTHING_FORCE_INSTALLED=1 python -m pytest
agent-harness/cli_anything/twilightecho/tests -v --tb=no`.

Environment: Windows, Python 3.11.14, real packaged TwilightEcho 1.4.0-perview.1,
isolated `.local/agent-cli-qa`, RTX 5080 and existing study model pack. 31 unit
tests and 20 installed-command real-backend cases passed. Fresh 28-second vocal
analysis ran six-track separation, lyric-aligned transcription and chord
identification; its native score export passed. Full-song Qinghuaci exports
retain all 68 lyric rows and 442 notes. PDF first pages for both notations were
rendered with Poppler and visually inspected. Playback selection/queue persisted
across explicit-source batch/full analysis. Native WAV export was validated.

The related TypeScript regression run passed 84 tests with no skips: agent
transport, Core protocol, study/lyrics services and score mapping/spelling. Core,
Node and Vue typechecks passed. Renderer budgets and packaged dependency closure
passed. Manifest regeneration `--check` matched all 387 operations / 52 domains.

Coverage limits: every registered operation has a CLI route/schema; only the
listed representative domains were exercised against the running backend. No
real account comment/upload/publication, private-account login, every device,
all 387 mutations or native dialog acceptance was tested. Native picker commands
retain their visible-UI requirement; headless calls fail explicitly. Windows
runtime was tested; macOS/Linux packaging was not. Optional cli-hub consumer was
not installed/tested. Model output is estimated, not hand-labeled ground truth.

Additional E2E environment: `TWILIGHT_ECHO_TEST_VOCAL_MEDIA` is the prepared
28-second voiced WAV with adjacent timed LRC. Tests delete/recreate only that
explicit test source's project inside the isolated profile.

Full passing pytest output:

```text
============================= test session starts =============================
platform win32 -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0 -- D:\Tools\TwilightEchoToolchain\agent-cli\Scripts\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\vilolu\.codex\worktrees\music-study\twilight_echo\agent-harness
collecting ... collected 51 items

agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_requires_real_backend PASSED [  1%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_local_endpoint PASSED [  3%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_remote_or_ambiguous_urls[https://127.0.0.1:123/v1] PASSED [  5%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_remote_or_ambiguous_urls[http://example.com:123/v1] PASSED [  7%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_remote_or_ambiguous_urls[http://user@127.0.0.1:123/v1] PASSED [  9%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_remote_or_ambiguous_urls[http://127.0.0.1:123/v1?token=bad] PASSED [ 11%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_remote_or_ambiguous_urls[http://127.0.0.1:123/v2] PASSED [ 13%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_invalid_protocol_or_credential[changes0] PASSED [ 15%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_invalid_protocol_or_credential[changes1] PASSED [ 17%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_discovery_rejects_invalid_protocol_or_credential[changes2] PASSED [ 19%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_every_manifest_operation_has_a_command PASSED [ 21%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_dry_run_never_needs_backend[args0-playback.control-payload0] PASSED [ 23%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_dry_run_never_needs_backend[args1-study.state-payload1] PASSED [ 25%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_dry_run_never_needs_backend[args2-settings.state-payload2] PASSED [ 27%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_schema_types PASSED [ 29%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_stages_fail_before_sending[] PASSED [ 31%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_stages_fail_before_sending[six,six] PASSED [ 33%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_stages_fail_before_sending[made-up] PASSED [ 35%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_source_exactly_one PASSED [ 37%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_batch_partial_failure_preserves_order PASSED [ 39%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_batch_malformed_items_are_reported_not_crashed[item0] PASSED [ 41%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_batch_malformed_items_are_reported_not_crashed[item1] PASSED [ 43%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_batch_malformed_items_are_reported_not_crashed[item2] PASSED [ 45%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_interval_preserves_native_notes_and_clips_chords PASSED [ 47%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_interval_invalid_ranges[5-2] PASSED [ 49%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_interval_invalid_ranges[-1-2] PASSED [ 50%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_interval_invalid_ranges[0-nan] PASSED [ 52%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_wait_handles_real_job_states PASSED [ 54%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_wait_failure_is_not_success[failed] PASSED [ 56%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_wait_failure_is_not_success[cancelled] PASSED [ 58%]
agent-harness\cli_anything\twilightecho\tests\test_core.py::test_wait_failure_is_not_success[interrupted] PASSED [ 60%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_doctor_is_live_and_does_not_print_credentials PASSED [ 62%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_complete_live_registry_and_describe PASSED [ 64%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[state.snapshot] PASSED [ 66%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[settings.state] PASSED [ 68%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[audio.dsp] PASSED [ 70%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[plugins.list] PASSED [ 72%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[providers.list] PASSED [ 74%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[player.lyrics] PASSED [ 76%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[queue.page] PASSED [ 78%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_representative_domains[catalog.status] PASSED [ 80%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_volume_and_settings_round_trip PASSED [ 82%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_catalog_query_and_dsp_status PASSED [ 84%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_queue_playback_lyrics_and_dsp_round_trip PASSED [ 86%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_real_interval_and_native_artifacts PASSED [ 88%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_native_score_pdf_svg_and_note_identity[staff] PASSED [ 90%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_native_score_pdf_svg_and_note_identity[numbered] PASSED [ 92%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_real_preview_capture_and_latest PASSED [ 94%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_fresh_six_analysis_and_batch_do_not_change_playback PASSED [ 96%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_fresh_vocal_lyrics_chords_and_score_workflow PASSED [ 98%]
agent-harness\cli_anything\twilightecho\tests\test_full_e2e.py::TestCLISubprocess::test_json_errors_and_headless_picker_boundary PASSED [100%]

======================= 51 passed in 122.42s (0:02:02) ========================
```
