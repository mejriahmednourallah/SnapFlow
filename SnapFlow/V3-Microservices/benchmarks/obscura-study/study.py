"""Matched Linux/Docker content, Markdown and resource-use benchmark.

Only GET requests are made to Docker's local API to sample the named engine.
The client and fixture server run outside the measured engine container.
"""
import argparse
import asyncio
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import statistics
import threading
import time
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from fixtures import MARKERS, server

HERE = Path(__file__).resolve().parent


class DockerConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__("localhost", timeout=3)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(3)
        self.sock.connect("/var/run/docker.sock")


def docker_get(path):
    connection = DockerConnection()
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        payload = json.loads(response.read())
        if response.status != 200:
            raise RuntimeError(f"Docker sampling failed: {response.status}")
        return payload
    finally:
        connection.close()


class Sampler:
    def __init__(self, container):
        self.container = container
        self.samples = []
        self.errors = []
        self.phase = "idle"
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop_event.is_set():
            try:
                result = docker_get(f"/containers/{quote(self.container)}/stats?stream=false&one-shot=true")
                memory = result.get("memory_stats", {})
                stats = memory.get("stats", {})
                usage = memory.get("usage", 0)
                inactive_file = stats.get("inactive_file", stats.get("total_inactive_file", 0))
                self.samples.append({
                    "time": time.monotonic(), "phase": self.phase,
                    "usage_bytes": usage, "working_set_bytes": max(0, usage-inactive_file),
                    "anonymous_bytes": stats.get("anon", stats.get("total_rss")),
                    "file_bytes": stats.get("file", stats.get("total_cache")),
                    "cpu_ns": result.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0),
                    "pids": result.get("pids_stats", {}).get("current"),
                })
            except Exception as exc:
                self.errors.append(str(exc))
            self.stop_event.wait(0.2)

    def begin(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=4)

    def summary(self, phase):
        rows = [row for row in self.samples if row["phase"] == phase]
        if not rows:
            return {"samples": 0}
        return {
            "samples": len(rows),
            "working_set_peak_mib": round(max(row["working_set_bytes"] for row in rows)/1024**2, 2),
            "working_set_median_mib": round(statistics.median(row["working_set_bytes"] for row in rows)/1024**2, 2),
            "anonymous_peak_mib": round(max(row["anonymous_bytes"] or 0 for row in rows)/1024**2, 2),
            "cpu_seconds": round((rows[-1]["cpu_ns"]-rows[0]["cpu_ns"])/1e9, 3),
        }


SNAPSHOT = """() => {
    const shadow = {text:'', links:[]};
    function walk(root) {
        for (const node of root.querySelectorAll('*')) {
            if (node.shadowRoot) {
                shadow.text += '\\n' + node.shadowRoot.textContent;
                shadow.links.push(...Array.from(node.shadowRoot.querySelectorAll('a[href]')).map(a=>a.href));
                walk(node.shadowRoot);
            }
        }
    }
    walk(document);
    return {html:document.documentElement.outerHTML, visible_text:document.body.innerText,
            dom_text:document.body.textContent, shadow,
            links:Array.from(document.querySelectorAll('a[href]')).map(a=>a.href),
            headings:Array.from(document.querySelectorAll('h1,h2,h3')).map(h=>h.textContent),
            final_url:location.href};
}"""
READY = """marker => {
    let text = document.body ? document.body.textContent : '';
    function walk(root) { for (const node of root.querySelectorAll('*')) if (node.shadowRoot) {text+=node.shadowRoot.textContent;walk(node.shadowRoot);} }
    walk(document);
    // Markers inside a script string do not establish hydration.
    let content = document.querySelector('main');
    return marker==='SHADOW_READY' ? text.includes(marker) && !!document.querySelector('#host').shadowRoot
        : !!content && content.textContent.includes(marker);
}"""


def text_from_html(html):
    soup = BeautifulSoup(html, "html.parser")
    for node in soup(["script", "style", "noscript"]):
        node.decompose()
    return soup.get_text(" ", strip=True)


async def bounded_close(context):
    started = time.perf_counter()
    try:
        await asyncio.wait_for(context.close(), timeout=2)
        return {"ms": round((time.perf_counter()-started)*1000, 2), "error": None}
    except Exception as exc:
        return {"ms": round((time.perf_counter()-started)*1000, 2), "error": type(exc).__name__}


async def visit(browser, args, target, index, phase, converter, semaphore):
    queued = time.perf_counter()
    async with semaphore:
        started = time.perf_counter()
        context = None
        row = {"engine": args.engine, "url": target, "phase": phase, "index": index,
               "queue_ms": round((started-queued)*1000, 2), "status": "error", "timings_ms": {}}
        try:
            async with asyncio.timeout(22):
                context = await browser.new_context(viewport={"width":1366,"height":768}, ignore_https_errors=True)
                page = await context.new_page()
                stamp = time.perf_counter()
                response = await page.goto(target, wait_until="domcontentloaded", timeout=10000)
                row["timings_ms"]["navigation"] = round((time.perf_counter()-stamp)*1000,2)
                row["http_status"] = response.status if response else None
                marker = MARKERS.get(urlparse(target).path) if urlparse(target).hostname == "snapflow-study-client" else None
                stamp = time.perf_counter()
                if marker:
                    await page.wait_for_function(READY, arg=marker, timeout=5000)
                else:
                    await page.wait_for_timeout(1000)
                row["timings_ms"]["readiness"] = round((time.perf_counter()-stamp)*1000,2)
                stamp = time.perf_counter()
                snapshot = await page.evaluate(SNAPSHOT)
                row["timings_ms"]["snapshot"] = round((time.perf_counter()-stamp)*1000,2)
                stamp = time.perf_counter()
                if args.engine == "obscura":
                    cdp = await context.new_cdp_session(page)
                    markdown = (await cdp.send("LP.getMarkdown"))["markdown"]
                else:
                    markdown = await page.evaluate(converter)
                row["timings_ms"]["markdown"] = round((time.perf_counter()-stamp)*1000,2)
                html = snapshot.pop("html")
                plain = text_from_html(html)
                row.update({
                    "status":"success", "final_url":snapshot["final_url"], "visible_words":len(snapshot["visible_text"].split()),
                    "plain_words":len(plain.split()), "markdown_words":len(markdown.split()),
                    "html_bytes":len(html.encode()), "markdown_bytes":len(markdown.encode()),
                    "plain_sha256":hashlib.sha256(plain.encode()).hexdigest(),
                    "links":snapshot["links"], "headings":snapshot["headings"], "shadow":snapshot["shadow"],
                    "marker_in_plain":bool(marker and marker in plain), "marker_in_markdown":bool(marker and marker in markdown),
                    "hidden_in_markdown":"HIDDEN_TEXT_SHOULD_NOT_BE_VISIBLE" in markdown,
                    "script_in_markdown":"SCRIPT_TEXT_SHOULD_NOT_BE_CONTENT" in markdown,
                    "markdown_method":"LP.getMarkdown" if args.engine=="obscura" else "same_versioned_converter_evaluated_in_chromium",
                })
                stem = f"{phase}-{index}"
                (args.output/f"{stem}.html").write_text(html,encoding="utf-8")
                (args.output/f"{stem}.md").write_text(markdown,encoding="utf-8")
                (args.output/f"{stem}.txt").write_text(plain,encoding="utf-8")
                # Equal hold lets the sampler observe concurrent loaded pages.
                await asyncio.sleep(0.2)
        except Exception as exc:
            row["error"] = f"{type(exc).__name__}: {exc}"
        finally:
            if context:
                row["cleanup"] = await bounded_close(context)
            row["elapsed_ms"] = round((time.perf_counter()-started)*1000,2)
        return row


async def benchmark(args):
    args.output.mkdir(parents=True,exist_ok=True)
    sampler = Sampler(args.engine_container)
    sampler.begin()
    report = {"started_at":datetime.now(timezone.utc).isoformat(), "engine":args.engine,
              "methodology":{"platform":"Linux Docker Desktop", "playwright":"1.58.0", "readiness":"known content markers; live pages 1s settle",
                             "sample_interval_s":0.2, "working_set":"cgroup usage minus inactive file cache", "driver_excluded":True,
                             "chromium_overhead":"small Python TCP relay included in cgroup metrics", "https_errors_ignored":True},
              "rows":[], "phases":{}}
    converter = (HERE/"obscura_markdown.js").read_text(encoding="utf-8")
    try:
        await asyncio.sleep(1)
        report["phases"]["idle"] = sampler.summary("idle")
        async with async_playwright() as playwright:
            token = os.environ.get("OBSCURA_CDP_TOKEN", "") if args.engine=="obscura" else ""
            headers = {"Authorization":f"Bearer {token}"} if token else {}
            version_headers = headers if args.engine=="obscura" else {"Host":"127.0.0.1:9222"}
            request = Request(args.cdp_url.rstrip('/')+"/json/version",headers=version_headers)
            with urlopen(request,timeout=5) as response:
                version = json.load(response)
            advertised = urlparse(version["webSocketDebuggerUrl"])
            base = urlparse(args.cdp_url)
            endpoint = f"ws://{base.netloc}{advertised.path}"
            browser = await playwright.chromium.connect_over_cdp(endpoint,headers=headers or None,timeout=10000)
            report["browser_version"] = browser.version
            sampler.phase = "connected_idle"
            await asyncio.sleep(1)
            report["phases"]["connected_idle"] = sampler.summary("connected_idle")
            for concurrency in args.concurrency:
                phase = f"fixtures_c{concurrency}"
                sampler.phase = phase
                targets = [f"http://snapflow-study-client:18991{path}?visit={i}" for i,path in enumerate(list(MARKERS)*args.repeats)]
                began = time.perf_counter()
                semaphore = asyncio.Semaphore(concurrency)
                rows = await asyncio.gather(*(visit(browser,args,target,i,phase,converter,semaphore) for i,target in enumerate(targets)))
                report["rows"].extend(rows)
                elapsed = time.perf_counter()-began
                report["phases"][phase] = {**sampler.summary(phase), "wall_seconds":round(elapsed,3), "pages":len(rows),
                                          "successful_pages":sum(row["status"]=="success" for row in rows),
                                          "useful_pages_per_second":round(sum(row["status"]=="success" for row in rows)/elapsed,3)}
                (args.output/"study.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
                print(args.engine,phase,report["phases"][phase],flush=True)
                sampler.phase = f"after_{phase}"
                await asyncio.sleep(1)
                report["phases"][sampler.phase] = sampler.summary(sampler.phase)
            if args.live:
                phase = "live"
                sampler.phase = phase
                for i,target in enumerate(["https://example.com/","https://www.medianet.tn/","https://www.biat.com.tn/"]):
                    row = await visit(browser,args,target,i,phase,converter,asyncio.Semaphore(1))
                    report["rows"].append(row)
                    print(args.engine,target,row["status"],row["elapsed_ms"],row.get("plain_words"),flush=True)
                report["phases"][phase] = sampler.summary(phase)
            # Closing remote CDP connection here is okay: engine is isolated and
            # discarded after each matched replicate.
            try:
                await asyncio.wait_for(browser.close(),timeout=3)
            except Exception:
                pass
    finally:
        sampler.stop()
        report["memory_samples"] = sampler.samples
        report["sampling_errors"] = sampler.errors
        report["completed_at"] = datetime.now(timezone.utc).isoformat()
        (args.output/"study.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--fixtures-only",action="store_true")
    parser.add_argument("--engine",choices=["obscura","chromium"])
    parser.add_argument("--engine-container")
    parser.add_argument("--cdp-url")
    parser.add_argument("--output",type=Path,default=Path('/results'))
    parser.add_argument("--concurrency",type=int,nargs='+',default=[1,4,8])
    parser.add_argument("--repeats",type=int,default=3)
    parser.add_argument("--live",action="store_true")
    args=parser.parse_args()
    if args.fixtures_only:
        server().serve_forever()
    else:
        asyncio.run(benchmark(args))
