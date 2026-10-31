Music Study model adapters
=========================

Vocal numbered notation: Vocal2Midi f589c183ec9a4b25ea234459b8a4b72ba993af50,
https://github.com/Xiantaidu/Vocal2Midi (Apache-2.0). The bundled subset and
local source-word identity change are documented in vendor/vocal2midi/PROVENANCE.md.
TiFA 1.0 (https://github.com/openvpi/TIFA) and GAME medium 1.0.3
(https://github.com/openvpi/GAME): code MIT; model weights CC BY-NC-SA 4.0.
TiFA ONNX graphs are exported with the pinned upstream deployment code, not
loaded through remote code at runtime. Archives and inference files are SHA-256
verified. Inference consumes supplied original lyrics; no ASR is used.
Beat This! 1.1.0 (https://github.com/CPJKU/beat_this), MIT, supplies the acoustic
beat grid from the original mixture. Music21 (BSD) serializes musical events;
jianpu-ly 1.891 (Apache-2.0, https://github.com/ssb22/jianpu-ly) and the separately
installed GNU LilyPond 2.24.4 (GPL-3.0-or-later, https://lilypond.org) engrave
rhythm, rests, ties, beams and original-language lyrics. Open JTalk pronunciation
data is provisioned at installation, before offline analysis. These dependencies
and models live in a separate notation environment outside the app archive.

Duet sampler is derived from https://github.com/iamycy/duet-svs-diffusion
(MIT, Copyright (c) 2023 Yi Chin Yang). Its upstream LICENSE is distributed
alongside the model pack. Production inference uses self-conditioning, with no
ground-truth source selection. Singers are anonymous A/B, not identified people.

Demucs: https://github.com/facebookresearch/demucs (MIT).
MDX Karaoke 2: https://github.com/TRvlvr/model_repo and
https://github.com/Anjok07/ultimatevocalremovergui . Model metadata fixes
FFT=5120, frequency bins=2048, frames=256, compensation=1.065,
primary stem=Instrumental. Do not substitute metadata from other MDX models.

Models and Python/CUDA runtime are installed separately from the application.
Imported model packs provide fixed registered data, never executable adapter
scripts. Legacy Demucs / ECAPA serialized weights require the exact registered
SHA-256; arbitrary training pickles are not accepted.

Anonymous singer continuity: SpeechBrain ECAPA-TDNN,
https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb (Apache-2.0).
Only its fixed embedding weights are loaded, using Torch weights_only=True.
It compares voice timbres; it does not identify people or assign real names.

BTC large-vocabulary chord inference architecture:
https://github.com/jayg996/BTC-ISMIR19 (MIT; full notice in btc/LICENSE).
The vendored inference architecture replaces deprecated NumPy float aliases
and localizes imports. Training and MIDI code are excluded.

Lightweight comparison chord weights: ChordMini BTC continual-learning checkpoint,
https://github.com/ptnghia-j/ChordMini at aa6e3a8d7b017f082fd2aaff9329d5c26af49c03.
MIT, Copyright (c) 2026 ChordMini contributors (full notice in licenses/chordmini-MIT.txt).
Paper: https://arxiv.org/abs/2602.19778 . Only the checked model_state_dict is
converted to safetensors; optimizer/training state is not used by the app.
Its stored normalization statistics are used unchanged. The current selection
was measured against the original teacher and both published ChordMini models
on the same GuitarSet and IDMT audio; see docs/music-study-comparison-20261030.md.

Default high-accuracy chord analysis: SheetSage2 with MERT-v2-FullSong,
https://huggingface.co/m-a-p/SheetSage2 at b83c3d79a6d98bcffaf8f9ed112c90aa887887bc,
https://huggingface.co/m-a-p/MERT-v2-FullSong at d8ba1c745e733b3908ce6ad16ebeb17ac7600a42.
Code and model weights are CC-BY-NC-4.0 (noncommercial use only). The fixed
inference source, full license, upstream notices and source hashes are in
vendor/sheetsage2. Our only upstream source change loads the parent through
the bundled MERT2Model class, retaining its integrity checks; model folders
contain weights and configuration only. No trust_remote_code runs at inference.
Weights remain outside the application and are downloaded by the installer.
Paper: https://arxiv.org/abs/2610.05336 . Measured with paper preset and prompts
timestamp/downbeat_meter/chord_full, without training or benchmark tuning.
The model supplies greedy labels, not calibrated confidence or ranked
alternatives; these are shown as unrated rather than synthesized.
