"""Native music21 / jianpu-ly / LilyPond layout, serialized as inert SVG.

The native engraver owns rests, ties, beams, barlines and lyric spacing. Notehead
labels are data-bound by the player so changing the display key needs no inference
or re-engraving. A neutral notehead avoids baked-in accidental/octave glyphs.
"""
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import time
from runtime_context import check_cancel
from vocal_cache import score_key, reuse_score

SVG='http://www.w3.org/2000/svg'
SCORE_LAYOUT_KEY='lyric-phrase-v1'
ET.register_namespace('',SVG)

def inert_svg(source):
    root=ET.fromstring(source)
    allowed={'svg','g','path','text','tspan','line','rect','polygon','polyline','circle','ellipse','defs','clipPath'}
    attributes={'viewBox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry',
        'd','points','transform','fill','stroke','stroke-width','stroke-linejoin','stroke-linecap',
        'font-family','font-size','font-weight','font-style','text-anchor','data-note','data-held','opacity'}
    for parent in root.iter():
        for child in list(parent):
            if child.tag.split('}')[-1] not in allowed: parent.remove(child)
        for name in list(parent.attrib):
            if name not in attributes: del parent.attrib[name]
        for attr in ['fill','stroke']:
            value=parent.get(attr)
            if value and value!='none': parent.set(attr,'currentColor')
    root.attrib.pop('width',None);root.attrib.pop('height',None)
    return ET.tostring(root,encoding='unicode')

def phrase_part(rows):
    """A lyric phrase has a pickup/final partial bar, not fabricated silent edges."""
    from music21 import stream,note,meter,key
    part=stream.Part()
    part.insert(0,meter.TimeSignature('4/4'));part.insert(0,key.Key('C'))
    base=int(rows[0][1]['beat']//4)*4
    cursor=0
    for i,row in rows:
        start=max(cursor,round((row['beat']-base)*8)/8)
        length=max(.125,round(row['durationBeats']*8)/8)
        n=note.Note('C4',quarterLength=length)
        n.editorial['vocalIndex']=i
        part.insert(start,n);cursor=start+length
    part.makeMeasures(inPlace=True);part.makeTies(inPlace=True)
    measures=list(part.getElementsByClass(stream.Measure))
    for measure in measures:
        measure.makeRests(fillGaps=True,inPlace=True,timeRangeFromBarDuration=True)
    measures[0].padAsAnacrusis(useInitialRests=True)
    last=measures[-1]
    for obj in list(reversed(last.notesAndRests)):
        if not obj.isRest: break
        last.remove(obj)
    last.paddingRight=max(0,4-last.highestTime-(last.paddingLeft if len(measures)==1 else 0))
    # The engraver splits double/triple dots into supported native durations.
    for measure in measures:
        for obj in list(measure.notesAndRests):
            if obj.duration.dots<=1: continue
            remaining=float(obj.duration.quarterLength);lengths=[]
            for v in [4,3,2,1.5,1,.75,.5,.375,.25,.1875,.125,.0625]:
                while remaining>=v-1e-8: lengths.append(v);remaining-=v
            if abs(remaining)>1e-7: raise ValueError('无法排版音符时值')
            offset=float(obj.offset);measure.remove(obj)
            for piece in obj.splitByQuarterLengths(lengths):
                measure.insert(offset,piece);offset+=float(piece.duration.quarterLength)
    # MusicXML serializes measures consecutively; pickup padding is not elapsed
    # phrase time. Retain the original note identity through splits and ties.
    events=[];cursor=0
    for measure in measures:
        for obj in measure.notes:
            start=cursor+float(obj.offset)
            events.append((start,start+float(obj.duration.quarterLength),obj.editorial['vocalIndex']))
        cursor+=float(measure.highestTime)
    return part,events


def compile_batch(lily, paths, out):
    """One native parser per bounded batch; cancellation kills only this child."""
    command=[str(lily),'-dbackend=svg','-dcrop','-dno-point-and-click','-o',str(out.resolve())+'/',
             *[str(path.resolve()) for path in paths]]
    child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if __import__('os').name=='nt' else 0)
    started=time.monotonic()
    try:
        while True:
            check_cancel()
            try:
                _,stderr=child.communicate(timeout=.1)
                break
            except subprocess.TimeoutExpired:
                if time.monotonic()-started>180:
                    raise ValueError('简谱排版超时')
        if child.returncode:
            raise ValueError('简谱排版失败：'+stderr.decode('utf-8',errors='replace')[-600:])
    finally:
        if child.poll() is None:
            child.kill();child.communicate()


def engrave(notes,lines,directory,home,progress,previous=None):
    from music21 import stream
    import jianpu_ly
    jianpu_ly.force_staff=False
    lily=home/'notation-tools/lilypond-2.24.4/bin/lilypond.exe'
    if not lily.is_file(): raise ValueError('简谱排版器未安装，请运行 install-music-study.ps1')
    out=directory/'notation';out.mkdir(exist_ok=True)
    scores=[];pending=[]
    for index,line in enumerate(lines):
        check_cancel()
        rows=[(i,n) for i,n in enumerate(notes) if n['lineId']==line['id']]
        if not rows: continue
        key=SCORE_LAYOUT_KEY+'|'+score_key(rows)
        indices=[i for i,n in rows]
        reused=reuse_score(previous or [],key,indices)
        scores.append({'lineId':line['id'],'text':line['text'],'key':key,'noteIndices':indices,'svg':reused})
        if reused is not None:
            continue
        score=stream.Score();part,events=phrase_part(rows)
        lyric_tokens=[]
        for i,row in rows:
            text=row.get('lyric','')
            # jianpu-ly handles quoted tokens; exclude executable LilyPond syntax.
            text=text.replace('\\','').replace('"',"'").replace('\n',' ')
            lyric_tokens.append('"'+text+'"' if text else '_')
        score.append(part)
        xml=out/f'line-{line["id"]}.layout.musicxml';score.write('musicxml',fp=str(xml))
        jly=jianpu_ly.xml2jianpu(xml.read_text(encoding='utf-8'))
        jly=re.sub(r'(?m)^L:.*$', '',jly)
        jly+='\nL: '+' '.join(lyric_tokens)+'\n'
        # No extra title or instructions in the player surface.
        jly='\n'.join(l for l in jly.splitlines() if not l.startswith(('title=','composer=')))
        source=jianpu_ly.process_input(jly)
        source=source.replace('\\new RhythmicStaff \\with {',
            '\\new RhythmicStaff \\with {\n \\remove "Time_signature_engraver"\n \\remove "Bar_engraver"')
        source=source.replace('\\tweak NoteHead.stencil', "\\tweak NoteHead.X-extent #'(-0.7 . 1.7)\n     \\tweak NoteHead.stencil")
        cursor=0.
        def mark(match):
            nonlocal cursor
            label,pitch,value,dots=match.groups()
            start=cursor;cursor+=4/int(value)*(2-2**(-len(dots)))
            event=next((e for e in events if e[0]-.001<=start<e[1]-.001),None)
            if pitch=='r' or label=='0' or not event: return match.group(0)
            held=' (data-held . "true")' if label=='–' else ''
            return f'\\once \\override NoteHead.output-attributes = #\'((data-note . "{event[2]}"){held}) '+match.group(0)
        source=re.sub(r'\\note-mod "([^"\n]+)" (c\x27|r)(\d+)(\.*)',mark,source)
        source=source.replace('\\mark \\markup{1=C}','')
        source+='\n\\header { tagline = ##f }\n\\layout { \\context { \\RhythmicStaff \\omit TimeSignature \\omit BarLine } }\n\\paper { indent = 0\\mm\n ragged-right = ##t\n page-breaking = #ly:one-line-breaking\n #(define fonts (set-global-fonts #:roman "Microsoft YaHei" #:sans "Microsoft YaHei")) }\n'
        ly=xml.with_suffix('.ly');ly.write_text(source,encoding='utf-8')
        pending.append((ly,scores[-1]))
    for offset in range(0,len(pending),16):
        batch=pending[offset:offset+16]
        compile_batch(lily,[path for path,_ in batch],out)
        for ly,score in batch:
            svg=ly.with_suffix('.cropped.svg')
            if not svg.exists(): svg=ly.with_suffix('.svg')
            inert=inert_svg(svg.read_text(encoding='utf-8'))
            if 'data-note=' not in inert: raise ValueError('简谱缺少音符时间映射')
            score['svg']=inert
        progress(.82+.17*min(offset+16,len(pending))/len(pending),f'排版简谱 {min(offset+16,len(pending))}/{len(pending)}')
    return scores
