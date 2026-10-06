"""Actual packaged browser-pool discovery on a local known-content fixture.

Only the private-target validator is replaced for this local fixture; its
production protection is unchanged. No forms are submitted or explored.
"""
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
if Path(pool.__file__).parent != Path('/app'):
    raise RuntimeError('Discovery probe must use packaged production pool')

HTML = '''<!doctype html><html><head><title>Shadow evidence fixture</title><style>.hidden {display:none}</style></head>
<body><style>.hidden{display:none} /* STYLE_SOURCE_NOISE */</style><nav>NAV_NOISE</nav><main><h1>Support guide</h1><p>''' + 'Useful support instructions for our customers. ' * 100 + '''</p>
<p>LIGHT_FIRST</p><p>LIGHT_SECOND</p><p>inter<b>national</b> light text</p><p class="hidden">LIGHT_HIDDEN_NOISE</p>
<div id="inner-shadow"><span>SLOTTED_READY</span></div></main><footer>FOOTER_NOISE</footer>
<div id="outer-shadow"></div><div hidden><div id="hidden-host"></div></div>
<script>
const root = document.getElementById('inner-shadow').attachShadow({mode:'open'});
root.innerHTML='<style>.hidden{display:none}</style><h2>SHADOW_READY</h2><p>Shadow tree evidence for NLP.</p><a href="/nested">SHADOW_LINK</a><p>inter<b>national</b> service</p><slot></slot><p hidden>SHADOW_HIDDEN_NOISE</p><p class="hidden">CSS_SHADOW_NOISE</p><div id="nested"></div>';
root.getElementById('nested').attachShadow({mode:'open'}).innerHTML='<h3>NESTED_READY</h3><p>Nested tree evidence.</p>';
document.getElementById('outer-shadow').attachShadow({mode:'open'}).innerHTML='<p>OUTER_READY</p><p style="opacity:0">TRANSPARENT_NOISE</p>';
document.getElementById('hidden-host').attachShadow({mode:'open'}).innerHTML='<p>HIDDEN_HOST_NOISE</p>';
</script></body></html>'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data = HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Last-Modified','Sun, 20 Sep 2026 10:00:00 GMT')
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *_args):
        pass

async def run():
    server = ThreadingHTTPServer(('0.0.0.0',18996), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    browser_pool = pool.BrowserPool()
    # Isolate the owned local fixture from the production private-host guard.
    fixture_url = os.environ.get('DISCOVERY_FIXTURE_URL', 'http://127.0.0.1:18996/')
    pool._validate_discovery_target = lambda url, _domains: (url.startswith(fixture_url), 'local_fixture_only')
    await browser_pool.start()
    try:
        started = time.perf_counter()
        from urllib.parse import urlparse
        result = await browser_pool._discover_rendered_once(fixture_url,
            allowed_domains=[urlparse(fixture_url).hostname], extract_forms=False, capture_projection=True,
            force_chromium=os.environ.get('DISCOVERY_FORCE_CHROMIUM', 'true') == 'true',
            connection_fallback=False, wait_ms=10000)
        assert result.status == pool.PageStatus.SUCCESS, result.error
        assert 'LIGHT_FIRST LIGHT_SECOND' in result.visible_text
        assert 'international light text' in result.visible_text
        assert all(marker not in result.visible_text for marker in ('STYLE_SOURCE_NOISE','LIGHT_HIDDEN_NOISE','SHADOW_HIDDEN_NOISE','CSS_SHADOW_NOISE','TRANSPARENT_NOISE','HIDDEN_HOST_NOISE'))
        shadow = result.shadow_dom
        assert shadow['host_count'] == 3
        assert 'SHADOW_READY Shadow tree evidence for NLP. SHADOW_LINK' in shadow['text']
        assert 'international service' in shadow['text']
        assert shadow['text'].count('NESTED_READY') == 1
        assert shadow['text'].count('OUTER_READY') == 1
        assert 'SLOTTED_READY' not in shadow['text']
        assert 'SLOTTED_READY' in result.rendered_html
        assert all(marker not in shadow['text'] for marker in ('SHADOW_HIDDEN_NOISE','CSS_SHADOW_NOISE','TRANSPARENT_NOISE','HIDDEN_HOST_NOISE'))
        assert result.text_projection['markdown'].count('SLOTTED_READY') == 1
        assert f'[SHADOW\\_LINK]({fixture_url}nested)' in result.text_projection['markdown']
        assert 'SHADOW_HIDDEN_NOISE' in result.raw_html  # source script retained
        assert 'hidden-host' in result.rendered_html
        assert result.response_headers['last-modified'] == 'Sun, 20 Sep 2026 10:00:00 GMT'
        import main as api
        api._pool = browser_pool
        measured = await api.render(api.RenderRequest(url=fixture_url, timeout_ms=10000,
                                                       engine='chromium', settle_ms=0))
        assert measured['status'] == pool.PageStatus.SUCCESS, measured['error']
        assert measured['raw_html'] == HTML
        assert measured['navigation_status'] == 200
        assert measured['response_headers']['last-modified'] == 'Sun, 20 Sep 2026 10:00:00 GMT'
        assert measured['shadow_dom']['host_count'] == 3
        assert measured['shadow_dom']['text'].count('NESTED_READY') == 1
        assert 'SHADOW_HIDDEN_NOISE' not in measured['shadow_dom']['text']
        assert isinstance(measured['metrics_available'], bool)
        assert browser_pool._active_sessions == 0
        assert all(count == 0 for count in browser_pool._worker_leases)
        import importlib.metadata
        output = dict(result=asdict(result), elapsed_ms=(time.perf_counter()-started)*1000,
            measurement_response=measured,
            playwright=importlib.metadata.version('playwright'), source=pool.__file__, assertions='passed',
            methodology='Actual pool/Chromium discovery with local private-target fixture adapter; no form exploration')
        path = Path(os.environ.get('DISCOVERY_TEST_OUTPUT','/workspace/output/playwright/production-discovery.json'))
        path.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps({key:output[key] for key in ('elapsed_ms','playwright','source','assertions')}))
    finally:
        await browser_pool.stop()
        server.shutdown()

if __name__ == '__main__':
    asyncio.run(run())
