"""Resident whole-song executor. Core persists results; this process owns models."""
import copy
import hashlib
import json
import os
from pathlib import Path
import random
import subprocess
import time
import numpy as np
import soundfile as sf
from runtime_context import check_cancel, emit
from vocal_melody import model_keys, lyrics_key
from vocal_score import SCORE_LAYOUT_KEY

SIX = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
SIX_KEY = 'htdemucs6-reference-seeded-v1'


def digest(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def json_digest(value):
    def canonical(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: canonical(child) for key, child in item.items()}
        if isinstance(item, list):
            return [canonical(child) for child in item]
        return item
    return hashlib.sha256(json.dumps(canonical(value), ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def pcm_digest(path):
    # FLOAT WAV PEAK chunks contain a wall-clock timestamp. Hash decoded frames,
    # otherwise rebuilding identical audio would invalidate every small result.
    value = hashlib.sha256(b'pcm-f32le-44100-stereo-v1:')
    with sf.SoundFile(path) as audio:
        for block in audio.blocks(blocksize=65536, dtype='float32', always_2d=True):
            check_cancel()
            value.update(block.astype('<f4', copy=False).tobytes())
    return value.hexdigest()


def owned_bytes(root):
    return sum(path.stat().st_size for path in root.rglob('*') if path.is_file())


def decode(source, destination, start=0, end=None, pregap=0, max_frames=None):
    import imageio_ffmpeg
    import tempfile
    command = [imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error']
    if start:
        command += ['-ss', str(start)]
    command += ['-i', str(source)]
    if end is not None:
        command += ['-t', str(end - start)]
    if pregap:
        command += ['-af', f'aresample=44100,adelay={round(pregap * 44100)}S:all=1']
    command += ['-vn', '-ar', '44100', '-ac', '2', '-f', 'f32le', 'pipe:1']
    with tempfile.TemporaryFile() as errors:
        child = subprocess.Popen(command, executable=command[0], stdout=subprocess.PIPE, stderr=errors,
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        frames = 0
        try:
            with sf.SoundFile(destination, mode='w', samplerate=44100, channels=2, subtype='FLOAT', format='WAV') as output:
                while True:
                    check_cancel()
                    block = child.stdout.read(65536)
                    if not block:
                        break
                    if len(block) % 8:
                        raise ValueError('音频解码帧不完整')
                    count = len(block) // 8
                    if max_frames is not None and frames + count > max_frames:
                        raise ValueError('音频缓存容量不足，请提高缓存上限')
                    output.write(np.frombuffer(block, dtype='<f4').reshape(-1, 2))
                    frames += count
            if child.wait():
                errors.seek(0)
                raise ValueError('音频解码失败：' + errors.read().decode(errors='replace')[-1000:])
        finally:
            if child.poll() is None:
                child.kill()
            child.wait()
            child.stdout.close()


def warm(pack, features=None):
    import scipy.linalg
    import torch
    from model_residency import snapshot
    torch.set_num_threads(4)
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    features = ['six', 'chords'] if features is None else features
    times = {}
    for name in features:
        started = time.perf_counter()
        if name == 'six':
            from separation import six_model
            model = six_model(str(pack), device)
            if device == 'cuda':
                from demucs.apply import apply_model
                from runtime_context import CooperativePool
                with torch.inference_mode():
                    apply_model(model, torch.zeros(1, 2, 343980), device=device,
                                shifts=0, split=False, progress=False, pool=CooperativePool())
        elif name == 'chords':
            from sheetsage_harmony import load_model
            from model_residency import ensure_model
            load_model(str(Path(pack).resolve()))
            model = ensure_model('chords')
            if device == 'cuda':
                t = np.arange(24000 * 2, dtype=np.float32) / 24000
                model.transcribe(np.sin(t * (2 * np.pi * 440)) * .0001, sampling_rate=24000,
                    prompts=['timestamp', 'downbeat_meter', 'chord_full'], preset='paper',
                    dtype='bf16' if torch.cuda.is_bf16_supported() else 'fp32')
        times['sixLoadMs' if name == 'six' else 'chordLoadMs'] = round((time.perf_counter() - started) * 1000)
        check_cancel()
    loaded = list(snapshot().get('devices', {}))
    return dict(gpu=device == 'cuda', gpuName=torch.cuda.get_device_name(0) if device == 'cuda' else '',
                loaded=loaded, **times, pid=os.getpid())


def analyze(request):
    from separation import read_audio, six_stems, lead_backing, two_singers
    from harmony import analyze_files
    import torch
    root, pack = Path(request['directory']), Path(request['pack'])
    root.mkdir(parents=True, exist_ok=True)
    operation = request.get('operation', 'analyze')
    if operation not in ('six', 'analyze', 'chords', 'originalChords', 'leadBacking', 'twoSingers', 'melody'):
        raise ValueError('未知分析阶段')
    previous = copy.deepcopy(request.get('previous') or {})
    fingerprints = request.get('modelFingerprints', {})
    cache = previous.get('cache', {})
    signatures = cache.get('signatures', {})
    original = root / 'original.wav'
    phase, revision, report_time = ['six'], [0], [0.]
    parts = {}

    def report(value, stage):
        check_cancel()
        now = time.monotonic()
        if now - report_time[0] > .3 or value >= 1:
            report_time[0] = now
            emit(dict(kind='progress', progress=min(1, max(0, value)), stage=stage, phase=phase[0]))

    def signature(keys, parent):
        return json_digest(dict(keys=[fingerprints.get(key, key) for key in keys], parent=parent))

    def semantic_parent(source_hash):
        return signature([SIX_KEY, 'torch/hub/checkpoints/5c90dfd2-34c22ccb.th'], source_hash)

    source_hash = previous.get('sourceSha256', '')
    vocal_parent = semantic_parent(source_hash)
    supplied_lyrics = request.get('lyrics')
    note_signature = signature(model_keys(supplied_lyrics), vocal_parent + '|' + lyrics_key(supplied_lyrics)) if operation == 'melody' else ''
    notes_hit = bool(previous.get('melody') and signatures.get('notes') == note_signature)
    needs_audio = operation != 'melody' or not notes_hit
    budget = request.get('budgetBytes', 2 * 1024**3) - 65536

    if needs_audio and not original.exists():
        report(0, '准备音频')
        started = time.perf_counter()
        outputs = 9 if operation in ('leadBacking', 'twoSingers') else 7
        maximum = max(0, (budget - owned_bytes(root) - 8192) // (outputs * 8))
        temporary = root / 'decode.part.wav'
        try:
            decode(request['source'], temporary, request.get('start', 0), request.get('end'),
                   request.get('virtualPregapSeconds', 0), max_frames=maximum)
            os.replace(temporary, original)
        finally:
            temporary.unlink(missing_ok=True)
        parts['decodeMs'] = round((time.perf_counter() - started) * 1000)
        for path in root.glob('source.*'):
            path.unlink(missing_ok=True)

    if needs_audio:
        duration = sf.info(original).frames / 44100
        expected = request.get('expectedDuration')
        if duration > 3 * 3600 or expected and duration < expected * .96 - 1:
            raise ValueError('音源时长不符，请确认可以获取完整歌曲')
        source_hash = pcm_digest(original)
        if previous.get('sourceSha256') != source_hash:
            previous = {}
            cache, signatures = {}, {}
        vocal_parent = semantic_parent(source_hash)
    else:
        duration = previous['duration']

    result = previous or dict(version=1, stems=[], harmonicStems=[], waveforms={}, ready=[], timings={},
        chords=dict(segments=[], tuningCents=None, algorithm='not-requested'), originalChords=dict(segments=[]))
    result.update(duration=duration, sampleRate=44100, frames=round(duration * 44100),
                  sourceSha256=source_hash, modelFingerprints=fingerprints)
    result['cache'] = cache
    cache.setdefault('files', {})
    cache['signatures'] = signatures
    result['models'] = dict(instruments='htdemucs_6s', voices='UVR_MDXNET_KARA_2',
                            singers='duet-svs-diffusion', singersSampleRate=24000, singersChannels=1)

    def publish(stage, started, hit=False, ready=True):
        if ready:
            result['ready'] = list(dict.fromkeys(result['ready'] + [stage]))
        result['timings'][stage] = dict(elapsedMs=round((time.perf_counter() - started) * 1000), cacheHit=hit, parts=dict(parts))
        revision[0] += 1
        emit(dict(kind='stageReady', phase=stage, resultRevision=revision[0], result=copy.deepcopy(result)))

    def write_stems(values):
        added = sum(wave.size * 4 + 128 for wave in values.values())
        if owned_bytes(root) + added > budget:
            raise ValueError('音频缓存容量不足，请提高缓存上限')
        staged, committed, file_info, waveforms = [], [], {}, {}
        try:
            for name, wave in values.items():
                check_cancel()
                if wave.shape != (2, result['frames']) or not np.isfinite(wave).all():
                    raise ValueError('分轨与原曲未对齐：' + name)
                target, temporary = root / (name + '.wav'), root / (name + '.part.wav')
                staged.append((temporary, target))
                sf.write(temporary, wave.T, 44100, subtype='FLOAT')
                file_info[name] = dict(sha256=digest(temporary), bytes=temporary.stat().st_size)
                stride = max(1, int(np.ceil(wave.shape[-1] / 768)))
                mono = abs(wave).max(axis=0)
                waveforms[name] = [round(float(mono[i:i + stride].max()), 4) for i in range(0, len(mono), stride)]
            check_cancel()
            for temporary, target in staged:
                os.replace(temporary, target)
                committed.append(target)
        except Exception:
            for target in committed:
                target.unlink(missing_ok=True)
            raise
        finally:
            for temporary, _ in staged:
                temporary.unlink(missing_ok=True)
        cache['files'].update(file_info)
        result['waveforms'].update(waveforms)
        result['stems'] = list(dict.fromkeys(result['stems'] + list(values)))

    if needs_audio:
        started = time.perf_counter()
        six_hit = 'six' in result['ready'] and signatures.get('six') == vocal_parent and all((root / (s + '.wav')).is_file() for s in SIX)
        if not six_hit:
            for stem in SIX:
                (root / (stem + '.wav')).unlink(missing_ok=True)
            random.seed(int(source_hash[:16], 16))
            audio = read_audio(original)
            write_stems(six_stems(audio, pack, 'cuda' if torch.cuda.is_available() else 'cpu', report))
            del audio
            signatures['six'] = vocal_parent
        cache['files']['original'] = dict(sha256=digest(original), bytes=original.stat().st_size)
        publish('six', started, six_hit)

    if operation in ('leadBacking', 'twoSingers'):
        phase[0] = operation
        names = ['lead', 'backing'] if operation == 'leadBacking' else ['singerA', 'singerB']
        keys = ['UVR_MDXNET_KARA_2.onnx'] if operation == 'leadBacking' else ['duet.safetensors', 'speaker/embedding_model.ckpt']
        key = signature(keys, vocal_parent)
        hit = operation in result['ready'] and signatures.get(operation) == key and all((root / (s + '.wav')).is_file() for s in names)
        started = time.perf_counter()
        if not hit:
            for stem in names:
                (root / (stem + '.wav')).unlink(missing_ok=True)
            vocals = read_audio(root / 'vocals.wav')
            values = lead_backing(vocals, pack, report) if operation == 'leadBacking' else two_singers(
                vocals, pack, 'cuda' if torch.cuda.is_available() else 'cpu', report,
                identity_report=lambda ranges: result.update(singerIdentityUncertain=ranges))
            write_stems(values)
            del vocals, values
            signatures[operation] = key
        publish(operation, started, hit)
        emit(dict(kind='runtime', loadedOptional=operation))

    if operation in ('analyze', 'chords', 'originalChords'):
        phase[0] = 'originalChords' if operation == 'originalChords' else 'chords'
        harmonic = ['original'] if operation == 'originalChords' else request.get('harmonicStems') or ['bass', 'piano', 'guitar', 'other']
        if not harmonic or any(name not in SIX + ['original'] for name in harmonic):
            raise ValueError('无效和弦轨道')
        key = signature(['sheetsage2-mert2-chord-full-paper-v1', 'sheetsage2/model.safetensors', 'mert2/model.safetensors'],
                        source_hash if harmonic == ['original'] else vocal_parent + '|' + '|'.join(harmonic))
        started = time.perf_counter()
        hit = signatures.get(phase[0]) == key
        if not hit:
            result[phase[0]] = analyze_files([root / (name + '.wav') for name in harmonic], model_pack=pack, progress=report)
            signatures[phase[0]] = key
            if phase[0] == 'chords':
                result['harmonicStems'] = harmonic
        publish(phase[0], started, hit)

    if operation == 'melody':
        from vocal_melody import recognize, render_score
        phase[0] = 'melody'
        started = time.perf_counter()
        key = signature(model_keys(supplied_lyrics), vocal_parent + '|' + lyrics_key(supplied_lyrics))
        notes_hit = bool(result.get('melody') and signatures.get('notes') == key)
        previous_scores = result.get('melody', {}).get('scores', [])
        if not notes_hit:
            if owned_bytes(root) + 32 * 1024**2 > budget:
                raise ValueError('歌词对齐临时音频空间不足，请提高缓存上限')
            tick = time.perf_counter()
            result['melody'] = {**recognize(model_pack=pack, progress=report, lyrics=supplied_lyrics, directory=root,
                previous=result.get('melody'), parent=signature(model_keys(supplied_lyrics), vocal_parent)), 'scores': previous_scores}
            parts['recognitionMs'] = round((time.perf_counter() - tick) * 1000)
            signatures['notes'] = key
            signatures.pop('score', None)
            result['ready'] = [s for s in result['ready'] if s != 'melody']
            publish('melody', started, False, ready=False)
            emit(dict(kind='runtime', loadedOptional='melody'))
        raw = {k: v for k, v in result['melody'].items() if k != 'scores'}
        layout = SCORE_LAYOUT_KEY + '|' + json_digest(raw)
        cache['notesHash'] = json_digest(raw)
        score_hit = signatures.get('score') == layout
        if not score_hit:
            tick = time.perf_counter()
            result['melody']['scores'] = render_score(raw, model_pack=pack, progress=report, lyrics=supplied_lyrics, directory=root,
                previous=previous_scores)
            parts['layoutMs'] = round((time.perf_counter() - tick) * 1000)
            signatures['score'] = layout
        publish('melody', started, notes_hit and score_hit)
    emit(dict(kind='complete'))
    return result


def export_audio(request):
    root, destination = Path(request['directory']), Path(request['destination'])
    destination.mkdir(parents=True, exist_ok=True)
    for stem in request['stems']:
        check_cancel()
        if stem not in SIX + ['original', 'lead', 'backing', 'singerA', 'singerB']:
            raise ValueError('Invalid stem')
        wave, sr = sf.read(root / (stem + '.wav'), dtype='float32', always_2d=True)
        path = destination / (stem + '.' + request['format'])
        if path.exists():
            raise ValueError('导出文件已存在')
        sf.write(path, wave, sr, subtype='PCM_24')


def release_under_pressure():
    import torch
    free = torch.cuda.mem_get_info()[0] if torch.cuda.is_available() else 2**63
    ram_free = 2**63
    if os.name == 'nt':
        import ctypes
        class Memory(ctypes.Structure):
            _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in
                ('totalPhysical', 'availablePhysical', 'totalPage', 'availablePage', 'totalVirtual', 'availableVirtual', 'extended')]
        memory = Memory(); memory.length = ctypes.sizeof(memory)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            ram_free = memory.availablePhysical
    if min(free, ram_free) < 1536 * 1024**2:
        from separation import lead_session, duet_model
        from vocal_melody import release_runtime
        import gc
        lead_session.cache_clear(); duet_model.cache_clear(); release_runtime()
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        emit(dict(kind='runtime', releasedOptional=True))


def execute(method, params):
    if 'componentPaths' in params:
        os.environ['TWILIGHT_STUDY_COMPONENT_PATHS'] = json.dumps(params['componentPaths'])
    if method == 'warm':
        return warm(params['pack'], params.get('features'))
    if method == 'analyze':
        release_under_pressure()
        return analyze(params)
    if method == 'export':
        return export_audio(params)
    if method == 'notationSources':
        from vocal_melody import export_sources
        return export_sources(params['melody'], params['lines'], params['directory'], model_pack=params['pack'])
    if method == 'stats':
        from separation import six_model
        from sheetsage_harmony import load_model
        return dict(pid=os.getpid(), six=six_model.cache_info()._asdict(), chords=load_model.cache_info()._asdict())
    raise ValueError('未知运行时方法')


def dispatch(method, params):
    from model_residency import standby, snapshot, release_unused_cuda
    from vocal_melody import existing_runtime_call
    def combined():
        result = snapshot()
        optional = existing_runtime_call('residency')
        if optional:
            result['devices'].update(optional['devices'])
            for key in ('modelBudgetBytes', 'activationReserveBytes'):
                result[key] = max(result[key], optional.get(key, 0))
            for key in ('cudaAllocatedBytes', 'cudaReservedBytes', 'residentWeightBytes', 'estimatedDirectMLBytes'):
                result[key] += optional.get(key, 0)
        return result
    if method == 'standby':
        started = time.perf_counter()
        standby()
        existing_runtime_call('standby')
        return dict(**combined(), lastOffloadMs=round((time.perf_counter()-started)*1000))
    if method == 'residency':
        return combined()
    if method in ('warm', 'analyze'):
        # Two isolated dependency stacks share one physical GPU. Never admit
        # their large optional families simultaneously, even below the cap.
        if method == 'analyze' and params.get('operation') == 'melody':
            standby()
        else:
            existing_runtime_call('standby')
    try:
        result = execute(method, params)
    finally:
        if method in ('warm', 'analyze'):
            release_unused_cuda()
    if method in ('warm', 'analyze'):
        # Cancellation may suppress events, so the host also refreshes placement
        # through a metadata-only request after a cancelled task has joined.
        if method == 'warm':
            result.update(combined())
        else:
            emit(dict(kind='runtime', residency=combined()))
    return result


if __name__ == '__main__':
    # Initialize OpenBLAS before the stdin control reader starts on Windows.
    # DLL initialization can wait on Python thread attachment while it is reading.
    import scipy.linalg
    from vendor.sheetsage2.modeling_sheetsage2 import SheetSage2Model
    from resident_protocol import serve
    serve(dispatch)
