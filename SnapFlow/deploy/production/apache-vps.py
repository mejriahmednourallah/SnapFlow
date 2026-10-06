"""Scoped Debian Apache repair. Run as root; never print protected route/config.

acme: add local challenges and protect terminal routing from the root proxy.
stack: activate the prepared loopback frontend/Supabase routes after startup.
probe: check exact challenge bytes locally and publicly, plus missing-file 404.
check-wetty: read-only repeated file/runtime checks; never print protected values.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

HOSTS = {
    '010-snapflow.medianet.space.conf': ('snapflow.medianet.space', '/var/www/snapflow.medianet.space/build'),
    '020-snapflow-api.medianet.space.conf': ('snapflow-api.medianet.space', '/var/www/snapflow-api.medianet.space'),
}
START = '    # BEGIN SNAPFLOW OWNED ACME\n'
END = '    # END SNAPFLOW OWNED ACME\n'
VHOST = re.compile(r'(<VirtualHost\s+\*:([0-9]+)>)(.*?)(</VirtualHost>)', re.S)


def acme_block(webroot):
    directory = webroot.rstrip('/') + '/.well-known/acme-challenge'
    return (START + '    SetEnvIf Request_URI "^/\\.well-known/acme-challenge/" no-proxy=1\n'
            + f'    Alias /.well-known/acme-challenge/ "{directory}/"\n'
            + f'    <Directory "{directory}">\n        Options -Indexes\n'
            + '        AllowOverride None\n        Require all granted\n    </Directory>\n' + END)


def patch(source, host, webroot, stack=False, wetty_include=None, wetty_routes=()):
    """Only modify the two expected vhosts, leaving SSL/WSGI/global files intact."""
    source = re.sub(re.escape(START) + r'.*?' + re.escape(END), '', source, flags=re.S)
    source = re.sub(r'    # BEGIN SNAPFLOW OWNED TERMINAL\n.*?    # END SNAPFLOW OWNED TERMINAL\n', '', source, flags=re.S)
    ports = []
    def replace(match):
        opening, port, body, closing = match.groups()
        if port not in ('80', '443') or not re.search(r'^\s*ServerName\s+' + re.escape(host) + r'\s*$', body, re.M):
            raise ValueError('Unexpected vhost; nothing should be applied')
        ports.append(port)
        if stack:
            if host != 'snapflow.medianet.space' or not wetty_include or not wetty_routes:
                raise ValueError('Stack routing requires the protected terminal include')
            # Support the supplied legacy config or our own previous generated block.
            if '# BEGIN SNAPFLOW OWNED ROUTES' in body:
                body = re.sub(r'    # BEGIN SNAPFLOW OWNED ROUTES\n.*?    # END SNAPFLOW OWNED ROUTES\n', '', body, flags=re.S)
            else:
                locations = re.findall(r'<Location\s+(/api/|/)>(.*?)</Location>', body, re.S)
                if len(locations) != 2 or set(path for path, _ in locations) != {'/', '/api/'}:
                    raise ValueError('Unexpected application proxy rules; inspect privately')
                expected = {'/': 'http://127.0.0.1:3000/', '/api/': 'http://127.0.0.1:8080/api/'}
                for path, rules in locations:
                    if not re.fullmatch(r'\s*ProxyPass\s+' + re.escape(expected[path])
                                        + r'\s+ProxyPassReverse\s+' + re.escape(expected[path]) + r'\s*', rules):
                        raise ValueError('Unexpected Location contents; inspect privately')
                body = re.sub(r'[ \t]*<Location\s+(?:/api/|/)>(.*?)</Location>\s*', '', body, flags=re.S)
            rules = '    # BEGIN SNAPFLOW OWNED ROUTES\n    ProxyRequests Off\n'
            rules += f'    Include "{wetty_include}"\n'
            rules += f'    RequestHeader set X-Forwarded-Proto "{"https" if port == "443" else "http"}"\n'
            if port == '80':
                rules += '    RewriteEngine On\n    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge/\n'
                for route in wetty_routes:
                    rules += '    RewriteCond %{REQUEST_URI} !^' + re.escape(route) + '\n'
                rules += '    RewriteRule ^ https://snapflow.medianet.space%{REQUEST_URI} [R=301,L]\n'
            rules += '    <Location /functions/v1/seed-users>\n        Require all denied\n    </Location>\n'
            for route in ('auth', 'rest', 'functions', 'storage', 'realtime', 'graphql'):
                path = f'/{route}/v1/'
                upgrade = ' upgrade=websocket' if route == 'realtime' else ''
                rules += f'    ProxyPass {path} http://127.0.0.1:18000{path}{upgrade}\n'
                rules += f'    ProxyPassReverse {path} http://127.0.0.1:18000{path}\n'
            rules += '    ProxyPass / http://127.0.0.1:13000/\n    ProxyPassReverse / http://127.0.0.1:13000/\n'
            body = body.rstrip() + '\n' + rules + '    # END SNAPFLOW OWNED ROUTES\n'
        if not stack and wetty_routes:
            body = body.rstrip() + '\n    # BEGIN SNAPFLOW OWNED TERMINAL\n'
            for route in wetty_routes:
                body += (f'    <Location "{route}">\n'
                         + f'        ProxyPass http://localhost:3030{route}\n'
                         + f'        ProxyPassReverse http://localhost:3030{route}\n    </Location>\n')
            body += '    # END SNAPFLOW OWNED TERMINAL\n'
        # Alias uses first-match ordering. The specific challenge must precede
        # the API vhost's pre-existing broad /.well-known Alias.
        return opening + '\n' + acme_block(webroot) + body.strip('\n') + '\n' + closing
    result = VHOST.sub(replace, source)
    if sorted(ports) != ['443', '80']:
        raise ValueError('Expected exactly HTTP and HTTPS vhosts')
    return result


def run(*args):
    subprocess.run(args, check=True)


def protected(root):
    files = [root/'sites-enabled/990-wetty.conf', root/'wetty.htdigest']
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}


def terminal_routes(root):
    source = (root/'sites-enabled/990-wetty.conf').read_text()
    pairs = re.findall(r'^\s*ProxyPass\s+(\S+)\s+http://(?:localhost|127\.0\.0\.1):3030(\S*)\s*$', source, re.M)
    if any(route != target for route, target in pairs):
        raise ValueError('Protected proxy target differs from its route; inspect privately')
    routes = [route for route, _ in pairs]
    if not routes or any(not route.startswith('/') or route == '/' or re.search(r'[\s"\\]', route) for route in routes):
        raise ValueError('Unexpected protected proxy configuration')
    return routes


def terminal_check(routes):
    opener = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))
    for route in routes:
        request = urllib.request.Request('http://127.0.0.1'+route, headers={'Host':'snapflow.medianet.space'})
        try:
            opener.open(request, timeout=10).close()
            raise RuntimeError('Protected terminal no longer requires authentication')
        except urllib.error.HTTPError as error:
            if error.code != 401 or not error.headers.get('WWW-Authenticate','').startswith('Digest '):
                raise RuntimeError('Protected terminal Digest challenge failed') from None


def wetty_snapshot():
    fmt = ('{"id":{{json .Id}},"image":{{json .Image}},'
           '"running":{{json .State.Running}},"started":{{json .State.StartedAt}},'
           '"restarts":{{json .RestartCount}},"oom":{{json .State.OOMKilled}},'
           '"mode":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},'
           '"networks":{{json .NetworkSettings.Networks}}}')
    result = subprocess.run(['docker','inspect','wetty_wetty_1','--format',fmt],
                            check=True, capture_output=True)
    data = json.loads(result.stdout)
    if data['running'] is not True:
        raise RuntimeError('Wetty is not running')
    # Docker may enumerate mounts in a different order between inspect calls.
    # Compare values, retaining every mount and all nested network metadata.
    data['mounts'] = sorted(data['mounts'], key=lambda item: json.dumps(item, sort_keys=True))
    return data, result.stdout


def wetty_identity():
    return wetty_snapshot()[0]


def changed_fields(before, after):
    return sorted(key for key in before.keys() | after.keys()
                  if key not in before or key not in after or before[key] != after[key])


def check_wetty(root):
    """Read-only diagnosis without printing credentials, routes or mount values."""
    files = protected(root)
    before, raw_before = wetty_snapshot()
    serialization_changes = 0
    runtime_changes = set()
    file_changes = set()
    for _ in range(4):
        time.sleep(.2)
        after, raw_after = wetty_snapshot()
        changes = changed_fields(before, after)
        runtime_changes.update(changes)
        file_changes.update(Path(name).name for name in changed_fields(files, protected(root)))
        if not changes and raw_before != raw_after:
            serialization_changes += 1
    print(json.dumps({'samples': 5, 'wetty_running': True,
                      'runtime_changed_fields': sorted(runtime_changes),
                      'protected_files_changed': sorted(file_changes),
                      'serialization_only_changes': serialization_changes}))
    if runtime_changes or file_changes:
        raise RuntimeError('Wetty protection check detected changes; do not activate Apache')


def apply(root, stack=False):
    before = protected(root)
    routes = terminal_routes(root)
    identity = wetty_identity()
    terminal_check(routes)
    # Stack activation is a later phase; require both loopback candidates first.
    if stack:
        for port in (13000, 18000):
            import socket
            with socket.create_connection(('127.0.0.1', port), timeout=5):
                pass
    run('apache2ctl', '-t')
    changes = []
    for name, (host, webroot) in HOSTS.items():
        target = (root/'sites-enabled'/name).resolve(strict=True)
        if not target.is_relative_to(root.resolve()):
            raise ValueError('Enabled vhost resolves outside Apache directory')
        original = target.read_bytes()
        candidate = patch(original.decode(), host, webroot, stack and name.startswith('010-'),
                          str(root/'sites-enabled/990-wetty.conf'), routes)
        changes.append((target, original, candidate.encode(), target.stat()))
    backup = Path('/var/backups/snapflow-apache') / (time.strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup.parent, 0o700)
    for target, original, _, _ in changes:
        file = backup/target.name
        file.write_bytes(original)
        os.chmod(file, 0o600)
    def save_identity(name, value):
        file = backup/name
        file.write_text(json.dumps(value, sort_keys=True))
        os.chmod(file, 0o600)
    save_identity('wetty-before.json', identity)
    def write(target, payload, stat):
        fd, temporary = tempfile.mkstemp(prefix='.snapflow-', dir=target.parent)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(payload)
            os.chmod(temporary, stat.st_mode & 0o7777)
            os.chown(temporary, stat.st_uid, stat.st_gid)
            os.replace(temporary, target)
        finally:
            Path(temporary).unlink(missing_ok=True)
    try:
        for target, _, candidate, stat in changes:
            write(target, candidate, stat)
        if protected(root) != before:
            raise RuntimeError('Protected terminal files changed before reload')
        run('apache2ctl', '-t')
        run('systemctl', 'reload', 'apache2')
        terminal_check(routes)
        after = wetty_identity()
        save_identity('wetty-after.json', after)
        file_changes = changed_fields(before, protected(root))
        if file_changes:
            raise RuntimeError('Protected terminal files changed: ' + ', '.join(Path(name).name for name in file_changes))
        runtime_changes = changed_fields(identity, after)
        if runtime_changes:
            raise RuntimeError('Wetty runtime changed: ' + ', '.join(runtime_changes)
                               + '; private snapshots: ' + str(backup))
    except BaseException:
        for target, original, _, stat in changes:
            write(target, original, stat)
        run('apache2ctl', '-t')
        run('systemctl', 'reload', 'apache2')
        print(json.dumps({'rolled_back': True, 'backup': str(backup)}))
        raise
    (backup/'manifest.json').write_text(json.dumps({'mode': 'stack' if stack else 'acme', 'files': [str(t) for t, *_ in changes]}))
    print(json.dumps({'applied': 'stack' if stack else 'acme', 'backup': str(backup), 'protected_files_unchanged': True}))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def challenge_directory(webroot):
    """Make only the two public challenge directories traversable by Apache.

    Private export/release files retain umask 077. Do not chmod application
    parents or follow challenge-directory symlinks into unrelated locations.
    """
    base = Path(webroot).resolve(strict=True)
    current = base
    for component in ('.well-known', 'acme-challenge'):
        current = current/component
        if current.is_symlink():
            raise RuntimeError('Challenge directory is a symlink; inspect before repair')
        created = not current.exists()
        if created:
            current.mkdir(mode=0o755)
        if not current.is_dir():
            raise RuntimeError('Challenge path is not a directory')
        stat = current.stat()
        if created or stat.st_uid == 0:
            # chmod after mkdir is required when invoked with restrictive umask.
            os.chmod(current, stat.st_mode & 0o7777 | 0o055)
    return current


def probe():
    opener = urllib.request.build_opener(NoRedirect, urllib.request.ProxyHandler({}))
    identifier = 'snapflow-owned-' + uuid.uuid4().hex
    payload = (identifier + '\n').encode()
    for host, webroot in HOSTS.values():
        directory = challenge_directory(webroot)
        path = directory/identifier
        with path.open('xb') as handle:
            handle.write(payload)
        os.chmod(path, 0o644)
        try:
            for destination in ('127.0.0.1', host):
                request = urllib.request.Request(f'http://{destination}/.well-known/acme-challenge/{identifier}', headers={'Host': host})
                try:
                    with opener.open(request, timeout=20) as response:
                        if response.status != 200 or response.read(1024) != payload:
                            raise RuntimeError(f'Challenge bytes incorrect for {host} via {destination}')
                except urllib.error.HTTPError as error:
                    raise RuntimeError(f'Challenge HTTP {error.code} for {host} via {destination}') from None
                missing = urllib.request.Request(f'http://{destination}/.well-known/acme-challenge/{identifier}-missing', headers={'Host': host})
                try:
                    opener.open(missing, timeout=20).close()
                    raise RuntimeError(f'Missing challenge did not return 404 for {host}')
                except urllib.error.HTTPError as error:
                    if error.code != 404:
                        raise
            print(json.dumps({'host': host, 'local_and_public_probe': 'passed', 'missing': 404}))
        finally:
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['acme', 'probe', 'stack', 'check-wetty'])
    options = parser.parse_args()
    if os.name != 'posix' or os.geteuid() != 0:
        parser.error('Run with sudo python3 on the Debian VPS')
    if options.action == 'check-wetty':
        check_wetty(Path('/etc/apache2'))
    elif options.action == 'probe':
        probe()
    else:
        apply(Path('/etc/apache2'), stack=options.action == 'stack')


if __name__ == '__main__':
    main()
