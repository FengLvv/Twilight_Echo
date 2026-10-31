"""GuitarSet chord WCSR on fixed, annotated accompaniment recordings."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import soundfile as sf
from harmony import recognize,ROOTS

def label(text):
    if text=='N':return 'N'
    if text=='X':return None
    root,quality=(text.split(':',1)+['maj'])[:2] if ':' in text else (text,'maj')
    if '*' in quality:return None
    quality=quality.split('/')[0].split('(')[0]
    roots={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}
    pitch=(roots[root[0]]+root.count('#')-root.count('b'))%12
    qualities={'maj':'','min':'m','7':'7','maj7':'maj7','min7':'m7','dim':'dim','aug':'aug','sus2':'sus2','sus4':'sus4','dim7':'dim7','hdim7':'m7b5'}
    return ROOTS[pitch]+qualities[quality] if quality in qualities else None

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('audio');parser.add_argument('annotations');parser.add_argument('output');parser.add_argument('--count',type=int,default=60);parser.add_argument('--performed',action='store_true');parser.add_argument('--pack')
    args=parser.parse_args();audio=Path(args.audio);annotations=Path(args.annotations)
    files=sorted(audio.rglob('*_comp_mic.wav'))
    rows=[];correct=0;total=0;all_seconds=0
    cache=Path(args.output).parent/'chord-evaluation-v2';cache.mkdir(exist_ok=True)
    def sha(path):
        with Path(path).open('rb')as file:return hashlib.file_digest(file,'sha256').hexdigest()
    code=hashlib.sha256()
    for path in [Path(__file__).with_name('harmony.py'),Path(__file__).with_name('btc_harmony.py'),*sorted(Path(__file__).with_name('btc').glob('*.py'))]:
        code.update(path.name.encode());code.update(path.read_bytes())
    weights=sha(Path(args.pack)/'btc.safetensors') if args.pack else None
    # Spread the fixed subset across players and styles, without using labels to select.
    indices=np.linspace(0,len(files)-1,min(args.count,len(files)),dtype=int)
    for index in indices:
        file=files[int(index)];name=file.stem.removesuffix('_mic');jams=json.loads((annotations/(name+'.jams')).read_text())
        reference=[a['data'] for a in jams['annotations'] if a['namespace']=='chord'][1 if args.performed else 0]
        signature=hashlib.sha256(json.dumps({'audio':sha(file),'annotation':sha(annotations/(name+'.jams')),
            'code':code.hexdigest(),'weights':weights,'performed':args.performed},sort_keys=True).encode()).hexdigest()
        cache_file=cache/(name+'-'+signature[:20]+'.json')
        if cache_file.exists():prediction=json.loads(cache_file.read_text())
        else:
            wave,sr=sf.read(file,dtype='float32',always_2d=True);prediction=recognize(wave.mean(1),sr,model_pack=args.pack)['segments'];cache_file.write_text(json.dumps(prediction),encoding='utf-8')
        matched=0;seconds=0
        for target in reference:
            all_seconds+=target['duration']
            expected=label(target['value'])
            if expected is None:continue
            start,end=target['time'],target['time']+target['duration'];seconds+=end-start
            for estimated in prediction:
                overlap=max(0,min(end,estimated['end'])-max(start,estimated['start']))
                # Exact common chord quality; inversion spelling is reported separately in unit fixtures.
                if estimated['label'].split('/')[0]==expected:matched+=overlap
        correct+=matched;total+=seconds
        row={'file':file.name,'seconds':seconds,'wcsr':matched/seconds if seconds else 0};rows.append(row)
        print(json.dumps(row),flush=True)
    Path(args.output).write_text(json.dumps({'dataset':'GuitarSet','annotation':'performed, full common chord core' if args.performed else 'lead sheet','files':rows,'commonChordWcsr':correct/total if total else 0,'evaluatedSeconds':total,'recordedSeconds':all_seconds,'coverage':total/all_seconds if all_seconds else 0},indent=2),encoding='utf-8')
