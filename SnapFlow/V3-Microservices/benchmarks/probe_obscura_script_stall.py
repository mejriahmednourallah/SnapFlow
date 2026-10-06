"""Isolate external script scheduling with a slow async local resource."""
import argparse
import asyncio
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from threading import Thread
import time
from urllib.parse import urlparse


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/slow.js':
            time.sleep(10)
            body=b"window.asyncCompleted=true;"
            mime='application/javascript'
        elif self.path in ('/boot.js', '/blocking-boot.js'):
            if self.path == '/blocking-boot.js':
                time.sleep(.3)
            body=b"document.getElementById('classic').textContent='CLASSIC_BOOTED';window.fixtureTrace.push('classic');"
            mime='application/javascript'
        elif self.path == '/quick-async.js':
            time.sleep(.05)
            body=b"document.getElementById('async').textContent='ASYNC_READY';window.fixtureTrace.push('async');"
            mime='application/javascript'
        elif self.path in ('/deferred.js', '/slow-deferred.js'):
            time.sleep(10 if self.path == '/slow-deferred.js' else .1)
            body=b"document.getElementById('defer').textContent='DEFER_READY';window.fixtureTrace.push('defer');"
            mime='application/javascript'
        elif self.path == '/failed.js':
            body=b"document.getElementById('bad').textContent='ERROR_BODY_EXECUTED';"
            mime='application/javascript'
        else:
            slow='<script async src="/slow.js"></script>' if self.path in ('/slow','/failed') else ''
            if self.path == '/async-fast':
                slow='<script async src="/quick-async.js"></script>'
            defer='<script defer src="/deferred.js"></script>' if self.path == '/defer' else ''
            if self.path == '/slow-defer':
                defer='<script defer src="/slow-deferred.js"></script>'
            boot='/failed.js' if self.path == '/failed' else '/blocking-boot.js' if self.path == '/async-fast' else '/boot.js'
            body=('''<!doctype html><html><body><main><h1>Scheduling fixture</h1>
                <p id="classic">CLASSIC_MISSING</p><p id="inline">INLINE_MISSING</p><p id="async">ASYNC_MISSING</p>
                <p id="defer">DEFER_MISSING</p><p id="bad">NO_ERROR_BODY</p></main>
                <script>window.fixtureTrace=[];document.addEventListener('DOMContentLoaded',()=>window.fixtureTrace.push('dcl'));</script>'''+slow+defer+f'''
                <script src="{boot}"></script><script>document.getElementById('inline').textContent='INLINE_BOOTED';window.fixtureTrace.push('inline');</script>
                </body></html>''').encode()
            mime='text/html; charset=utf-8'
        self.send_response(404 if self.path == '/failed.js' else 200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass
    def log_message(self,*args):
        pass


async def client(args):
    from playwright.async_api import async_playwright
    from urllib.request import Request, urlopen
    server=ThreadingHTTPServer(('0.0.0.0',18995),Handler)
    Thread(target=server.serve_forever,daemon=True).start()
    headers={'Authorization':f"Bearer {os.environ['OBSCURA_CDP_TOKEN']}"}
    with urlopen(Request(args.cdp_url+'/json/version',headers=headers),timeout=5) as response:
        version=json.load(response)
    endpoint='ws://'+urlparse(args.cdp_url).netloc+urlparse(version['webSocketDebuggerUrl']).path
    observations=[]
    async with async_playwright() as pw:
        browser=await pw.chromium.connect_over_cdp(endpoint,headers=headers,timeout=10000)
        for path in ['/fast','/slow','/defer','/async-fast','/failed','/slow-defer']:
            context=await browser.new_context()
            page=await context.new_page()
            started=time.perf_counter()
            row={'case':path,'error':None}
            try:
                await page.goto('http://snapflow-script-stall-client:18995'+path,
                                wait_until='domcontentloaded',timeout=8000)
                row['navigation_ms']=(time.perf_counter()-started)*1000
                row['text']=await asyncio.wait_for(page.evaluate('document.body.textContent'),3)
                row['dom']=await asyncio.wait_for(page.evaluate("Object.fromEntries(['classic','inline','async','defer','bad'].map(id=>[id,document.getElementById(id).textContent]))"),3)
                row['trace']=await asyncio.wait_for(page.evaluate('window.fixtureTrace || []'),3)
            except Exception as exc:
                row['error']=type(exc).__name__+':'+str(exc)[:500]
            row['elapsed_ms']=(time.perf_counter()-started)*1000
            observations.append(row)
            try:
                await asyncio.wait_for(context.close(),2)
            except Exception:
                pass
        try:
            await asyncio.wait_for(browser.close(),2)
        except Exception:
            pass
    args.output.write_text(json.dumps(observations,indent=2),encoding='utf-8')
    print(json.dumps(observations),flush=True)
    server.shutdown()


def host(args):
    from run_obscura_study import HERE,ROOT,NETWORK,IMAGE,docker,owned_remove
    output=ROOT/args.output
    output.mkdir(parents=True,exist_ok=True)
    metadata = {'engine_image':args.image,
        'engine_image_id':docker('image','inspect','--format','{{.Id}}',args.image,capture=True).stdout.strip(),
        'client_image':args.client_image,
        'client_image_id':docker('image','inspect','--format','{{.Id}}',args.client_image,capture=True).stdout.strip(),
        'script_deadline_ms':4000, 'expect_fixed':args.expect_fixed,
        'methodology':'Local script fixtures; direct DOM values and event order; no production scan'}
    (output/'environment.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    engine='snapflow-script-stall-engine'
    caller='snapflow-script-stall-client'
    try:
        owned_remove(engine)
        owned_remove(caller)
        docker('run','-d','--name',caller,'--label','snapflow.study=obscura-memory','--network',NETWORK,
               '--env-file',str(HERE/'obscura.env'),
               '--mount',f'type=bind,src={HERE},dst=/benchmarks,readonly',
               '--mount',f'type=bind,src={output},dst=/results',args.client_image,'python','-c','import time; time.sleep(3600)',capture=True)
        docker('run','-d','--name',engine,'--label','snapflow.study=obscura-memory','--network',NETWORK,
               '--env-file',str(HERE/'obscura.env'),'-e','OBSCURA_ALLOW_PRIVATE_NETWORK=1',
               '-e','OBSCURA_BLOCK_TRACKERS=0','-e','OBSCURA_SCRIPT_DEADLINE_MS=4000',
               '-e','RUST_LOG=obscura_browser=info,obscura_net=warn,obscura_js=warn',
               args.image,'serve','--port','9222','--host','0.0.0.0','--stealth',capture=True)
        time.sleep(1)
        docker('exec',caller,'python','/benchmarks/probe_obscura_script_stall.py','--client',
               '--cdp-url',f'http://{engine}:9222','--output','/results/observations.json')
        if args.expect_fixed:
            rows=json.loads((output/'observations.json').read_text())
            for row in rows:
                assert row['error'] is None, row
                assert row['dom']['inline']=='INLINE_BOOTED', row
                assert row['dom']['classic']==('CLASSIC_MISSING' if row['case']=='/failed' else 'CLASSIC_BOOTED'), row
                assert row['dom']['bad']=='NO_ERROR_BODY', row
                if row['case']=='/defer':
                    assert row['trace'].index('inline') < row['trace'].index('defer') < row['trace'].index('dcl'), row
                if row['case']=='/async-fast':
                    assert row['dom']['async']=='ASYNC_READY', row
                    assert row['trace'].index('async') < row['trace'].index('classic'), row
            print('Six DOM-state/order scheduler checks passed',flush=True)
        log=docker('logs','--tail','300',engine,capture=True).stderr
        for line in (HERE/'obscura.env').read_text().splitlines():
            if line.startswith('OBSCURA_CDP_TOKEN='):
                log=log.replace(line.split('=',1)[1],'<redacted>')
        (output/'engine.log').write_text(log,encoding='utf-8')
    finally:
        owned_remove(engine)
        owned_remove(caller)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--client',action='store_true')
    parser.add_argument('--cdp-url')
    parser.add_argument('--image',default='snapflow/obscura-stealth:v0.2.3-study')
    parser.add_argument('--client-image',default='snapflow/obscura-study:pw1.58')
    parser.add_argument('--expect-fixed',action='store_true')
    parser.add_argument('--output',type=Path,default=Path('output/playwright/obscura-study/script-stall-original'))
    args=parser.parse_args()
    if args.client:
        asyncio.run(client(args))
    else:
        host(args)
