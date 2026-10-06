"""Known-content fixtures; no form submissions or security probes."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from urllib.parse import urlparse

RICH_CONTENT = """<nav>NAV_BOILERPLATE <a href='/static'>Home</a></nav>
<main><h1>STRUCTURE_READY</h1><h2>French content: confidentialité et données</h2>
<p>BODY_EVIDENCE Publication date: 2026-09-20. Readable content for the audit.</p>
<ul><li>LIST_ALPHA</li><li>LIST_BETA</li></ul><ol><li>ORDER_FIRST</li><li>ORDER_SECOND</li></ol>
<table><thead><tr><th>TABLE_KEY</th><th>TABLE_VALUE</th></tr></thead><tbody><tr><td>Retention</td><td>30 days</td></tr></tbody></table>
<blockquote>QUOTE_EVIDENCE</blockquote><pre><code>const CODE_EVIDENCE = 1;</code></pre>
<a href='/nested/two?lang=fr'>LINK_EVIDENCE</a><img alt='IMAGE_ALT_EVIDENCE' src='/pixel.svg'>
<div style='display:none'>HIDDEN_TEXT_SHOULD_NOT_BE_VISIBLE</div>
<script>const internal_secret='SCRIPT_TEXT_SHOULD_NOT_BE_CONTENT';</script>
</main><footer>FOOTER_BOILERPLATE <a href='/privacy'>Privacy</a></footer>"""
FIXTURES = {
    "/static": "<main><h1>STATIC_READY</h1><p>Reliable source content with an ordinary link.</p><a href='/nested/one'>Next route</a></main>",
    "/delayed": "<div id='root'></div><script>setTimeout(()=>{document.getElementById('root').innerHTML='<main><h1>HYDRATED_READY</h1><p>Hydrated content after seven hundred milliseconds.</p><a href=\"/nested/one\">Next route</a></main>'},700)</script>",
    "/fetch": "<main id='root'></main><script>fetch('/data').then(r=>r.json()).then(d=>{document.getElementById('root').innerHTML='<h1>FETCH_READY</h1><p>'+d.text+'</p>'})</script>",
    "/shadow": "<main><h1>SHADOW_HOST</h1><div id='host'></div></main><script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<h2>SHADOW_READY</h2><p>Shadow tree evidence for NLP.</p><a href=\"/nested/one\">SHADOW_LINK</a>'</script>",
    "/structured": RICH_CONTENT,
    "/heavy": "<main><h1>HEAVY_READY</h1>" + "".join(f"<section><h2>Topic {i}</h2><p>Detailed audit evidence about performance, security and privacy for page section {i}.</p><a href='/nested/two?topic={i}'>Read details</a></section>" for i in range(300)) + "</main>",
    "/nested/one": "<main><h1>NESTED_READY</h1><a href='/nested/two'>Deeper route</a></main>",
    "/nested/two": "<main><h1>DEEP_READY</h1><p>Second discovery depth content.</p></main>",
    "/privacy": "<main><h1>Privacy</h1><p>You can request access, deletion and correction of personal data.</p></main>",
}
MARKERS = {"/static": "STATIC_READY", "/delayed": "HYDRATED_READY", "/fetch": "FETCH_READY", "/shadow": "SHADOW_READY", "/structured": "STRUCTURE_READY", "/heavy": "HEAVY_READY"}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/data":
            body = json.dumps({"text": "Fetched content for the page evidence."}).encode()
            content_type = "application/json"
        elif path == "/pixel.svg":
            body = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>'
            content_type = "image/svg+xml"
        elif path in FIXTURES:
            body = ("<!doctype html><html><head><meta charset='utf-8'><title>Known content fixture</title></head><body>" + FIXTURES[path] + "</body></html>").encode()
            content_type = "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", "Sun, 20 Sep 2026 10:00:00 GMT")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def server():
    return ThreadingHTTPServer(("0.0.0.0", 18991), Handler)
