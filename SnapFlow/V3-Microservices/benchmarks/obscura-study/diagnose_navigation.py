"""Separate navigation event failure from availability of an actual DOM."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from playwright.async_api import async_playwright
from study import SNAPSHOT, bounded_close, text_from_html


async def probe(args):
    headers={"Authorization":f"Bearer {os.environ['OBSCURA_CDP_TOKEN']}"}
    with urlopen(Request(args.cdp_url+'/json/version',headers=headers),timeout=5) as response:
        version=json.load(response)
    endpoint='ws://'+urlparse(args.cdp_url).netloc+urlparse(version['webSocketDebuggerUrl']).path
    report={"url":args.url,"wait_until":args.wait_until,"events":[],"console":[],"failures":[]}
    began=time.perf_counter()
    async with async_playwright() as playwright:
        browser=await playwright.chromium.connect_over_cdp(endpoint,headers=headers,timeout=10000)
        context=await browser.new_context(ignore_https_errors=True)
        page=await context.new_page()
        for event in ['domcontentloaded','load']:
            page.on(event,lambda event=event:report['events'].append({'event':event,'ms':round((time.perf_counter()-began)*1000,1)}))
        page.on('pageerror',lambda error:report['console'].append(str(error)[:600]))
        page.on('console',lambda message:report['console'].append(message.text[:600]) if message.type=='error' and len(report['console'])<20 else None)
        def request_failed(request):
            parsed=urlparse(request.url)
            if len(report['failures'])<20:
                report['failures'].append({'host':parsed.hostname,'path':parsed.path,'error':request.failure})
        page.on('requestfailed',request_failed)
        try:
            stamp=time.perf_counter()
            await asyncio.wait_for(page.goto(args.url,wait_until=args.wait_until,timeout=8000),timeout=10)
            report['navigation']='success'
        except Exception as exc:
            report['navigation']=type(exc).__name__
            report['navigation_error']=str(exc)[:900]
        report['navigation_ms']=round((time.perf_counter()-stamp)*1000,1)
        try:
            stamp=time.perf_counter()
            snapshot=await asyncio.wait_for(page.evaluate(SNAPSHOT),timeout=4)
            html=snapshot.pop('html')
            report['dom']={'status':'available','final_url':snapshot['final_url'],'words':len(text_from_html(html).split()),'bytes':len(html.encode()),'headings':snapshot['headings'][:8]}
            args.output.with_suffix('.html').write_text(html,encoding='utf-8')
        except Exception as exc:
            report['dom']={'status':'unavailable','error':str(exc)[:900]}
        report['dom_probe_ms']=round((time.perf_counter()-stamp)*1000,1)
        report['cleanup']=await bounded_close(context)
        try:
            await asyncio.wait_for(browser.close(),timeout=2)
        except Exception:
            pass
    report['elapsed_ms']=round((time.perf_counter()-began)*1000,1)
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:report[key] for key in ['url','wait_until','navigation','navigation_ms','dom','elapsed_ms']}),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    parser.add_argument('--cdp-url',required=True)
    parser.add_argument('--wait-until',choices=['commit','domcontentloaded'],required=True)
    parser.add_argument('--output',type=Path,required=True)
    asyncio.run(probe(parser.parse_args()))
