"""Supplied lyrics → TiFA alignment → GAME notes with quantized beats.

Raw seconds remain authoritative for playback. Musical beats are a separate view.
All model and pronunciation resources are local; this module never invokes ASR.
"""
from pathlib import Path
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import unicodedata

from vocal_melody import ALGORITHM, lyrics_key

def language_for(text):
    if re.search(r'[\u3040-\u30ff]',text): return 'ja'
    if re.search(r'[\u3400-\u9fff]',text): return 'zh'
    return 'en'

def validate_lines(serialized, duration):
    lyrics_key(serialized)
    rows=json.loads(serialized)
    previous=-1
    for row in rows:
        if (not isinstance(row,dict) or not isinstance(row.get('id'),int) or row['id']<=previous
                or not isinstance(row.get('text'),str) or not row['text'].strip()
                or len(row['text'])>2000
                or not all(isinstance(row.get(k),(int,float)) and math.isfinite(row[k]) for k in ['start','end'])
                or not 0<=row['start']<row['end']<=duration+.05):
            raise ValueError('歌词时间或内容无效，请重新加载歌词')
        if row['end']-row['start']>55:
            raise ValueError('单行歌词超过 55 秒，请使用逐行或逐字时间歌词')
        previous=row['id']
    return rows

def normalized_text(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).casefold() if c.isalnum())

def source_owners(words, lines):
    text='';owners=[];positions=[]
    for line in lines:
        for i,char in enumerate(line['text']):
            value=normalized_text(char);text+=value
            owners.extend([line['id']]*len(value));positions.extend([i]*len(value))
    cursor=0;mapping={};starts={}
    for word in words:
        word_id=getattr(word,'source_word',-1)
        if word_id<0 or word_id in mapping: continue
        value=normalized_text(word.source_text)
        if not value: continue
        found=text.find(value,cursor)
        if found<0: raise ValueError('无法保留歌词原词映射：'+word.source_text)
        if owners[found]!=owners[found+len(value)-1]:
            raise ValueError('原词跨越歌词行，请调整歌词分行：'+word.source_text)
        mapping[word_id]=owners[found];starts[word_id]=positions[found];cursor=found+len(value)
    return mapping,starts

def restore_spelling(notes, lines, starts):
    """A written word may cover several mora, including an unpitched long vowel.
    Keep that many-to-many relationship; never replace kanji with guessed kana.
    """
    for line in lines:
        selected=[n for n in notes if n['lineId']==line['id']]
        ids=list(dict.fromkeys(n['wordId'] for n in selected))
        spellings={word_id:line['text'][0 if i==0 else starts[word_id]:
            starts[ids[i+1]] if i+1<len(ids) else len(line['text'])] for i,word_id in enumerate(ids)}
        seen=set()
        for n in selected:
            n['lyric']=spellings[n['wordId']] if n['wordId'] not in seen else ''
            seen.add(n['wordId'])

def lyric_groups(lines):
    groups=[]
    for line in lines:
        if not groups or line['end']-groups[-1][0]['start']>45:
            groups.append([])
        groups[-1].append(line)
    return groups

def run(request, progress):
    import numpy as np
    import soundfile as sf
    import librosa
    import torch
    import pyopenjtalk
    from music21 import stream, note as m21note
    from beat_this.inference import File2Beats
    sys.path.insert(0,str(Path(__file__).parent/'vendor/vocal2midi'))
    from inference.TiFA.runtime import load_tifa_model
    from inference.TiFA.aligner import run_tifa_fa
    from inference.API.game_api import load_game_model, extract_pitches_and_align
    from inference.io.note_io import NoteInfo, _save_midi
    from inference.quant.quantization import quantize_notes

    root,pack=Path(request['directory']),Path(request['pack'])
    dictionary=pyopenjtalk.OPEN_JTALK_DICT_DIR
    if isinstance(dictionary,bytes): dictionary=os.fsdecode(dictionary)
    if not (Path(dictionary)/'sys.dic').is_file():
        raise ValueError('发音词典未安装，请先运行 install-music-study.ps1')
    registry=json.loads(Path(__file__).with_name('vocal_models.json').read_text(encoding='utf-8'))
    for name,expected in registry['files'].items():
        with (pack/name).open('rb') as f:
            if hashlib.file_digest(f,'sha256').hexdigest()!=expected:
                raise ValueError('简谱模型校验失败：'+name)
    waveform,sr=sf.read(root/'vocals.wav',dtype='float32',always_2d=True)
    waveform=waveform.mean(axis=1)
    duration=len(waveform)/sr
    lines=validate_lines(request['lyrics'],duration)
    torch.set_num_threads(4)
    progress(.02,'载入人声简谱模型')
    import onnxruntime as ort
    device='dml' if 'DmlExecutionProvider' in ort.get_available_providers() else 'cpu'
    # Beat inference is on the mixture, where percussion is still present.
    predictor=File2Beats(checkpoint_path=str(pack/'vocal2midi/beat_this-final0.ckpt'),
                        device='cuda' if torch.cuda.is_available() else 'cpu',dbn=False)
    progress(.06,'识别节拍')
    beats,downbeats=predictor(str(root/'original.wav'))
    del predictor
    if torch.cuda.is_available(): torch.cuda.empty_cache()
    beats=np.asarray(beats,dtype=float)
    if len(beats)<4 or not np.isfinite(beats).all() or np.any(np.diff(beats)<=0):
        raise ValueError('未检测到稳定节拍，无法生成带时值简谱')
    tifa=load_tifa_model(pack/'vocal2midi/tifa',device=device)
    game=load_game_model(str(pack/'vocal2midi/game'),device=device)
    tempo=float(60/np.median(np.diff(beats)))
    phase=0
    if len(downbeats): phase=(-int(np.argmin(abs(beats-downbeats[0]))))%4
    def beat_at(t):
        if t<beats[0]: return (t-beats[0])/(beats[1]-beats[0])+phase
        if t>beats[-1]: return len(beats)-1+(t-beats[-1])/(beats[-1]-beats[-2])+phase
        return float(np.interp(t,beats,np.arange(len(beats))))+phase
    all_notes=[]
    # Use the song's language for kanji-only Japanese lines too.
    song_language=language_for(''.join(row['text'] for row in lines))
    from inference.TiFA.g2p_pipeline import build_g2p_pipeline
    g2p=build_g2p_pipeline(tifa.model_dir,japanese_g2p_engine='pyopenjtalk')
    with tempfile.TemporaryDirectory(prefix='vocal-align-',dir=root) as work:
        work=Path(work)
        groups=lyric_groups(lines)
        for index,group in enumerate(groups):
            start,end=max(0,group[0]['start']-.25),min(duration,group[-1]['end']+.25)
            wave=waveform[round(start*sr):round(end*sr)]
            sf.write(work/'chunk_0.wav',wave,sr,subtype='FLOAT')
            text='\n'.join(line['text'] for line in group)
            (work/'chunk_0.txt').write_text(text,encoding='utf-8')
            lang=song_language if song_language=='ja' else language_for(text)
            progress(.1+.7*index/len(groups),f'对齐歌词 {index+1}/{len(groups)}')
            pred,display=run_tifa_fa(tifa,work,language=lang,g2p_pipeline=g2p,japanese_g2p_engine='pyopenjtalk')
            if 'chunk_0' not in pred: raise ValueError('歌词无法对齐：'+text[:60])
            words=list(pred['chunk_0'][2])
            owners,word_starts=source_owners(words,group)
            chars=([r for r,k in display['chunk_0']] if lang=='ja' else
                   [w.text for w in words if hasattr(w,'source_word')])
            if sr!=game.samplerate: wave=librosa.resample(wave,orig_sr=sr,target_sr=game.samplerate)
            notes,processed=extract_pitches_and_align([{'waveform':wave,'offset':0.0}],game.samplerate,
                pred,{'chunk_0':chars},game,ts=[i/8 for i in range(8)],seg_threshold=.2,
                seg_radius=.02,est_threshold=.2,batch_size=1,language=lang)
            if processed!={0}: raise ValueError('未生成逐词音符：'+text[:60])
            seen=set();word_cursor=0;current_word=None;group_notes=[]
            lexical=[w for w in words if getattr(w,'source_word',-1) in owners]
            for n in notes:
                if not all(math.isfinite(v) for v in [n.onset,n.offset,n.pitch]): continue
                begin,finish=max(start,start+n.onset),min(end,start+n.offset)
                if finish<=begin: continue
                # GAME's lyric token is the native aligned word/mora identity;
                # longest time overlap can wrongly attach a melisma to a neighbor.
                if n.lyric not in ['', '-', '+', '#']:
                    while word_cursor<len(lexical) and lexical[word_cursor].text.casefold()!=n.lyric.casefold(): word_cursor+=1
                    if word_cursor>=len(lexical): raise ValueError('音符与原词映射丢失：'+n.lyric)
                    current_word=lexical[word_cursor];word_cursor+=1
                if current_word is None: raise ValueError('音符缺少原词')
                word=current_word
                word_id=word.source_word
                group_notes.append({'start':begin,'end':finish,'midi':max(0,min(127,round(n.pitch))),
                    'lineId':owners[word_id],'wordId':word_id,
                    'lyric':word.source_text if word_id not in seen else '',
                    'beat':beat_at(begin),'durationBeats':max(.125,beat_at(finish)-beat_at(begin))})
                seen.add(word_id)
            restore_spelling(group_notes,group,word_starts)
            for n in group_notes: n['wordId']+=index*10000
            all_notes.extend(group_notes)
    if not all_notes: raise ValueError('人声轨中没有识别到可用音符')
    all_notes.sort(key=lambda n:n['start'])
    # Quantization works in the detected (possibly varying) beat grid, not a fake
    # constant-speed audio clock. Keep raw start/end unchanged.
    for line in lines:
        notes=[n for n in all_notes if n['lineId']==line['id']]
        normalized=[NoteInfo(n['beat']/2,(n['beat']+n['durationBeats'])/2,n['midi'],n['lyric']) for n in notes]
        quantize_notes(normalized,120,120,mode='smart',simplicity=0)
        for n,q in zip(notes,normalized):
            n['beat'],n['durationBeats']=q.onset*2,max(.125,(q.offset-q.onset)*2)
    pitches=stream.Stream()
    for n in all_notes: pitches.append(m21note.Note(n['midi'],quarterLength=n['durationBeats']))
    key=pitches.analyze('key')
    key_data={'tonic':key.tonic.pitchClass,'mode':key.mode}
    (root/'notation').mkdir(exist_ok=True)
    _save_midi([NoteInfo(n['start'],n['end'],n['midi'],n['lyric']) for n in all_notes],root/'notation/vocal-raw.mid',tempo=tempo)
    return {'algorithm':ALGORITHM,'source':'vocals','notes':all_notes,'key':key_data,
            'tempo':tempo,'lyricsKey':lyrics_key(request['lyrics'])}

if __name__=='__main__':
    request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    root=Path(request['directory'])
    def progress(value,stage):
        print(json.dumps({'kind':'progress','progress':value,'stage':stage},ensure_ascii=False),flush=True)
    try:
        result=run(request,progress)
        path=root/'vocal-notes-result.json';tmp=path.with_suffix('.part')
        tmp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
        tmp.replace(path)
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        (root/'vocal-notes-error.txt').write_text(str(error),encoding='utf-8')
        sys.exit(1)
