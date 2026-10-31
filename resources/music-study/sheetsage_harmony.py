"""Pinned, offline SheetSage2 chord adapter. Model packs supply data, never code.

Greedy chord labels have no calibrated confidence or alternative hypotheses.
Keep this distinction in the UI and exports instead of inventing probabilities.
"""
from functools import lru_cache
import math
from pathlib import Path
import re

import numpy as np

ALGORITHM = 'sheetsage2-mert2-chord-full-paper-v1'
ROOTS = ('C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B')
PITCHES = {'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
DEGREES = (0,2,4,5,7,9,11)
QUALITIES = {'maj':'','min':'m','dim':'dim','aug':'aug','7':'7',
    'maj7':'maj7','min7':'m7','dim7':'dim7','hdim7':'m7b5',
    'minmaj7':'mMaj7','sus2':'sus2','sus4':'sus4',
    'sus4(b7)':'7sus4','maj6':'6','min6':'m6'}


def display_label(label):
    if label == 'N':return label
    match = re.fullmatch(r'([A-G])([#b]?):([^/]+)(?:/([#b]*)([1-7]))?',label)
    if not match or match[3] not in QUALITIES:
        raise ValueError('Unsupported SheetSage2 chord label: '+label)
    root=(PITCHES[match[1]]+match[2].count('#')-match[2].count('b'))%12
    value=ROOTS[root]+QUALITIES[match[3]]
    if match[5]:
        bass=(root+DEGREES[int(match[5])-1]+match[4].count('#')-match[4].count('b'))%12
        if bass!=root:value+='/'+ROOTS[bass]
    return value


def segments_from_lab(text,duration):
    """Normalize spelling and cover every input sample, including leading gaps."""
    segments=[];cursor=0.
    def append(start,end,label):
        if end<=start:return
        if segments and segments[-1]['label']==label:
            segments[-1]['end']=end
        else:segments.append({'start':start,'end':end,'label':label,
            'confidence':'unrated','candidates':[]})
    for line in text.splitlines():
        values=line.split()
        if not values:continue
        if len(values)!=3:raise ValueError('Malformed chord interval')
        start,end=map(float,values[:2])
        if not math.isfinite(start) or not math.isfinite(end) or end<start or start<cursor-1e-5:
            raise ValueError('Invalid or overlapping chord intervals')
        start=max(cursor,min(duration,start));end=max(start,min(duration,end))
        append(cursor,start,'N');append(start,end,display_label(values[2]));cursor=end
    append(cursor,duration,'N')
    return segments


@lru_cache(maxsize=1)
def load_model(pack):
    import torch
    from vendor.sheetsage2.modeling_sheetsage2 import SheetSage2Model
    device='cuda' if torch.cuda.is_available() else 'cpu'
    torch.set_num_threads(min(4,torch.get_num_threads()))
    model=SheetSage2Model.from_pretrained(str(Path(pack)/'sheetsage2'),
        base_model_path=str(Path(pack)/'mert2'),local_files_only=True,
        attn_implementation='sdpa',torch_dtype=torch.float32).eval().to(device)
    return model


def recognize(audio,sample_rate,*,model_pack,progress=None):
    if audio.ndim==2:audio=audio.mean(axis=1)
    if not len(audio) or sample_rate<=0 or not np.isfinite(audio).all():
        raise ValueError('无有效音频可供分析')
    duration=len(audio)/sample_rate
    if progress:progress(0,'加载高精度和弦模型')
    if np.max(np.abs(audio))<1e-7:
        segments=segments_from_lab('',duration)
        metadata={'warnings':[],'device':'none (silence)'}
    else:
        model=load_model(str(Path(model_pack).resolve()))
        def report(event):
            if progress:
                window=event.get('window',1);windows=event.get('windows',1)
                progress(min(.98,(window-1+.5)/windows),f'高精度和弦分析 {window}/{windows}')
        import torch
        device=next(model.parameters()).device
        # Match the measured paper protocol; CPU uses float32, CUDA uses BF16
        # where supported. No audio is sent to a service and no Hub lookup runs.
        result=model.transcribe(np.asarray(audio,dtype=np.float32),sampling_rate=sample_rate,
            prompts=['timestamp','downbeat_meter','chord_full'],preset='paper',
            dtype='bf16' if device.type=='cuda' and torch.cuda.is_bf16_supported() else 'fp32',
            progress=report)
        segments=segments_from_lab(result['labs']['chord'],duration)
        metadata={key:result.get(key) for key in ('elapsed_seconds','peak_gpu_mib','warnings','dtype')}
        metadata['device']=str(device)
    if progress:progress(1,'和弦识别完成')
    return {'version':1,'algorithm':ALGORITHM,'duration':duration,'tuningCents':None,
        'segments':segments,'inference':metadata}
