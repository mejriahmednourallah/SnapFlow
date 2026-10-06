"""Real isolated Apache/Digest routing test; only owned container/files removed."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import socket
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('apache_vps', HERE/'apache-vps.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def docker(*args):
    return subprocess.run(['docker', *args], check=True, capture_output=True, text=True).stdout.strip()


def main():
    results = []
    with tempfile.TemporaryDirectory(prefix='snapflow-apache-probe-') as temporary:
        root = Path(temporary)
        # Synthetic route/password only. No VPS Wetty credentials are used.
        route = '/owned-terminal/'
        realm, user, password = 'Owned Digest', 'fixture', 'fixture-only'
        digest = hashlib.md5(f'{user}:{realm}:{password}'.encode()).hexdigest()
        (root/'digest').write_text(f'{user}:{realm}:{digest}\n')
        wetty = (f'ProxyPass {route} http://fixture:3030{route}\n'
                 + f'ProxyPassReverse {route} http://fixture:3030{route}\n'
                 + f'<Location {route}>\nAuthType Digest\nAuthName "{realm}"\n'
                 + f'AuthDigestDomain "{route}"\nAuthDigestProvider file\n'
                 + 'AuthUserFile "/test/digest"\nRequire valid-user\n</Location>\n')
        (root/'wetty.conf').write_text(wetty)
        (root/'acme').mkdir()
        (root/'acme/owned').write_text('OWNED_CHALLENGE\n')
        # acme_block appends /.well-known/acme-challenge to the webroot.
        challenge = root/'webroot/.well-known/acme-challenge'
        challenge.mkdir(parents=True)
        (challenge/'owned').write_bytes(b'OWNED_CHALLENGE\n')
        for name, paths in {
            'front': {'index.html':'FRONTEND'},
            'api': {'api/ping':'API'},
            'supabase': {f'{name}/v1/health':f'SUPABASE_{name}' for name in ('auth','rest','functions','storage','realtime','graphql')},
            'terminal': {'owned-terminal/index.html':'WETTY'},
        }.items():
            for path, value in paths.items():
                target = root/name/path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(value)
        base = '''ServerRoot "/usr/local/apache2"
ServerName localhost
Listen 8088
LoadModule mpm_event_module modules/mod_mpm_event.so
LoadModule unixd_module modules/mod_unixd.so
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule authn_core_module modules/mod_authn_core.so
LoadModule authn_file_module modules/mod_authn_file.so
LoadModule auth_digest_module modules/mod_auth_digest.so
LoadModule authz_user_module modules/mod_authz_user.so
LoadModule dir_module modules/mod_dir.so
LoadModule alias_module modules/mod_alias.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule headers_module modules/mod_headers.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
User daemon
Group daemon
ErrorLog /proc/self/fd/2
PidFile /tmp/httpd.pid
DirectoryIndex index.html
<Directory /test>
  Require all granted
</Directory>
Include /test/wetty.conf
'''
        source = '''<VirtualHost *:80>
ServerName snapflow.medianet.space
ProxyPreserveHost On
<Location /api/>
ProxyPass http://127.0.0.1:8080/api/
ProxyPassReverse http://127.0.0.1:8080/api/
</Location>
<Location />
ProxyPass http://127.0.0.1:3000/
ProxyPassReverse http://127.0.0.1:3000/
</Location>
</VirtualHost>
<VirtualHost *:443>
ServerName snapflow.medianet.space
ProxyPreserveHost On
<Location /api/>
ProxyPass http://127.0.0.1:8080/api/
ProxyPassReverse http://127.0.0.1:8080/api/
</Location>
<Location />
ProxyPass http://127.0.0.1:3000/
ProxyPassReverse http://127.0.0.1:3000/
</Location>
</VirtualHost>
'''
        (root/'backend.py').write_text('''from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading, hashlib, base64
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        port = self.server.server_port
        if port == 18000 and self.headers.get('Upgrade','').lower() == 'websocket':
            key = self.headers['Sec-WebSocket-Key']
            accept = base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
            self.send_response(101)
            self.send_header('Upgrade','websocket')
            self.send_header('Connection','Upgrade')
            self.send_header('Sec-WebSocket-Accept',accept)
            self.end_headers()
            self.close_connection = True
            return
        body = b'WETTY' if port == 3030 else b'FRONTEND'
        if port == 18000:
            body = ('SUPABASE_' + self.path.split('/')[1]).encode()
            if self.path.endswith('/headers'):
                body = self.headers.get('X-Forwarded-Proto','').encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args): pass
for port in (3030, 3000, 13000, 8080, 18000):
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Event().wait()
''')
        network = docker('network','create','--label','snapflow.test=apache-vps','snapflow-apache-test-'+uuid.uuid4().hex[:8])
        backend = None
        try:
            backend = docker('run','-d','--network',network,'--network-alias','fixture','--label','snapflow.test=apache-vps',
                             '--mount',f'type=bind,source={root},target=/test,readonly',
                             'snapflow/v3-python-fastapi-base:latest','python','/test/backend.py')
            execute_modes(root, source, base, route, wetty, realm, user, password, network, results)
        finally:
            if backend: docker('rm','-f',backend)
            docker('network','rm',network)
        print(json.dumps({'apache_routing':'passed','tests':results,'public_tls_tested':False}))


def execute_modes(root, source, base, route, wetty, realm, user, password, network, results):
        # A deliberately conflicting broad Alias reproduces the API vhost's
        # first-match hazard. Specific challenge routing must win over it.
        source = source.replace('ProxyPreserveHost On', 'ProxyPreserveHost On\nAlias /.well-known/ /test/denied/')
        for mode, vhost_port in (('acme','443'),('acme','80'),('stack','443'),('stack','80')):
            candidate = module.patch(source, 'snapflow.medianet.space', '/test/webroot', mode=='stack', '/test/wetty.conf', [route])
            assert module.patch(candidate, 'snapflow.medianet.space', '/test/webroot', mode=='stack', '/test/wetty.conf', [route]) == candidate, 'Patch must be idempotent'
            # Execute the HTTPS vhost's actual proxy directives over isolated HTTP:
            # no certificate/trust claim is made by this test.
            blocks = list(module.VHOST.finditer(candidate))
            selected = next(b.group(0) for b in blocks if b.group(2)==vhost_port).replace('*:'+vhost_port, '*:8088').replace('http://127.0.0.1:', 'http://fixture:').replace('http://localhost:', 'http://fixture:')
            (root/'httpd.conf').write_text(base+selected)
            container = None
            try:
                container = docker('run','-d','--network',network,'--label','snapflow.test=apache-vps', '-p','127.0.0.1::8088',
                                   '--mount',f'type=bind,source={root},target=/test,readonly',
                                   '--mount',f'type=bind,source={root / "httpd.conf"},target=/usr/local/apache2/conf/httpd.conf,readonly',
                                   'httpd:2.4.65-bookworm')
                port = docker('port',container,'8088/tcp').split(':')[-1]
                origin = f'http://127.0.0.1:{port}'
                plain = urllib.request.build_opener(module.NoRedirect, urllib.request.ProxyHandler({}))
                for attempt in range(30):
                    try:
                        with plain.open(origin+'/.well-known/acme-challenge/owned',timeout=2) as response:
                            observed = response.read()
                            assert observed == b'OWNED_CHALLENGE\n', repr(observed[:200])
                        break
                    except (urllib.error.URLError, ConnectionResetError):
                        if attempt==29:
                            raise
                        time.sleep(.2)
                for path in ('/.well-known/acme-challenge/absent',):
                    try:
                        plain.open(origin+path).close()
                        raise AssertionError('Expected 404')
                    except urllib.error.HTTPError as error:
                        assert error.code == 404
                try:
                    plain.open(origin+route).close()
                    raise AssertionError('Terminal must require Digest authentication')
                except urllib.error.HTTPError as error:
                    assert error.code==401 and error.headers['WWW-Authenticate'].startswith('Digest ')
                passwords = urllib.request.HTTPPasswordMgrWithDefaultRealm()
                passwords.add_password(realm, origin, user, password)
                authenticated = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPDigestAuthHandler(passwords))
                with authenticated.open(origin+route, timeout=10) as response:
                    assert response.read()==b'WETTY'
                assert (root/'wetty.conf').read_text()==wetty
                if mode=='stack' and vhost_port=='80':
                    for path in ('/', '/auth/v1/health', '/rest/v1/health'):
                        try:
                            plain.open(origin+path,timeout=10).close()
                            raise AssertionError('HTTP application requests must redirect to HTTPS')
                        except urllib.error.HTTPError as error:
                            assert error.code==301
                            assert error.headers['Location']=='https://snapflow.medianet.space'+path
                if mode=='stack' and vhost_port=='443':
                    with plain.open(origin+'/') as response:
                        assert response.read()==b'FRONTEND'
                    for name in ('auth','rest','functions','storage','realtime','graphql'):
                        with plain.open(origin+f'/{name}/v1/health') as response:
                            assert response.read()==f'SUPABASE_{name}'.encode()
                    with plain.open(origin+'/auth/v1/headers',timeout=10) as response:
                        assert response.read()==b'https'
                    with socket.create_connection(('127.0.0.1',int(port)),timeout=5) as stream:
                        stream.sendall(b'GET /realtime/v1/websocket HTTP/1.1\r\nHost: snapflow.medianet.space\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')
                        handshake = b''
                        while b'\r\n\r\n' not in handshake:
                            chunk = stream.recv(4096)
                            assert chunk, 'WebSocket handshake ended prematurely'
                            handshake += chunk
                        assert b' 101 ' in handshake.split(b'\r\n')[0]
                        assert b's3pPLMBiTxaQ9kYGzzhZRbK+xOo=' in handshake
                    try:
                        plain.open(origin+'/functions/v1/seed-users').close()
                        raise AssertionError('Seed function must be denied')
                    except urllib.error.HTTPError as error:
                        assert error.code==403
                results.append({'mode':mode,'vhost':vhost_port,'acme_bytes':True,'missing_404':True,'digest_401':True,'authenticated_terminal':True,'supabase_routes':mode=='stack' and vhost_port=='443','https_redirect':mode=='stack' and vhost_port=='80'})
            except BaseException:
                if container:
                    log = subprocess.run(['docker','logs','--tail','20',container], capture_output=True, text=True)
                    print(log.stdout + log.stderr)
                raise
            finally:
                if container:
                    docker('rm','-f',container)


if __name__=='__main__':
    main()
