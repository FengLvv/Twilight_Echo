"""Cancellation joins the owned native engraver before temporary files expire."""
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import os
import json
import unittest
from unittest.mock import patch
from runtime_context import bind, Cancelled
from vocal_score import compile_batch


class EngraverLifecycleTests(unittest.TestCase):
    def test_external_locale_is_isolated_without_mutating_the_player_environment(self):
        actual_popen=subprocess.Popen
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ,LC_ALL='zh_CN.UTF-8',LANGUAGE='ja'):
            output=Path(directory)/'locale.json'
            def spawn(*args,**kwargs):
                code='import os,json,pathlib;pathlib.Path('+repr(str(output))+').write_text(json.dumps({k:os.environ[k] for k in ("LC_ALL","LANG","LANGUAGE")}))'
                return actual_popen([sys.executable,'-c',code],**kwargs)
            with patch('vocal_score.subprocess.Popen',spawn):compile_batch(Path('unused'),[],Path(directory))
            self.assertEqual(json.loads(output.read_text()),dict(LC_ALL='C',LANG='C',LANGUAGE='C'))
            self.assertEqual(os.environ['LC_ALL'],'zh_CN.UTF-8')

    def test_cancel_stops_and_joins_native_child(self):
        token=threading.Event();bind(token,lambda value:None)
        actual_popen=subprocess.Popen
        children=[]
        def spawn(*args,**kwargs):
            child=actual_popen([sys.executable,'-c','import time; time.sleep(60)'],**kwargs)
            children.append(child)
            return child
        timer=threading.Timer(.2,token.set);timer.start()
        try:
            with tempfile.TemporaryDirectory() as directory, patch('vocal_score.subprocess.Popen',spawn):
                with self.assertRaises(Cancelled):
                    compile_batch(Path('unused'),[Path('line.ly')],Path(directory))
            self.assertIsNotNone(children[0].poll())
        finally:
            timer.cancel();bind(threading.Event(),lambda value:None)
            for child in children:
                if child.poll() is None:child.kill();child.wait()


if __name__=='__main__':unittest.main()
