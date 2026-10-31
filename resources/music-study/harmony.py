"""Local chord recognition from harmonic pitch-class and bass evidence.

No transcription, MIDI, lyrics or network service is used. Scores are ranking
scores, not calibrated probabilities. Human edits belong to the Core project.
"""
from __future__ import annotations

import math
from pathlib import Path

import librosa
import numpy as np
from scipy.ndimage import median_filter, uniform_filter

ROOTS = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
QUALITIES = {
    "": (0, 4, 7), "m": (0, 3, 7), "dim": (0, 3, 6), "aug": (0, 4, 8),
    "sus2": (0, 2, 7), "sus4": (0, 5, 7), "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11), "m7": (0, 3, 7, 10),
    "dim7": (0, 3, 6, 9), "m7b5": (0, 3, 6, 10),
}


def _features(audio: np.ndarray, sr: int, hop: int):
    harmonic = librosa.effects.harmonic(audio, margin=3.0)
    tuning = float(librosa.estimate_tuning(y=harmonic, sr=sr))
    # A semitone grid retains bass register evidence; whitening controls the
    # dominance of instrument formants without interpreting every overtone as
    # another independently played note.
    cqt = np.abs(librosa.cqt(harmonic, sr=sr, hop_length=hop,
        fmin=librosa.note_to_hz("C1"), n_bins=252, bins_per_octave=36, tuning=tuning * 3))[::3]
    floor = np.maximum(cqt.max(axis=0, keepdims=True) * .015, 1e-7)
    cqt = np.maximum(cqt - floor, 0)
    scale = np.maximum(uniform_filter(cqt, size=(12, 1)),
        np.maximum(cqt.max(axis=0, keepdims=True) * .15, 1e-7))
    whitened = np.sqrt(cqt) / np.power(scale, .25)
    # Suppress octaves' fifth/third overtones before folding to pitch classes.
    salience = whitened.copy()
    for interval, attenuation in ((19, .35), (28, .15)):
        salience[interval:] -= attenuation * whitened[:-interval]
    salience = np.maximum(salience, 0)
    chroma = np.zeros((12, salience.shape[1]), dtype=np.float32)
    bass = np.zeros_like(chroma)
    for note in range(84):
        chroma[note % 12] += salience[note] * (1.0 if note < 60 else .35)
        if note < 30:
            bass[note % 12] += np.sqrt(cqt[note]) * math.exp(-note / 22)
    chroma = median_filter(chroma, size=(1, 5), mode="nearest")
    bass = median_filter(bass, size=(1, 5), mode="nearest")
    return chroma, bass, tuning


def recognize(audio: np.ndarray, sample_rate: int, *, progress=None, model_pack=None) -> dict:
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if not len(audio) or sample_rate <= 0 or not np.isfinite(audio).all():
        raise ValueError("无有效音频可供分析")
    duration = len(audio) / sample_rate
    sr, hop = 22050, 1024
    y = librosa.resample(audio.astype(np.float32), orig_sr=sample_rate, target_sr=sr)
    if len(y) < 8192:
        y = np.pad(y, (0, 8192 - len(y)))
    chroma, bass, tuning = _features(y, sr, hop)
    if progress:
        progress(.60, "已提取和声与低音特征")
    # Ordinary chord dictionary: each state has an explicit musical definition.
    states, templates = [], []
    for root in range(12):
        for quality, intervals in QUALITIES.items():
            template = np.zeros(12)
            template[(root + np.asarray(intervals)) % 12] = 1
            states.append((root, quality, intervals))
            templates.append(template)
    templates = np.asarray(templates)
    # Compress duplicated roots/octaves so a softly played seventh is retained.
    compressed = chroma ** .4
    normalized = compressed / np.maximum(np.linalg.norm(compressed, axis=0), 1e-9)
    normalized_templates = templates / np.linalg.norm(templates, axis=1, keepdims=True)
    scores = normalized_templates @ normalized
    bass_share = bass / np.maximum(bass.sum(axis=0), 1e-9)
    for index, (root, _, intervals) in enumerate(states):
        scores[index] += .10 * bass_share[root]
        scores[index] -= .013 * (len(intervals) - 3)
    algorithm='harmonic-chroma-bass-v2'
    if model_pack:
        from btc_harmony import posterior
        learned=posterior(y,sr,model_pack,states,hop)[:,:scores.shape[1]]
        # Preserve very clear spectral fixtures; use learned musical context
        # when several explicit templates have similar support.
        ordered=np.sort(scores,axis=0)
        spectral_clear=(ordered[-1]>.98)&((ordered[-1]-ordered[-2])>.06)
        fused=.35*scores+.65*learned**.35
        scores=np.where(spectral_clear[None,:],scores,fused)
        algorithm='chordmini-btc-harmonic-chroma-bass-v3'
    # A flat transition cost can be decoded exactly in O(states * frames).
    emission = scores * 12
    cumulative = emission[:, 0].copy()
    back = np.empty(emission.shape, dtype=np.int16)
    for frame in range(1, emission.shape[1]):
        winner = int(cumulative.argmax())
        change = cumulative[winner] - .9
        stay = cumulative >= change
        back[:, frame] = np.where(stay, np.arange(len(states)), winner)
        cumulative = np.where(stay, cumulative, change) + emission[:, frame]
    decoded = np.empty(emission.shape[1], dtype=np.int16)
    decoded[-1] = cumulative.argmax()
    for frame in range(len(decoded) - 1, 0, -1):
        decoded[frame - 1] = back[decoded[frame], frame]
    rms = librosa.feature.rms(y=y, frame_length=4096, hop_length=hop)[0]
    segments = []
    for frame, state in enumerate(decoded):
        start = frame * hop / sr
        if start >= duration:
            break
        end = min(duration, (frame + 1) * hop / sr)
        root, quality, intervals = states[int(state)]
        alternatives = np.argsort(scores[:, frame])[-3:][::-1]
        margin = float(scores[alternatives[0], frame] - scores[alternatives[1], frame])
        strength = float(scores[state, frame])
        silent = rms[min(frame, len(rms) - 1)] < 0.0007
        confidence = "high" if strength >= .88 and margin >= .045 else "medium" if strength >= .73 else "low"
        label = "N" if silent else ROOTS[root] + quality if strength >= .60 else "?"
        bass_note = int(bass_share[:, frame].argmax())
        relative_bass = (bass_note - root) % 12
        if label not in ("N", "?") and bass_note != root and relative_bass in intervals \
                and bass_share[bass_note, frame] >= .39:
            label += "/" + ROOTS[bass_note]
        candidates = [ROOTS[states[int(i)][0]] + states[int(i)][1] for i in alternatives]
        if segments and segments[-1]["label"] == label:
            segments[-1]["end"] = end
            if confidence == "low":
                segments[-1]["confidence"] = "low"
        else:
            segments.append({"start": start, "end": end, "label": label,
                "confidence": confidence, "candidates": candidates})
    # Only remove brief label excursions between two equal neighbours. Never
    # force all short musical chords to an arbitrary beat grid.
    index = 1
    while index < len(segments) - 1:
        current = segments[index]
        if current["end"] - current["start"] < .16 and segments[index - 1]["label"] == segments[index + 1]["label"]:
            segments[index - 1]["end"] = segments[index + 1]["end"]
            del segments[index:index + 2]
        else:
            index += 1
    if progress:
        progress(1, "和弦识别完成")
    return {"version": 1, "algorithm": algorithm, "duration": duration,
        "tuningCents": round(tuning * 100, 2), "segments": segments}


def analyze_files(paths: list[Path], *, progress=None, model_pack=None) -> dict:
    import soundfile as sf
    audio, sample_rate = None, 0
    for path in paths:
        current, rate = sf.read(path, dtype="float32", always_2d=True)
        current = current.mean(axis=1)
        if audio is None:
            audio, sample_rate = current, rate
        else:
            if rate != sample_rate:
                current = librosa.resample(current, orig_sr=rate, target_sr=sample_rate)
            size = max(len(audio), len(current))
            audio = np.pad(audio, (0, size - len(audio))) + np.pad(current, (0, size - len(current)))
    if audio is None:
        raise ValueError("请选择参与分析的音轨")
    if model_pack:
        from sheetsage_harmony import recognize as accurate_recognize
        return accurate_recognize(audio,sample_rate,progress=progress,model_pack=model_pack)
    return recognize(audio, sample_rate, progress=progress)
