"""Round-trip native exports against the actual canonical pitch/time/lyric data."""
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import mido

root=Path(sys.argv[1]);run_name=sys.argv[2] if len(sys.argv)>2 else 'verified'
results=json.loads((root/f'results-{run_name}.json').read_text(encoding='utf-8'))
audits=[]
for result in results:
    if result['outcome']!='passed':
        continue
    project_path=root/f'results-{run_name}'/f'{result["index"]:02}-{result["ncmId"]}'/'project.json'
    project=json.loads(project_path.read_text(encoding='utf-8'))
    melody=project['result']['melody'];notes=melody['notes'];score_rows=melody['scores']
    for notation,exported in result['exports'].items():
        folder=Path(exported['directory']);manifest=json.loads((folder/'score.json').read_text(encoding='utf-8'))
        assert manifest['notation']==notation
        assert len(manifest['rows'])==len(score_rows)
        assert len(list(folder.glob('*.svg')))==len(score_rows)
        assert not list((folder/'source').glob('*.layout.musicxml'))
        clock=0.;events={'note_on':[],'note_off':[]}
        for msg in mido.MidiFile(folder/'source/vocal-raw.mid',charset='utf8'):
            clock+=msg.time
            if msg.type in events:
                kind='note_off' if msg.type=='note_on' and not msg.velocity else msg.type
                events[kind].append((msg.note,clock))
        max_error=0.
        for kind,field in [('note_on','start'),('note_off','end')]:
            expected=sorted((n['midi'],n[field]) for n in notes)
            actual=sorted(events[kind]);assert len(actual)==len(expected)
            for (pitch,stamp),(target_pitch,target_stamp) in zip(actual,expected):
                assert pitch==target_pitch
                max_error=max(max_error,abs(stamp-target_stamp))
        assert max_error<.002,(result['title'],max_error)
        xml_files=list((folder/'source').glob('*.musicxml'));assert len(xml_files)==len(score_rows)
        for row in score_rows:
            xml=ET.parse(folder/'source'/f'line-{row["lineId"]}.musicxml')
            heads=[n for n in xml.findall('.//note') if n.find('pitch') is not None
                   and not any(tie.get('type')=='stop' for tie in n.findall('tie'))]
            expected=[n for n in notes if n['lineId']==row['lineId']]
            pitches=[]
            for head in heads:
                p=head.find('pitch');step={'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[p.findtext('step')]
                pitches.append((int(p.findtext('octave'))+1)*12+step+int(p.findtext('alter','0')))
            assert pitches==[n['midi'] for n in expected],(result['title'],row['lineId'])
            assert ''.join(n.findtext('lyric/text','') for n in heads)==row['text']
        audits.append(dict(index=result['index'],title=result['title'],notation=notation,
                           notes=len(notes),rows=len(score_rows),midiMaxTimeErrorMs=round(max_error*1000,4)))
(root/f'export-audit-{run_name}.json').write_text(json.dumps(audits,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(songs=len(audits)//2,exports=len(audits),midiAndMusicXml='verified')))
