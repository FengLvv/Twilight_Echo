from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch,Mock
import json

from vocal_lyric_classifier import filter_lyrics,LyricLineClassifier,release_classifier
from vocal_pipeline import prepare_lyrics


class LyricClassifierTests(unittest.TestCase):
    def tearDown(self): release_classifier()

    def test_nonfinite_model_outputs_preserve_the_input(self):
        import numpy as np
        from types import SimpleNamespace
        model=LyricLineClassifier.__new__(LyricLineClassifier)
        model.np=np;model.threshold=.999
        model.tokenizer=Mock(encode=lambda text:SimpleNamespace(ids=[1],attention_mask=[1]))
        model.session=Mock(run=lambda *args:[np.array([[float('nan'),1]])])
        self.assertTrue(model.is_lyric('保留不确定的歌词'))

    def test_model_is_reused_and_each_unique_line_is_inferred_only_once(self):
        model=Mock(threshold=.999,is_lyric=Mock(side_effect=lambda text:text=='演唱歌词'))
        rows=[dict(id=i,text=text) for i,text in enumerate(['演唱歌词','未知署名','演唱歌词'])]
        with patch('vocal_lyric_classifier.LyricLineClassifier',return_value=model) as create:
            kept,excluded,first=filter_lyrics(rows,Path('models'))
            _,_,second=filter_lyrics(rows,Path('models'))
        self.assertEqual([row['id'] for row in kept],[0,2])
        self.assertEqual(excluded,[dict(id=1,reason='non_lyric_classifier')])
        self.assertEqual(first['candidates'],[1])
        self.assertEqual(first['uniqueLines'],2)
        self.assertFalse(first['reused']);self.assertTrue(second['reused'])
        self.assertEqual(create.call_count,1)
        self.assertEqual(model.is_lyric.call_count,4)

    def test_rejecting_every_line_abstains_instead_of_emptying_the_song(self):
        with patch('vocal_lyric_classifier.LyricLineClassifier',return_value=Mock(threshold=.999,is_lyric=lambda text:False)):
            rows=[dict(id=2,text='不确定的文字')]
            kept,excluded,info=filter_lyrics(rows,Path('models'))
        self.assertEqual(kept,rows);self.assertEqual(excluded,[])
        self.assertTrue(info['abstained'])

    def test_missing_and_corrupt_weights_fail_before_any_session_load(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'未安装'):LyricLineClassifier(directory)
            from vocal_lyric_classifier import policy
            target=Path(directory)/policy()['directory'];target.mkdir()
            (target/'lyric-line.onnx').write_bytes(b'bad')
            with self.assertRaisesRegex(ValueError,'校验失败'):LyricLineClassifier(directory)

    def test_vocal_activity_protects_interior_rows_and_only_exterior_candidates_narrow_the_margin(self):
        rows=[dict(id=0,start=4.5,end=4.7,text='Unknown intro'),dict(id=1,start=5,end=6,text='真正演唱'),
              dict(id=2,start=6,end=6.8,text='确定演唱'),dict(id=3,start=7,end=7.2,text='Unknown outro')]
        candidates=[dict(id=i,reason='non_lyric_classifier') for i in [0,1,3]]
        info=dict(candidates=[0,1,3],elapsedMs=0)
        with patch('vocal_lyric_classifier.filter_lyrics',return_value=(rows[2:3],candidates,info)), \
             patch('vocal_activity.detect_vocal_activity',return_value=dict(status='estimated',start=5,end=7,margin=.8)):
            kept,policy,_=prepare_lyrics(json.dumps(rows),8,Path('audio'),Path('models'))
        self.assertEqual(kept,rows[1:3])
        self.assertEqual(policy['classifier']['protected'],[1])
        self.assertEqual(policy['classifier']['rejected'],2)
        self.assertEqual({row['id'] for row in policy['excluded']},{0,3})

    def test_uncertain_activity_cannot_authorize_a_model_candidate_deletion(self):
        rows=[dict(id=0,start=0,end=1,text='Unknown'),dict(id=1,start=2,end=3,text='演唱歌词')]
        info=dict(candidates=[0],elapsedMs=0)
        with patch('vocal_lyric_classifier.filter_lyrics',return_value=(rows[1:],[dict(id=0,reason='non_lyric_classifier')],info)), \
             patch('vocal_activity.detect_vocal_activity',return_value=dict(status='uncertain',start=None,end=None,margin=.8)):
            kept,policy,_=prepare_lyrics(json.dumps(rows),4,Path('audio'),Path('models'))
        self.assertEqual(kept,rows);self.assertEqual(policy['excluded'],[])
        self.assertEqual(policy['classifier']['protected'],[0])


if __name__=='__main__':unittest.main()
