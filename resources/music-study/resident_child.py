"""Reusable isolated environment; cancellation joins the current request."""
import atexit
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import uuid

from runtime_context import check_cancel, Cancelled, emit


class ResidentChild:
    def __init__(self, python, script):
        self.child = subprocess.Popen([str(python), '-X', 'utf8', '-u', str(script)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, text=True, encoding='utf-8',
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
            start_new_session=False)
        emit(dict(kind='childStarted', pid=self.child.pid))
        self.messages = queue.Queue()
        def read():
            try:
                for line in self.child.stdout:
                    try:
                        self.messages.put(json.loads(line))
                    except ValueError:
                        pass
            finally:
                self.messages.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        atexit.register(self.close)

    def call(self, method, params, progress):
        emit(dict(kind='childStarted', pid=self.child.pid))
        try:
            return self._call(method, params, progress)
        finally:
            emit(dict(kind='childFinished', pid=self.child.pid))

    def _call(self, method, params, progress):
        identifier = str(uuid.uuid4())
        self.child.stdin.write(json.dumps(dict(id=identifier, method=method, params=params), ensure_ascii=False) + '\n')
        self.child.stdin.flush()
        cancelled = False
        while True:
            try:
                check_cancel()
            except Cancelled:
                if not cancelled:
                    self.child.stdin.write(json.dumps(dict(method='cancel', target=identifier)) + '\n')
                    self.child.stdin.flush()
                    cancelled = True
            try:
                message = self.messages.get(timeout=.05)
            except queue.Empty:
                continue
            if message is None:
                raise ValueError('人声分析运行时退出')
            if message.get('kind') == 'heartbeat':
                if not cancelled:
                    emit(dict(kind='runtimeHeartbeat', pid=self.child.pid, progressToken=message.get('progressToken')))
                continue
            if message.get('kind') == 'started':
                continue
            if message.get('id') != identifier:
                continue
            if 'event' in message:
                value = message['event']
                if not cancelled and value.get('kind') == 'progress':
                    try:
                        progress(value['progress'], value['stage'])
                    except Cancelled:
                        continue
            else:
                if cancelled or message.get('cancelled'):
                    raise Cancelled('任务已取消')
                if 'error' in message:
                    raise ValueError(message['error'])
                return message.get('result')

    def close(self):
        if self.child.poll() is None:
            self.child.stdin.close()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == 'nt':
                    subprocess.run([str(Path(os.environ.get('SystemRoot', r'C:\Windows')) / 'System32/taskkill.exe'),
                                    '/PID', str(self.child.pid), '/T', '/F'], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW)
                else:
                    self.child.kill()
                self.child.wait()
