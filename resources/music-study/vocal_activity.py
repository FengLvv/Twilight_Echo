"""Conservative outer bounds of activity in an already separated vocal stem.

This is a signal-based boundary estimate, not speech recognition. Leakage may
widen its bounds; uncertain/quiet/constant stems do not authorize deleting text.
Internal gaps and boundary-crossing lyric rows are intentionally retained.
"""
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.ndimage import median_filter
from runtime_context import check_cancel

ACTIVITY_ALGORITHM='vocal-stem-outer-energy-v1'
HOP_SECONDS=.02
EDGE_MARGIN=.8


def _frame_energy(path):
    values=[]
    with sf.SoundFile(path) as audio:
        rate=audio.samplerate;hop=max(1,round(rate*HOP_SECONDS));frames=audio.frames
        while True:
            check_cancel()
            block=audio.read(hop*250,dtype='float32',always_2d=True)
            if not len(block):break
            if not np.isfinite(block).all():raise ValueError('人声活动检测遇到无效音频')
            power=np.mean(np.square(block.astype(np.float64)),axis=1)
            count=len(power)//hop
            if count:values.extend(np.sqrt(power[:count*hop].reshape(count,hop).mean(axis=1)))
            if len(power)%hop:values.append(float(np.sqrt(power[count*hop:].mean())))
    return np.asarray(values),frames/rate


def _runs(mask):
    edges=np.diff(np.r_[False,mask,False].astype(np.int8))
    return list(zip(np.flatnonzero(edges==1),np.flatnonzero(edges==-1)))


def detect_vocal_activity(vocal_path,original_path):
    energy,duration=_frame_energy(Path(vocal_path))
    mixture,mix_duration=_frame_energy(Path(original_path))
    result=dict(algorithm=ACTIVITY_ALGORITHM,status='uncertain',start=None,end=None,margin=EDGE_MARGIN)
    if abs(duration-mix_duration)>.05 or len(energy)!=len(mixture):
        raise ValueError('人声轨与原曲时长不一致')
    if not len(energy):return result
    db=20*np.log10(np.maximum(energy,1e-12))
    low,high=np.percentile(db,[10,95]);peak=float(db.max())
    result.update(levelDb=round(float(high),2),contrastDb=round(float(high-low),2))
    if peak<-80 or high-low<12:
        return result
    # A low relative threshold protects quiet verses and breathy entrances.
    # Sustained stem leakage is allowed to widen the range, never to erase a
    # quiet entrance by demanding a speech-model or loud-chorus threshold.
    threshold=max(float(high)-42,min(float(low)+6,float(high)-24),-90)
    mask=median_filter(db,size=5,mode='nearest')>=threshold
    spans=[(a,b) for a,b in _runs(mask) if (b-a)*HOP_SECONDS>=.24]
    if not spans:return result
    indices=np.concatenate([np.arange(a,b) for a,b in spans])
    relative=20*np.log10(np.maximum(energy[indices],1e-12)/np.maximum(mixture[indices],1e-12))
    result.update(thresholdDb=round(threshold,2),medianStemRatioDb=round(float(np.median(relative)),2))
    if np.median(relative)<-42 or len(indices)*HOP_SECONDS<.8:
        return result
    result.update(status='estimated',start=round(spans[0][0]*HOP_SECONDS,3),
                  end=round(min(duration,spans[-1][1]*HOP_SECONDS),3))
    return result


def filter_outer_lyrics(lines,activity):
    """No deletion without usable bounds; no inferred text or retimed rows."""
    excluded=[]
    if activity.get('status')!='estimated':return list(lines),excluded
    start=max(0,activity['start']-activity['margin']);end=activity['end']+activity['margin']
    kept=[]
    for line in lines:
        reason='before_vocals' if line['end']<=start else 'after_vocals' if line['start']>=end else None
        if reason:excluded.append(dict(id=line['id'],reason=reason))
        else:kept.append(line)
    # Emptying supplied lyrics is inconclusive (bad clocks, instrumental, etc.),
    # not permission to silently remove every sung row.
    return (kept,excluded) if kept else (list(lines),[])
