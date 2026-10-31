"""Same-audio model comparison with content-addressed caches and mir_eval metrics.

ChordMini is a separately cloned, pinned research dependency, not product code.
No model is trained or fine-tuned by this benchmark. No NetEase audio is treated
as annotated ground truth. Every prediction covers the full recorded interval.
"""
import argparse
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import sys
import time

import librosa
import mir_eval
import numpy as np
import soundfile as sf
import torch
from safetensors import safe_open
from safetensors.torch import load_file

from harmony import recognize, ROOTS
from evaluate_harmony import label as common_label

METRICS=('root','majmin','triads','sevenths','majmin_inv','sevenths_inv','mirex')
QUALITY={'':'maj','m':'min','m7':'min7','m7b5':'hdim7','mMaj7':'minmaj7','6':'maj6','m6':'min6'}


def sha(path):
    with Path(path).open('rb') as file:
        return hashlib.file_digest(file,'sha256').hexdigest()


def harte(text):
    # Unknown estimates are scored as no-chord, never excluded like reference X.
    if text=='?':return 'N'
    if text in ('N','X'):return text
    if ':' in text:return text
    match=re.fullmatch(r'([A-G](?:#|b)?)(.*?)(?:/([A-G](?:#|b)?))?',text)
    if not match:raise ValueError('Unrecognized prediction label: '+text)
    root,quality,bass=match.groups()
    result=root+':'+QUALITY.get(quality,quality)
    if bass:
        pitch=lambda note:({'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[note[0]]+note.count('#')-note.count('b'))%12
        degree={0:'1',1:'b2',2:'2',3:'b3',4:'3',5:'4',6:'b5',7:'5',8:'#5',9:'6',10:'b7',11:'7'}[(pitch(bass)-pitch(root))%12]
        result+='/'+degree
    return result


def idmt_label(text):
    """IDMT slash numbers name chord members, not chromatic Harte intervals.

    For example its C:min/3 audio has Eb in the bass and C:7/7 has Bb.
    Normalize the convention for mir_eval, retaining the original source files.
    """
    if '/' not in text:return text
    chord,bass=text.rsplit('/',1)
    quality=chord.split(':',1)[1]
    if bass=='3' and quality in ('min','min7','hdim7'):bass='b3'
    if bass=='5' and quality=='hdim7':bass='b5'
    if bass=='7' and quality in ('7','min7','hdim7'):bass='b7'
    return chord+'/'+bass


def intervals(segments,duration,unknown):
    times=np.asarray([[s['start'],s['end']]for s in segments],dtype=float)
    labels=[harte(s['label'])for s in segments]
    if unknown=='N':labels=['N'if value=='X'else value for value in labels]
    times,labels=mir_eval.util.adjust_intervals(times,labels,t_min=0,t_max=duration,start_label=unknown,end_label=unknown)
    return times,labels


def score(reference,prediction,duration):
    ref_times,ref_labels=intervals(reference,duration,'X')
    est_times,est_labels=intervals(prediction,duration,'N')
    merged,refs,ests=mir_eval.util.merge_labeled_intervals(ref_times,ref_labels,est_times,est_labels)
    lengths=mir_eval.util.intervals_to_durations(merged)
    metrics={}
    for name in METRICS:
        comparison=np.asarray(getattr(mir_eval.chord,name)(refs,ests))
        valid=comparison>=0
        metrics[name]={'matched':float(np.sum(lengths[valid]*comparison[valid])),'seconds':float(lengths[valid].sum())}
    matched=0.;seconds=0.
    for target in reference:
        expected=common_label(target['label'])
        if expected is None:continue
        seconds+=target['end']-target['start']
        for estimated in prediction:
            value=common_label(harte('N'if estimated['label']in('X','?')else estimated['label']))
            if value==expected:
                matched+=max(0,min(target['end'],estimated['end'])-max(target['start'],estimated['start']))
    metrics['common_exact']={'matched':matched,'seconds':seconds}
    return metrics


@lru_cache(maxsize=3)
def mini_model(repo,pack,kind):
    sys.path.insert(0,str(repo))
    from src.models import BTC_model,ChordNet
    from src.models.common.checkpoint_loading import _infer_chordnet
    from src.utils import HParams
    config=HParams.load(str(Path(repo)/'config/ChordMini.yaml'))
    path=Path(pack)/('2e1d.safetensors' if kind=='mini-2e1d' else 'btc.safetensors')
    state=load_file(str(path))
    model=ChordNet(**_infer_chordnet(state,config)) if kind=='mini-2e1d' else BTC_model(config.model)
    model.load_state_dict(state,strict=True)
    device='cuda' if torch.cuda.is_available() else 'cpu'
    model.to(device).eval()
    with safe_open(str(path),framework='pt')as file:metadata=file.metadata()
    mapping={int(k):v for k,v in json.loads(metadata['labels']).items()}
    return model,float(metadata['mean']),float(metadata['std']),mapping


def mini_predict(audio,sr,repo,pack,kind):
    from src.evaluation.utils.inference import predict_sliding_windows
    model,mean,std,mapping=mini_model(repo,pack,kind)
    wave=librosa.resample(audio,orig_sr=sr,target_sr=22050).astype(np.float32)
    features=np.log(abs(librosa.cqt(wave,sr=22050,n_bins=144,bins_per_octave=24,hop_length=2048,fmin=librosa.note_to_hz('C1')))+1e-6).T.astype(np.float32)
    prediction=predict_sliding_windows(model,features,mean,std,108,32,'ChordNet'if kind=='mini-2e1d'else'BTC',170,
        vote_aggregation='logit',use_overlap=True,overlap_ratio=.5,smooth_logits=True,smooth_predictions=True,kernel_size=9,use_gaussian=True)
    segments=[];duration=len(audio)/sr
    for index,value in enumerate(prediction):
        start=index*2048/22050
        if start>=duration:break
        end=min(duration,(index+1)*2048/22050)
        label=mapping[int(value)]
        if segments and label==segments[-1]['label']:segments[-1]['end']=end
        else:segments.append({'start':start,'end':end,'label':label})
    segments[-1]['end']=duration
    return segments


def main():
    parser=argparse.ArgumentParser()
    for arg in ('audio','annotations','pack','mini-repo','mini-pack','output'):parser.add_argument('--'+arg,required=True)
    parser.add_argument('--sheetsage-pack',help='Fixed complete production pack containing sheetsage2/ and mert2/')
    parser.add_argument('--split',choices=['dev','holdout','all'],default='dev')
    parser.add_argument('--dataset',choices=['guitarset','idmt','mirex'],default='guitarset')
    parser.add_argument('--count',type=int,default=60)
    parser.add_argument('--models',default='baseline,mini-fused,mini-btc,mini-2e1d,sheetsage2')
    args=parser.parse_args();output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,args.mini_repo)
    pattern='*_comp_mic.wav'if args.dataset=='guitarset'else'*.mp3'if args.dataset=='mirex'else'*.wav'
    files=sorted(Path(args.audio).rglob(pattern))
    if args.dataset=='guitarset':
        if args.split=='holdout':files=[p for p in files if p.name.startswith('05_')]
        elif args.split=='dev':files=[p for p in files if not p.name.startswith('05_')]
    if args.count<len(files):files=[files[int(i)]for i in np.linspace(0,len(files)-1,args.count,dtype=int)]
    models=args.models.split(',')
    if 'sheetsage2' in models and not args.sheetsage_pack:parser.error('--sheetsage-pack is required when evaluating sheetsage2')
    code=hashlib.sha256()
    for file in sorted(Path(__file__).parent.rglob('*.py')):code.update(file.relative_to(Path(__file__).parent).as_posix().encode());code.update(file.read_bytes())
    for file in sorted((Path(args.mini_repo)/'src').rglob('*.py')):code.update(file.relative_to(args.mini_repo).as_posix().encode());code.update(file.read_bytes())
    configuration={'code':code.hexdigest(),'mir_eval':mir_eval.__version__,'dataset':args.dataset,'split':args.split,'count':len(files),'postprocess':'ChordMini: official overlap=.5 gaussian=9 categorical=9; SheetSage2: paper, timestamp/downbeat_meter/chord_full, fp32 weights and bf16 CUDA autocast; no discarded segments; estimated X/? count as N, never ignored'}
    result={'configuration':configuration,'files':[],'summary':{}}
    published=[]
    if args.dataset=='mirex':published=['published:'+s['name']for s in json.loads((Path(args.annotations)/(files[0].stem+'.json')).read_text())['systems']]
    totals={model:{name:{'matched':0.,'seconds':0.}for name in (*METRICS,'common_exact')}for model in models+published}
    # Weights are fixed for the run; hashing the multi-GB parent per track
    # would obscure inference timings and add hundreds of GB of redundant IO.
    weights_fingerprints={}
    for model in models:
        if model=='sheetsage2':
            weights_fingerprints[model]={name:sha(Path(args.sheetsage_pack)/name)for name in
                ('sheetsage2/model.safetensors','sheetsage2/config.json','mert2/model.safetensors','mert2/config.json')}
        else:
            pack=args.pack if model=='baseline'else args.mini_pack
            weights_fingerprints[model]=sha(Path(pack)/('2e1d.safetensors'if model=='mini-2e1d'else'btc.safetensors'))
    for file in files:
        name=file.stem.removesuffix('_mic')
        if args.dataset=='guitarset':
            annotation=Path(args.annotations)/(name+'.jams')
            jams=json.loads(annotation.read_text());chords=[a['data']for a in jams['annotations']if a['namespace']=='chord'][1]
            reference=[{'start':c['time'],'end':c['time']+c['duration'],'label':c['value']}for c in chords]
        elif args.dataset=='idmt':
            annotation=Path(args.annotations)/('guitar_annotation.lab'if '_guitar_'in file.name else 'non_guitar_annotation.lab')
            reference=[{'start':float(parts[0]),'end':float(parts[1]),'label':idmt_label(parts[2])}for line in annotation.read_text().splitlines()if len(parts:=line.split())==3]
        else:
            annotation=Path(args.annotations)/(name+'.json');demo=json.loads(annotation.read_text())
            assert demo['audio_offset']==0.,'Demo audio offset must be handled explicitly'
            reference=[{'start':a,'end':b,'label':c}for a,b,c in demo['reference']]
        wave,sr=sf.read(file,dtype='float32',always_2d=True);audio=wave.mean(1);duration=len(audio)/sr
        row={'file':file.name,'duration':duration,'models':{}}
        audio_digest,annotation_digest=sha(file),sha(annotation)
        for model in models:
            pack=args.pack if model=='baseline'else args.mini_pack
            signature=hashlib.sha256(json.dumps({'configuration':configuration,'model':model,'audio':audio_digest,'annotation':annotation_digest,'weights':weights_fingerprints[model]},sort_keys=True).encode()).hexdigest()
            cache=output/'predictions'/model/(name+'-'+signature[:16]+'.json');cache.parent.mkdir(parents=True,exist_ok=True)
            started=time.perf_counter()
            if cache.exists():prediction=json.loads(cache.read_text())
            elif model=='sheetsage2':
                from sheetsage_harmony import recognize as accurate_recognize
                prediction=accurate_recognize(audio,sr,model_pack=args.sheetsage_pack)['segments']
            elif model in ('baseline','mini-fused'):prediction=recognize(audio,sr,model_pack=pack)['segments']
            else:prediction=mini_predict(audio,sr,args.mini_repo,args.mini_pack,model)
            if not cache.exists():cache.write_text(json.dumps(prediction),encoding='utf-8')
            metrics=score(reference,prediction,duration)
            row['models'][model]={'seconds':time.perf_counter()-started,'cacheKey':signature,'metrics':{k:v['matched']/v['seconds']if v['seconds']else 0 for k,v in metrics.items()}}
            for key,metric in metrics.items():
                for field in ('matched','seconds'):totals[model][key][field]+=metric[field]
        if args.dataset=='mirex':
            row['publishedPredictionSource']='Organizer-provided demo predictions; these systems were NOT executed locally'
            for system in demo['systems']:
                model='published:'+system['name']
                prediction=[{'start':a,'end':b,'label':c}for a,b,c in system['chords']]
                metrics=score(reference,prediction,duration)
                row['models'][model]={'metrics':{k:v['matched']/v['seconds']if v['seconds']else 0 for k,v in metrics.items()}}
                for key,metric in metrics.items():
                    for field in ('matched','seconds'):totals[model][key][field]+=metric[field]
        result['files'].append(row)
        result['summary']={model:{key:metric['matched']/metric['seconds']if metric['seconds']else 0 for key,metric in values.items()}for model,values in totals.items()}
        result['denominators']={model:{key:metric['seconds']for key,metric in values.items()}for model,values in totals.items()}
        (output/'metrics.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        print(json.dumps({'file':file.name,'summary':result['summary']}),flush=True)


if __name__=='__main__':main()
