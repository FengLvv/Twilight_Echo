import unittest
from vocal_lyrics import is_credit


class CreditPolicyTests(unittest.TestCase):
    def test_observed_multilingual_and_bilingual_attributions(self):
        for text in ['作詞：大森祥子', '制 作 人：叶圣涛', '作词 Lyrics by：阿福',
                     '编曲/钢琴Music Arranged &Piano by: 某某',
                     '混音/母带工程师 Mixing Engineer/Mastering：某某',
                     '管乐录音师：某某', '人声录音棚Ａ：某棚',
                     'Recording Engineer - Agust D', 'Recorded by 홍지상 at The Chocolab',
                     'Bass by Young K', 'Drums by 윤도운', 'Mixed at Henson Recording Studios',
                     'Recorded at Noisematch (Miami, U.S.), late 2016', 'Auteurs: Zaz']:
            with self.subTest(text=text):self.assertTrue(is_credit(text))

    def test_performer_cues_and_ordinary_sentences_are_retained(self):
        for text in ['男：我爱你', '女：别离开', '合唱：我们一起唱', '念白：等你回来',
                     'Chorus: We will rise', '[Verse 1: Lil Wayne]', '慕寒：我在等你',
                     '策划逃脱 这也有错', '制作人说：再唱一次', '和声像风吹过',
                     'Recorded at dawn, I remembered you', 'Written by the wind I follow you',
                     'Bass by the window']:
            with self.subTest(text=text):self.assertFalse(is_credit(text))


if __name__=='__main__':unittest.main()
