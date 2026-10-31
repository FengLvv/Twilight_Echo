import json
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import soundfile as sf
from worker import analyze


class WorkerStageTests(unittest.TestCase):
    def fixture(self, root, fail_chords=False):
        calls = []
        wave = np.ones((2, 4410), dtype=np.float32) * .02
        sf.write(root/'original.wav', wave.T, 44100, subtype='FLOAT')
        def six(audio, pack, device, report):
            calls.append('six')
            return {s: audio.copy() for s in ['vocals','drums','bass','guitar','piano','other']}
        def voices(audio, pack, report):
            calls.append('leadBacking')
            return {'lead':audio*.6,'backing':audio*.4}
        def duet(audio, pack, device, report, identity_report):
            calls.append('twoSingers')
            return {'singerA':audio*.6,'singerB':audio*.4}
        def chords(files, **kwargs):
            calls.append('chords')
            if fail_chords: raise RuntimeError('chord failure')
            return {'segments':[{'start':0,'end':.1,'label':'C','confidence':'unrated','candidates':[]}], 'tuningCents':None,'algorithm':'test'}
        modules = {'torch':types.SimpleNamespace(cuda=types.SimpleNamespace(is_available=lambda:False)),
            'separation':types.SimpleNamespace(read_audio=lambda p:sf.read(p,dtype='float32',always_2d=True)[0].T,
                six_stems=six,lead_backing=voices,two_singers=duet),
            'harmony':types.SimpleNamespace(analyze_files=chords)}
        return calls, modules, {'directory':str(root),'pack':str(root),'source':'unused','lyrics':'[{"id":0,"start":0,"end":0.1,"text":"test"}]'}

    def test_default_publishes_six_before_chords_and_runs_no_vocal_subdivision(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls,modules,request=self.fixture(root)
            published=[]
            def event(value):
                if value['kind']=='stageReady':
                    result=json.loads((root/'result.json').read_text())
                    published.append((value['phase'],list(calls),result['ready']))
            with patch.dict('sys.modules',modules),patch('worker.emit',event): analyze(request)
            self.assertEqual(calls,['six','chords'])
            self.assertEqual(published[0],('six',['six'],['six']))
            self.assertEqual(published[-1][0],'chords')

    def test_chord_failure_leaves_six_playable_and_retry_reuses_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls,modules,request=self.fixture(root,True)
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                with self.assertRaisesRegex(RuntimeError,'chord failure'): analyze(request)
            self.assertEqual(json.loads((root/'result.json').read_text())['ready'],['six'])
            modules['harmony'].analyze_files=lambda *a,**k:{'segments':[],'algorithm':'test','tuningCents':None}
            with patch.dict('sys.modules',modules),patch('worker.emit'): analyze(request)
            self.assertEqual(calls.count('six'),1)
            self.assertTrue(json.loads((root/'result.json').read_text())['timings']['six']['cacheHit'])

    def test_melody_is_requested_independently_and_reuses_vocal_and_melody_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls,modules,request=self.fixture(root)
            def melody(**kwargs):
                calls.append('melody')
                return {'algorithm':'test','notes':[{'start':0,'end':.1,'midi':60}], 'key':None,'source':'vocals'}
            def score(*args,**kwargs):calls.append('score');return []
            modules['vocal_melody']=types.SimpleNamespace(recognize=melody,render_score=score)
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                analyze(request)
                self.assertNotIn('melody',calls)
                analyze({**request,'operation':'melody'})
                analyze({**request,'operation':'melody'})
            self.assertEqual(calls,['six','chords','melody','score'])
            result=json.loads((root/'result.json').read_text())
            self.assertIn('melody',result['ready'])
            self.assertTrue(result['timings']['melody']['cacheHit'])
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                analyze({**request,'operation':'melody','lyrics':request['lyrics'].replace('test','changed')})
            self.assertEqual(calls.count('melody'),2)
            self.assertEqual(calls.count('six'),1)
            self.assertEqual(calls.count('chords'),1)
            self.assertEqual(calls.count('score'),2)
            (root/'vocal-score.json').unlink()
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                analyze({**request,'operation':'melody','lyrics':request['lyrics'].replace('test','changed')})
            self.assertEqual(calls.count('melody'),2)
            self.assertEqual(calls.count('score'),3)

    def test_melody_can_prepare_six_without_chords_and_later_analysis_reuses_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls,modules,request=self.fixture(root)
            def melody(**kwargs):
                calls.append('melody')
                return {'algorithm':'test','notes':[], 'key':None,'source':'vocals'}
            def score(*args,**kwargs):calls.append('score');return []
            modules['vocal_melody']=types.SimpleNamespace(recognize=melody,render_score=score)
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                analyze({**request,'operation':'melody'})
                self.assertEqual(calls,['six','melody','score'])
                self.assertEqual(json.loads((root/'result.json').read_text())['ready'],['six','melody'])
                analyze(request)
            self.assertEqual(calls,['six','melody','score','chords'])

    def test_failed_score_layout_preserves_recognition_for_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls,modules,request=self.fixture(root)
            def melody(**kwargs):
                calls.append('melody')
                return {'algorithm':'test','notes':[{'start':0,'end':.1,'midi':60}],'key':None,'source':'vocals'}
            def score(*args,**kwargs):
                calls.append('score')
                if calls.count('score')==1:raise RuntimeError('engraving failed')
                return []
            modules['vocal_melody']=types.SimpleNamespace(recognize=melody,render_score=score)
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                with self.assertRaisesRegex(RuntimeError,'engraving failed'):
                    analyze({**request,'operation':'melody'})
                self.assertTrue((root/'vocal-notes.json').is_file())
                self.assertFalse((root/'vocal-score.json').exists())
                analyze({**request,'operation':'melody'})
            self.assertEqual(calls,['six','melody','score','score'])
            self.assertIn('melody',json.loads((root/'result.json').read_text())['ready'])

    def test_vocal_subdivision_reuses_six_and_keeps_chords_without_recognition(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls,modules,request=self.fixture(root)
            with patch.dict('sys.modules',modules),patch('worker.emit'):
                analyze(request)
                analyze({**request,'operation':'leadBacking'})
                analyze({**request,'operation':'twoSingers'})
            self.assertEqual(calls,['six','chords','leadBacking','twoSingers'])
            result=json.loads((root/'result.json').read_text())
            self.assertEqual(len(result['stems']),10)
            self.assertEqual(result['chords']['segments'][0]['label'],'C')


if __name__=='__main__': unittest.main()
