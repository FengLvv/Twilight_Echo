"""Fixed, local worker protocol. Stdout is bounded JSONL; diagnostics go to stderr."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import numpy as np
import soundfile as sf
from vocal_melody import model_keys, lyrics_key
from vocal_score import SCORE_LAYOUT_KEY


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def digest(path):
    result = hashlib.sha256()
    with open(path, "rb") as file:
        for block in iter(lambda: file.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def probe(pack):
    import torch
    import onnxruntime
    import demucs, speechbrain, audio_diffusion_pytorch, librosa, imageio_ffmpeg, safetensors
    if torch.cuda.is_available():
        torch.ones(8,device='cuda').sum().item()
    from vendor.sheetsage2.modeling_sheetsage2 import SheetSage2Model
    required = ("UVR_MDXNET_KARA_2.onnx", "duet.safetensors", "speaker/embedding_model.ckpt", "btc.safetensors", "sheetsage2/model.safetensors", "mert2/model.safetensors")
    if any(not (pack / name).is_file() for name in required):
        raise ValueError("模型包缺少分轨或高精度和弦模型，请运行环境安装脚本升级")
    if not list((pack / "torch" / "hub" / "checkpoints").glob("*.th")):
        raise ValueError("模型包缺少六轨模型")
    return {"gpu": torch.cuda.is_available(), "gpuName": torch.cuda.get_device_name(0)
            if torch.cuda.is_available() else "", "torch": torch.__version__}


def decode(source, destination, start=0, end=None, pregap=0):
    import imageio_ffmpeg
    command = [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-v", "error", "-y"]
    if start:
        command += ["-ss", str(start)]
    with open(source,'rb') as file:header=file.read(12)
    if header[:4] in (b'RIFF',b'RF64',b'RIFX') and header[8:12]==b'WAVE':
        command += ['-f','wav']
    if end is not None:
        command += ["-t", str(end - start)]
    command += ["-i", str(source)]
    if pregap:
        command += ['-af',f'aresample=44100,adelay={round(pregap*44100)}S:all=1']
    command += ["-vn", "-ar", "44100", "-ac", "2", "-c:a", "pcm_f32le", str(destination)]
    result = subprocess.run(command, capture_output=True, timeout=1800)
    if result.returncode:
        raise RuntimeError("音频解码失败: " + result.stderr.decode("utf-8", "replace")[-1200:])


def analyze(request):
    from separation import read_audio, six_stems, lead_backing, two_singers
    from harmony import analyze_files
    import torch
    root, pack = Path(request["directory"]), Path(request["pack"])
    root.mkdir(parents=True, exist_ok=True)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    report_time = [0.0]
    operation = request.get('operation', 'analyze')
    if operation not in ('six', 'analyze', 'chords', 'originalChords', 'leadBacking', 'twoSingers', 'melody'):
        raise ValueError('未知分析阶段')
    phase = ['six']

    def report(value, stage):
        now = time.monotonic()
        if now - report_time[0] > .3 or value >= 1:
            report_time[0] = now
            emit({"kind": "progress", "progress": round(min(1, max(0, value)), 4), "stage": stage, "phase": phase[0]})

    original = root / "original.wav"
    if not original.exists():
        report(0, "完整缓存与解码")
        temporary = root / "decode.wav"
        decode(request["source"], temporary, request.get("start", 0), request.get("end"), request.get('virtualPregapSeconds',0))
        os.replace(temporary, original)
    duration = sf.info(original).frames / 44100
    if duration > 3 * 3600:
        raise ValueError("单次分析最长支持 3 小时")
    expected=request.get('expectedDuration')
    if expected and duration<expected*.96-1:
        original.unlink(missing_ok=True)
        raise ValueError('音频时长不足，可能是试听片段；请缓存完整歌曲后重试')
    six = ["drums", "bass", "other", "vocals", "guitar", "piano"]
    stems = list(six)
    original_digest=digest(original)
    fingerprint=request.get('modelFingerprints',{})
    checkpoint=root/'stages.json'
    stages=json.loads(checkpoint.read_text()) if checkpoint.exists() else {}
    def signature(keys,parent):return '|'.join(fingerprint.get(key,key) for key in keys)+'|'+parent
    def cached(stage,files,keys,parent=original_digest):
        record=stages.get(stage)
        if not isinstance(record,dict) or record.get('signature')!=signature(keys,parent):return False
        for name in files:
            path=root/(name+'.wav')
            if not path.exists() or record.get('files',{}).get(name)!=digest(path):return False
        return True
    def committed(stage,files,keys,parent=original_digest):
        stages[stage]={'signature':signature(keys,parent),'files':{name:digest(root/(name+'.wav')) for name in files}}
        atomic_json(checkpoint,stages)
    six_keys=['torch/hub/checkpoints/5c90dfd2-34c22ccb.th']
    voice_keys=['UVR_MDXNET_KARA_2.onnx']
    duet_keys=['duet.safetensors','speaker/embedding_model.ckpt']

    def write_stems(values):
        for name, wave in values.items():
            if wave.shape!=(2,round(duration*44100)) or not np.isfinite(wave).all():
                raise ValueError('模型输出与原曲未对齐或含无效采样: '+name)
            path = root / (name + ".wav")
            temporary = root / (name + ".part.wav")
            sf.write(temporary, wave.T, 44100, subtype="FLOAT")
            os.replace(temporary, path)

    result_path = root / 'result.json'
    previous = json.loads(result_path.read_text(encoding='utf-8')) if result_path.exists() else {}
    result = previous if previous.get('sourceSha256') == original_digest else {}
    result.update(version=1, duration=duration, sampleRate=44100, frames=round(duration*44100),
                  sourceSha256=original_digest, modelFingerprints=fingerprint)
    result.setdefault('chords', {'segments': [], 'tuningCents': None, 'algorithm': 'not-requested'})
    result.setdefault('originalChords', {'segments': []})
    result.setdefault('harmonicStems', [])
    result.setdefault('waveforms', {})
    result.setdefault('timings', {})
    result.setdefault('ready', [])
    result['models'] = {'instruments': 'htdemucs_6s', 'voices': 'UVR_MDXNET_KARA_2',
                        'singers': 'duet-svs-diffusion', 'singersSampleRate': 24000, 'singersChannels': 1}
    revision = [0]

    def publish(stage, started, hit=False):
        result['stems'] = list(stems)
        for stem in ['original'] + stems:
            if stem not in result['waveforms']:
                wave, _ = sf.read(root/(stem+'.wav'), dtype='float32', always_2d=True)
                stride = max(1, int(np.ceil(len(wave)/768)))
                mono = abs(wave).max(axis=1)
                result['waveforms'][stem] = [round(float(np.max(mono[i:i+stride])),4)
                                             for i in range(0,len(wave),stride)]
        result['ready'] = list(dict.fromkeys(result['ready']+[stage]))
        result['timings'][stage] = {'elapsedMs': round((time.perf_counter()-started)*1000), 'cacheHit': hit}
        atomic_json(result_path, result)
        revision[0] += 1
        emit({'kind': 'stageReady', 'phase': stage, 'resultRevision': revision[0]})

    started = time.perf_counter()
    hit = cached('six', six, six_keys)
    if not hit:
        if operation not in ('six', 'analyze', 'melody'):
            raise ValueError('六轨缓存已失效，请重新分析歌曲')
        result['waveforms'] = {}
        result['ready'] = []
        result['chords'] = {'segments': [], 'tuningCents': None, 'algorithm': 'not-requested'}
        result['originalChords'] = {'segments': []}
        result.pop('melody', None)
        audio = read_audio(original)
        write_stems(six_stems(audio, pack, device, lambda p,s:report(p,s)))
        del audio
        committed('six', six, six_keys)
    vocal_digest = digest(root/'vocals.wav')
    melody_keys = model_keys()
    try:
        melody_cache = json.loads((root/'vocal-notes.json').read_text(encoding='utf-8'))
        supplied_lyrics = request.get('lyrics') if operation == 'melody' else melody_cache.get('lyrics')
        melody_parent = vocal_digest + '|' + lyrics_key(supplied_lyrics)
        melody_hit = melody_cache.get('signature') == signature(melody_keys, melody_parent)
    except (OSError, ValueError):
        melody_cache, melody_hit = {}, False
    score_cache = {}
    if melody_hit:
        try: score_cache = json.loads((root/'vocal-score.json').read_text(encoding='utf-8'))
        except (OSError,ValueError): pass
    score_hit = melody_hit and score_cache.get('signature') == SCORE_LAYOUT_KEY+'|'+digest(root/'vocal-notes.json')
    if not (melody_hit and score_hit):
        result.pop('melody', None)
        result['ready'] = [stage for stage in result['ready'] if stage != 'melody']
    result['ready'] = [stage for stage in result['ready'] if stage not in ('leadBacking', 'twoSingers')]
    for stage, names, keys in [('leadBacking',['lead','backing'],voice_keys),('twoSingers',['singerA','singerB'],duet_keys)]:
        if cached(stage,names,keys,vocal_digest):
            stems += names
            result['ready'] = list(dict.fromkeys(result['ready']+[stage]))
    for chord_stage in ('chords', 'originalChords'):
        if chord_stage not in result['ready']:
            continue
        harmonic = ['original'] if chord_stage == 'originalChords' else result.get('harmonicStems', [])
        keys = ['sheetsage2/model.safetensors', 'mert2/model.safetensors']
        try:
            parent = '|'.join(name+':'+digest(root/(name+'.wav')) for name in harmonic)
            cache = json.loads((root/(chord_stage+'.json')).read_text())
            valid = bool(harmonic) and cache.get('signature') == signature(keys, parent)
        except (OSError, ValueError):
            valid = False
        if not valid:
            result['ready'].remove(chord_stage)
    publish('six', started, hit)
    if device == 'cuda': torch.cuda.empty_cache()

    if operation in ('leadBacking','twoSingers'):
        phase[0] = operation
        started = time.perf_counter()
        names, keys = (['lead','backing'],voice_keys) if operation=='leadBacking' else (['singerA','singerB'],duet_keys)
        hit = cached(operation,names,keys,vocal_digest)
        if not hit:
            vocals = read_audio(root/'vocals.wav')
            if operation=='leadBacking':
                values = lead_backing(vocals,pack,lambda p,s:report(p,s))
            else:
                values = two_singers(vocals,pack,device,lambda p,s:report(p,s),
                    identity_report=lambda ranges:atomic_json(root/'singer-identity.json',ranges))
            write_stems(values)
            del vocals, values
            committed(operation,names,keys,vocal_digest)
        stems = list(dict.fromkeys(stems+names))
        identity_file = root/'singer-identity.json'
        if identity_file.exists(): result['singerIdentityUncertain'] = json.loads(identity_file.read_text())
        publish(operation,started,hit)

    if operation in ('analyze','chords','originalChords'):
        phase[0] = 'originalChords' if operation=='originalChords' else 'chords'
        harmonic = ['original'] if operation=='originalChords' else request.get('harmonicStems',['bass','piano','guitar','other'])
        if not harmonic or any(name not in stems+['original'] for name in harmonic):
            raise ValueError('无效的和弦分析轨道')
        started = time.perf_counter()
        keys = ['sheetsage2/model.safetensors','mert2/model.safetensors']
        parent = '|'.join(name+':'+digest(root/(name+'.wav')) for name in harmonic)
        cache_path = root/(phase[0]+'.json')
        key = signature(keys,parent)
        hit = False
        if cache_path.exists() and operation=='analyze':
            cache = json.loads(cache_path.read_text())
            hit = cache.get('signature')==key
        if hit:
            chords = cache['chords']
        else:
            chords = analyze_files([root/(name+'.wav') for name in harmonic],model_pack=pack,
                                   progress=lambda p,s:report(p,s))
            atomic_json(cache_path,{'signature':key,'chords':chords})
        if operation=='originalChords': result['originalChords'] = chords
        else:
            result['chords'] = chords
            result['harmonicStems'] = harmonic
        publish(phase[0],started,hit)
    if operation == 'melody':
        from vocal_melody import recognize, render_score
        phase[0] = 'melody'
        started = time.perf_counter()
        if melody_hit:
            melody = melody_cache['melody']
        else:
            supplied_lyrics = request.get('lyrics')
            melody_parent = vocal_digest + '|' + lyrics_key(supplied_lyrics)
            melody = recognize(model_pack=pack, progress=report, lyrics=supplied_lyrics, directory=root)
            atomic_json(root/'vocal-notes.json', {'signature': signature(melody_keys, melody_parent), 'lyrics': supplied_lyrics, 'melody': melody})
        if not score_hit:
            scores = render_score(melody,model_pack=pack,progress=report,
                lyrics=request['lyrics'],directory=root)
            score_cache = {'signature':SCORE_LAYOUT_KEY+'|'+digest(root/'vocal-notes.json'),'scores':scores}
            atomic_json(root/'vocal-score.json',score_cache)
        result['melody'] = {**melody,'scores':score_cache['scores']}
        publish('melody', started, bool(melody_hit and score_hit))
    emit({"kind": "complete"})


def export_audio(request):
    root, destination = Path(request["directory"]), Path(request["destination"])
    destination.mkdir(parents=True, exist_ok=True)
    for stem in request["stems"]:
        if stem not in ("original", "drums", "bass", "other", "vocals", "guitar", "piano",
                        "lead", "backing", "singerA", "singerB"):
            raise ValueError("Invalid stem")
        wave, sr = sf.read(root / (stem + ".wav"), dtype="float32", always_2d=True)
        suffix = request["format"]
        path = destination / (stem + "." + suffix)
        if path.exists():
            raise ValueError("导出目录已有同名文件")
        sf.write(path, wave, sr, subtype="PCM_24")
    emit({"kind": "complete"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["probe", "analyze", "export"])
    parser.add_argument("request")
    args = parser.parse_args()
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8-sig"))
        if args.operation == "probe":
            emit({"kind": "probe", **probe(Path(request["pack"]))})
        elif args.operation == "analyze":
            analyze(request)
        else:
            export_audio(request)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit({"kind": "error", "message": str(error)[:1600]})
        sys.exit(1)
