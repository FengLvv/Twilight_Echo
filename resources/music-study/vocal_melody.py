"""Isolated Vocal2Midi process; the analysis environment keeps its own dependencies."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import sys

ALGORITHM = 'vocal2midi-tifa-game-medium-rhythm-v1'

def model_keys():
    registry = json.loads(Path(__file__).with_name('vocal_models.json').read_text(encoding='utf-8'))
    return [ALGORITHM] + sorted(registry['files'])

def lyrics_key(lyrics):
    if not isinstance(lyrics, str) or len(lyrics) > 1024 * 1024:
        raise ValueError('请先加载带时间的原文歌词，再生成简谱')
    rows = json.loads(lyrics)
    if not isinstance(rows, list) or not rows or len(rows) > 2000:
        raise ValueError('没有可用于对齐的歌词')
    return hashlib.sha256(lyrics.encode('utf-8')).hexdigest()

def invoke(script, phase, *, model_pack, progress, directory, payload):
    """Independent native jobs share process isolation, never each other's cache."""
    root = Path(directory)
    home = Path(model_pack).parent
    python = home/'runtime-vocal2midi'/('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not python.is_file():
        raise ValueError('人声简谱环境未安装，请运行 install-music-study.ps1 安装简谱组件')
    request = root/f'vocal-{phase}-request.json'
    result_path = root/f'vocal-{phase}-result.json'
    (root/f'vocal-{phase}-error.txt').unlink(missing_ok=True)
    result_path.unlink(missing_ok=True)
    payload={**payload,'pack':str(model_pack),'directory':str(root)}
    request.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
    try:
        with subprocess.Popen([str(python),str(Path(__file__).with_name(script)),str(request)],
                stdout=subprocess.PIPE, text=True, encoding='utf-8',
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0) as child:
            for line in child.stdout:
                try:
                    value = json.loads(line)
                    if value.get('kind') == 'progress': progress(value['progress'],value['stage'])
                except (ValueError,KeyError):
                    print(line.rstrip()[:1000],file=sys.stderr)
            code = child.wait()
        if code:
            error_path=root/f'vocal-{phase}-error.txt'
            raise ValueError(error_path.read_text(encoding='utf-8')[:1600] if error_path.exists() else '人声简谱生成失败')
        return json.loads(result_path.read_text(encoding='utf-8'))
    finally:
        request.unlink(missing_ok=True)
        result_path.unlink(missing_ok=True)


def recognize(*, model_pack, progress, lyrics, directory):
    return invoke('vocal_pipeline.py','notes',model_pack=model_pack,progress=progress,
        directory=directory,payload={'lyrics':lyrics})


def render_score(melody, *, model_pack, progress, lyrics, directory):
    return invoke('vocal_score.py','score',model_pack=model_pack,progress=progress,
        directory=directory,payload={'notes':melody['notes'],'lines':json.loads(lyrics)})
