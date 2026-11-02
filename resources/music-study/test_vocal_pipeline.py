import json
import unittest
from types import SimpleNamespace as Word
from vocal_pipeline import validate_lines, source_owners, restore_spelling, lyric_groups, prepare_lyrics
from vocal_score import inert_svg, phrase_part, engraving_part

class VocalPipelineTests(unittest.TestCase):
    def test_provider_outro_is_cleaned_before_audio_duration_validation(self):
        from pathlib import Path
        from unittest.mock import patch
        rows=[dict(id=0,start=5,end=7,text='真实演唱'),
              dict(id=61,start=349.203,end=350,text='出品音乐公司：天涯音乐工作室 Tian Ya Music Productions')]
        with patch('vocal_activity.detect_vocal_activity',return_value=dict(status='estimated',start=5,end=7,margin=.8)), \
             patch('vocal_lyric_classifier.filter_lyrics',side_effect=lambda lines,pack:(lines,[],dict(elapsedMs=0))):
            kept,policy,_=prepare_lyrics(json.dumps(rows),349.5417,Path('audio'),Path('models'))
        self.assertEqual(kept,rows[:1])
        self.assertIn(dict(id=61,reason='after_vocals'),policy['excluded'])

    def test_uncertain_activity_still_rejects_sung_rows_outside_audio(self):
        from pathlib import Path
        from unittest.mock import patch
        rows=[dict(id=3,start=349,end=350,text='不要误删这句演唱')]
        with patch('vocal_activity.detect_vocal_activity',return_value=dict(status='uncertain')), \
             patch('vocal_lyric_classifier.filter_lyrics',side_effect=lambda lines,pack:(lines,[],dict(elapsedMs=0))):
            with self.assertRaisesRegex(ValueError,'第 4 行.*349.54'):
                prepare_lyrics(json.dumps(rows),349.5417,Path('audio'),Path('models'))

    def test_structured_lead_lyrics_skip_credit_words_and_do_not_read_audio_boundaries(self):
        from pathlib import Path
        from unittest.mock import patch
        rows=[dict(id=3,start=0,end=2,text='作词：我心中的你',origin=dict(format='amll-ttml',kind='lyric'))]
        with patch('vocal_activity.detect_vocal_activity',side_effect=AssertionError('Must not run for TTML')):
            selected,policy,elapsed=prepare_lyrics(json.dumps(rows),5,Path('nonexistent-audio'),Path('models'))
        self.assertEqual(selected,rows)
        self.assertEqual(policy['mode'],'structured')
        self.assertEqual(policy['activity']['status'],'skipped')
        self.assertEqual(policy['excluded'],[])
        self.assertEqual(elapsed,0)

    def test_plain_provider_lyrics_keep_the_existing_credit_and_vocal_boundary_fallback(self):
        from pathlib import Path
        from unittest.mock import patch
        rows=[dict(id=0,start=0,end=1,text='作词：某某'),dict(id=1,start=1,end=2,text='Unknown attribution'),
              dict(id=2,start=5,end=7,text='真正演唱的歌词')]
        activity=dict(status='estimated',start=5,end=7,margin=.8)
        with patch('vocal_activity.detect_vocal_activity',return_value=activity) as detect, \
             patch('vocal_lyric_classifier.filter_lyrics',side_effect=lambda lines,pack:(lines,[],dict(elapsedMs=0))):
            selected,policy,_=prepare_lyrics(json.dumps(rows),8,Path('audio'),Path('models'))
        detect.assert_called_once()
        self.assertEqual(selected,rows[2:])
        self.assertEqual(policy['mode'],'heuristic')
        self.assertEqual(policy['excluded'],[dict(id=0,reason='credit'),dict(id=1,reason='before_vocals')])

    def test_mixed_source_annotations_cannot_disable_the_provider_cleanup(self):
        rows=[dict(id=0,start=0,end=1,text='Main',origin=dict(format='amll-ttml',kind='lyric')),
              dict(id=1,start=1,end=2,text='Other')]
        with self.assertRaisesRegex(ValueError,'来源混用'):validate_lines(json.dumps(rows),3)

    def test_rounding_an_attack_onto_the_next_downbeat_cannot_leave_an_empty_pickup_measure(self):
        from music21 import stream
        for beat in [223.97297282506887,3.98,-.02]:
            part,events=phrase_part([(7,dict(beat=beat,durationBeats=.375)),(8,dict(beat=beat+.375,durationBeats=.25))])
            rendered=engraving_part(part)
            self.assertTrue(all(m.highestTime>0 for m in rendered.getElementsByClass(stream.Measure)))
            self.assertEqual(events,[(0,.375,7),(.375,.625,8)])

    def test_complex_rests_are_split_before_musicxml_roundtrip_without_losing_time_or_note_identity(self):
        from music21 import stream
        import jianpu_ly
        import tempfile
        from pathlib import Path
        beats=[(1,.125),(1.75,.125),(4.125,.625),(4.75,.125),(4.875,.125),(5,.125),(8.75,.75)]
        part,events=phrase_part([(i,dict(beat=b,durationBeats=d)) for i,(b,d) in enumerate(beats)])
        self.assertEqual(set(index for start,end,index in events),set(range(len(beats))))
        self.assertAlmostEqual(sum(end-start for start,end,index in events),sum(d for b,d in beats))
        for obj in part.recurse().notesAndRests:
            self.assertEqual(len(obj.duration.components),1)
            self.assertLessEqual(obj.duration.dots,1)
        with tempfile.TemporaryDirectory() as directory:
            score=stream.Score();score.append(engraving_part(part));xml=Path(directory)/'rest.musicxml'
            score.write('musicxml',fp=str(xml))
            self.assertTrue(jianpu_ly.process_input(jianpu_ly.xml2jianpu(xml.read_text(encoding='utf-8'))))

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
