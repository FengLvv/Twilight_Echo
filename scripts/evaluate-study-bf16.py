"""Reproducible, separate-process FP32-weights / BF16-weights quality gate.

Both candidates retain paper decoding and BF16 autocast. No production policy
is changed by this evaluation. A frozen source tree prevents edit-time drift.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


def measure(args):
    sys.path.insert(0, str(Path(args.output) / 'runtime'))
    import scipy.linalg
    import librosa
    import torch
    from sheetsage_harmony import load_model, recognize
    torch.set_num_threads(4)
    model = load_model(str(Path(args.home) / 'models'))
    if args.precision == 'bf16':
        model.to(dtype=torch.bfloat16)
    from model_residency import ensure_model
    ensure_model('chords')
    torch.cuda.empty_cache()
    report = {'precision': args.precision, 'weightBytes': sum(p.numel()*p.element_size() for p in model.parameters()),
              'allocatedBytes': torch.cuda.memory_allocated(), 'samples': []}
    for path in json.loads((Path(args.output) / 'samples.json').read_text()):
        audio, rate = librosa.load(path, sr=24000, mono=True)
        torch.cuda.reset_peak_memory_stats()
        started = time.perf_counter()
        result = recognize(audio, rate, model_pack=Path(args.home) / 'models')
        report['samples'].append({'path': path, 'duration': len(audio)/rate, 'seconds': time.perf_counter()-started,
            'peakBytes': torch.cuda.max_memory_allocated(), 'segments': result['segments']})
        (Path(args.output) / f'{args.precision}.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(args.precision, Path(path).name, round(report['samples'][-1]['seconds'], 2), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--precision', choices=['fp32', 'bf16'])
    args = parser.parse_args()
    if args.precision:
        return measure(args)
    root = Path(args.output).resolve(); root.mkdir(parents=True, exist_ok=False)
    shutil.copytree(Path(__file__).resolve().parents[1] / 'resources/music-study', root / 'runtime',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    corpus = Path(args.home) / 'evaluation/guitar-audio'
    samples = [str(next(corpus.glob(f'*_{style}*_comp_mic.wav'))) for style in ['BN1', 'Funk1', 'Jazz1', 'SS1', 'Rock1']]
    repo = Path(__file__).resolve().parents[1]
    samples += [str(repo / '.local/song-analysis-media/MyFriend.wav'), str(repo / '.local/vocal-rhythm-media/Qinghuaci.wav')]
    samples += [str(path) for path in (Path(args.home) / 'research-20261030/mirex-demo').glob('*.mp3')]
    (root / 'samples.json').write_text(json.dumps(samples), encoding='utf-8')
    for precision in ['fp32', 'bf16']:
        subprocess.run([sys.executable, str(Path(__file__).resolve()), '--home', args.home, '--output', str(root),
                        '--precision', precision], check=True)
    baseline, candidate = [json.loads((root / f'{p}.json').read_text()) for p in ['fp32', 'bf16']]
    comparisons = []
    for a, b in zip(baseline['samples'], candidate['samples']):
        points = sorted({0, a['duration']} | {x[k] for sample in [a,b] for x in sample['segments'] for k in ['start','end']})
        def label(rows, t):
            return next((r['label'] for r in rows if r['start'] <= t < r['end']), 'N')
        agreement = sum(end-start for start,end in zip(points, points[1:])
                        if label(a['segments'], (start+end)/2) == label(b['segments'], (start+end)/2))/a['duration']
        exact = a['segments'] == b['segments']
        comparisons.append({'path': a['path'], 'exact': exact, 'timeAgreement': agreement,
                            'fp32Seconds': a['seconds'], 'bf16Seconds': b['seconds']})
    result = {'accepted': all(x['exact'] for x in comparisons), 'gate': 'identical labels and boundaries on all samples',
              'weightBytes': {p: r['weightBytes'] for p,r in [('fp32',baseline),('bf16',candidate)]}, 'comparisons': comparisons}
    (root / 'comparison.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
