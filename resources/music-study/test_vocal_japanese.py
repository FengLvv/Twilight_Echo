"""Japanese small-kana spellings retain lyrics and valid dictionary phones."""
import os
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent / 'vendor/vocal2midi'))
from inference.TiFA.g2p.converters.japanese import JapaneseKanaConverter, _KANA_TO_ROMAJI


class JapaneseCompoundTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        dictionary = Path(self.directory.name) / 'ja.txt'
        dictionary.write_text('a\ta\ni\ti\nu\tu\ne\te\no\to\nka\tk a\nka\tg a\nsa\ts a\nshi\tsh i\nwa\tw a\nya\ty a\nna\tn a\nn\tN\n', encoding='utf-8')
        self.kana = JapaneseKanaConverter(str(dictionary))

    def phones(self, text):
        return [[group.phonemes for group in path]
                for word in self.kana.convert(text)
                for reading in word.readings for path in reading.paths]

    def test_long_vowels_preserve_small_kana_word_and_repeated_phones(self):
        for text in ('あぁ', 'アァ'):
            words = self.kana.convert(text)
            self.assertEqual([word.text for word in words], [text])
            self.assertEqual(self.phones(text), [[['a', 'a']]])
            self.assertEqual(words[0].readings[0].paths[0][0].script, 'aa')
        self.assertEqual(self.phones('しぃ'), [[['sh', 'i', 'i']]])

    def test_long_vowel_mark_is_not_shifted_to_a_diacritic(self):
        self.assertEqual(self.phones('ー'), [[]])
        self.assertEqual(self.phones('ーぁ'), [[['a']]])
        self.assertEqual(self.phones('ーぃ'), [[['i']]])
        self.assertEqual(self.phones('ーぅ'), [[['u']]])

    def test_composition_retains_dictionary_variants_and_consonant_onsets(self):
        self.assertEqual(self.phones('かぁ'), [[['k', 'a', 'a']], [['g', 'a', 'a']]])
        self.assertEqual(self.phones('すぁ'), [[['s', 'w', 'a']]])
        self.assertEqual(self.phones('ぬぁ'), [[['n', 'w', 'a']]])

    def test_standard_syllables_and_explicit_dictionary_entries_win(self):
        self.assertEqual(self.phones('か'), [[['k', 'a']], [['g', 'a']]])
        self.assertEqual(self.phones('ん'), [[['N']]])
        self.kana._script_dict['aa'] = [['a']]
        self.assertEqual(self.phones('あぁ'), [[['a']]])
        with self.assertRaisesRegex(KeyError, 'not found'):
            self.kana.script_to_paths('unknown-script')


@unittest.skipUnless(os.environ.get('TWILIGHT_MUSIC_STUDY_HOME'), 'local pronunciation pack required')
class JapanesePackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = Path(os.environ['TWILIGHT_MUSIC_STUDY_HOME']) / 'models/vocal2midi/tifa'
        cls.kana = JapaneseKanaConverter(str(cls.pack / 'dictionaries/japanese_dict_full.txt'))

    def test_all_declared_kana_readings_resolve_to_existing_dictionary_phones(self):
        known = {phone for variants in self.kana._script_dict.values() for variant in variants for phone in variant}
        for kana in _KANA_TO_ROMAJI:
            with self.subTest(kana=kana):
                for word in self.kana.convert(kana):
                    self.assertTrue(word.readings)
                    for reading in word.readings:
                        self.assertTrue(reading.paths)
                        for path in reading.paths:
                            self.assertTrue(all(phone in known for group in path for phone in group.phonemes))

    def test_small_kana_lyrics_convert_and_encode_with_real_pipeline(self):
        from inference.TiFA.g2p_pipeline import build_g2p_pipeline
        from inference.TiFA.g2p.encoding import encode_paths
        from inference.TiFA.lib.vocabulary import Vocabulary
        from vocal_pipeline import languages_for
        pipeline = build_g2p_pipeline(self.pack, japanese_g2p_engine='pyopenjtalk')
        vocabulary = Vocabulary.from_file(self.pack / 'vocabulary.json')
        texts = ['あぁしたいような', 'あぁあぁ', 'かぁ しぃ すぁ ふゅ ぬぁ']
        for text in texts:
            with self.subTest(text=text):
                languages = languages_for(text, 'ja')
                words = pipeline.convert(text, languages=languages)
                data, _, _ = encode_paths(words, vocabulary, 'discard', languages=languages,
                    global_symbols=('AP', 'SP', 'EP', 'GS', 'sil', 'br', 'pau'), stop_symbols=('SP', 'sil', 'pau'))
                self.assertTrue(data['paths'].any())


if __name__ == '__main__':
    unittest.main()
