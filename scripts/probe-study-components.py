"""Probe the assembled component environments with Python networking denied."""
from pathlib import Path
import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile


def probe(root, role):
    def denied(*_args, **_kwargs):
        raise RuntimeError('Network disabled during component release probe')
    socket.socket.connect = denied
    import numpy
    import torch
    import torchaudio
    import onnxruntime
    from study_bootstrap import paths
    value = paths()
    if role == 'engine-vocal':
        import pyopenjtalk
        assert pyopenjtalk.run_frontend('夢遊')
        from vocal_pipeline import prepare_lyrics
        rows = [dict(id=0, start=0, end=1, text='夢遊', origin=dict(format='amll-ttml', kind='lyric'))]
        lines, status, _ = prepare_lyrics(json.dumps(rows), 1, Path('missing-audio'), Path('missing-models'))
        assert status['mode'] == 'structured' and status['activity']['status'] == 'skipped'
        from vocal_score import engrave
        with tempfile.TemporaryDirectory(prefix='component-score-probe-') as work:
            notes = [dict(start=0, end=.5, midi=60, lineId=0, wordId=0, lyric='夢', beat=0, durationBeats=1),
                     dict(start=.5, end=1, midi=62, lineId=0, wordId=1, lyric='遊', beat=1, durationBeats=1)]
            scores = engrave(notes, lines, Path(work), root, lambda *_: None)
            assert scores and '<svg' in scores[0]['svg']
    assert value.get('sharedPython')
    return dict(role=role, python=sys.version.split()[0], numpy=numpy.__version__, torch=torch.__version__,
                torchaudio=torchaudio.__version__, onnxruntime=onnxruntime.__version__, network=False, componentPaths=True)


def run(root):
    home = root / 'analysis-components'
    entries = json.loads((home / 'installed.json').read_text(encoding='utf-8'))
    directories = {entry['id']: home / entry['directory'] for entry in entries if entry['phase'] == 'ready'}
    source = Path(__file__).resolve().parents[1] / 'src/main/audio/studyRuntimeView.ts'
    descriptors = {entry['id']: dict(directory=str(home / entry['directory']), version=entry['version']) for entry in entries if entry['phase'] == 'ready'}
    code = f"import {{resolveStudyRuntimeView}} from {json.dumps(source.as_uri())};process.stdout.write(JSON.stringify(await resolveStudyRuntimeView(JSON.parse(process.argv[1]),process.argv[2])));"
    aliases = json.loads(subprocess.check_output(['node', '--experimental-strip-types', '--input-type=module', '-e', code, json.dumps(descriptors), tempfile.gettempdir()], text=True))
    directories = {key: Path(value) for key, value in aliases.items()}
    script = Path(__file__).resolve()
    resources = root / 'resources/music-study'
    value = dict(python=str(directories['engine-main'] / 'runtime/Scripts/python.exe'),
                 vocalPython=str(directories['engine-vocal'] / 'runtime-vocal2midi/Scripts/python.exe'),
                 sharedPython=str(directories['engine-torch'] / 'shared-python/site-packages'),
                 notationHome=str(directories['lilypond']), models={})
    for role in ('engine-main', 'engine-vocal'):
        python = value['python' if role == 'engine-main' else 'vocalPython']
        executable = '\\\\?\\' + os.path.abspath(python) if os.name == 'nt' else python
        code = 'import sys;sys.path.insert(0,sys.argv.pop(1));from study_bootstrap import run;run()'
        environment = {**os.environ, 'TWILIGHT_STUDY_COMPONENT_PATHS': json.dumps(value),
                       'TWILIGHT_STUDY_RUNTIME_ROLE': 'vocal' if role == 'engine-vocal' else 'main',
                       'PYTHONHOME': 'Z:/no-python', 'PYTHONPATH': 'Z:/no-packages',
                       'PYTHONNOUSERSITE': '1', 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'}
        subprocess.run([executable, '-X', 'utf8', '-c', code, str(resources), str(script), str(root), '--role', role], executable=executable,
                       cwd=tempfile.gettempdir(), env=environment, check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--role', choices=('engine-main', 'engine-vocal'))
    args = parser.parse_args()
    if args.role:
        print(json.dumps(probe(args.root.resolve(), args.role), ensure_ascii=False), flush=True)
    else:
        run(args.root.resolve())
