"""Result persistence is a Core responsibility, including failed-stage recovery."""
import copy
import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import soundfile as sf
from worker import analyze, pcm_digest, json_digest


class WorkerStageTests(unittest.TestCase):
    def test_identity_ignores_float_wav_header_metadata_and_json_numeric_spelling(self):
        self.assertEqual(json_digest({'start': 1.0, 'nested': [2.0, 2.5]}), json_digest({'nested': [2, 2.5], 'start': 1}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'a.wav'
            samples = np.ones((441, 2), dtype=np.float32) * .02
            sf.write(path, samples, 44100, subtype='FLOAT')
            before = pcm_digest(path)
            raw = bytearray(path.read_bytes())
            position = raw.index(b'PEAK') + 12
            raw[position:position + 4] = (123456).to_bytes(4, 'little')
            path.write_bytes(raw)
            self.assertEqual(pcm_digest(path), before)

    def fixture(self, directory):
        root = Path(directory) / 'audio'
        root.mkdir()
        source = Path(directory) / 'input.wav'
        wave = np.ones((2, 4410), dtype=np.float32) * .02
        sf.write(source, wave.T, 44100, subtype='FLOAT')
        calls, events, current = [], [], {}
        def six(audio, *args):
            calls.append('six')
            return {s: audio.copy() for s in ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']}
        def chords(*args, **kwargs):
            calls.append('chords')
            return dict(segments=[dict(start=0, end=.1, label='C', confidence='unrated', candidates=[])], tuningCents=None, algorithm='test')
        def melody(**kwargs):
            calls.append('notes')
            return dict(algorithm='vocal2midi-tifa-game-medium-rhythm-v10', notes=[dict(start=0, end=.1, midi=60)], key=None, source='vocals')
        def score(*args, **kwargs):
            calls.append('score')
            return [dict(lineId=0, text='test', svg='<svg/>')]
        modules = dict(torch=types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda: False)),
            separation=types.SimpleNamespace(read_audio=lambda p: sf.read(p, dtype='float32', always_2d=True)[0].T,
                six_stems=six, lead_backing=lambda a, *args: {'lead': a * .6, 'backing': a * .4},
                two_singers=lambda a, *args, **kwargs: {'singerA': a * .6, 'singerB': a * .4}),
            harmony=types.SimpleNamespace(analyze_files=chords),
            vocal_melody=types.SimpleNamespace(recognize=melody, render_score=score))
        request = dict(directory=str(root), source=str(source), pack=str(root),
                       lyrics='[{"id":0,"start":0,"end":0.1,"text":"test"}]')
        def event(value):
            events.append(copy.deepcopy(value))
            if value['kind'] == 'stageReady':
                current.clear(); current.update(copy.deepcopy(value['result']))
        def decode(source, target, *args, **kwargs):
            values, rate = sf.read(source, dtype='float32', always_2d=True)
            if len(values) > kwargs['max_frames']:
                raise ValueError('音频缓存容量不足')
            sf.write(target, values, rate, subtype='FLOAT')
        def run(**kwargs):
            with patch.dict('sys.modules', modules), patch('worker.emit', event), patch('worker.decode', decode):
                return analyze({**request, 'previous': copy.deepcopy(current), **kwargs})
        return root, calls, modules, events, current, run

    def test_six_publishes_before_chords_without_durable_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root, calls, _, events, result, run = self.fixture(directory)
            run()
            self.assertEqual(calls, ['six', 'chords'])
            ready = [e for e in events if e['kind'] == 'stageReady']
            self.assertEqual(ready[0]['result']['ready'], ['six'])
            self.assertEqual(result['ready'], ['six', 'chords'])
            self.assertEqual(list(root.glob('*.json')), [])

    def test_chord_failure_keeps_six_and_retry_reuses_models_output(self):
        with tempfile.TemporaryDirectory() as directory:
            _, calls, modules, _, result, run = self.fixture(directory)
            good = modules['harmony'].analyze_files
            modules['harmony'].analyze_files = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('chord failure'))
            with self.assertRaisesRegex(RuntimeError, 'chord failure'):
                run()
            self.assertEqual(result['ready'], ['six'])
            modules['harmony'].analyze_files = good
            run()
            self.assertEqual(calls.count('six'), 1)
            self.assertTrue(result['timings']['six']['cacheHit'])

    def test_melody_then_audio_eviction_does_not_rerun_recognition(self):
        with tempfile.TemporaryDirectory() as directory:
            root, calls, _, _, result, run = self.fixture(directory)
            run(operation='melody')
            for path in root.glob('*.wav'):
                path.unlink()
            result['ready'].remove('six')
            run(operation='melody')
            self.assertEqual(calls, ['six', 'notes', 'score'])
            self.assertFalse((root / 'original.wav').exists())
            result['cache']['signatures'].pop('score')
            run(operation='melody')
            self.assertEqual(calls, ['six', 'notes', 'score', 'score'])
            self.assertFalse((root / 'original.wav').exists())

    def test_restoring_audio_keeps_chords_and_notes(self):
        with tempfile.TemporaryDirectory() as directory:
            root, calls, _, _, result, run = self.fixture(directory)
            run(); run(operation='melody')
            notes = copy.deepcopy(result['melody'])
            for path in root.glob('*.wav'):
                path.unlink()
            result['ready'] = ['chords', 'melody']
            run()
            self.assertEqual(calls.count('six'), 2)
            self.assertEqual(calls.count('chords'), 1)
            self.assertEqual(calls.count('notes'), 1)
            self.assertEqual(result['melody'], notes)

    def test_failed_layout_publishes_notes_and_only_layout_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            _, calls, modules, _, result, run = self.fixture(directory)
            good = modules['vocal_melody'].render_score
            modules['vocal_melody'].render_score = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('engraving failed'))
            with self.assertRaisesRegex(RuntimeError, 'engraving failed'):
                run(operation='melody')
            self.assertIn('notes', result['cache']['signatures'])
            self.assertNotIn('melody', result['ready'])
            modules['vocal_melody'].render_score = good
            run(operation='melody')
            self.assertEqual(calls.count('notes'), 1)
            self.assertIn('melody', result['ready'])

    def test_changed_lyrics_only_recompute_notes_and_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            _, calls, _, _, _, run = self.fixture(directory)
            run(); run(operation='melody')
            run(operation='melody', lyrics='[{"id":0,"start":0,"end":0.1,"text":"changed"}]')
            self.assertEqual(calls.count('six'), 1)
            self.assertEqual(calls.count('chords'), 1)
            self.assertEqual(calls.count('notes'), 2)

    def test_budget_rejects_before_writing_separation(self):
        with tempfile.TemporaryDirectory() as directory:
            _, calls, _, _, _, run = self.fixture(directory)
            with self.assertRaisesRegex(ValueError, '容量不足'):
                run(budgetBytes=1024)
            self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
