"""Language/vowel provenance across mixed lyrics, without ASR or guessed text."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace as NS
import numpy as np

sys.path.insert(0,str(Path(__file__).parent/'vendor/vocal2midi'))
from vocal_pipeline import languages_for, validate_lines
from vocal_lyrics import is_credit
from inference.TiFA.aligner import _build_word_list, run_tifa_fa
from inference.API.game_api import extract_vowel_boundaries, _find_word_nucleus_start


class MixedLanguageTests(unittest.TestCase):
    def test_retry_of_frozen_lyrics_also_ignores_production_credits(self):
        texts=["Say it's a new world",'人声编辑：名字@SBMS Beijing','吉他：名字','鼓：名字','鼓录音：名字@55TEC','和声&和声设计：名字']
        rows=[dict(id=i,start=i,end=i+.8,text=text) for i,text in enumerate(texts)]
        self.assertEqual(validate_lines(json.dumps(rows),10),rows[:1])
        self.assertFalse(is_credit('Hello: my world'))
        self.assertFalse(is_credit('吉他轻轻唱'))
        with self.assertRaisesRegex(ValueError,'演唱歌词'):validate_lines(json.dumps(rows[1:]),10)

    def test_credit_composition_and_codec_tail_padding_are_normalized_before_alignment(self):
        for text in ['民谣吉他：怪兽','Loop：石头','弦乐编曲：乐手','弦乐改编：乐手','弦乐演奏：乐手',
                     '人声录音室: Studio','插画: Lost7','Programing / Guitars / Keyboards &Sythn : 音乐人']:
            self.assertTrue(is_credit(text),text)
        rows=[dict(id=1,start=250,end=261.66857142857145,text='最后一句'),
              dict(id=2,start=261,end=262,text='弦乐演奏：乐手')]
        selected=validate_lines(json.dumps(rows),261.6184580498866)
        self.assertEqual(selected,[{**rows[0],'end':261.6184580498866}])
        with self.assertRaisesRegex(ValueError,'歌词时间'):validate_lines(json.dumps(rows[:1]),261.4)

    def test_language_set_preserves_kanji_context_but_keeps_english_lines_english(self):
        self.assertEqual(languages_for("梦一样的自由 Say it's a new world",'zh'),['zh','en'])
        self.assertEqual(languages_for('明日 hello world','ja'),['ja','en'])
        self.assertEqual(languages_for('明日','ja'),['ja'])
        self.assertEqual(languages_for('Say hello','ja'),['en'])
        self.assertEqual(languages_for('青花瓷','zh'),['zh'])

    def test_studio_labels_and_exact_notices_do_not_erase_ordinary_sentences(self):
        for text in ['配唱编写：某某','人声录音师：某某','人声录音棚A：某棚','鼓录音室2：某棚',
                     '低音吉他：某某','曼陀林：某某','小号：某某','Vocal edite：某某',
                     'OP: Publisher','Lead & Background Vocals: Singer','Talkbox: Player',
                     '未经著作权人许可 不得翻录翻唱或使用']:
            self.assertTrue(is_credit(text),text)
        for text in ['我在录音室里等你','录音室A的灯还亮着：你在哪','制作人说：再唱一次',
                     'I said: stay','Love: don’t leave','你说未经著作权人许可 不得翻录翻唱或使用',
                     'Recorded at dawn, I remembered you']:
            self.assertFalse(is_credit(text),text)

    def test_japanese_mora_and_english_words_keep_their_own_identity_and_phones(self):
        phones=['ja/a','ja/i','en/W','en/ER','en/L','en/D','zh/n','zh/i']
        rows=_build_word_list(np.array([[i,i+1] for i in range(8)]),np.arange(8),
            np.array([1,1,2,2,2,2,3,3]),np.array([1,2,3,3,3,3,4,4]),np.ones(3,dtype=int),
            [[dict(phonemes=phones[:2],scripts=['あ','い'])],
             [dict(phonemes=phones[2:6],scripts=['world'])],
             [dict(phonemes=phones[6:],scripts=['你'])]],
            ['愛','world','你'],None,'ja',.1,.8,word_languages=['ja','en','zh'])[0]
        lexical=[word for word in rows if hasattr(word,'source_word')]
        self.assertEqual([word.source_language for word in lexical],['ja','ja','en','zh'])
        self.assertEqual([word.source_word for word in lexical],[0,0,1,2])
        self.assertEqual([p.text for p in lexical[2].phonemes],['W','ER','L','D'])

    def test_mixed_english_syllables_do_not_use_mandarin_vowel_heuristics(self):
        def word(text,language,start,end,phones):
            return NS(text=text,source_language=language,start=start,end=end,
                      phonemes=[NS(text=p,start=t,end=t+.05) for p,t in phones])
        rows=[word('你','zh',0,.5,[('n',0),('i',.2)]),
              word('very','en',.5,1.2,[('V',.5),('EH',.7),('R',.8),('IY',.95)]),
              word('的','zh',1.2,1.6,[('d',1.2),('e',1.3)])]
        self.assertEqual(_find_word_nucleus_start(rows[1],'zh'),.7)
        durations,voiced,lyrics=extract_vowel_boundaries(rows,['你','very','的'],language='zh')
        self.assertEqual(lyrics,['','你','very','+','的'])
        self.assertAlmostEqual(sum(durations),1.6)
        self.assertEqual(voiced,[0,1,1,1,1])


@unittest.skipUnless(os.environ.get('TWILIGHT_MUSIC_STUDY_HOME'),'local pronunciation model pack required')
class PronunciationPackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from inference.TiFA.g2p_pipeline import build_g2p_pipeline
        from inference.TiFA.lib.vocabulary import Vocabulary
        cls.pack=Path(os.environ['TWILIGHT_MUSIC_STUDY_HOME'])/'models/vocal2midi/tifa'
        cls.g2p=build_g2p_pipeline(cls.pack,japanese_g2p_engine='pyopenjtalk')
        cls.vocabulary=Vocabulary.from_file(cls.pack/'vocabulary.json')

    def test_real_pronunciations_encode_chinese_english_and_japanese_english(self):
        from inference.TiFA.g2p.encoding import encode_paths
        for text,langs in [("梦一样的自由\nSay it's a new world",['zh','en']),('明日 hello world',['ja','en'])]:
            words=self.g2p.convert(text,languages=langs)
            self.assertIn('en',{word.language for word in words})
            self.assertIn(langs[0],{word.language for word in words})
            data,_,_=encode_paths(words,self.vocabulary,'discard',languages=langs,
                global_symbols=('AP','SP','EP','GS','sil','br','pau'),stop_symbols=('SP','sil','pau'))
            self.assertTrue(data['paths'].any())

    def test_bad_language_configuration_preserves_encoding_cause(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'chunk_0.wav').touch()
            (root/'chunk_0.txt').write_text("梦一样的自由 Say it's a new world",encoding='utf-8')
            model=NS(timestep=.01,vocabulary=self.vocabulary)
            with self.assertRaisesRegex(ValueError,'歌词发音编码失败.*say'):
                run_tifa_fa(model,root,language='zh',g2p_pipeline=self.g2p)

    def test_numeric_english_lyrics_have_candidate_pronunciations_and_original_identity(self):
        from inference.TiFA.g2p.encoding import encode_paths
        from vocal_pipeline import source_owners
        text='24/7 90 1999 007 1st'
        words=self.g2p.convert(text,languages=['en'])
        self.assertEqual([word.text for word in words],['24','7','90','1999','007','1st'])
        readings={tuple(group.script for group in path) for reading in words[0].readings for path in reading.paths}
        self.assertIn(('twenty','four'),readings)
        self.assertIn(('two','four'),readings)
        data,_,texts=encode_paths(words,self.vocabulary,languages=['en'])
        self.assertTrue(data['paths'].any())
        aligned=[NS(source_word=i,source_text=source) for i,source in enumerate(texts)]
        owners,_=source_owners(aligned,[dict(id=8,text=text)])
        self.assertEqual(set(owners.values()),{8})

    def test_standalone_hyphens_are_not_pronounced_but_compounds_and_original_punctuation_survive(self):
        from inference.TiFA.g2p.encoding import encode_paths
        from vocal_pipeline import source_owners,restore_spelling
        text="Sincerely yours' Stan -- P.S. I can't stop - not-a chance"
        words=self.g2p.convert(text,languages=['en'])
        self.assertFalse(any(word.text in ['-','--'] for word in words))
        self.assertIn("can't",[word.text for word in words])
        self.assertIn('not-a',[word.text for word in words])
        encode_paths(words,self.vocabulary,languages=['en'])
        owners,starts=source_owners([NS(source_word=i,source_text=w.text) for i,w in enumerate(words)],[dict(id=9,text=text)])
        notes=[dict(wordId=i,lineId=owners[i],lyric='') for i in range(len(words))]
        restore_spelling(notes,[dict(id=9,text=text)],starts)
        self.assertEqual(''.join(n['lyric'] for n in notes),text)

    def test_japanese_quote_punctuation_is_not_sent_as_an_unknown_phoneme(self):
        from inference.TiFA.g2p.encoding import encode_paths
        from vocal_pipeline import source_owners
        text='「さよなら」だけだった。『愛してる』'
        words=self.g2p.convert(text,languages=['ja'])
        data,_,texts=encode_paths(words,self.vocabulary,languages=['ja'])
        self.assertTrue(data['paths'].any())
        self.assertFalse(any(char in ''.join(texts) for char in '「」『』。'))
        owners,_=source_owners([NS(source_word=i,source_text=source) for i,source in enumerate(texts)],[dict(id=4,text=text)])
        self.assertEqual(set(owners.values()),{4})


if __name__=='__main__':unittest.main()
