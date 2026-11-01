"""M0 separation A/B diagnostics; baseline similarity is NOT accuracy."""
import argparse
import os
from pathlib import Path
import random
import time

from benchmark_progressive import HOP, RATE, digest, write_json


def similarity(actual, expected):
    import numpy as np
    error = actual - expected
    signal, noise = float(np.mean(expected**2)), float(np.mean(error**2))
    return dict(referenceSimilarityDb=float(10 * np.log10(max(signal, 1e-20) / max(noise, 1e-20))),
                referenceRms=float(np.sqrt(signal)), errorRms=float(np.sqrt(noise)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', required=True)
    parser.add_argument('--audio', required=True)
    parser.add_argument('--artifacts', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    import numpy as np
    import soundfile as sf
    import torch
    from separation import read_audio
    os.environ['TORCH_HOME'] = str(Path(args.pack) / 'torch')
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    root = Path(args.artifacts)
    run = __import__('json').loads((root / 'stems.json').read_text(encoding='utf-8'))
    if digest(args.audio) != run['audioSha256']:
        raise ValueError('M0 source has changed')
    audio = read_audio(args.audio)[:, :run['frames']]
    torch.set_num_threads(4)
    model = get_model('htdemucs_6s').to('cuda').eval()
    reference = np.stack([sf.read(root / (name + '-baseline.wav'), dtype='float32')[0].T for name in model.sources])
    progressive = np.stack([sf.read(root / (name + '-progressive.wav'), dtype='float32')[0].T for name in model.sources])
    source = torch.from_numpy(audio)
    mean, std = source.mean(0).mean(), source.mean(0).std().clamp_min(1e-6)
    result = dict(note='No isolated ground truth: similarity and seam diagnostics only; no listening test claimed',
                  sourceSha256=run['audioSha256'], baselineSeed=20261031, trials=[])
    with torch.inference_mode():
        for seed in (20261032, 20261033, 20261034):
            random.seed(seed)
            started = time.perf_counter()
            estimate = apply_model(model, ((source - mean) / std)[None], device='cuda',
                                  shifts=1, split=True, overlap=.25, progress=False)[0]
            alternative = estimate.cpu().numpy() * float(std) + float(mean) / 6
            result['trials'].append(dict(seed=seed, seconds=time.perf_counter() - started,
                stems={name: similarity(actual, expected) for name, actual, expected in zip(model.sources, alternative, reference)}))
    result['progressive'] = {name: similarity(actual, expected) for name, actual, expected in zip(model.sources, progressive, reference)}
    result['mix'] = dict(baseline=similarity(reference.sum(0), audio), progressive=similarity(progressive.sum(0), audio))
    seams = np.arange(HOP, len(audio[0]), HOP)
    mask = np.zeros(audio.shape[-1] - 1, dtype=bool)
    for frame in seams:
        # 20 ms on either side, not just one fortunate sample at the seam.
        mask[max(0, frame - 882):min(len(mask), frame + 882)] = True
    result['seams'] = {}
    for name, actual, expected in zip(model.sources, progressive, reference):
        def jumps(value):
            derivative = np.abs(np.diff(value, axis=-1))[:, mask]
            return dict(p99=float(np.percentile(derivative, 99)), maximum=float(derivative.max(initial=0)))
        result['seams'][name] = dict(baseline=jumps(expected), progressive=jumps(actual))
    write_json(args.output, result)


if __name__ == '__main__':
    main()
