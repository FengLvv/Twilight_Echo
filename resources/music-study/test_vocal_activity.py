import tempfile
from pathlib import Path
import unittest
import numpy as np
import soundfile as sf
from vocal_activity import detect_vocal_activity,filter_outer_lyrics


class VocalActivityTests(unittest.TestCase):
    rate=8000

    def probe(self,vocals,mixture=None):
        if mixture is None:mixture=vocals+np.random.default_rng(123).normal(0,.03,vocals.shape)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            sf.write(root/'v.wav',vocals,self.rate,subtype='FLOAT')
            sf.write(root/'o.wav',mixture,self.rate,subtype='FLOAT')
            return detect_vocal_activity(root/'v.wav',root/'o.wav')

    def voice(self,length=12):
        t=np.arange(length*self.rate)/self.rate
        wave=np.zeros_like(t)
        for start,end,amplitude in [(2,4,.1),(7,9,.1)]:
            mask=(t>=start)&(t<end);wave[mask]=np.sin(2*np.pi*220*t[mask])*amplitude
        return wave

    def test_sustained_activity_filters_only_outer_rows_and_preserves_crossing_rows_and_internal_gaps(self):
        activity=self.probe(self.voice())
        self.assertEqual(activity['status'],'estimated')
        self.assertAlmostEqual(activity['start'],2,delta=.04);self.assertAlmostEqual(activity['end'],9,delta=.04)
        rows=[dict(id=i,start=a,end=b,text=text) for i,(a,b,text) in enumerate([
            (0,1,'片头名字'),(.5,2.5,'提前显示的演唱'),(2,4,'第一句'),(4.5,6.5,'间奏内保留'),(7,9.2,'尾音'),(10.2,12,'片尾文字')])]
        kept,excluded=filter_outer_lyrics(rows,activity)
        self.assertEqual([r['id'] for r in kept],[1,2,3,4])
        self.assertEqual(excluded,[dict(id=0,reason='before_vocals'),dict(id=5,reason='after_vocals')])
        self.assertEqual(kept[0],rows[1])

    def test_quiet_first_verse_is_not_replaced_by_loud_chorus_bounds(self):
        wave=self.voice();wave[2*self.rate:4*self.rate]*=.018
        self.assertLess(self.probe(wave)['start'],2.1)

    def test_out_of_phase_stereo_still_has_vocal_energy(self):
        wave=self.voice();stereo=np.stack([wave,-wave],axis=1)
        self.assertLess(self.probe(stereo)['start'],2.1)

    def test_silence_and_constant_noise_cannot_authorize_deletions(self):
        rows=[dict(id=3,start=0,end=2,text='真实歌词')]
        for wave in [np.zeros(self.rate*4),np.random.default_rng(1).normal(0,.01,self.rate*4)]:
            activity=self.probe(wave)
            self.assertEqual(activity['status'],'uncertain')
            self.assertEqual(filter_outer_lyrics(rows,activity),(rows,[]))

    def test_short_click_and_tiny_residual_stem_are_inconclusive(self):
        wave=np.zeros(self.rate*5);wave[self.rate:self.rate+160]=.2
        self.assertEqual(self.probe(wave)['status'],'uncertain')
        wave=self.voice()*1e-5
        self.assertEqual(self.probe(wave)['status'],'uncertain')

    def test_bad_clocks_do_not_silently_remove_every_line(self):
        rows=[dict(id=0,start=0,end=1,text='演唱但时间标错')]
        self.assertEqual(filter_outer_lyrics(rows,dict(status='estimated',start=10,end=12,margin=.8)),(rows,[]))

    def test_mismatched_stem_duration_is_an_explicit_integrity_error(self):
        with self.assertRaisesRegex(ValueError,'时长不一致'):
            self.probe(self.voice(),np.zeros(self.rate))


if __name__=='__main__':unittest.main()
