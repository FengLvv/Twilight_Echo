"""Exercise process reuse and cooperative cancellation without model dependencies."""
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading
import unittest


class ResidentProtocolTests(unittest.TestCase):
    def test_cancel_is_request_scoped_and_process_survives(self):
        code = '''
import os, time
from resident_protocol import serve
from runtime_context import check_cancel, emit
def handler(method, params):
    if method == 'slow':
        emit({'kind':'started'})
        for _ in range(1000):
            check_cancel()
            time.sleep(.01)
    return {'pid':os.getpid()}
serve(handler)
'''
        child = subprocess.Popen([sys.executable, '-u', '-c', code], cwd=Path(__file__).parent,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
        output = queue.Queue()
        def read():
            for line in child.stdout:
                output.put(json.loads(line))
        reader = threading.Thread(target=read, daemon=True); reader.start()
        def send(value):
            child.stdin.write(json.dumps(value) + '\n'); child.stdin.flush()
        try:
            send(dict(id='first', method='pid'))
            first = output.get(timeout=5)['result']
            send(dict(id='cancel-me', method='slow'))
            self.assertEqual(output.get(timeout=5)['event']['kind'], 'started')
            send(dict(method='cancel', target='cancel-me'))
            cancelled = output.get(timeout=5)
            self.assertEqual(cancelled['id'], 'cancel-me')
            self.assertTrue(cancelled['cancelled'])
            send(dict(id='after', method='pid'))
            self.assertEqual(output.get(timeout=5)['result'], first)
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait()
            reader.join(timeout=1)
            child.stdout.close(); child.stderr.close()
        self.assertEqual(child.returncode, 0)


if __name__ == '__main__':
    unittest.main()
