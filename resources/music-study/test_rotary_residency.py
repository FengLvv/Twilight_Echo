import types
import unittest
import torch
from vendor.sheetsage2.modeling_mert2 import RotaryEmbedding


class RotaryResidencyTests(unittest.TestCase):
    def test_device_apply_releases_derived_cache_and_rebuilds_identical_values(self):
        rotary = RotaryEmbedding(types.SimpleNamespace(hidden_size=32, num_attention_heads=4, rotary_embedding_base=10000))
        audio = torch.zeros(1, 17, 32)
        before = tuple(value.clone() for value in rotary(audio))
        self.assertIsNotNone(rotary._cos)
        rotary.to('cpu')
        self.assertIsNone(rotary._cos); self.assertIsNone(rotary._sin)
        after = rotary(audio)
        for left, right in zip(before, after):
            torch.testing.assert_close(left, right, rtol=0, atol=0)


if __name__ == '__main__':
    unittest.main()
