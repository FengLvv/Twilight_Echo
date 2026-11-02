import unittest
from vocal_pitch import quantize_pitches


class VocalPitchTests(unittest.TestCase):
    def test_flat_diatonic_boundaries_use_song_tuning_without_changing_time_or_raw_pitch(self):
        notes=[dict(midi=60,pitchMidi=59.8,start=i,end=i+.5) for i in range(12)]
        notes.append(dict(midi=61,pitchMidi=61.45,start=12,end=12.5))
        raw=[dict(n) for n in notes]
        result=quantize_pitches(notes,dict(tonic=10,mode='major'))
        self.assertAlmostEqual(result['tuningCents'],-20)
        self.assertEqual(notes[-1]['midi'],62)
        self.assertEqual([n['pitchMidi'] for n in notes],[n['pitchMidi'] for n in raw])
        self.assertEqual([(n['start'],n['end']) for n in notes],[(n['start'],n['end']) for n in raw])

    def test_uncertain_boundary_is_assisted_but_definite_chromatic_note_survives(self):
        notes=[dict(midi=60,pitchMidi=60.,start=i,end=i+.5) for i in range(12)]
        notes.extend([dict(midi=61,pitchMidi=61.49,start=12,end=12.5),dict(midi=61,pitchMidi=61.05,start=13,end=13.5)])
        result=quantize_pitches(notes,dict(tonic=10,mode='major'))
        self.assertEqual([n['midi'] for n in notes[-2:]],[62,61])
        self.assertEqual(result['scaleAssistedNotes'],1)

    def test_poor_scale_coverage_cannot_authorize_pitch_snapping(self):
        notes=[dict(midi=61,pitchMidi=61.49,start=i,end=i+.5) for i in range(5)]
        result=quantize_pitches(notes,dict(tonic=0,mode='major'))
        self.assertEqual(result['scaleAssistedNotes'],0)
        self.assertEqual([n['midi'] for n in notes],[61]*5)

if __name__=='__main__':unittest.main()
