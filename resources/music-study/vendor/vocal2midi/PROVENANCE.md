Vocal2Midi f589c183ec9a4b25ea234459b8a4b72ba993af50 (Apache-2.0).
Subset: TiFA alignment, GAME ONNX, quantization, and their helper imports. No ASR pipeline.
Local change: aligner.py retains source_text/source_word on aligned Word objects before Japanese mora expansion.
Local change: TiFA accepts the active language set and retains each word's source_language; mixed Chinese/Japanese and English lyrics use the corresponding phoneme vocabularies. GAME uses each word's vowel/syllable rules. Alignment failures retain their underlying cause instead of silently returning a pitch-only fallback.
Models: TiFA 1.0 and GAME medium 1.0.3, CC BY-NC-SA 4.0.
