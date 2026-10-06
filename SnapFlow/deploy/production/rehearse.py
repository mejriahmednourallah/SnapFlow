"""Pinned production-Compose configuration, restore and local rehearsal.

Requires Python with PyYAML and cryptography, Docker and Compose. This does not
modify Cloud. VPS configuration uses a separate private runtime and host Apache.
Export key is accepted through stdin only; SMTP can be explicitly deferred.
"""
import argparse
import base64
import concurrent.futures
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from urllib.parse import urlsplit

import yaml

ROOT = Path(__file__).resolve().parents[2]
COMMIT = '564eab8ad7840b13324f68b1bfac074ef8d51c21'
RELEASE = 'self-hosted/v0.8.2'
# Cloud exports include recovery-code and SCIM tables absent from v2.196.0.
# v2.197.0 creates them through the Auth service's own migrations.
AUTH_IMAGE = 'supabase/gotrue:v2.197.0'


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')


def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'SnapFlow-production-rehearsal'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def fetch(runtime):
    upstream = runtime / 'upstream'
    tree = json.loads(get(f'https://api.github.com/repos/supabase/supabase/git/trees/{COMMIT}?recursive=1'))
    assert not tree.get('truncated'), 'Upstream tree truncated'
    paths = [entry['path'] for entry in tree['tree'] if entry['type'] == 'blob'
             and (entry['path'].startswith(('docker/volumes/db/', 'docker/volumes/api/',
                                           'docker/volumes/pooler/', 'docker/volumes/functions/'))
                  or entry['path'] in ('docker/docker-compose.yml', 'docker/.env.example'))]
    def download(path):
        target = upstream / Path(path).relative_to('docker')
        target.parent.mkdir(parents=True, exist_ok=True)
        blob = get(f'https://raw.githubusercontent.com/supabase/supabase/{COMMIT}/{path}')
        target.write_bytes(blob)
        return dict(path=path, sha256=hashlib.sha256(blob).hexdigest())
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        files = list(executor.map(download, paths))
    dump(runtime / 'upstream-manifest.json', dict(release=RELEASE, commit=COMMIT, files=files))
    print(json.dumps(dict(upstream=RELEASE, commit=COMMIT, files=len(files))))


def decrypt(runtime, export):
    from cryptography.fernet import Fernet
    summary = json.loads((export / 'migration-summary.json').read_text(encoding='utf-8-sig'))
    blob = (export / summary['encrypted_bundle']).read_bytes()
    assert hashlib.sha256(blob).hexdigest() == summary['bundle_sha256']
    archive = Fernet(sys.stdin.buffer.read().strip()).decrypt(blob)
    target = (runtime / 'import').resolve()
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as tar:
        for member in tar:
            resolved = (target / member.name).resolve()
            assert resolved.is_relative_to(target) and not member.issym() and not member.islnk()
            if member.isdir():
                resolved.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                resolved.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source:
                    resolved.write_bytes(source.read())
    print(json.dumps(dict(decrypted_files=len(list(target.rglob('*'))), sql_files=[p.name for p in target.rglob('*.sql')], secrets_printed=False)))


def env_file(path):
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def readable_container_inputs(upstream):
    """Bind-mounted public bootstrap/code needs access for container service UIDs.

    The enclosing private runtime stays 0700 and credentials/imports stay 0600.
    Host users cannot traverse that runtime; container mounts expose only their
    intended input subtree. Never chmod database data or follow symlinks.
    """
    if os.name != 'posix':
        return
    paths = []
    data = upstream / 'volumes/db/data'
    for name in ('db', 'api', 'pooler', 'functions', 'snippets'):
        root = upstream / 'volumes' / name
        if not root.exists():
            continue
        paths.extend(p for p in [root, *root.rglob('*')]
                     if p != data and data not in p.parents)
    if any(path.is_symlink() for path in paths):
        raise ValueError('Container input symlink refused; preserve private runtime boundaries')
    for path in paths:
        path.chmod(0o755 if path.is_dir() or path.suffix == '.sh' else 0o644)


def token(role, secret):
    encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj, separators=(',', ':')).encode()).rstrip(b'=')
    now = int(time.time())
    message = encode(dict(alg='HS256', typ='JWT')) + b'.' + encode(dict(role=role, iss='supabase', iat=now, exp=now+315360000))
    return (message + b'.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), message, hashlib.sha256).digest()).rstrip(b'=')).decode()


def configure(runtime, profile='rehearsal', public_origin=None, skip_smtp=False):
    upstream = runtime / 'upstream'
    private = runtime / 'runtime.env'
    descriptor = runtime/'deployment.json'
    previous = json.loads(descriptor.read_text()) if descriptor.exists() else {'profile':'rehearsal'}
    if private.exists() and previous['profile'] != profile:
        raise ValueError('Use a separate private runtime for VPS; do not convert a running rehearsal')
    public = public_origin or 'http://127.0.0.1:18080'
    if profile == 'vps':
        if public_origin is None or not skip_smtp:
            raise ValueError('VPS requires --public-origin and explicit --skip-smtp until real SMTP is configured')
        parsed = urlsplit(public)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.port not in (None,443) or parsed.path not in ('','/') or parsed.query or parsed.fragment
                or parsed.hostname in ('localhost','127.0.0.1')):
            raise ValueError('VPS public origin must be an HTTPS hostname without a path or credentials')
        public = public.rstrip('/')
    project = 'snapflow-production' if profile == 'vps' else 'snapflow-rehearsal'
    network = project+'-bridge'
    if os.name == 'posix':
        os.chmod(runtime, 0o700)
    reused = private.exists()
    if reused:
        values = env_file(private)
    else:
        values = env_file(upstream / '.env.example')
        for key in ('POSTGRES_PASSWORD', 'JWT_SECRET', 'DASHBOARD_PASSWORD', 'SECRET_KEY_BASE',
                    'PG_META_CRYPTO_KEY', 'LOGFLARE_PUBLIC_ACCESS_TOKEN', 'LOGFLARE_PRIVATE_ACCESS_TOKEN',
                    'S3_PROTOCOL_ACCESS_KEY_SECRET'):
            values[key] = secrets.token_hex(32)
        values['REALTIME_DB_ENC_KEY'] = secrets.token_hex(8)
        values['VAULT_ENC_KEY'] = secrets.token_hex(16)
        values['ANON_KEY'] = token('anon', values['JWT_SECRET'])
        values['SERVICE_ROLE_KEY'] = token('service_role', values['JWT_SECRET'])
        values['DB_PASS'] = secrets.token_hex(24)
        values['REDMINE_LOGIN_RATE_LIMIT_SALT'] = secrets.token_hex(32)
    values.update(SUPABASE_PUBLIC_URL=public, API_EXTERNAL_URL=public+'/auth/v1', SITE_URL=public,
                  ADDITIONAL_REDIRECT_URLS=public+'/**', POSTGRES_HOST='supabase-db', POOLER_TENANT_ID=project,
                  ENABLE_PHONE_SIGNUP='false', ENABLE_PHONE_AUTOCONFIRM='false', OPENAI_API_KEY='',
                  VITE_SUPABASE_URL=public, VITE_SUPABASE_PUBLISHABLE_KEY=values['ANON_KEY'],
                  FORM_EXECUTOR_DATABASE_URL=f"postgresql://postgres:{values['POSTGRES_PASSWORD']}@supabase-db:5432/postgres",
                  FORM_EXECUTOR_SUPABASE_URL='http://supabase-gateway:8000',
                  SUPABASE_SERVICE_ROLE_KEY=values['SERVICE_ROLE_KEY'])
    if profile == 'vps':
        # User deliberately deferred SMTP. Do not silently auto-confirm accounts.
        values.update(SMTP_HOST='', SMTP_PORT='587', SMTP_USER='', SMTP_PASS='',
                      SMTP_ADMIN_EMAIL='', SMTP_SENDER_NAME='SnapFlow', ENABLE_EMAIL_AUTOCONFIRM='false')
    else:
        values.update(SMTP_HOST='mail', SMTP_PORT='1025', SMTP_USER='', SMTP_PASS='',
                      SMTP_ADMIN_EMAIL='rehearsal@snapflow.local', SMTP_SENDER_NAME='SnapFlow Rehearsal')
    verified = next((runtime/'import').rglob('verified-external-secrets.private.json'), None)
    if verified:
        values.update(json.loads(verified.read_text()))
    private.write_text('\n'.join(f'{key}={value}' for key,value in values.items())+'\n', encoding='utf-8')
    if os.name == 'posix':
        os.chmod(private, 0o600)
    sb = yaml.safe_load((upstream / 'docker-compose.yml').read_text(encoding='utf-8'))
    sb.pop('name', None)
    sb['services']['auth']['image'] = AUTH_IMAGE
    for name, service in sb['services'].items():
        service.pop('container_name', None)
        service['labels'] = {'snapflow.rehearsal': 'production'}
        service['logging'] = dict(driver='json-file', options={'max-size': '10m', 'max-file': '3'})
        service.pop('ports', None)
        mounts = []
        for mount in service.get('volumes', []):
            if mount.startswith('./'):
                source, tail = mount.split(':', 1)
                if source == './volumes/db/data':
                    mount = 'supabase-data:' + tail
                elif source == './volumes/storage':
                    mount = 'storage-data:' + tail
                else:
                    absolute = (upstream / source).resolve()
                    if not absolute.exists():
                        if source == './volumes/snippets':
                            absolute.mkdir(parents=True, exist_ok=True)
                        else:
                            raise ValueError('Pinned container input missing: ' + source)
                    mount = absolute.as_posix() + ':' + tail
            mounts.append(mount)
        service['volumes'] = mounts
    sb['services']['db']['networks'] = {'default': {}, 'bridge': {'aliases': ['supabase-db']}}
    # The official gateway uses this name both for DNS and tenant selection.
    # Removing fixed container_name must preserve it as a project-local alias.
    sb['services']['realtime']['networks'] = {'default': {'aliases': ['realtime-dev.supabase-realtime']}}
    sb['services']['api-gw']['networks']['bridge'] = {'aliases': ['supabase-gateway']}
    sb['services']['api-gw']['ports'] = ['127.0.0.1:18000:8000']
    sb['services']['functions']['networks'] = ['default', 'bridge']
    sb['services']['functions']['environment'].update(
        SCANNER_BASE_URL='http://aggregator:8080', AUDIT_API_URL='http://aggregator:8080',
        FORM_TESTER_PUBLIC_STORAGE_ORIGIN=public, FORM_EXECUTOR_ARTIFACT_BUCKET='form-test-artifacts',
        DEFAULT_SCAN_MAX_PAGES='150', REDMINE_LOGIN_RATE_LIMIT_SALT='${REDMINE_LOGIN_RATE_LIMIT_SALT}',
        REDMINE_API_KEY='${REDMINE_API_KEY}', REDMINE_BASE_URL='https://maintenance.medianet.tn',
        GEMINI_API_KEY='${GEMINI_API_KEY}')
    sb['services']['functions']['environment'].update(
        GEMINI_CHAT_MODEL='gemini-3.5-flash-lite', FORM_TESTER_GEMINI_MODEL='gemini-3.5-flash-lite')
    # Cron imported/configured jobs must not run against production targets.
    sb['services']['db']['command'] += ['-c', 'cron.launch_active_jobs=off']
    sb['services']['supabase-db'] = sb['services'].pop('db')
    for service in sb['services'].values():
        dependencies = service.get('depends_on', {})
        if 'db' in dependencies:
            dependencies['supabase-db'] = dependencies.pop('db')
    if profile == 'rehearsal':
        sb['services']['mail'] = dict(image='axllent/mailpit:v1.30.2', restart='unless-stopped',
                                      ports=['127.0.0.1:18025:8025'], labels={'snapflow.rehearsal':'production'})
    sb.setdefault('volumes', {}).update({'supabase-data':{}, 'storage-data':{}})
    sb['networks'] = {'default': {}, 'bridge': {'external':True, 'name':network}}
    functions = upstream / 'volumes/functions'
    exported = runtime/'import/supabase/functions'
    if exported.exists():
        for source in exported.iterdir():
            if source.is_dir() and source.name not in ('main','seed-users'):
                shutil.copytree(source, functions/source.name, dirs_exist_ok=True)
    for source in (ROOT / 'Front-Snap/supabase/functions').iterdir():
        if source.is_dir() and source.name != 'seed-users':
            shutil.copytree(source, functions/source.name, dirs_exist_ok=True)
    # A public anon API key is not user authentication. Keep login public but
    # require a valid destination user/service JWT before private function work.
    main = functions/'main/index.ts'
    content = main.read_text(encoding='utf-8')
    needle = "Deno.serve(async (req: Request) => {"
    gate = '''
  const requestedFunction = new URL(req.url).pathname.split('/')[1];
  if (requestedFunction === 'seed-users') return new Response('Not found', {status:404});
  if (req.method !== 'OPTIONS' && requestedFunction !== 'redmine-login') {
    const callerToken = getAuthToken(req);
    if (typeof callerToken !== 'string') return getAuthErrorResponse(callerToken);
    const failure = await isValidHybridJWT(callerToken);
    if (failure) return getAuthErrorResponse(failure);
    const role = jose.decodeJwt(callerToken).role;
    if (role !== 'authenticated' && role !== 'service_role') {
      return getAuthErrorResponse({code:RequestErrors.InvalidLegacyJWT,message:'User authentication required'});
    }
  }
'''
    if 'const requestedFunction' not in content:
        assert needle in content
        main.write_text(content.replace(needle,needle+gate),encoding='utf-8')
    (runtime/'supabase.compose.yml').write_text(yaml.safe_dump(sb, sort_keys=False), encoding='utf-8')
    snap = yaml.safe_load((ROOT/'V3-Microservices/docker-compose.preprod.yml').read_text(encoding='utf-8'))
    for name, service in snap['services'].items():
        service.pop('container_name', None)
        service['labels'] = {'snapflow.rehearsal':'production'}
        service['logging'] = dict(driver='json-file', options={'max-size':'10m', 'max-file':'3'})
        if 'build' in service:
            if isinstance(service['build'], str): service['build'] = {'context':service['build']}
            service['build']['context'] = (ROOT/'V3-Microservices'/service['build']['context']).resolve().as_posix()
        if 'volumes' in service:
            service['volumes'] = [(ROOT/'V3-Microservices'/m.split(':',1)[0]).resolve().as_posix()+':'+m.split(':',1)[1] if m.startswith('./') else m for m in service['volumes']]
        service.pop('ports',None)
    snap['services']['frontend']['ports'] = ['127.0.0.1:13000:3000']
    snap['services']['frontend']['networks'] = ['default', 'bridge']
    if profile == 'rehearsal':
        snap['services']['aggregator']['ports'] = ['127.0.0.1:18081:8080']
    for name in ('aggregator', 'v3-form-executor'):
        snap['services'][name]['networks'] = ['default','bridge']
    if profile == 'rehearsal':
        acme = runtime/'acme'
        acme.mkdir(exist_ok=True)
        (acme/'owned-probe').write_text('SNAPFLOW_ACME_REHEARSAL\n',encoding='ascii')
        snap['services']['apache'] = dict(image='httpd:2.4.65-bookworm',
            ports=['127.0.0.1:18080:80'], networks=['bridge'],
            volumes=[(ROOT/'deploy/production/apache-rehearsal.conf').as_posix()+':/usr/local/apache2/conf/httpd.conf:ro',acme.as_posix()+':/acme:ro'],
            labels={'snapflow.rehearsal':'production'}, restart='unless-stopped')
    snap['services']['fixture'] = dict(image='snapflow/v3-python-fastapi-base:latest',
        command=['python','/fixture.py'], networks={'default':{'aliases':['preprod-fixture']}},
        volumes=[(ROOT/'V3-Microservices/benchmarks/preprod_fixture.py').as_posix()+':/fixture.py:ro'],
        profiles=['fixture'], labels={'snapflow.rehearsal':'production'})
    snap['networks'] = {'default':{},'bridge':{'external':True,'name':network}}
    (runtime/'snapflow.compose.yml').write_text(yaml.safe_dump(snap, sort_keys=False), encoding='utf-8')
    readable_container_inputs(upstream)
    dump(descriptor, {'profile':profile,'project':project,'network':network,'public_origin':public,'smtp_deferred':profile=='vps'})
    print(json.dumps(dict(configured=True, profile=profile, public_origin=public, credentials_reused=reused, secrets_printed=False)))


def compose(runtime, stack, args, **kwargs):
    descriptor = runtime/'deployment.json'
    project = json.loads(descriptor.read_text())['project'] if descriptor.exists() else 'snapflow-rehearsal'
    return subprocess.run(['docker','compose','-p',f'{project}-{stack}', '--env-file',str(runtime/'runtime.env'), '-f',str(runtime/f'{stack}.compose.yml'),*args],check=True,**kwargs)


def restore(runtime):
    marker=runtime/'import-complete.json'
    if marker.exists():
        print('Import already completed; refusing to replay data.'); return
    result=compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atc','SELECT count(*) FROM auth.users;'],capture_output=True,text=True)
    assert result.stdout.strip()=='0', 'Destination already contains Auth users'
    paths={name:next((runtime/'import').rglob(name)) for name in ('roles.sql','schema.sql','data.sql')}
    validation=json.loads(next((runtime/'import').rglob('database-export-validation.json')).read_text())
    for name,path in paths.items():
        assert path.stat().st_size==validation['files'][name]['bytes']
        assert hashlib.sha256(path.read_bytes()).hexdigest()==validation['files'][name]['sha256']
    payload=b'BEGIN;\n'+paths['roles.sql'].read_bytes()+b'\n'+paths['schema.sql'].read_bytes()+b'\nSET session_replication_role=replica;\n'+paths['data.sql'].read_bytes()+b'\nSET session_replication_role=origin;\nCOMMIT;\n'
    log=runtime/'restore.private.log'
    with log.open('wb') as handle:
        compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=payload,stdout=handle,stderr=subprocess.STDOUT)
    result=compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atc',"SELECT json_build_object('users',(SELECT count(*) FROM auth.users),'public_tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'));"],capture_output=True,text=True)
    counts=json.loads(result.stdout)
    expected=validation['exported_table_row_counts']
    statements=[]
    for table in expected:
        schema,name=table.split('.',1)
        assert schema.isidentifier() and name.isidentifier(), table
        statements.append(f"SELECT '{table}', count(*) FROM \"{schema}\".\"{name}\"")
    result=compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atc',' UNION ALL '.join(statements)],capture_output=True,text=True)
    actual={line.split('|')[0]:int(line.split('|')[1]) for line in result.stdout.splitlines()}
    assert actual==expected, {table:dict(expected=expected[table],actual=actual.get(table)) for table in expected if actual.get(table)!=expected[table]}
    assert counts['users']==validation['auth_users'] and counts['public_tables']==31,counts
    dump(marker,dict(assertions='passed',counts=counts,verified_tables=len(actual),auth_image=AUTH_IMAGE,data_sha256=hashlib.sha256(paths['data.sql'].read_bytes()).hexdigest(),source_cloud_changed=False))
    print(json.dumps(dict(restore='passed',**counts)))


def prepare(runtime):
    """Apply destination-only compatibility migrations before workers start."""
    assert (runtime/'import-complete.json').exists(), 'Restore must pass first'
    migrations = [
        '20261005010000_explicit_application_api_grants.sql',
        '20261005020000_restore_auth_profile_trigger.sql',
        '20261005030000_service_rpc_permissions.sql',
    ]
    payload=b'BEGIN;\n'+b'\n'.join((ROOT/'Front-Snap/supabase/migrations'/name).read_bytes() for name in migrations)
    # Never dispatch imported schedules to live customer targets in rehearsal.
    payload+=b'\nUPDATE public.report_schedules SET is_active=false;\nUPDATE public.workflow_schedules SET is_active=false;\nCOMMIT;\n'
    compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],input=payload,capture_output=True)
    queued=compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atc',"SELECT count(*) FROM public.workflow_results WHERE status='queued' AND execution_source='pending_executor';"],capture_output=True,text=True)
    assert queued.stdout.strip()=='0', 'Inspect imported pending executions before starting the Form Executor'
    print(json.dumps(dict(prepared=True,migrations=migrations,imported_schedules_disabled=True)))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['fetch','decrypt','configure','restore','prepare','compose'])
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--export',type=Path)
    parser.add_argument('--stack',choices=['supabase','snapflow'])
    parser.add_argument('--profile',choices=['rehearsal','vps'],default='rehearsal')
    parser.add_argument('--public-origin')
    parser.add_argument('--skip-smtp',action='store_true')
    options,args=parser.parse_known_args()
    runtime=options.runtime.resolve()
    assert not runtime.is_relative_to(ROOT), 'Private runtime must remain outside checkout'
    runtime.mkdir(parents=True,exist_ok=True)
    if options.action=='fetch': fetch(runtime)
    elif options.action=='decrypt': decrypt(runtime,options.export)
    elif options.action=='configure': configure(runtime, options.profile, options.public_origin, options.skip_smtp)
    elif options.action=='restore': restore(runtime)
    elif options.action=='prepare': prepare(runtime)
    else: compose(runtime,options.stack,args[1:] if args and args[0]=='--' else args)


if __name__=='__main__': main()
