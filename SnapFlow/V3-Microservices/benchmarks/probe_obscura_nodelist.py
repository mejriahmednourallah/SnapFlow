"""Run inside the production browser client, sharing the engine network.

Reproduces the observed third-party NodeList prototype use against a controlled
external script. No real website or resource is modified.
"""
import asyncio
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from urllib.request import Request, urlopen
from playwright.async_api import async_playwright

HTML = b'''<html><body><main><p>FIRST</p><p>SECOND</p><div id="result">UNINITIALIZED</div></main><script src="/sharing.js"></script></body></html>'''
SCRIPT = b'''NodeList.prototype.forEach.call(document.querySelectorAll('p'), function(el){ el.textContent += '_READY'; }); document.getElementById('result').textContent = Array.isArray(document.querySelectorAll('p')) ? 'BAD_ARRAY' : 'NODELIST_READY';'''

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = SCRIPT if self.path == '/sharing.js' else HTML
        self.send_response(200)
        self.send_header('Content-Type', 'application/javascript' if self.path == '/sharing.js' else 'text/html')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args): pass

async def run():
    server = ThreadingHTTPServer(('0.0.0.0',19001), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    headers = {'Authorization': 'Bearer ' + os.environ['OBSCURA_CDP_TOKEN']}
    with urlopen(Request('http://127.0.0.1:9222/json/version', headers=headers), timeout=5) as response:
        endpoint = json.load(response)['webSocketDebuggerUrl']
    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(endpoint, headers=headers)
        context = await browser.new_context()
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        await page.goto('http://127.0.0.1:19001/', wait_until='domcontentloaded', timeout=10000)
        result = await page.evaluate("({constructor:typeof NodeList, tag:Object.prototype.toString.call(document.querySelectorAll('p')), text:document.body.textContent})")
        result['page_errors'] = errors
        assert result['constructor'] == 'function' and result['tag'] == '[object NodeList]'
        assert all(text in result['text'] for text in ('FIRST_READY','SECOND_READY','NODELIST_READY'))
        assert not errors, errors
        Path('/workspace/output/playwright/obscura-study/nodelist-candidate.json').write_text(json.dumps(result, indent=2))
        print(json.dumps(result))
        await context.close()
        await browser.close()
    server.shutdown()

asyncio.run(run())
