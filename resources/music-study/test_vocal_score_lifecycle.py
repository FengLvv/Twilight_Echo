"""Cancellation joins the owned native engraver before temporary files expire."""
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from runtime_context import bind, Cancelled
from vocal_score import compile_batch


class EngraverLifecycleTests(unittest.TestCase):
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
