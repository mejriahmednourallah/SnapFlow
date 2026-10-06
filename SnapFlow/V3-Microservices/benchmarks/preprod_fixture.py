"""Owned six-page target for the actual composed audit, never a public site."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json

EN = ('Customers can read this guide to understand the service. '
      'Each section explains the available options and describes the next steps. '
      'Contact our team for assistance with an application or a question. ')
FR = ('Les clients peuvent consulter ce guide pour comprendre notre service. '
      'Chaque section présente les options disponibles et explique les étapes suivantes. '
      'Contactez notre équipe pour obtenir une réponse à votre demande. ')
AR = 'يمكن للعملاء قراءة هذا الدليل لفهم الخدمة ومعرفة الخيارات المتاحة والخطوات التالية والتواصل مع فريق الدعم للحصول على المساعدة. '

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == '/robots.txt':
            self.reply('User-agent: *\nAllow: /\n', 'text/plain'); return
        if path == '/llms.txt':
            self.reply('# Local service\n\nA known-content audit fixture.\n', 'text/plain'); return
        if path == '/data':
            self.reply(json.dumps({'text': EN * 9}), 'application/json'); return
        if path == '/':
            lang, title, body = 'en', 'HOME_EVIDENCE', '<main><h1>HOME_EVIDENCE</h1><p>' + EN * 9 + '</p>' + ''.join(
                f'<a href="{url}">{name}</a>' for url, name in [('/delayed','French'),('/shadow','Arabic'),('/guide?topic=a','Account guide'),('/guide?topic=b','Payment guide'),('/late','Fetched guide')]) + '</main>'
        elif path == '/delayed':
            lang, title = 'fr', 'HYDRATED_EVIDENCE'
            content = '<main><h1>HYDRATED_EVIDENCE</h1><p>' + FR * 9 + '</p></main>'
            body = '<div id="root"></div><script>setTimeout(()=>document.getElementById("root").innerHTML=' + json.dumps(content) + ',700)</script>'
        elif path == '/shadow':
            lang, title = 'ar', 'SHADOW_EVIDENCE'
            content = '<h2>SHADOW_EVIDENCE</h2><p>' + AR * 12 + '</p><div id="inner"></div>'
            nested = '<p>NESTED_SHADOW_EVIDENCE ' + AR * 3 + '</p>'
            body = '<main><h1>Arabic service guide</h1><div id="host"></div></main><script>const r=document.getElementById("host").attachShadow({mode:"open"}); r.innerHTML=' + json.dumps(content) + ';r.getElementById("inner").attachShadow({mode:"open"}).innerHTML=' + json.dumps(nested) + ';</script>'
        elif path == '/guide' and parse_qs(parsed.query).get('topic', [''])[0] in ('a','b'):
            topic = parse_qs(parsed.query)['topic'][0]
            lang, title = 'en', 'QUERY_' + topic.upper() + '_EVIDENCE'
            text = ('Account registration and identity verification. ' if topic == 'a' else 'Payment processing and invoice management. ')
            body = '<main><h1>' + title + '</h1><p>' + (text + EN) * 9 + '</p></main>'
        elif path == '/late':
            lang, title = 'en', 'FETCH_EVIDENCE'
            body = '<main id="root"></main><script>fetch("/data").then(r=>r.json()).then(d=>document.getElementById("root").innerHTML="<h1>FETCH_EVIDENCE</h1><p>"+d.text+"</p>")</script>'
        else:
            self.send_error(404); return
        self.reply('<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><title>' + title + '</title><meta name="description" content="' + EN + '"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + body + '</body></html>', 'text/html; charset=utf-8')

    def reply(self, content, mime):
        data = content.encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Last-Modified', 'Sun, 20 Sep 2026 10:00:00 GMT')
        self.end_headers(); self.wfile.write(data)

    def log_message(self, *args):
        pass

if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 18991), Handler).serve_forever()
