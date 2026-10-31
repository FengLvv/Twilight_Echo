import unittest
from benchmark_chords import harte,score,idmt_label

class BenchmarkTests(unittest.TestCase):
    def test_idmt_chord_degree_bass_convention(self):
        self.assertEqual(idmt_label('C:min/3'),'C:min/b3')
        self.assertEqual(idmt_label('C:7/7'),'C:7/b7')
        self.assertEqual(idmt_label('C:hdim7/5'),'C:hdim7/b5')
        self.assertEqual(idmt_label('C:maj7/7'),'C:maj7/7')

    def test_estimated_unknown_is_penalized_not_excluded(self):
        reference=[{'start':0,'end':2,'label':'C:maj'}]
        for label in ('X','?','N'):
            metrics=score(reference,[{'start':0,'end':2,'label':label}],2)
            self.assertEqual(metrics['majmin'],{'matched':0.,'seconds':2.})

    def test_slash_chord_and_enharmonic_bass(self):
        self.assertEqual(harte('C/E'),'C:maj/3')
        self.assertEqual(harte('Abm7/B'),'Ab:min7/b3')
        reference=[{'start':0,'end':2,'label':'C:maj/3'}]
        correct=score(reference,[{'start':0,'end':2,'label':'C/E'}],2)
        wrong=score(reference,[{'start':0,'end':2,'label':'C'}],2)
        self.assertEqual(correct['majmin_inv']['matched'],2.)
        self.assertEqual(wrong['majmin']['matched'],2.)
        self.assertEqual(wrong['majmin_inv']['matched'],0.)

if __name__=='__main__':unittest.main()
