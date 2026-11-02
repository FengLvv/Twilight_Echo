"""Conservative whole-song tuning and scale assistance for uncertain semitones.

The continuous estimate remains available as pitchMidi. Definite chromatic
notes are never snapped merely because they disagree with an inferred key.
"""
import math


def quantize_pitches(notes, key):
    observations=[]
    for note in notes:
        pitch=note.get('pitchMidi',note['midi'])
        if not math.isfinite(pitch):continue
        weight=min(2,max(0,note['end']-note['start']))
        observations.append((note,float(pitch),weight))
    stable=sorted((pitch-round(pitch),weight) for _,pitch,weight in observations
                  if abs(pitch-round(pitch))<=.35 and weight>=.08)
    tuning=0.
    if len(stable)>=8:
        half=sum(weight for _,weight in stable)/2
        for residual,weight in stable:
            half-=weight
            if half<=0:tuning=residual;break
    tonic=int(key['tonic'])
    scale={(tonic+i)%12 for i in ([0,2,3,5,7,8,10] if key['mode']=='minor' else [0,2,4,5,7,9,11])}
    total=sum(weight for _,_,weight in observations)
    coverage=sum(weight for _,pitch,weight in observations if round(pitch-tuning)%12 in scale)/max(total,1e-9)
    assisted=0
    for note,pitch,_ in observations:
        corrected=pitch-tuning
        nearest=round(corrected)
        if coverage>=.75 and nearest%12 not in scale:
            choices=[m for m in range(nearest-1,nearest+2) if m%12 in scale and 0<=m<=127]
            if choices:
                candidate=min(choices,key=lambda m:abs(m-corrected))
                error=abs(candidate-corrected)
                if error<=.60 and error-abs(nearest-corrected)<=.20:
                    nearest=candidate;assisted+=1
        note['midi']=max(0,min(127,nearest))
    return dict(algorithm='tuning-scale-aware-v1',tuningCents=round(tuning*100,2),
                scaleCoverage=round(coverage,4),scaleAssistedNotes=assisted)
