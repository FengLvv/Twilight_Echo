"""Compare real sung text, wrong text, attribution text and silence with one TiFA session.

Manifest entries: title, vocals, rows, language (zh/ja/en), optional start/end.
The caller provides already authorized media; no network or account writes.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time

parser=argparse.ArgumentParser()
parser.add_argument('manifest')
parser.add_argument('output')
parser.add_argument('--home',default='D:/Tools/TwilightEchoToolchain/study')
args=parser.parse_args()
repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'resources/music-study'))
sys.path.insert(0,str(repo/'resources/music-study/vendor/vocal2midi'))
import numpy as np
import soundfile as sf
import torch
torch.set_num_threads(4)
from inference.TiFA.runtime import load_tifa_model
from inference.TiFA.g2p_pipeline import build_g2p_pipeline
from inference.TiFA.aligner import run_tifa_fa
from vocal_pipeline import source_owners, languages_for
from lyric_alignment_evidence import summarize_lines

started=time.perf_counter()
model=load_tifa_model(Path(args.home)/'models/vocal2midi/tifa',device='dml')
g2p=build_g2p_pipeline(model.model_dir,japanese_g2p_engine='pyopenjtalk')
print(json.dumps(dict(modelLoadMs=round((time.perf_counter()-started)*1000))),flush=True)
report=[]
for sample in json.loads(Path(args.manifest).read_text(encoding='utf-8')):
    wave,sr=sf.read(sample['vocals'],dtype='float32',always_2d=True)
    rows=sample['rows']
    start=sample.get('start',max(0,rows[0]['start']-.25))
    end=sample.get('end',rows[-1]['end']+.25)
    clip=wave[round(start*sr):round(end*sr)].mean(axis=1)
    text='\n'.join(row['text'] for row in rows)
    cases=[('matched',rows,clip),
           ('wrong_lyrics',[{**row,'text':sample['wrongText']} for row in rows],clip),
           ('attribution',[{**row,'text':'Mixed at The Mixsuite (South London and Los Angeles)'} for row in rows],clip),
        ('silence',rows,np.zeros_like(clip))]
    for mode,lines,audio in cases:
        tick=time.perf_counter()
        result=dict(title=sample['title'],mode=mode)
        try:
            with tempfile.TemporaryDirectory(prefix='study-evidence-probe-') as work:
                work=Path(work)
                sf.write(work/'chunk_0.wav',audio,sr,subtype='FLOAT')
                body='\n'.join(row['text'] for row in lines)
                (work/'chunk_0.txt').write_text(body,encoding='utf-8')
                languages=languages_for(body,sample['language'])
                evidence={}
                pred,_=run_tifa_fa(model,work,language=languages[0],languages=languages,
                                  g2p_pipeline=g2p,japanese_g2p_engine='pyopenjtalk',evidence=evidence)
                owners,_=source_owners(pred['chunk_0'][2],lines)
                result['rows']=summarize_lines(evidence['chunk_0'],owners,lines,start)
        except Exception as error:
            result['error']=str(error)
        result['elapsedMs']=round((time.perf_counter()-tick)*1000)
        report.append(result)
        Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False),flush=True)
