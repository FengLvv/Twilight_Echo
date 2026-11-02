import copy
import unittest
from unittest.mock import patch
from vocal_cache import group_key, reuse_group, score_key, reuse_score
from vocal_pipeline import lyric_groups


class VocalReuseTests(unittest.TestCase):
    def test_child_receives_algorithm_provenance_with_reusable_notes_but_not_svg(self):
        from vocal_melody import recognize, ALGORITHM
        prior=dict(algorithm=ALGORITHM,notes=[dict(midi=60)],reuse=dict(parent='parent'),scores=['large-svg'])
        with patch('vocal_melody.invoke',return_value={}) as invoke:
            recognize(model_pack='models',progress=lambda *args:None,lyrics='lyrics',directory='audio',previous=prior,parent='parent')
        self.assertEqual(invoke.call_args.kwargs['payload']['previous'],{k:v for k,v in prior.items() if k!='scores'})
    def test_text_retime_and_context_boundary_invalidate_only_matching_context(self):
        lines=[dict(id=i,start=i*15,end=i*15+10,text=f'line {i}') for i in range(6)]
        before=[group_key(group,'en') for group in lyric_groups(lines)]
        changed=copy.deepcopy(lines);changed[1]['text']='corrected word'
        after=[group_key(group,'en') for group in lyric_groups(changed)]
        self.assertNotEqual(before[0],after[0]);self.assertEqual(before[1:],after[1:])
        changed=copy.deepcopy(lines);changed[0]['start']+=.1
        self.assertNotEqual(before[0],group_key(lyric_groups(changed)[0],'en'))
        # Deleting a line can regroup following lines; reuse follows actual
        # context identity rather than assuming only the removed row changed.
        changed=lines[1:]
        self.assertFalse(set(before)&{group_key(g,'en') for g in lyric_groups(changed)})
        self.assertNotEqual(before[0],group_key(lyric_groups(lines)[0],'ja'))

    def test_reindex_keeps_pitch_and_timing_but_remaps_row_and_word_identities(self):
        notes=[dict(lineId=3,wordId=10004,start=12,end=13,midi=67)]
        previous=dict(notes=notes,reuse=dict(groups=[dict(key='k',lineIds=[3],noteIndices=[0],wordBase=10000)]))
        result=reuse_group(previous,'k',[dict(id=99)],20000)
        self.assertEqual(result,[dict(lineId=99,wordId=20004,start=12,end=13,midi=67)])
        self.assertEqual(previous['notes'],notes)
        result[0]['midi']=1;self.assertEqual(notes[0]['midi'],67)
        self.assertIsNone(reuse_group(previous,'missing',[dict(id=99)],0))

    def test_score_reuse_remaps_every_tied_head_after_preceding_note_count_changes(self):
        previous=[dict(key='k',noteIndices=[4,5],svg='<svg><g data-note="4"/><g data-note="4" data-held="true"/><g data-note="5"/></svg>')]
        self.assertEqual(reuse_score(previous,'k',[9,10]),'<svg><g data-note="9"/><g data-note="9" data-held="true"/><g data-note="10"/></svg>')
        self.assertIsNone(reuse_score(previous,'k',[9]))
        self.assertIsNone(reuse_score([dict(key='k',noteIndices=[4,5],svg='<svg data-note="7"/>')],'k',[9,10]))

    def test_neutral_engraving_uses_rhythm_and_spelling_not_presentation_pitch_or_absolute_note_index(self):
        rows=[(2,dict(beat=5,durationBeats=.5,lyric='word',midi=60))]
        moved=[(100,dict(beat=9,durationBeats=.5,lyric='word',midi=67))]
        self.assertEqual(score_key(rows),score_key(moved))
        self.assertEqual(score_key([(2,dict(beat=5.,durationBeats=1.,lyric='x'))]),
                         score_key([(2,dict(beat=5,durationBeats=1,lyric='x'))]))
        moved[0][1]['durationBeats']=1
        self.assertNotEqual(score_key(rows),score_key(moved))


if __name__=='__main__':unittest.main()
