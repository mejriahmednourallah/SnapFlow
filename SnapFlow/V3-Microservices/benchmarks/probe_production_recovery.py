"""Actual packaged Obscura-first recovery and repeated-origin routing proof."""
import asyncio
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
from threading import Thread
import time

sys.path.insert(0, '/app')
import pool
assert Path(pool.__file__).parent == Path('/app')


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/slow.js':
            time.sleep(10)
            body, mime = b'window.slowCompleted=true;', 'application/javascript'
        else:
            body = b'''<!doctype html><html><head><title>Recovery fixture</title></head><body><main>
            <h1>Recovery guide</h1><p id="content">NOT_BOOTED</p></main>
            <script async src="/slow.js"></script><script>document.getElementById('content').textContent='READY_CONTENT';</script></body></html>'''
            mime = 'text/html; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass
    def log_message(self, *_args):
        pass


async def run():
    base = os.environ['RECOVERY_FIXTURE_URL']
    pool._validate_discovery_target = lambda target, _: (target.startswith(base), 'owned_local_fixture')
    pool._OBSCURA_ACQUISITION_ROUTER_ENABLED = True
    server = ThreadingHTTPServer(('0.0.0.0', 18997), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    browser_pool = pool.BrowserPool()
    await browser_pool.start()
    from urllib.parse import urlparse
    rows = []
    try:
        for index in range(4):
            target = base + str(index)
            started = time.perf_counter()
            baseline = await browser_pool.discover_rendered(target, allowed_domains=[urlparse(base).hostname],
                extract_forms=False, force_chromium=True, wait_ms=10000)
            baseline_ms = (time.perf_counter() - started) * 1000
            started = time.perf_counter()
            acquired = await browser_pool.discover_rendered(target, allowed_domains=[urlparse(base).hostname],
                extract_forms=False, scan_id='production-recovery-fixture', wait_ms=10000)
            elapsed = (time.perf_counter() - started) * 1000
            row = dict(index=index, baseline=asdict(baseline), baseline_ms=baseline_ms,
                       acquired=asdict(acquired), elapsed_ms=elapsed)
            rows.append(row)
            Path('/results/recovery.json').write_text(json.dumps(rows, indent=2), encoding='utf-8')
            assert baseline.status == pool.PageStatus.SUCCESS
            assert acquired.status == pool.PageStatus.SUCCESS, row
            assert acquired.engine == 'chromium', row
            assert 'READY_CONTENT' in acquired.visible_text and 'NOT_BOOTED' not in acquired.visible_text, row
            assert acquired.acquisition_routed
            expected = ['obscura', 'obscura', 'chromium'] if index < 3 else ['chromium']
            assert [attempt['engine'] for attempt in acquired.acquisition_attempts] == expected, row
            assert elapsed < 10300, row
            print(json.dumps(dict(index=index, elapsed_ms=elapsed, baseline_ms=baseline_ms, attempts=expected, assertions='passed')), flush=True)
    finally:
        try:
            await asyncio.wait_for(browser_pool.stop(), 5)
        except Exception:
            pass
        server.shutdown()


if __name__ == '__main__':
    asyncio.run(run())
