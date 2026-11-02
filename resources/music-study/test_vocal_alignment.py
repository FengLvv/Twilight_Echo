import json
from pathlib import Path
import sys
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).parent/'vendor/vocal2midi'))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'scripts'))
from inference.TiFA.evidence import token_evidence
from lyric_alignment_evidence import summarize_lines
from vocal_pipeline import validate_lines


class AcousticEvidenceTests(unittest.TestCase):
    def test_skipped_tokens_are_measured_before_minimum_duration_repairs(self):
        sim = np.array([[.6, .1, 0], [.4, .2, 0], [.1, .1, 0]], dtype=np.float32)
        tokens = token_evidence(sim, np.array([[0, 2], [3, 3], [3, 3]]), [1, 1, 2], .01)
        self.assertEqual(tokens[1]['frames'], 0)
        self.assertIsNone(tokens[1]['similarity'])
        rows = summarize_lines(tokens, {0: 7, 1: 8}, [dict(id=7,start=10,end=11),dict(id=8,start=11,end=12)], 10)
        self.assertEqual(rows[0]['coverage'], .5)
        self.assertEqual(rows[0]['meanSimilarity'], .5)
        self.assertEqual(rows[0]['status'], 'review')
        self.assertEqual(rows[1]['alignedTokens'], 0)
        self.assertIn('no_aligned_phonemes', rows[1]['reasons'])

    def test_audio_offsets_and_window_mismatch_are_not_confused_with_silent_tokens(self):
        tokens = [dict(word=0,start=1,end=2,frames=100,similarity=.4),
                  dict(word=1,start=2,end=3,frames=100,similarity=.4)]
        rows = summarize_lines(tokens, {0: 10,1: 11}, [dict(id=10,start=31,end=32),dict(id=11,start=35,end=36)], 30)
        self.assertEqual(rows[0]['insideRatio'], 1)
        self.assertEqual(rows[0]['status'], 'measured')
        self.assertEqual(rows[1]['insideRatio'], 0)
        self.assertEqual(rows[1]['reasons'], ['outside_lyric_window'])

    def test_nonfinite_similarity_and_punctuation_only_rows_remain_explicit_and_json_safe(self):
        tokens = token_evidence(np.array([[float('nan')]]), np.array([[0,1]]), [1], .01)
        rows = summarize_lines(tokens, {0: 1}, [dict(id=1,start=0,end=1),dict(id=2,start=1,end=2)], 0)
        json.dumps(rows, allow_nan=False)
        self.assertEqual(rows[1]['status'], 'unavailable')
        self.assertIsNone(rows[1]['meanSimilarity'])
        with self.assertRaises(ValueError): token_evidence(np.ones((2,1)), np.array([[0,3]]), [1], .01)

    def test_metadata_semantics_are_independent_of_the_credit_vocabulary(self):
        rows = [dict(id=0,start=0,end=1,text='Previously unknown attribution',origin=dict(format='netease-json',kind='metadata')),
                dict(id=1,start=1,end=2,text='I love you',origin=dict(format='netease-json',kind='unknown'))]
        excluded=[]
        self.assertEqual(validate_lines(json.dumps(rows),3,excluded), rows[1:])
        self.assertEqual(excluded,[dict(id=0,reason='source_metadata')])
        rows[0]['origin']['format']='untrusted-guess'
        with self.assertRaisesRegex(ValueError,'来源信息'): validate_lines(json.dumps(rows),3)

if __name__ == '__main__': unittest.main()
