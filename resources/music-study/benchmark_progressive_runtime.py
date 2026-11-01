"""M0 resident-GPU and serial scheduling probe, never imported by the app."""
import argparse
import os
from pathlib import Path
import random
import time

from benchmark_progressive import HOP, RATE, WINDOW, digest, emit, write_json


def main():
    launched = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pack', required=True)
    parser.add_argument('--audio', required=True, help='Six-stem source audio')
    parser.add_argument('--accompaniment', required=True, help='Matching M0 separated accompaniment')
    parser.add_argument('--context', type=int, default=60)
    parser.add_argument('--repeats', type=int, default=10)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    import numpy as np
    import torch
    from separation import read_audio
    from sheetsage_harmony import load_model, recognize
    os.environ['TORCH_HOME'] = str(Path(args.pack) / 'torch')
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    torch.set_num_threads(4)
    audio = read_audio(args.audio)
    accompaniment = read_audio(args.accompaniment).mean(0)[:args.context * RATE]
    started = time.perf_counter()
    six = get_model('htdemucs_6s').to('cuda').eval()
    chords = load_model(str(Path(args.pack).resolve()))
    torch.cuda.synchronize()
    result = dict(device=torch.cuda.get_device_name(), sourceSha256=digest(args.audio),
                  accompanimentSha256=digest(args.accompaniment),
                  importAndDecodeSeconds=started - launched,
                  loadBothSeconds=time.perf_counter() - started, context=args.context,
                  purpose='Resident serial kernel probe, not an end-to-end streaming player',
                  rate=RATE, window=WINDOW, hop=HOP, trials=[])
    # Keep explicit references alive throughout serial alternation.
    assert chords is not None and six is not None
    for trial in range(args.repeats):
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        with torch.inference_mode():
            # Produce enough finalized audio for the complete chord dependency,
            # not merely a single window then extrapolate its cost.
            for index, start in enumerate(range(0, len(accompaniment), HOP)):
                wave = torch.from_numpy(audio[:, start:start + WINDOW])
                mean, std = wave.mean(0).mean(), wave.mean(0).std().clamp_min(1e-6)
                random.seed(20261031 + index)
                output = apply_model(six, ((wave - mean) / std)[None], device='cuda',
                                     shifts=1, split=True, overlap=.25, progress=False)
                output.cpu()
                del output
        torch.cuda.synchronize()
        six_seconds = time.perf_counter() - started
        started = time.perf_counter()
        value = recognize(np.ascontiguousarray(accompaniment), RATE, model_pack=args.pack)
        torch.cuda.synchronize()
        seconds = time.perf_counter() - started
        prediction = [(s['start'], s['end'], s['label']) for s in value['segments']]
        row = dict(sixSeconds=six_seconds, chordSeconds=seconds,
                   totalSeconds=six_seconds + seconds,
                   inputSeconds=len(accompaniment) / RATE,
                   serialRtfEstimate=six_seconds / (len(accompaniment) / RATE) +
                       seconds / (len(accompaniment) / RATE / 2),
                   peakGpuMiB=torch.cuda.max_memory_allocated() / 1024**2,
                   prediction=prediction)
        result['trials'].append(row)
        write_json(args.output, result)
        emit(trial=trial, sixSeconds=six_seconds, chordSeconds=seconds, rtfEstimate=row['serialRtfEstimate'],
             peakGpuMiB=row['peakGpuMiB'])
    result['deterministicRepeatedLabelsAndTimestamps'] = all(
        row['prediction'] == result['trials'][0]['prediction'] for row in result['trials'])
    result['warmChordP50'] = float(np.percentile([row['chordSeconds'] for row in result['trials'][1:]], 50))
    result['warmChordP95'] = float(np.percentile([row['chordSeconds'] for row in result['trials'][1:]], 95))
    write_json(args.output, result)


if __name__ == '__main__':
    main()
