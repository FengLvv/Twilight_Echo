import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from resident_child import ResidentChild


class ResidentEncodingTests(unittest.TestCase):
    def test_unicode_protocol_enables_utf8_even_when_environment_disables_it(self):
        with tempfile.TemporaryDirectory(prefix='study-unicode-') as temporary:
            script = Path(temporary) / 'echo.py'
            script.write_text('import json,sys\nfor line in sys.stdin:\n'
                ' request=json.loads(line)\n'
                ' print(json.dumps(dict(id=request["id"],result=dict(text=request["params"]["text"],'
                'utf8=sys.flags.utf8_mode)),ensure_ascii=False),flush=True)\n', encoding='utf-8')
            with patch.dict(os.environ, {'PYTHONUTF8': '0'}):
                child = ResidentChild(sys.executable, script)
                try:
                    result = child.call('echo', {'text': '调性・夢遊 🎵'}, lambda *_: None)
                    self.assertEqual(result, {'text': '调性・夢遊 🎵', 'utf8': 1})
                finally:
                    child.close()


if __name__ == '__main__':
    unittest.main()
