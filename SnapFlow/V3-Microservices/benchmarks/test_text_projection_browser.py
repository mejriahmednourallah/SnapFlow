"""Real-browser assertion for cleaned Markdown and source/shadow retention."""
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import sys
from threading import Thread
import time

from playwright.async_api import async_playwright
runtime = os.environ.get('PROJECTION_RUNTIME_PATH')
sys.path.insert(0,runtime or str(Path(__file__).resolve().parents[1]/'v3-browser-pool'))
from text_projection import capture_text_projection
if runtime and Path(sys.modules['text_projection'].__file__).parent != Path(runtime):
    raise RuntimeError('Projection probe did not import the requested packaged module')

HTML = '''<!doctype html><html><head><title>Projection fixture</title><style>.hidden {display:none}</style></head>
<body><nav>NAV_NOISE</nav><main><h1>Données personnelles</h1><p>Vous pouvez demander la suppression de vos informations.</p>
<p class="hidden">CSS_HIDDEN_NOISE</p><div hidden>HIDDEN_NOISE</div><script>/* SCRIPT_NOISE */</script>
<a href="/rights">Exercer vos droits</a><ul><li>Accès</li><li>Effacement</li></ul>
<table><tr><th>Droit</th><th>Contact</th></tr><tr><td>Accès</td><td>Délégué</td></tr></table>
<div id="inner-shadow"></div></main><footer>FOOTER_NOISE</footer><div id="outer-shadow"></div>
<script>document.getElementById('inner-shadow').attachShadow({mode:'open'}).innerHTML='<p>INNER_SHADOW_RIGHT</p>';
document.getElementById('outer-shadow').attachShadow({mode:'open'}).innerHTML='<p>OUTER_SHADOW_RIGHT</p><p hidden>SHADOW_HIDDEN_NOISE</p>';</script></body></html>'''


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        data=HTML.encode()
        self.send_response(200)
        self.send_header('Content-Type','text/html; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self,*args):
        pass


async def run():
    server=ThreadingHTTPServer(('0.0.0.0',18994),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    async with async_playwright() as pw:
        browser=await pw.chromium.launch(headless=True,args=['--no-sandbox'])
        page=await browser.new_page()
        await page.goto('http://127.0.0.1:18994/')
        before=await page.content()
        started=time.perf_counter()
        projection=await capture_text_projection(page,'chromium')
        elapsed=(time.perf_counter()-started)*1000
        assert all(marker not in projection['markdown'] for marker in ['NAV_NOISE','CSS_HIDDEN_NOISE','HIDDEN_NOISE','SCRIPT_NOISE','FOOTER_NOISE'])
        assert projection['markdown'].count('INNER_SHADOW_RIGHT') == 1
        assert projection['markdown'].count('OUTER_SHADOW_RIGHT') == 1
        assert '[Exercer vos droits](http://127.0.0.1:18994/rights)' in projection['markdown']
        assert '# Données personnelles' in projection['markdown']
        assert 'Droit | Contact' in projection['markdown']
        assert '| --- | --- |' in projection['markdown']
        assert projection['shadow_roots_preserved'] == 2
        assert await page.content() == before
        assert 'CSS_HIDDEN_NOISE' in before
        await browser.close()
    server.shutdown()
    output=Path(os.environ.get('PROJECTION_TEST_OUTPUT','/results/text-projection.json'))
    output.write_text(json.dumps(dict(projection=projection,elapsed_ms=elapsed,assertions='passed',
                                     playwright=__import__('importlib.metadata').metadata.version('playwright'),
                                     module=sys.modules['text_projection'].__file__),
                                 ensure_ascii=False,indent=2),encoding='utf-8')
    print('Clean Markdown, hidden-content exclusion, source retention and two shadow roots: passed',flush=True)


if __name__=='__main__':
    asyncio.run(run())
