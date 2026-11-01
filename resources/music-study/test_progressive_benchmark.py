"""Guard M0 measurements against missing ranges and inflated denominators."""
import unittest
import json
from pathlib import Path
import tempfile

from benchmark_progressive import CONTEXTS, chord_windows, crop, inference_identity
from progressive_m0_report import summarize


class WindowTests(unittest.TestCase):
    def test_every_source_frame_accepted_exactly_once(self):
        for duration in (0.1, 7.8, 28, 120, 253.04, 357.2, 950):
            frames, rate = round(duration * 44100), 44100
            for context in CONTEXTS:
                windows = list(chord_windows(frames, rate, context))
                cursor = 0
                for window in windows:
                    self.assertEqual(cursor, window['start'])
                    self.assertLess(window['start'], window['end'])
                    self.assertLessEqual(window['inputStart'], window['start'])
                    self.assertGreaterEqual(window['inputEnd'], window['end'])
                    self.assertLessEqual(window['inputEnd'] - window['inputStart'], context * rate)
                    self.assertGreaterEqual(window['inputStart'], 0)
                    self.assertLessEqual(window['inputEnd'], frames)
                    cursor = window['end']
                self.assertEqual(cursor, frames)

    def test_grid_does_not_depend_on_requested_position(self):
        full = list(chord_windows(44100 * 600, 44100, 60))
        self.assertEqual(full[5], dict(start=6615000, end=7938000,
                                      inputStart=5953500, inputEnd=8599500))

    def test_crop_clips_absolute_time_without_adding_unknown_coverage(self):
        original = [dict(start=0, end=3, label='C'), dict(start=3, end=7, label='G')]
        clipped = crop(original, 12, 18, 10)
        self.assertEqual(clipped, [dict(start=12, end=13, label='C'), dict(start=13, end=17, label='G')])
        self.assertEqual(original[0]['start'], 0)

    def test_only_adjacent_identical_labels_merge(self):
        segments = [dict(start=0, end=1, label='C'), dict(start=1, end=2, label='C'),
                    dict(start=3, end=4, label='C')]
        self.assertEqual(crop(segments, 0, 5), [dict(start=0, end=2, label='C'), dict(start=3, end=4, label='C')])

    def test_report_reuses_original_timing_once_per_distinct_input(self):
        metric = dict(common_exact=dict(matched=27., seconds=30.))
        candidate = dict(calls=[dict(key='same', seconds=None), dict(key='same', seconds=None)],
                         **{name: metric for name in ('metrics', 'firstMetrics', 'baselineFirstMetrics',
                                                     'seamMetrics', 'baselineSeamMetrics')})
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'predictions').mkdir()
            (root / 'predictions/same.json').write_text(json.dumps(dict(seconds=3.)))
            (root / 'chords.json').write_text(json.dumps(dict(encoderSeconds=300, files=[
                dict(dataset='fixture', duration=30., baseline=dict(metrics=metric), candidates={'15': candidate})])))
            result = summarize(root / 'chords.json', .03)['datasets']['fixture']['candidates']['15']
        self.assertEqual(result['measuredComputeSeconds'], 3.)
        self.assertEqual(result['distinctInputCalls'], 1)
        self.assertAlmostEqual(result['serialSixPlusChordRtfEstimate'], .13)
        self.assertTrue(result['qualityWithinOnePoint'])

    def test_inference_cache_follows_models_and_decoder_but_not_scorer(self):
        original = dict(protocol='m0', weights={'model': 'a'}, source={
            'sheetsage_harmony.py': 'b', 'vendor/decoder.py': 'c', 'benchmark_chords.py': 'd'})
        changed = dict(original, source=dict(original['source'], **{'benchmark_chords.py': 'e'}))
        self.assertEqual(inference_identity(original), inference_identity(changed))
        changed['source']['vendor/decoder.py'] = 'different'
        self.assertNotEqual(inference_identity(original), inference_identity(changed))

    def test_all_model_qualities_are_valid_for_evaluation_including_inversions(self):
        import mir_eval
        from sheetsage_harmony import QUALITIES, display_label
        from benchmark_chords import harte
        for quality in QUALITIES:
            for bass in ('', '/5'):
                source = 'B:' + quality + bass
                target = harte(display_label(source))
                mir_eval.chord.validate_chord_label(target)


if __name__ == '__main__':
    unittest.main()
