from __future__ import annotations

import contextlib
import functools
import http.server
import threading
from pathlib import Path

import pytest


FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


@pytest.fixture(scope="session")
def fixture_server():
    handler = functools.partial(QuietHandler, directory=str(FIXTURE_ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@contextlib.contextmanager
def does_not_raise():
    yield
