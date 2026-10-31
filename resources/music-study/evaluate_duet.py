"""Reproducible real singing evaluation, never used to choose inference outputs."""
import argparse
import itertools
import json
from pathlib import Path
import time
import numpy as np
import soundfile as sf
from separation import read_audio, two_singers


def sisdr(estimate, reference):
    estimate=estimate-estimate.mean();reference=reference-reference.mean()
    target=np.dot(estimate,reference)/(np.dot(reference,reference)+1e-10)*reference
    return float(10*np.log10((np.dot(target,target)+1e-10)/(np.dot(estimate-target,estimate-target)+1e-10)))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('dataset');parser.add_argument('pack');parser.add_argument('output');parser.add_argument('--count',type=int,default=8);parser.add_argument('--seconds',type=float,default=5.5);parser.add_argument('--songs',default='')
    args=parser.parse_args();root=Path(args.dataset);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    segments=[]
    for song in sorted((root/'duet').iterdir()):
        if not song.is_dir():continue
        if args.songs and song.name not in args.songs.split(','):continue
        for segment in sorted(song.iterdir()):
            if len(list((segment/'gt').glob('*.wav')))==2:
                segments.append(segment);break
    rows=[]
    for index,segment in enumerate(segments[:args.count]):
        mixture=read_audio(next((segment/'mix').glob('*.wav')))
        # First case also exercises identity across several generation windows.
        length=min(mixture.shape[1],round((max(12,args.seconds) if index==0 else args.seconds)*44100))
        mixture=mixture[:,:length]
        references=[read_audio(p).mean(0)[:length] for p in sorted((segment/'gt').glob('*.wav'))]
        started=time.time()
        estimates=two_singers(mixture,args.pack,'cuda',lambda p,s:None)
        audio=np.stack([estimates['singerA'].mean(0),estimates['singerB'].mean(0)])
        permutations=list(itertools.permutations(range(2)))
        scores=[np.mean([sisdr(audio[order[k]],references[k]) for k in range(2)]) for order in permutations]
        best=permutations[int(np.argmax(scores))]
        base=np.mean([sisdr(mixture.mean(0),reference) for reference in references])
        chunks=[]
        for start in range(0,length,round(2.73*44100)):
            end=min(length,start+round(2.73*44100))
            if end-start<22050:continue
            metric=[np.mean([sisdr(audio[order[k],start:end],references[k][start:end]) for k in range(2)]) for order in permutations]
            chunks.append(int(np.argmax(metric)))
        row={'segment':str(segment.relative_to(root)),'seconds':length/44100,'sisdr':max(scores),'sisdrImprovement':max(scores)-base,
             'identityChanges':sum(a!=b for a,b in zip(chunks,chunks[1:])), 'wallSeconds':time.time()-started}
        rows.append(row);print(json.dumps(row),flush=True)
        sf.write(out/(str(index)+'-A.wav'),estimates['singerA'].T,44100,subtype='FLOAT')
        sf.write(out/(str(index)+'-B.wav'),estimates['singerB'].T,44100,subtype='FLOAT')
        (out/'metrics.json').write_text(json.dumps({'cases':rows,'medianImprovement':float(np.median([r['sisdrImprovement']for r in rows]))},indent=2),encoding='utf-8')
