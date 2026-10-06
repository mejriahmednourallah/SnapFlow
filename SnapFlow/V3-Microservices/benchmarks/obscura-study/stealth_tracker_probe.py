"""Controlled tracker-host test; the hostname resolves to our local fixture."""
import argparse
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.async_api import async_playwright

HITS = []


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/tracker.js':
            HITS.append({'host':self.headers.get('Host'), 'kind':'classic_script'})
            body = b"document.getElementById('tracker-result').textContent='TRACKER_EXECUTED';"
            mime = 'application/javascript'
        elif self.path == '/tracker-data':
            HITS.append({'host':self.headers.get('Host'), 'kind':'scripted_fetch'})
            body = b'{"marker":"FETCH_EXECUTED"}'
            mime = 'application/json'
        elif self.path == '/hits':
            body = json.dumps(HITS).encode()
            mime = 'application/json'
        else:
            body = b"<!doctype html><html><body><main><h1>TRACKER_PROBE</h1><p id='tracker-result'>NOT_EXECUTED</p><p id='fetch-result'>NOT_EXECUTED</p></main><script src='http://www.google-analytics.com:18992/tracker.js'></script><script>fetch('http://www.google-analytics.com:18992/tracker-data').then(r=>r.json()).then(d=>{document.getElementById('fetch-result').textContent=d.marker}).catch(()=>{});</script></body></html>"
            mime = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


async def probe(args):
    headers = {'Authorization':f"Bearer {os.environ['OBSCURA_CDP_TOKEN']}"}
    with urlopen(Request(args.cdp_url+'/json/version', headers=headers), timeout=5) as response:
        version = json.load(response)
    endpoint = 'ws://'+urlparse(args.cdp_url).netloc+urlparse(version['webSocketDebuggerUrl']).path
    before = json.load(urlopen('http://snapflow-stealth-tracker-client:18992/hits', timeout=3))
    async with async_playwright() as playwright:
        browser = await playwright.chromium.connect_over_cdp(endpoint, headers=headers, timeout=10000)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto('http://snapflow-stealth-tracker-client:18992/', wait_until='domcontentloaded', timeout=5000)
        await asyncio.sleep(1)
        marker = await page.locator('#tracker-result').text_content()
        fetch_marker = await page.locator('#fetch-result').text_content()
        await context.close()
        await browser.close()
    after = json.load(urlopen('http://snapflow-stealth-tracker-client:18992/hits', timeout=3))
    received = after[len(before):]
    report = {'marker':marker, 'fetch_marker':fetch_marker, 'tracker_requests_received':len(received),
              'classic_script_requests':sum(r['kind']=='classic_script' for r in received),
              'scripted_fetch_requests':sum(r['kind']=='scripted_fetch' for r in received),
              'tracker_host':'www.google-analytics.com', 'network':'hostname mapped to local fixture; no request to public analytics service'}
    args.output.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--cdp-url')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.serve:
        ThreadingHTTPServer(('0.0.0.0', 18992), Handler).serve_forever()
    else:
        asyncio.run(probe(args))
