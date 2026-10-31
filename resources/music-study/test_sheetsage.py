import unittest
import numpy as np
from sheetsage_harmony import display_label,segments_from_lab,recognize,ALGORITHM


class SheetSageAdapterTests(unittest.TestCase):
    def test_harte_bass_and_full_qualities_survive_conversion(self):
        for source,expected in [('C:maj/3','C/E'),('D:min7/b3','Dm7/F'),
                ('C:7/b7','C7/Bb'),('F#:hdim7','F#m7b5'),
                ('Ab:minmaj7','AbmMaj7'),('G:sus4(b7)','G7sus4'),
                ('B:maj6','B6'),('Bb:min6','Bbm6')]:
            self.assertEqual(display_label(source),expected)
        with self.assertRaises(ValueError):display_label('C:unknown')

    def test_complete_timeline_and_no_invented_confidence(self):
        result=segments_from_lab('.25 1.0 C:maj\n1.0 1.5 C:maj\n2 3 D:min7/b3',2.5)
        self.assertEqual([(s['start'],s['end'],s['label'])for s in result],
            [(0,.25,'N'),(.25,1.5,'C'),(1.5,2.,'N'),(2.,2.5,'Dm7/F')])
        self.assertTrue(all(s['confidence']=='unrated' and s['candidates']==[]for s in result))
        for text in ('0 2 C:maj\n1 3 D:min','nan 2 C:maj','0 inf C:maj'):
            with self.assertRaises(ValueError):segments_from_lab(text,3)

    def test_silence_does_not_hallucinate_a_chord(self):
        result=recognize(np.zeros(24000,np.float32),24000,model_pack='not-loaded')
        self.assertEqual(result['algorithm'],ALGORITHM)
        self.assertIsNone(result['tuningCents'])
        self.assertEqual(result['segments'][0]['label'],'N')
        self.assertEqual(result['segments'][0]['end'],1.)


if __name__=='__main__':unittest.main()
