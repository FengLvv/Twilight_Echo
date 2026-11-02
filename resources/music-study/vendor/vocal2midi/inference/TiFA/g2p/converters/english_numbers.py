"""English numeric readings keep the original digit token as lyric identity."""
from itertools import islice, product
import re

from ..registry import converter
from .base import Converter, G2PGroup, G2PReading, G2PWord
from .dictionary import load_pronunciation_dict
from .text import word_spans


@converter(id='english-numbers', language='en')
class EnglishNumberConverter(Converter):
    def __init__(self, *, dict_path):
        import inflect
        self._engine = inflect.engine()
        self._dict = load_pronunciation_dict(dict_path)

    def find(self, text):
        for begin, end in word_spans(text):
            if re.fullmatch(r'[0-9]{1,16}(?:st|nd|rd|th)?', text[begin:end]):
                return begin, end
        return None

    def convert(self, text):
        # Cardinal, spoken digits and (for years) two-digit pairs are legal
        # alternatives; TiFA selects a complete reading against the audio.
        groups = [0, 1]
        if re.fullmatch(r'[12][0-9]{3}', text):
            groups.append(2)
        readings = []
        seen = set()
        for group in groups:
            spoken = self._engine.number_to_words(text, group=group, andword='')
            words = re.findall(r'[a-z]+', spoken.lower())
            if not words or tuple(words) in seen:
                continue
            seen.add(tuple(words))
            pronunciations = [self._dict.get(word) for word in words]
            if not all(pronunciations):
                raise ValueError('数字发音词典缺失：' + spoken)
            paths = [[G2PGroup(script=word, phonemes=list(phones))
                      for word, phones in zip(words, choice)]
                     for choice in islice(product(*pronunciations), 16)]
            readings.append(G2PReading(paths=paths))
        return [G2PWord(text=text, readings=readings)]
