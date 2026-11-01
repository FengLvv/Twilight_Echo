import json
import unittest
from types import SimpleNamespace as Word
from vocal_pipeline import validate_lines, source_owners, restore_spelling, lyric_groups
from vocal_score import inert_svg, phrase_part, engraving_part

class VocalPipelineTests(unittest.TestCase):
    def test_render_adapter_supports_every_eighth_beat_pickup_without_changing_source_events(self):
        from music21 import stream,meter
        import jianpu_ly
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            for tick in range(1,32):
                start=tick/8
                rows=[(i,dict(beat=start+i*.75,durationBeats=.75)) for i in range(12)]
                original,events=phrase_part(rows)
                original_measures=list(original.getElementsByClass(stream.Measure))
                pickup=float(original_measures[0].paddingLeft)
                rendered=engraving_part(original)
                score=stream.Score();score.append(rendered)
                xml=Path(directory)/'phrase.musicxml';score.write('musicxml',fp=str(xml))
                # The native converter previously failed for the 3.5-beat edge.
                source=jianpu_ly.process_input(jianpu_ly.xml2jianpu(xml.read_text(encoding='utf-8')))
                self.assertTrue(source)
                self.assertEqual(float(original_measures[0].paddingLeft),pickup)
                self.assertEqual([float(m.highestTime) for m in rendered.getElementsByClass(stream.Measure)],
                                 [float(m.highestTime) for m in original_measures])
                self.assertAlmostEqual(sum(end-begin for begin,end,index in events),9)

    def test_phrase_pickup_and_final_partial_measure_keep_only_interior_rests(self):
        from music21 import stream
        rows=[(i,{'beat':b,'durationBeats':d}) for i,(b,d) in enumerate([(78.5,.5),(79,.5),(79.5,.5),(80,.5),(81,.5),(81.5,.5),(82,1)])]
        part,events=phrase_part(rows)
        measures=list(part.getElementsByClass(stream.Measure))
        self.assertEqual(float(measures[0].paddingLeft),2.5)
        self.assertEqual(float(measures[-1].paddingRight),1)
        serialized=list(part.recurse().notesAndRests)
        self.assertFalse(serialized[0].isRest)
        self.assertFalse(serialized[-1].isRest)
        self.assertEqual([float(n.quarterLength) for n in serialized if n.isRest],[.5])
        self.assertEqual([e[2] for e in events],list(range(7)))
        self.assertEqual(events[0][0],0)
        self.assertEqual(events[-1][1],4.5)

    def test_short_single_measure_phrase_is_not_padded_at_either_edge(self):
        rows=[(4,{'beat':3.25,'durationBeats':.375})]
        part,events=phrase_part(rows)
        self.assertEqual(len(list(part.recurse().notesAndRests)),1)
        self.assertEqual(events,[(0,.375,4)])

    def test_cross_bar_ties_preserve_original_note_identity(self):
        part,events=phrase_part([(7,{'beat':3,'durationBeats':2}),(8,{'beat':5,'durationBeats':1})])
        self.assertEqual([e[2] for e in events],[7,7,8])
        self.assertEqual(sum(e[1]-e[0] for e in events),3)
    def test_japanese_mora_keep_kanji_and_written_long_vowel(self):
        lines=[{'id':7,'start':0,'end':4,'text':'大人になろうとした'}]
        words=[Word(source_word=0,source_text='大人'),Word(source_word=0,source_text='大人'),
               Word(source_word=1,source_text='に'),Word(source_word=2,source_text='なろ'),
               Word(source_word=3,source_text='と'),Word(source_word=4,source_text='した')]
        owners,starts=source_owners(words,lines)
        notes=[{'lineId':7,'wordId':i,'lyric':'romanized'} for i in [0,0,1,2,2,3,4]]
        restore_spelling(notes,lines,starts)
        self.assertEqual(''.join(n['lyric'] for n in notes),lines[0]['text'])
        self.assertEqual(notes[3]['lyric'],'なろう')
        self.assertEqual(owners[0],7)

    def test_context_groups_preserve_row_identity_across_repeated_lyrics(self):
        lines=[{'id':i,'start':i*20,'end':i*20+10,'text':'同一句'} for i in range(4)]
        self.assertEqual([[r['id'] for r in g] for g in lyric_groups(lines)],[[0,1],[2,3]])
        words=[Word(source_word=i,source_text='同一句') for i in range(2)]
        owners,_=source_owners(words,lines[:2])
        self.assertEqual(owners,{0:0,1:1})

    def test_missing_invalid_and_unbounded_lyrics_fail_explicitly(self):
        with self.assertRaises(ValueError): validate_lines('[]',20)
        with self.assertRaises(ValueError): validate_lines(json.dumps([{'id':0,'start':0,'end':60,'text':'词'}]),70)
        with self.assertRaises(ValueError): validate_lines(json.dumps([{'id':0,'start':0,'end':float('nan'),'text':'词'}]),70)
        with self.assertRaises(ValueError): source_owners([Word(source_word=0,source_text='wrong')],[{'id':0,'text':'原词'}])

    def test_svg_keeps_native_geometry_and_discards_executable_content(self):
        svg=inert_svg('<svg xmlns="http://www.w3.org/2000/svg" onload="bad()"><script>bad()</script><g data-note="2"><path d="M0 0" fill="black"/><text>青</text></g><image href="https://bad"/></svg>')
        self.assertIn('data-note="2"',svg)
        self.assertIn('currentColor',svg)
        self.assertNotIn('script',svg)
        self.assertNotIn('onload',svg)
        self.assertNotIn('https://bad',svg)

if __name__=='__main__': unittest.main()
