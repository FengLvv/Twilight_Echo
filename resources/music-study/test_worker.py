import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
from worker import decode

class WorkerDecodeTests(unittest.TestCase):
    def test_cue_source_range_and_virtual_pregap_are_sample_aligned(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'原曲.wav';output=root/'range.wav'
            wave=np.sin(np.arange(88200)*2*np.pi*330/44100).astype(np.float32)*.2
            sf.write(source,np.stack([wave,wave],axis=1),44100,subtype='FLOAT')
            decode(source,output,.25,1.25,.1)
            result,sr=sf.read(output,dtype='float32',always_2d=True)
            self.assertEqual(sr,44100);self.assertEqual(result.shape,(48510,2))
            self.assertLess(float(abs(result[:4410]).max()),1e-8)
            np.testing.assert_allclose(result[4410:,0],wave[11025:55125],atol=1e-7)

if __name__=='__main__':unittest.main()
