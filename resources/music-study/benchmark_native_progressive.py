"""M0: drive Demucs' native windows, retaining its one global shift.

The global-normalization control must reproduce the existing adapter. Local
normalization is the online candidate. Neither path nests apply_model(split=True)
inside a second sliding-window loop. Not production code.
"""
import argparse
import os
from pathlib import Path
import random
import time

from benchmark_progressive import RATE, WINDOW, HOP, digest, write_json, emit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', required=True)
    parser.add_argument('--audio', required=True)
    parser.add_argument('--reference', required=True, help='M0 stems directory with the same seeded baseline')
    parser.add_argument('--seconds', type=float, default=60)
    parser.add_argument('--repeats', type=int, default=4)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    launched = time.perf_counter()
    import numpy as np
    import soundfile as sf
    import torch
    from separation import read_audio
    from benchmark_progressive_seams import similarity
    os.environ['TORCH_HOME'] = str(Path(args.pack) / 'torch')
    from demucs.apply import apply_model, TensorChunk
    from demucs.pretrained import get_model
    torch.set_num_threads(4)
    audio = read_audio(args.audio)[:, :round(args.seconds * RATE)]
    frames = audio.shape[-1]
    model = get_model('htdemucs_6s').to('cuda').eval()
    wave = torch.from_numpy(audio)
    mean, std = wave.mean(0).mean(), wave.mean(0).std().clamp_min(1e-6)
    maximum_shift = RATE // 2
    offset = random.Random(20261031).randint(0, maximum_shift)
    phase = maximum_shift - offset
    normalized = (wave - mean) / std
    padded = TensorChunk(normalized[None]).padded(frames + 2 * maximum_shift)
    shifted = TensorChunk(padded, offset, frames + phase)
    weight = np.concatenate((np.arange(1, WINDOW // 2 + 1),
                             np.arange(WINDOW - WINDOW // 2, 0, -1))).astype(np.float32)
    weight /= weight.max()
    root = Path(args.output)
    root.mkdir(parents=True, exist_ok=True)
    reference = np.stack([sf.read(Path(args.reference) / (name + '-baseline.wav'), dtype='float32')[0].T
                          for name in model.sources])
    if reference.shape != (6, 2, frames):
        raise ValueError('Baseline source frame count differs')
    result = dict(protocol='m0-native-global-shift-local-normalization-v1',
                  sourceSha256=digest(args.audio), codeSha256=digest(__file__),
                  device=torch.cuda.get_device_name(), torch=torch.__version__,
                  seed=20261031, shiftFrames=phase, window=WINDOW, hop=HOP,
                  frames=frames, importDecodeLoadSeconds=time.perf_counter() - launched,
                  control=None, trials=[])
    with torch.inference_mode():
        for trial in range(-1, args.repeats):
            output = np.zeros((6, 2, frames + phase), np.float32)
            weights = np.zeros(frames + phase, np.float32)
            begin = time.perf_counter()
            first = None
            for index, start in enumerate(range(0, frames + phase, HOP)):
                length = min(WINDOW, frames + phase - start)
                if trial == -1:
                    chunk = TensorChunk(shifted, start, WINDOW)
                    estimate = apply_model(model, chunk, device='cuda', shifts=0,
                                           split=False, progress=False)[0]
                    estimate = estimate.cpu().numpy() * float(std) + float(mean) / 6
                else:
                    # Reproduce TensorChunk's final-window centering with true
                    # adjacent source context. Only actual source edges pad zero.
                    trim = (WINDOW - length) // 2
                    source_start = start - phase - trim
                    left, right = max(0, source_start), min(frames, source_start + WINDOW)
                    valid = wave[:, left:right]
                    local_mean = valid.mean(0).mean()
                    local_std = valid.mean(0).std().clamp_min(1e-6) if valid.shape[-1] > 1 else torch.tensor(1e-6)
                    kernel_input = torch.zeros((2, WINDOW), dtype=wave.dtype)
                    kernel_input[:, left - source_start:right - source_start] = (valid - local_mean) / local_std
                    estimate = apply_model(model, kernel_input[None], device='cuda', shifts=0,
                                           split=False, progress=False)[0]
                    estimate = estimate[..., trim:trim + length].cpu().numpy() * float(local_std) + float(local_mean) / 6
                output[:, :, start:start + length] += estimate * weight[:length]
                weights[start:start + length] += weight[:length]
                torch.cuda.synchronize()
                finalized = min(frames, start + HOP - phase)
                if first is None and finalized >= min(frames, 12 * RATE):
                    first = time.perf_counter() - begin
            output /= weights
            output = output[:, :, phase:]
            row = dict(seconds=time.perf_counter() - begin, first12Seconds=first,
                       comparison={name: similarity(actual, expected) for name, actual, expected in zip(model.sources, output, reference)},
                       mixture=similarity(output.sum(0), audio))
            row['rtf'] = row['seconds'] / (frames / RATE)
            if trial == -1:
                row['maxAbsoluteError'] = float(np.abs(output - reference).max())
                result['control'] = row
                if row['maxAbsoluteError'] > 1e-5:
                    raise ValueError('Native-window control failed to reproduce current adapter: ' + str(row['maxAbsoluteError']))
            else:
                result['trials'].append(row)
                if trial == 0:
                    for name, values in zip(model.sources, output):
                        sf.write(root / (name + '.wav'), values.T, RATE, subtype='FLOAT')
            write_json(root / 'native.json', result)
            emit(trial=trial, seconds=row['seconds'], first12Seconds=first,
                 rtf=row['rtf'], controlMaxError=row.get('maxAbsoluteError'))


if __name__ == '__main__':
    main()
