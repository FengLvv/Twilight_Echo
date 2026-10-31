import unittest
import numpy as np
from harmony import recognize,ROOTS,QUALITIES


def chord(notes, seconds=2, sample_rate=22050):
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    result = np.zeros(len(time))
    for index, midi in enumerate(notes):
        hz = 440 * 2 ** ((midi - 69) / 12)
        for harmonic, gain in ((1, 1), (2, .22), (3, .08)):
            result += np.sin(2 * np.pi * hz * harmonic * time + index * .17) * gain
    envelope = np.minimum(time / .03, 1) * np.minimum((seconds - time) / .08, 1)
    return (result * envelope * .12).astype(np.float32)


class HarmonyTests(unittest.TestCase):
    def test_all_roots_and_supported_qualities(self):
        cases=[(ROOTS[root]+quality,[36+root]+[60+root+i for i in intervals]) for root in range(12) for quality,intervals in QUALITIES.items()]
        audio=np.concatenate([chord(notes,seconds=1.2) for _,notes in cases])
        segments=recognize(audio,22050)['segments']
        failures=[]
        for index,(expected,_) in enumerate(cases):
            center=index*1.2+.6;actual=next(s['label'] for s in segments if s['start']<=center<s['end'])
            if actual!=expected:failures.append((expected,actual))
        self.assertGreaterEqual(1-len(failures)/len(cases),.95,str(failures))
    def test_common_chords_and_boundaries(self):
        entries = [("C", [48, 60, 64, 67]), ("Am", [45, 57, 60, 64]),
            ("F", [41, 53, 57, 60]), ("G7", [43, 55, 59, 62, 65])]
        audio = np.concatenate([chord(notes) for _, notes in entries])
        result = recognize(audio, 22050)
        correct = 0
        for index, (expected, _) in enumerate(entries):
            position = index * 2 + 1
            segment = next(s for s in result["segments"] if s["start"] <= position < s["end"])
            self.assertEqual(segment["label"], expected, result["segments"])
            correct += 1
        self.assertEqual(correct, 4)
        self.assertAlmostEqual(result["segments"][-1]["end"], 8)

    def test_silence_and_invalid_audio(self):
        result = recognize(np.zeros(44100, np.float32), 22050)
        self.assertTrue(all(segment["label"] == "N" for segment in result["segments"]))
        with self.assertRaises(ValueError):
            recognize(np.array([np.nan]), 22050)

    def test_inversion(self):
        result = recognize(chord([40, 60, 64, 67]), 22050)
        center = next(s for s in result["segments"] if s["start"] <= 1 < s["end"])
        self.assertEqual(center["label"], "C/E")


if __name__ == "__main__":
    unittest.main()
