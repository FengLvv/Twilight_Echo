"""Streaming integrity checks for complete, aligned six-track output."""
import json
from pathlib import Path
import sys
import numpy as np
import soundfile as sf

root=Path(sys.argv[1])
names=['original','vocals','drums','bass','guitar','piano','other']
files=[sf.SoundFile(root/(name+'.wav')) for name in names]
try:
    reference=files[0]
    assert reference.samplerate==44100 and reference.channels==2
    assert all(f.frames==reference.frames and f.samplerate==reference.samplerate and f.channels==2 for f in files)
    power=residual=0.;peaks={name:0. for name in names}
    while True:
        blocks=[f.read(65536,dtype='float32',always_2d=True) for f in files]
        if not len(blocks[0]):break
        for name,block in zip(names,blocks):
            assert np.isfinite(block).all(),name+' has non-finite PCM'
            peaks[name]=max(peaks[name],float(np.abs(block).max()))
        original=blocks[0].astype('float64')
        difference=original-sum(block.astype('float64') for block in blocks[1:])
        power+=float(np.square(original).sum());residual+=float(np.square(difference).sum())
    print(json.dumps(dict(frames=reference.frames,sampleRate=reference.samplerate,channels=2,
                         peaks=peaks,mixtureResidualRatio=(residual/max(power,1e-20))**.5)))
finally:
    for file in files:file.close()
