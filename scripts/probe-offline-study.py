"""Exercise imports, multilingual pronunciation and engraving with network denied."""
from pathlib import Path
import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile


def offline(*_args, **_kwargs):
    raise RuntimeError('Network is disabled in the offline distribution probe')


def probe(root, role):
    socket.socket.connect = offline
    import numpy as np
    import torch
    import onnxruntime as ort
    def normalized(path):
        value = str(Path(path).resolve())
        return Path(value[4:] if value.startswith('\\\\?\\') else value)
    assert normalized(torch.__file__).is_relative_to(root / 'music-study-runtime/shared-python')
    assert sys.flags.isolated and sys.flags.utf8_mode
    assert all(not value or normalized(value).is_relative_to(root) for value in sys.path)
    if role == 'runtime':
        import audio_diffusion_pytorch
        import demucs
        import speechbrain
        import transformers
        assert np.__version__.startswith('2.')
    else:
        sys.path.insert(0, str(root / 'resources/music-study/vendor/vocal2midi'))
        import pyopenjtalk
        from librosa import resample
        from inference.TiFA.g2p_pipeline import build_g2p_pipeline
        from vocal_score import engrave
        home = root / 'music-study-runtime'
        assert np.__version__.startswith('1.26.')
        assert pyopenjtalk.run_frontend('明日')
        g2p = build_g2p_pipeline(home / 'models/vocal2midi/tifa', japanese_g2p_engine='pyopenjtalk')
        words = g2p.convert('梦一样的自由 Say hello', languages=['zh', 'en'])
        assert len(words) > 0
        with tempfile.TemporaryDirectory(prefix='release-engraving-') as work:
            notes = [dict(start=0, end=.5, midi=60, lineId=0, lyric='梦', beat=0, durationBeats=1),
                     dict(start=.5, end=1, midi=62, lineId=0, lyric='遊', beat=1, durationBeats=1)]
            scores = engrave(notes, [dict(id=0, start=0, end=1, text='梦遊')], Path(work), home, lambda *_: None)
            assert len(scores) == 1 and '<svg' in scores[0]['svg']
    return dict(role=role, python=sys.version.split()[0], isolated=True, utf8=True,
                numpy=np.__version__, torch=torch.__version__, onnxruntime=ort.__version__, network=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path)
    parser.add_argument('--role', choices=('runtime', 'runtime-vocal2midi'))
    args = parser.parse_args()
    if args.role:
        print(json.dumps(probe(args.root.resolve(), args.role), ensure_ascii=False), flush=True)
    else:
        for role in ('runtime', 'runtime-vocal2midi'):
            python = args.root / f'music-study-runtime/{role}/Scripts/python.exe'
            environment = {**os.environ, 'PYTHONHOME': 'Z:/not-a-python', 'PYTHONPATH': 'Z:/not-packages',
                           'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1'}
            subprocess.run([str(python.resolve()), '-X', 'utf8', str(Path(__file__).resolve()),
                            str(args.root.resolve()), '--role', role], cwd=tempfile.gettempdir(), env=environment, check=True)
