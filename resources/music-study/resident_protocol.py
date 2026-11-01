"""Bounded JSONL RPC with one executor and an independently readable cancel lane."""
import json
import os
import queue
import sys
import threading
import traceback

from runtime_context import bind, Cancelled


def serve(handler):
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    if os.environ.get('STUDY_DIAGNOSTIC_STACKS') == '1':
        import faulthandler
        faulthandler.dump_traceback_later(60, repeat=True)
    pending = queue.Queue()
    requests = {}
    lock, output_lock = threading.Lock(), threading.Lock()

    def write(value):
        line = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
        with output_lock:
            sys.stdout.write(line + '\n')
            sys.stdout.flush()

    def execute():
        while True:
            request = pending.get()
            if request is None:
                return
            identifier = request['id']
            with lock:
                cancelled = requests[identifier]
            bind(cancelled, lambda value: write(dict(id=identifier, event=value)))
            try:
                if cancelled.is_set():
                    raise Cancelled('任务已取消')
                value = handler(request['method'], request.get('params', {}))
                write(dict(id=identifier, result=value))
            except Exception as error:
                if not isinstance(error, Cancelled):
                    traceback.print_exc(file=sys.stderr)
                write(dict(id=identifier, error=str(error)[:1600], cancelled=isinstance(error, Cancelled)))
            finally:
                with lock:
                    requests.pop(identifier, None)

    def read_requests():
        try:
            for line in sys.stdin:
                if len(line) > 32 * 1024 * 1024:
                    raise ValueError('Runtime request exceeds limit')
                request = json.loads(line)
                if request.get('method') == 'cancel':
                    with lock:
                        token = requests.get(request.get('target'))
                        if token:
                            token.set()
                    continue
                identifier = request.get('id')
                if not isinstance(identifier, str) or not 1 <= len(identifier) <= 100:
                    raise ValueError('Invalid runtime request')
                with lock:
                    if identifier in requests:
                        raise ValueError('Duplicate runtime request')
                    requests[identifier] = threading.Event()
                pending.put(request)
        finally:
            with lock:
                for token in requests.values():
                    token.set()
            pending.put(None)

    # CUDA/ONNX initialization and inference stay on the process main thread.
    # The reader handles cancellation while a model releases the GIL.
    threading.Thread(target=read_requests, name='study-control', daemon=True).start()
    execute()
