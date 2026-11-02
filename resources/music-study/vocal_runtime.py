"""Resident lyric alignment and engraving, preserving dependency isolation."""
from pathlib import Path
import sys
import tempfile
import json
import os

from runtime_context import check_cancel, emit


def execute(method, params):
    if 'componentPaths' in params:
        os.environ['TWILIGHT_STUDY_COMPONENT_PATHS'] = json.dumps(params['componentPaths'])
    def report(value, stage):
        check_cancel()
        emit(dict(kind='progress', progress=value, stage=stage))
    if method == 'notes':
        from vocal_pipeline import run
        return run(params, report)
    if method == 'score':
        from vocal_score import engrave
        # All LilyPond/MusicXML/MIDI intermediates die with this job.
        with tempfile.TemporaryDirectory(prefix='study-score-') as work:
            return engrave(params['notes'], params['lines'], Path(work), Path(params['pack']).parent, report, params.get('previous'))
    if method == 'sources':
        from music21 import stream
        from vocal_score import phrase_part
        sys.path.insert(0, str(Path(__file__).parent / 'vendor/vocal2midi'))
        from inference.io.note_io import NoteInfo, _save_midi
        root = Path(params['directory'])
        root.mkdir(parents=True, exist_ok=True)
        notes = params['notes']
        _save_midi([NoteInfo(n['start'], n['end'], n['midi'], n.get('lyric', '')) for n in notes],
                   root / 'vocal-raw.mid', tempo=params['tempo'])
        for line in params['lines']:
            check_cancel()
            rows = [(i, n) for i, n in enumerate(notes) if n['lineId'] == line['id']]
            if not rows:
                continue
            part, _ = phrase_part(rows)
            seen = set()
            for note in part.recurse().notes:
                index = note.editorial['vocalIndex']
                note.pitch.midi = notes[index]['midi']
                if index not in seen and notes[index].get('lyric'):
                    note.addLyric(notes[index]['lyric'])
                seen.add(index)
            score = stream.Score()
            score.append(part)
            score.write('musicxml', fp=str(root / f'line-{line["id"]}.musicxml'))
        return True
    raise ValueError('未知人声运行时方法')


def dispatch(method, params):
    from model_residency import snapshot, standby
    if method == 'residency':
        return snapshot()
    if method == 'standby':
        from vocal_lyric_classifier import release_classifier
        release_classifier()
        return standby()
    try:
        return execute(method, params)
    finally:
        if method == 'notes':
            from model_residency import release_unused_cuda
            release_unused_cuda()


if __name__ == '__main__':
    import scipy.linalg
    from librosa import resample
    from resident_protocol import serve
    serve(dispatch)
