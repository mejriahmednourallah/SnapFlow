"""VPS phases behind run-all.sh --vps; never reset volumes or modify Apache."""
import argparse
from datetime import datetime, timezone
import getpass
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import warnings

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASES = ('fastapi', 'nlp', 'browser', 'heavy')
SERVICES = ('scanner', 'aggregator', 'nlp-worker', 'languagetool',
            'v3-browser-pool', 'v3-form-executor', 'v3-visual-regression', 'frontend')
OWNER_LABEL = 'snapflow.deployment'


class VPSLauncher:
    def __init__(self, options):
        self.options = options
        self.runtime = options.runtime.resolve()
        self.python = sys.executable
        self.log = self.runtime / (options.action + '-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.log')

    def run(self, args, *, capture=False, input=None):
        args = [str(a) for a in args]
        if capture or input is not None:
            return subprocess.run(args, check=True, capture_output=capture, input=input)
        # Stream long builds to Wetty and a private log without printing env files.
        with self.log.open('ab') as log:
            with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as child:
                for line in child.stdout:
                    log.write(line)
                    log.flush()
                    sys.stdout.buffer.write(line)
                    sys.stdout.buffer.flush()
                code = child.wait()
        if code:
            raise subprocess.CalledProcessError(code, args)
        return subprocess.CompletedProcess(args, code)

    def tool(self, action, *args, **kwargs):
        return self.run([self.python, HERE / 'rehearse.py', action,
                         '--runtime', self.runtime, *args], **kwargs)

    def compose(self, stack, *args, **kwargs):
        return self.tool('compose', '--stack', stack, '--', *args, **kwargs)

    def descriptor(self):
        value = json.loads((self.runtime / 'deployment.json').read_text())
        if value.get('profile') != 'vps' or value.get('project') != 'snapflow-production':
            raise ValueError('Expected a separate VPS runtime; do not reuse the local rehearsal')
        if value.get('network') != 'snapflow-production-bridge':
            raise ValueError('Unexpected production network identity')
        return value

    def wetty_snapshot(self):
        fmt = ('{"id":{{json .Id}},"image":{{json .Image}},'
               '"running":{{json .State.Running}},"started":{{json .State.StartedAt}},'
               '"restarts":{{json .RestartCount}},"oom":{{json .State.OOMKilled}},'
               '"mode":{{json .HostConfig.NetworkMode}},"mounts":{{json .Mounts}},'
               '"networks":{{json .NetworkSettings.Networks}}}')
        data = json.loads(self.run(['docker', 'inspect', 'wetty_wetty_1', '--format', fmt], capture=True).stdout)
        if not data['running']:
            raise ValueError('Wetty must remain running')
        # Docker mount-array order is not an identity change; retain every value.
        data['mounts'] = sorted(data['mounts'], key=lambda item: json.dumps(item, sort_keys=True))
        return data

    def check_wetty(self, before):
        after = self.wetty_snapshot()
        changed = sorted(key for key in before if before[key] != after[key])
        if changed:
            raise ValueError('Wetty changed; inspect fields before continuing: ' + ', '.join(changed))

    def network(self):
        name = self.descriptor()['network']
        try:
            owner = self.run(['docker', 'network', 'inspect', name, '--format',
                              '{{index .Labels "' + OWNER_LABEL + '"}}'], capture=True).stdout.decode().strip()
        except subprocess.CalledProcessError:
            # Distinguish absent network from daemon/permission failures.
            names = self.run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture=True).stdout.decode().splitlines()
            if name in names:
                raise
            self.run(['docker', 'network', 'create', '--label',
                      OWNER_LABEL + '=snapflow-production', name])
        else:
            if owner != 'snapflow-production':
                raise ValueError('Existing production bridge lacks the expected ownership label')

    def base_inputs(self):
        files = sorted((ROOT / 'V3-Microservices/docker/python-base').glob('*'))
        files.append(ROOT / 'V3-Microservices/BUILD_V3_BASE_IMAGES.sh')
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in files if p.is_file()}

    def base_images(self):
        return {name: self.run(['docker', 'image', 'inspect',
                               'snapflow/v3-python-' + name + '-base:latest',
                               '--format', '{{.Id}}'], capture=True).stdout.decode().strip()
                for name in BASES}

    def rebuild_bases(self):
        marker = self.runtime / 'base-build-inputs.json'
        inputs = self.base_inputs()
        reuse = False
        if marker.exists() and not self.options.rebuild_base:
            recorded = json.loads(marker.read_text())
            try:
                reuse = recorded == {'inputs': inputs, 'images': self.base_images()}
            except subprocess.CalledProcessError:
                pass
        if not reuse:
            args = ['bash', ROOT / 'V3-Microservices/BUILD_V3_BASE_IMAGES.sh', '--rebuild-base', '--pull']
            if self.options.no_cache:
                args.append('--no-cache')
            self.run(args)
            marker.write_text(json.dumps({'inputs': inputs, 'images': self.base_images()}, indent=2) + '\n')
        else:
            print('Reusing VPS-built bases with matching inputs and image identities.', flush=True)

    def cleanup_cache(self):
        # No container, volume, network or tagged-image pruning.
        failures = []
        for args in (['docker', 'builder', 'prune', '--all', '--force'],
                     ['docker', 'image', 'prune', '--force']):
            try:
                self.run(args)
            except Exception as error:
                failures.append(error)
        if failures:
            raise failures[0]

    def build(self):
        if (self.runtime / 'deployment.json').exists():
            self.descriptor()
        self.cleanup_cache()
        self.run(['df', '-h', '/'])
        self.run(['docker', 'compose', 'version'])
        self.run(['docker', 'buildx', 'version'])
        self.tool('fetch')
        self.tool('configure', '--profile', 'vps', '--public-origin', self.options.public_origin,
                  '--skip-smtp')
        for stack in ('supabase', 'snapflow'):
            self.compose(stack, 'config', '--quiet')
        self.rebuild_bases()
        for service in SERVICES:
            args = ['build']
            if self.options.no_cache:
                args.append('--no-cache')
            print('Building ' + service, flush=True)
            self.compose('snapflow', *args, service)
        self.compose('supabase', 'pull')
        self.compose('snapflow', 'pull', 'db')
        print('Build complete. Services have not been started; import/start are separate phases.', flush=True)

    def supabase(self):
        self.descriptor()
        self.network()
        self.compose('supabase', 'up', '-d', '--wait', '--wait-timeout', '300')

    def repair_bootstrap(self):
        """Recreate only an empty, owned Supabase DB after failed first init."""
        descriptor = self.descriptor()
        if (self.runtime / 'import-complete.json').exists():
            raise ValueError('Imported destination cannot be reset by bootstrap repair')
        # Verify destination data and all Docker ownership before changing anything.
        psql = ['exec', '-T', 'supabase-db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
                '-U', 'supabase_admin', '-d', 'postgres', '-Atc']
        exists = self.compose('supabase', *psql, "SELECT to_regclass('auth.users') IS NOT NULL;", capture=True).stdout.strip()
        if exists not in (b't', b'f'):
            raise ValueError('Cannot prove destination Auth state; no reset performed')
        if exists == b't':
            count = self.compose('supabase', *psql, 'SELECT count(*) FROM auth.users;', capture=True).stdout.strip()
            if count != b'0':
                raise ValueError('Destination contains users; no reset performed')
        tables = self.compose('supabase', *psql,
                              "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';",
                              capture=True).stdout.strip()
        if tables != b'0':
            raise ValueError('Destination contains public application tables; no reset performed')
        project = descriptor['project'] + '-supabase'
        container = project + '-supabase-db-1'
        metadata = json.loads(self.run(['docker', 'inspect', container, '--format',
                                       '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}}}'], capture=True).stdout)
        labels = metadata['labels']
        if labels.get('com.docker.compose.project') != project or labels.get('com.docker.compose.service') != 'supabase-db':
            raise ValueError('Unexpected DB container ownership; no reset performed')
        mounts = [m for m in metadata['mounts'] if m['Destination'] == '/var/lib/postgresql/data']
        expected = project + '_supabase-data'
        if len(mounts) != 1 or mounts[0].get('Type') != 'volume' or mounts[0].get('Name') != expected:
            raise ValueError('Unexpected Supabase data mount; no reset performed')
        owner = self.run(['docker', 'volume', 'inspect', expected, '--format',
                          '{{index .Labels "com.docker.compose.project"}}'], capture=True).stdout.decode().strip()
        if owner != project:
            raise ValueError('Unexpected data volume ownership; no reset performed')
        consumers = self.run(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'volume=' + expected], capture=True).stdout.decode().splitlines()
        if consumers != [metadata['id']]:
            raise ValueError('Supabase data volume has unexpected consumers; no reset performed')
        before = self.wetty_snapshot()
        self.tool('configure', '--profile', 'vps', '--public-origin', descriptor['public_origin'], '--skip-smtp')
        self.compose('supabase', 'stop')
        self.check_wetty(before)
        self.run(['docker', 'rm', metadata['id']])
        self.check_wetty(before)
        self.run(['docker', 'volume', 'rm', expected])
        self.supabase()
        print('Empty Supabase bootstrap recreated with existing destination keys; import remains pending.', flush=True)

    def verify_import(self):
        marker = json.loads((self.runtime / 'import-complete.json').read_text())
        expected = json.loads((HERE / 'exports/20261005-cloud/migration-summary.json').read_text())
        if (marker.get('assertions') != 'passed'
                or marker.get('counts') != {'users': expected['auth_users'], 'public_tables': expected['public_tables']}
                or not isinstance(marker.get('verified_tables'), int) or marker['verified_tables'] < 1):
            raise ValueError('Import marker does not record the verified Cloud export; inspect before startup')

    def import_cloud(self):
        descriptor = self.descriptor()
        if (self.runtime / 'import-complete.json').exists():
            self.verify_import()
            print('Verified import marker exists; refusing to replay the Cloud import.', flush=True)
            return
        workers = self.compose('snapflow', 'ps', '--status', 'running', '--quiet',
                               'scanner', 'aggregator', 'nlp-worker', 'v3-form-executor', capture=True).stdout.strip()
        if workers:
            raise ValueError('Stop destination workers before the first Cloud import')
        # This read query also verifies that Auth bootstrap/migrations ran first.
        count = self.compose('supabase', 'exec', '-T', 'supabase-db', 'psql', '-X', '-U',
                             'supabase_admin', '-d', 'postgres', '-Atc',
                             'SELECT count(*) FROM auth.users;', capture=True).stdout.strip()
        if count != b'0':
            raise ValueError('Destination already contains users; restore will not overwrite it')
        if not any((self.runtime / 'import').rglob('database-export-validation.json')):
            # Fail rather than allowing getpass's nonterminal echo fallback.
            with open('/dev/tty', 'w') as terminal, warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                key = getpass.getpass('Paste export key (hidden), then Enter: ', stream=terminal)
            try:
                self.tool('decrypt', '--export', HERE / 'exports/20261005-cloud', input=key.encode('ascii'))
            finally:
                key = None
        # Reuse destination signing keys, install exported functions/external keys.
        self.tool('configure', '--profile', 'vps', '--public-origin', descriptor['public_origin'], '--skip-smtp')
        self.tool('restore')
        self.verify_import()
        self.tool('prepare')

    def assert_no_active_audit(self):
        psql = ['exec', '-T', 'db', 'sh', '-c',
                'psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
        exists = self.compose('snapflow', *psql, input=b"SELECT to_regclass('public.scan_state') IS NOT NULL;", capture=True).stdout.strip()
        if exists not in (b't', b'f'):
            raise ValueError('Unexpected database reply while checking active audits')
        if exists == b't':
            active = self.compose('snapflow', *psql, input=b"SELECT COUNT(*) FROM scan_state WHERE LOWER(state_json->>'status') IN ('running','nlp_processing');", capture=True).stdout.strip()
            if int(active) > 0:
                raise ValueError('An audit is running; wait for it before restarting workers')

    def start(self):
        self.descriptor()
        if not (self.runtime / 'import-complete.json').exists():
            raise ValueError('Cloud restore must pass before SnapFlow workers start; run --action import')
        self.verify_import()
        db_running = self.compose('snapflow', 'ps', '--status', 'running', '--quiet', 'db', capture=True).stdout.strip()
        if db_running:
            self.assert_no_active_audit()
        self.supabase()
        self.compose('snapflow', 'up', '-d', '--wait', '--wait-timeout', '90', 'db')
        self.assert_no_active_audit()
        self.compose('snapflow', 'stop', 'aggregator', 'scanner', 'nlp-worker', 'v3-form-executor')
        self.tool('prepare')
        migration = ROOT / 'V3-Microservices/v3-scanner-go/db/evidence_schema.sql'
        self.compose('snapflow', 'exec', '-T', 'db', 'sh', '-c',
                     'psql -X --single-transaction -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                     input=migration.read_bytes())
        args = ['up', '-d', '--wait', '--wait-timeout', '300']
        if self.options.force_recreate:
            args.append('--force-recreate')
        self.compose('snapflow', *args)
        print('Services ready. Apache activation and public application acceptance are still separate.', flush=True)

    def status(self):
        self.descriptor()
        for stack in ('supabase', 'snapflow'):
            self.compose(stack, 'ps')
        self.run(['df', '-h', '/'])
        self.run(['free', '-h'])

    def execute(self):
        before = self.wetty_snapshot()
        failed = False
        try:
            action = {'import': 'import_cloud', 'repair-bootstrap': 'repair_bootstrap'}.get(self.options.action, self.options.action)
            getattr(self, action)()
        except BaseException:
            failed = True
            raise
        finally:
            # Attempt both cleanup and protection checks, preserving the original error.
            errors = []
            if self.options.action == 'build':
                try:
                    self.cleanup_cache()
                except Exception as error:
                    errors.append(error)
            try:
                self.check_wetty(before)
            except Exception as error:
                errors.append(error)
            for error in errors:
                print('Final check failed: ' + str(error), file=sys.stderr)
            if errors and not failed:
                raise errors[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--vps', action='store_true')
    parser.add_argument('--action', choices=('build', 'supabase', 'import', 'start', 'status', 'repair-bootstrap'), default='build')
    parser.add_argument('--runtime', type=Path, default=Path.home() / '.local/share/snapflow-vps')
    parser.add_argument('--public-origin', default='https://snapflow.medianet.space')
    parser.add_argument('--skip-smtp', action='store_true', help='Explicitly defer SMTP for VPS configuration')
    parser.add_argument('--rebuild-base', action='store_true')
    parser.add_argument('--no-cache', '--no-cache-build', action='store_true')
    parser.add_argument('--force-recreate', action='store_true')
    options = parser.parse_args()
    if sys.platform != 'linux':
        parser.error('Run --vps on the Linux VPS; use --local for Windows/local CLI deployment')
    if options.action == 'build' and not options.skip_smtp:
        parser.error('Build requires --skip-smtp while SMTP is deferred')
    runtime = options.runtime.resolve()
    if runtime == ROOT or ROOT in runtime.parents:
        parser.error('Private VPS runtime must remain outside the checkout')
    os.umask(0o077)
    runtime.mkdir(parents=True, exist_ok=True)
    runtime.chmod(0o700)
    # Use an isolated interpreter; no system pip install or automatic sudo/apt.
    python = runtime / 'venv/bin/python'
    if Path(sys.executable).absolute() != python.absolute():
        if not python.exists():
            subprocess.run([sys.executable, '-m', 'venv', str(runtime / 'venv')], check=True)
        check = subprocess.run([str(python), '-c', 'import yaml, cryptography'], capture_output=True)
        if check.returncode:
            subprocess.run([str(python), '-m', 'pip', 'install', '--no-cache-dir', 'PyYAML', 'cryptography'], check=True)
        os.execv(str(python), [str(python), str(Path(__file__)), *sys.argv[1:]])
    os.environ['COMPOSE_PARALLEL_LIMIT'] = '1'
    launcher = VPSLauncher(options)
    print('VPS phase: ' + options.action + '; private command log: ' + str(launcher.log), flush=True)
    launcher.execute()


if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, OSError, getpass.GetPassWarning) as error:
        print('STOP: ' + str(error), file=sys.stderr)
        sys.exit(error.returncode if isinstance(error, subprocess.CalledProcessError) else 1)
