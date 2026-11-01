"""M0 experiments, deliberately separate from the production analysis pipeline.

Uses the installed, pinned models without training or changing their encoder
length. Predictions and timings are content addressed; cache hits are never
reported as fresh inference. See --help for the reproducible entry points.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import time

RATE = 44100
WINDOW = 343980  # HTDemucs training window: 7.8 seconds
HOP = 257985     # 25 percent overlap, anchored at source frame zero
CONTEXTS = (15, 30, 60, 120, 300)
PROTOCOL = 'm0-fixed-grid-context-v1'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')
    temporary.replace(path)


def emit(**fields):
    print(json.dumps(fields, ensure_ascii=False), flush=True)


def chord_windows(frames, rate, context):
    """Half-window accept grid; quarter-window left and right context.

    End-of-source is known in M0. A production reader may use the final shifted
    window only after actual EOF. Input and acceptance boundaries are integers.
    """
    if frames <= 0 or rate <= 0 or context not in CONTEXTS:
        raise ValueError('Invalid source or context')
    width = round(context * rate)
    hop = width // 2
    for start in range(0, frames, hop):
        end = min(frames, start + hop)
        left = max(0, min(start - width // 4, frames - width))
        yield dict(start=start, end=end, inputStart=left,
                   inputEnd=min(frames, left + width))


def crop(segments, start, end, offset=0):
    result = []
    for segment in segments:
        a, b = max(start, segment['start'] + offset), min(end, segment['end'] + offset)
        if b > a:
            value = dict(segment, start=a, end=b)
            if result and result[-1]['label'] == value['label'] and abs(result[-1]['end'] - a) < 1e-7:
                result[-1]['end'] = b
            else:
                result.append(value)
    return result


def regional_scores(reference, prediction, duration, regions):
    from benchmark_chords import score
    totals = {}
    for start, end in regions:
        if end <= start:
            continue
        ref = crop(reference, start, end)
        est = crop(prediction, start, end)
        # Shift the actual scoring interval to zero so adjust_intervals cannot
        # add the excluded prefix back to the metric denominator.
        for items in (ref, est):
            for value in items:
                value['start'] -= start
                value['end'] -= start
        if not ref:
            continue
        for key, metric in score(ref, est, end - start).items():
            total = totals.setdefault(key, dict(matched=0., seconds=0.))
            for field in total:
                total[field] += metric[field]
    return totals


def model_identity(pack):
    files = ('torch/hub/checkpoints/5c90dfd2-34c22ccb.th',
             'sheetsage2/model.safetensors', 'sheetsage2/config.json',
             'mert2/model.safetensors', 'mert2/config.json')
    return {name: digest(Path(pack) / name) for name in files}


def source_identity():
    root = Path(__file__).parent
    paths = [root / 'sheetsage_harmony.py', root / 'benchmark_chords.py',
             root / 'evaluate_harmony.py', Path(__file__)]
    paths += sorted((root / 'vendor/sheetsage2').glob('*.py'))
    return {str(path.relative_to(root)): digest(path) for path in paths}


def inference_identity(identity):
    """Scoring or report changes do not invalidate identical model predictions."""
    return dict(protocol=identity['protocol'], weights=identity['weights'],
                source={name: value for name, value in identity['source'].items()
                        if name == 'sheetsage_harmony.py' or name.startswith('vendor/')})


def benchmark_stems(args, launched):
    import numpy as np
    import soundfile as sf
    import torch
    from separation import read_audio
    os.environ['TORCH_HOME'] = str(Path(args.pack) / 'torch')
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    torch.set_num_threads(4)
    tick = time.perf_counter()
    audio = read_audio(args.audio)
    if args.seconds:
        audio = audio[:, :round(args.seconds * RATE)]
    decode_seconds = time.perf_counter() - tick
    tick = time.perf_counter()
    model = get_model('htdemucs_6s').to('cuda').eval()
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - tick
    imported_seconds = tick - launched - decode_seconds
    frames = audio.shape[-1]
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    result = dict(protocol=PROTOCOL, device=torch.cuda.get_device_name(),
                  torch=torch.__version__, audioSha256=digest(args.audio),
                  source=source_identity(), weights=model_identity(args.pack),
                  frames=frames, rate=RATE, window=WINDOW, hop=HOP,
                  decodeSeconds=decode_seconds, importSeconds=imported_seconds,
                  modelLoadSeconds=load_seconds, trials=[])
    weight = np.concatenate((np.arange(1, WINDOW // 2 + 1),
                             np.arange(WINDOW - WINDOW // 2, 0, -1))).astype(np.float32)
    weight /= weight.max()
    wave = torch.from_numpy(audio)
    reference = None
    with torch.inference_mode():
        for trial in range(args.repeats):
            # Full arrays are intentionally retained here ONLY to compare the
            # prototype against the whole-song baseline; not a streaming store.
            output = np.zeros((6, 2, frames), dtype=np.float32)
            weights = np.zeros(frames, dtype=np.float32)
            timings = []
            torch.cuda.synchronize()
            begin = time.perf_counter()
            first = None
            for index, start in enumerate(range(0, frames, HOP)):
                chunk = wave[:, start:start + WINDOW]
                mean = chunk.mean(0).mean()
                std = chunk.mean(0).std().clamp_min(1e-6)
                random.seed(20261031 + index)
                torch.cuda.synchronize()
                tick = time.perf_counter()
                estimate = apply_model(model, ((chunk - mean) / std)[None],
                    device='cuda', shifts=1, split=True, overlap=.25, progress=False)[0]
                estimate = estimate.cpu().numpy() * float(std) + float(mean) / 6
                count = chunk.shape[-1]
                output[:, :, start:start + count] += estimate * weight[:count]
                weights[start:start + count] += weight[:count]
                torch.cuda.synchronize()
                elapsed = time.perf_counter() - tick
                timings.append(elapsed)
                finalized = min(frames, start + HOP)
                if first is None and finalized >= min(frames, 12 * RATE):
                    first = time.perf_counter() - begin
                emit(stage='six-window', trial=trial, index=index, seconds=elapsed,
                     finalizedSeconds=finalized / RATE)
            output /= weights
            elapsed = time.perf_counter() - begin
            result['trials'].append(dict(seconds=elapsed, rtf=elapsed / (frames / RATE),
                first12Seconds=first, windowSeconds=timings,
                peakGpuMiB=torch.cuda.max_memory_allocated() / 1024**2))
            if trial == 0:
                # Exact current adapter semantics, with an explicit reproducible
                # Python seed (production currently chooses an unseeded shift).
                mean = wave.mean(0).mean()
                std = wave.mean(0).std().clamp_min(1e-6)
                random.seed(20261031)
                tick = time.perf_counter()
                baseline = apply_model(model, ((wave - mean) / std)[None], device='cuda',
                    shifts=1, split=True, overlap=.25, progress=False)[0]
                reference = baseline.cpu().numpy() * float(std) + float(mean) / 6
                torch.cuda.synchronize()
                result['baselineSeconds'] = time.perf_counter() - tick
                result['comparison'] = {}
                for name, actual, expected in zip(model.sources, output, reference):
                    error = actual - expected
                    snr = 10 * np.log10(max(1e-20, np.mean(expected**2)) / max(1e-20, np.mean(error**2)))
                    joins = np.arange(HOP, frames, HOP)
                    jump = np.abs(actual[:, joins] - actual[:, joins - 1])
                    ref_jump = np.abs(expected[:, joins] - expected[:, joins - 1])
                    result['comparison'][name] = dict(referenceSimilarityDb=float(snr),
                        boundaryJumpMax=float(jump.max(initial=0)),
                        baselineBoundaryJumpMax=float(ref_jump.max(initial=0)),
                        note='Similarity to baseline, not ground-truth separation quality')
                    sf.write(destination / (name + '-progressive.wav'), actual.T, RATE, subtype='FLOAT')
                    sf.write(destination / (name + '-baseline.wav'), expected.T, RATE, subtype='FLOAT')
                accompaniment = sum(output[i] for i, name in enumerate(model.sources) if name != 'vocals')
                sf.write(destination / 'accompaniment.wav', accompaniment.T, RATE, subtype='FLOAT')
            write_json(destination / 'stems.json', result)
    warm = result['trials'][1:]
    result['warmFirst12P50'] = float(np.percentile([t['first12Seconds'] for t in warm], 50)) if warm else None
    result['warmFirst12P95'] = float(np.percentile([t['first12Seconds'] for t in warm], 95)) if warm else None
    result['coldFirst12Seconds'] = imported_seconds + decode_seconds + load_seconds + result['trials'][0]['first12Seconds']
    result['warmRtf'] = sum(t['seconds'] for t in warm) / (len(warm) * frames / RATE) if warm else None
    write_json(destination / 'stems.json', result)
    emit(stage='six-complete', summary={k: result[k] for k in ('coldFirst12Seconds', 'warmFirst12P50', 'warmFirst12P95', 'warmRtf')})


def examples(root, guitar_count, datasets):
    """Deterministic style/player spread plus both long MIREX demo recordings."""
    import numpy as np
    research = root / 'research-20261030'
    files = sorted((root / 'evaluation/guitar-audio').glob('*_comp_mic.wav'))
    indices = np.linspace(0, len(files) - 1, min(guitar_count, len(files)), dtype=int)
    for index in indices if 'guitarset' in datasets else []:
        audio = files[index]
        annotation = root / 'evaluation/guitar-annotations' / (audio.stem.removesuffix('_mic') + '.jams')
        jams = json.loads(annotation.read_text())
        chords = [a['data'] for a in jams['annotations'] if a['namespace'] == 'chord'][1]
        yield 'guitarset', audio, annotation, [dict(start=c['time'], end=c['time'] + c['duration'], label=c['value']) for c in chords]
    for audio in sorted((research / 'mirex-demo').glob('*.mp3')) if 'mirex' in datasets else []:
        annotation = audio.with_suffix('.json')
        data = json.loads(annotation.read_text())
        if data['audio_offset'] != 0:
            raise ValueError('Unaccounted annotation offset')
        yield 'mirex-supplementary', audio, annotation, [dict(start=a, end=b, label=c) for a, b, c in data['reference']]
    if 'idmt' in datasets:
        from benchmark_chords import idmt_label
        for audio in sorted((research / 'idmt-subset').glob('*.wav')):
            annotation = audio.parent / ('guitar_annotation.lab' if '_guitar_' in audio.name else 'non_guitar_annotation.lab')
            reference = [dict(start=float(parts[0]), end=float(parts[1]), label=idmt_label(parts[2]))
                         for line in annotation.read_text().splitlines() if len(parts := line.split()) == 3]
            yield 'idmt', audio, annotation, reference


def benchmark_chords(args, launched):
    import numpy as np
    import soundfile as sf
    import torch
    from sheetsage_harmony import load_model, recognize
    from benchmark_chords import score
    torch.set_num_threads(4)
    destination = Path(args.output)
    destination.mkdir(parents=True, exist_ok=True)
    identity = dict(protocol=PROTOCOL, source=source_identity(), weights=model_identity(args.pack))
    prediction_identity = inference_identity(identity)
    resumed_identity = None
    previous_path = destination / 'chords.json'
    if previous_path.exists():
        previous = json.loads(previous_path.read_text(encoding='utf-8'))
        previous_identity = previous['identity']
        if inference_identity(previous_identity) == prediction_identity:
            resumed_identity = previous.get('resumeIdentity') or previous.get('predictionIdentity', previous_identity)
    tick = time.perf_counter()
    model = load_model(str(Path(args.pack).resolve()))
    torch.cuda.synchronize()
    load_seconds = time.perf_counter() - tick
    result = dict(identity=identity, predictionIdentity=prediction_identity, resumeIdentity=resumed_identity,
                  device=torch.cuda.get_device_name(), torch=torch.__version__,
                  importAndIdentitySeconds=tick - launched, modelLoadSeconds=load_seconds,
                  encoderSeconds=float(model.hparams.input_audio_length), files=[], calls=[])
    in_memory = {}

    def infer(audio, rate):
        pcm = str(rate).encode() + audio.tobytes()
        key = hashlib.sha256(json.dumps(prediction_identity, sort_keys=True).encode() + pcm).hexdigest()
        if key in in_memory:
            return in_memory[key], dict(key=key, memoryReuse=True, seconds=None)
        path = destination / 'predictions' / (key + '.json')
        if not path.exists() and resumed_identity:
            previous_key = hashlib.sha256(json.dumps(resumed_identity, sort_keys=True).encode() + pcm).hexdigest()
            previous_file = destination / 'predictions' / (previous_key + '.json')
            if previous_file.exists():
                write_json(path, json.loads(previous_file.read_text(encoding='utf-8')))
        if path.exists():
            entry = json.loads(path.read_text(encoding='utf-8'))
            in_memory[key] = entry['segments']
            return entry['segments'], dict(key=key, diskReuse=True, seconds=None,
                                            originalSeconds=entry['seconds'])
        torch.cuda.synchronize()
        begin = time.perf_counter()
        prediction = recognize(audio, rate, model_pack=args.pack)
        torch.cuda.synchronize()
        seconds = time.perf_counter() - begin
        entry = dict(segments=prediction['segments'], seconds=seconds,
                     inputSeconds=len(audio) / rate, inference=prediction['inference'])
        write_json(path, entry)
        in_memory[key] = entry['segments']
        call = dict(key=key, seconds=seconds, inputSeconds=len(audio) / rate,
                    peakGpuMiB=prediction['inference'].get('peak_gpu_mib'))
        result['calls'].append(call)
        return entry['segments'], call

    for dataset, path, annotation, reference in examples(Path(args.study_root), args.guitar_count, args.datasets):
        stereo, rate = sf.read(path, dtype='float32', always_2d=True)
        audio = np.ascontiguousarray(stereo.mean(axis=1))
        frames, duration = len(audio), len(audio) / rate
        row = dict(dataset=dataset, file=path.name, audioSha256=digest(path),
                   annotationSha256=digest(annotation), duration=duration, candidates={})
        baseline, call = infer(audio, rate)
        row['baseline'] = dict(call=call, metrics=score(reference, baseline, duration))
        emit(stage='chord-baseline', file=path.name, call=call)
        for context in args.contexts:
            plan = list(chord_windows(frames, rate, context))
            estimates, calls = [], []
            for index, window in enumerate(plan):
                prediction, call = infer(audio[window['inputStart']:window['inputEnd']], rate)
                estimates.extend(crop(prediction, window['start'] / rate, window['end'] / rate,
                                      window['inputStart'] / rate))
                calls.append(call)
                emit(stage='chord-window', file=path.name, context=context, index=index,
                     windows=len(plan), call=call)
            seams = [(max(0, w['start'] / rate - 1), min(duration, w['start'] / rate + 1)) for w in plan[1:]]
            initial = [(0, min(duration, plan[0]['end'] / rate))]
            row['candidates'][str(context)] = dict(calls=calls, plan=plan,
                metrics=score(reference, estimates, duration),
                firstMetrics=regional_scores(reference, estimates, duration, initial),
                baselineFirstMetrics=regional_scores(reference, baseline, duration, initial),
                seamMetrics=regional_scores(reference, estimates, duration, seams),
                baselineSeamMetrics=regional_scores(reference, baseline, duration, seams))
            # Full accepted predictions are saved for inspection and time anchors.
            write_json(destination / 'accepted' / (path.stem + '-' + str(context) + '.json'), estimates)
        result['files'].append(row)
        write_json(destination / 'chords.json', result)
    emit(stage='chords-complete', files=len(result['files']), freshCalls=len(result['calls']))


def main():
    launched = time.perf_counter()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('stems', 'chords'))
    parser.add_argument('--pack', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--audio')
    parser.add_argument('--seconds', type=float, default=60)
    parser.add_argument('--repeats', type=int, default=4)
    parser.add_argument('--study-root')
    parser.add_argument('--guitar-count', type=int, default=12)
    parser.add_argument('--datasets', nargs='+', choices=('guitarset', 'mirex', 'idmt'),
                        default=('guitarset', 'mirex'))
    parser.add_argument('--contexts', type=int, nargs='+', choices=CONTEXTS, default=CONTEXTS)
    args = parser.parse_args()
    if args.mode == 'stems':
        if not args.audio or args.repeats < 2 or args.seconds < 0:
            parser.error('stems requires --audio, --repeats >= 2 and --seconds >= 0')
        benchmark_stems(args, launched)
    else:
        if not args.study_root or args.guitar_count < 1:
            parser.error('chords requires --study-root and --guitar-count >= 1')
        benchmark_chords(args, launched)


if __name__ == '__main__':
    main()
