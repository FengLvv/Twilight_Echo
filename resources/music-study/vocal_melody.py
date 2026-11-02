"""One reusable, isolated Vocal2Midi environment; Core owns all durable results."""
from pathlib import Path
import hashlib
import json
import os

ALGORITHM = 'vocal2midi-tifa-game-medium-rhythm-v10'


def model_keys(lyrics=None):
    registry = json.loads(Path(__file__).with_name('vocal_models.json').read_text(encoding='utf-8'))
    keys=[ALGORITHM] + sorted(registry['files'])
    rows=json.loads(lyrics) if lyrics is not None else []
    if rows and all((row.get('origin') or {}).get('format')=='amll-ttml' for row in rows):
        return keys
    policy=json.loads(Path(__file__).with_name('lyric_credits.json').read_text(encoding='utf-8'))
    policy_hash=hashlib.sha256(json.dumps(policy,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode('utf-8')).hexdigest()
    from vocal_lyric_classifier import policy_key
    return [ALGORITHM, 'lyric-credit-policy:'+policy_hash, policy_key()] + sorted(registry['files'])


def lyrics_key(lyrics):
    if not isinstance(lyrics, str) or len(lyrics) > 1024 * 1024:
        raise ValueError('请先加载带时间的原文歌词，再生成简谱')
    rows = json.loads(lyrics)
    if not isinstance(rows, list) or not rows or len(rows) > 2000:
        raise ValueError('没有可用于对齐的歌词')
    return hashlib.sha256(lyrics.encode('utf-8')).hexdigest()


_instances = {}


def runtime(home):
    from resident_child import ResidentChild
    home = Path(home)
    from study_bootstrap import paths
    python = Path(paths().get('vocalPython') or home / 'runtime-vocal2midi' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'))
    if not python.is_file():
        raise ValueError('人声简谱环境未安装')
    identifier = str(home)
    child = _instances.get(identifier)
    if child is None or child.child.poll() is not None:
        child = ResidentChild(python, Path(__file__).with_name('vocal_runtime.py'))
        _instances[identifier] = child
    return child


def release_runtime():
    for child in _instances.values():
        child.close()
    _instances.clear()


def existing_runtime_call(method):
    """Housekeeping must never launch an unused vocal environment."""
    child = next((value for value in _instances.values() if value.child.poll() is None), None)
    return child.call(method, {}, lambda *args: None) if child else None


def invoke(phase, *, model_pack, progress, directory, payload):
    return runtime(str(Path(model_pack).parent)).call(phase,
        {**payload, 'pack': str(model_pack), 'directory': str(directory), 'componentPaths': __import__('study_bootstrap').paths()}, progress)


def recognize(*, model_pack, progress, lyrics, directory, previous=None, parent=''):
    reusable = {key: previous[key] for key in ('algorithm','notes','reuse') if key in (previous or {})}
    return invoke('notes', model_pack=model_pack, progress=progress,
                  directory=directory, payload={'lyrics': lyrics, 'previous': reusable, 'parent': parent})


def render_score(melody, *, model_pack, progress, lyrics, directory, previous=None):
    return invoke('score', model_pack=model_pack, progress=progress, directory=directory,
                  payload={'notes': melody['notes'], 'lines': json.loads(lyrics), 'previous': previous or []})


def export_sources(melody, lines, destination, *, model_pack):
    return invoke('sources', model_pack=model_pack, progress=lambda *args: None, directory=destination,
                  payload={'notes': melody['notes'], 'lines': lines, 'tempo': melody.get('tempo', 120)})
