"""Compare the real browser pool's engines on identical fixture/public pages.

The local fixture allowlist override applies only inside this benchmark process.
No form submission, scanner probes or production database access is involved.
"""
import argparse
import asyncio
from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version
import json
import os
from pathlib import Path
import sys
import threading
import time
from urllib.parse import urlparse
from unittest.mock import patch

from bs4 import BeautifulSoup

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
FIXTURES = {
    "/static": "<main><h1>STATIC_READY</h1><p>Reliable original content for a website audit.</p><a href='/nested/one'>Next route</a></main>",
    "/delayed": "<div id='root'></div><script>setTimeout(()=>{document.getElementById('root').innerHTML='<main><h1>HYDRATED_READY</h1><p>Content produced after hydration.</p><a href=\"/nested/one\">Next route</a></main>'},700)</script>",
    "/fetch": "<main id='root'></main><script>fetch('/data').then(r=>r.json()).then(d=>{document.getElementById('root').innerHTML='<h1>FETCH_READY</h1><p>'+d.text+'</p>'})</script>",
    "/shadow": "<main><h1>SHADOW_HOST</h1><div id='host'></div></main><script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<h2>SHADOW_READY</h2><p>Evidence inside a shadow tree.</p><a href=\"/nested/one\">Next route</a>'</script>",
    "/nested/one": "<main><h1>NESTED_READY</h1><a href='/nested/two'>Deeper route</a></main>",
    "/nested/two": "<main><h1>DEEP_READY</h1><p>Evidence on the second discovery depth.</p></main>",
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/data":
            body = json.dumps({"text": "Fetched audit evidence must be preserved."}).encode()
            content_type = "application/json"
        elif path in FIXTURES:
            body = ("<!doctype html><html><head><title>SnapFlow fixture</title></head><body>" + FIXTURES[path] + "</body></html>").encode()
            content_type = "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def summarize(result):
    payload = asdict(result)
    html = payload.pop("rendered_html", None) or ""
    soup = BeautifulSoup(html, "html.parser")
    for node in soup(["script", "style", "noscript"]):
        node.decompose()
    text = soup.get_text(" ", strip=True)
    payload.update({
        "html_bytes": len(html.encode()), "html_sha256": hashlib.sha256(html.encode()).hexdigest(),
        "text_words": len(text.split()), "text_sha256": hashlib.sha256(text.encode()).hexdigest(),
        "heading_count": len(soup.find_all(["h1", "h2", "h3"])),
        "link_count": len(soup.find_all("a", href=True)),
        "markers": [marker for marker in ["STATIC_READY", "HYDRATED_READY", "FETCH_READY", "SHADOW_READY", "DEEP_READY"] if marker in text],
    })
    return payload, html, text


async def benchmark(args):
    env_path = HERE / "obscura.env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("OBSCURA_CDP_TOKEN="):
                os.environ["OBSCURA_CDP_TOKEN"] = line.split("=", 1)[1]
    os.environ.update({"OBSCURA_CDP_URL": args.cdp_url, "ENABLE_OBSCURA_DISCOVERY": "true", "OBSCURA_RENDER_ENABLED": "true", "BROWSER_POOL_WORKERS": "1"})
    sys.path.insert(0, str(ROOT / "V3-Microservices/v3-browser-pool"))
    import pool as runtime
    browser_pool = runtime.BrowserPool()
    await browser_pool.start()
    args.output.mkdir(parents=True, exist_ok=True)
    targets = [f"http://host.docker.internal:{args.fixture_port}{path}" for path in ("/static", "/delayed", "/fetch", "/shadow", "/nested/one")]
    if args.live:
        targets += ["https://example.com/", "https://www.biat.com.tn/", "https://www.medianet.tn/"]
    report = {"started_at": datetime.now(timezone.utc).isoformat(), "playwright": version("playwright"), "chromium": browser_pool._browsers[0].version, "settle_ms": args.settle_ms, "rows": []}
    try:
        # Explicit connection first, so a broken protocol cannot masquerade as an engine result.
        remote = await browser_pool._get_obscura_browser()
        report["obscura_version"] = remote.version
        print("Connected both engines", flush=True)
        for round_id in range(args.rounds):
            for target_index, target in enumerate(targets):
                for engine in (["obscura", "chromium"] if round_id % 2 == 0 else ["chromium", "obscura"]):
                    started = time.perf_counter()
                    visit_url = target.replace("host.docker.internal", "127.0.0.1") if engine == "chromium" else target
                    result = await browser_pool.render(visit_url, timeout_ms=20000, engine=engine, settle_ms=args.settle_ms)
                    payload, html, text = summarize(result)
                    payload.update({"engine_requested": engine, "fixture_target": target, "round": round_id, "elapsed_ms": round((time.perf_counter()-started)*1000, 1)})
                    stem = f"{round_id}-{target_index}-{engine}"
                    (args.output / f"{stem}.html").write_text(html, encoding="utf-8")
                    (args.output / f"{stem}.txt").write_text(text, encoding="utf-8")
                    report["rows"].append(payload)
                    (args.output / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(engine, target, payload["status"], payload["elapsed_ms"], "ms", payload["text_words"], "words", payload.get("error"), flush=True)
        original_validation = runtime._validate_discovery_target
        def validate_fixture(url, domains):
            if urlparse(url).hostname in {"host.docker.internal", "127.0.0.1"}:
                return True, ""
            return original_validation(url, domains)
        report["discovery"] = []
        with patch.object(runtime, "_validate_discovery_target", side_effect=validate_fixture):
            for target in targets:
                for engine in ["obscura", "chromium"]:
                    started = time.perf_counter()
                    visit_url = target.replace("host.docker.internal", "127.0.0.1") if engine == "chromium" else target
                    result = await browser_pool.discover_rendered(visit_url, [urlparse(visit_url).hostname], max_links=100, extract_forms=False, wait_ms=10000, force_chromium=engine=="chromium")
                    payload, html, text = summarize(result)
                    payload.update({"engine_requested": engine, "fixture_target": target, "elapsed_ms": round((time.perf_counter()-started)*1000, 1)})
                    report["discovery"].append(payload)
                    print("discovery", engine, target, result.engine, payload["status"], len(result.internal_links or []), "links", payload.get("error"), flush=True)
        report["health"] = browser_pool.health()
    finally:
        (args.output / "comparison.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        await browser_pool.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    parser.add_argument("--fixture-port", type=int, default=18991)
    parser.add_argument("--rounds", type=int, default=2)
    parser.add_argument("--settle-ms", type=int, default=1000)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "output/playwright/obscura-baseline")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("0.0.0.0", args.fixture_port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        asyncio.run(benchmark(args))
    finally:
        server.shutdown()
