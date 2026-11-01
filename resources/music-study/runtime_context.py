"""Cancellation belongs to a request, model objects belong to the runtime."""
from concurrent.futures import Future
import threading

_context = threading.local()


class Cancelled(RuntimeError):
    pass


def bind(cancelled, sink):
    _context.cancelled, _context.sink = cancelled, sink


def check_cancel():
    event = getattr(_context, 'cancelled', None)
    if event is not None and event.is_set():
        raise Cancelled('任务已取消')


def emit(value):
    check_cancel()
    sink = getattr(_context, 'sink', None)
    if sink is not None:
        sink(value)


class CooperativePool:
    """Demucs already uses synchronous execution on CUDA; keep that behavior."""
    def submit(self, function, *args, **kwargs):
        check_cancel()
        result = Future()
        result.set_result(function(*args, **kwargs))
        return result
