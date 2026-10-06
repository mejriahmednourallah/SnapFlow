"""Real offline PostgreSQL bootstrap using Linux-owned inputs, no user data."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def seed(source):
    runtime = Path('/probe/runtime')
    upstream = runtime / 'upstream'
    for name in ('db', 'api', 'pooler'):
        shutil.copytree(source / 'volumes' / name, upstream / 'volumes' / name)
    runtime.chmod(0o700)
    private = runtime / 'runtime.env'
    private.write_text('FIXTURE_ONLY=yes\n')
    private.chmod(0o600)
    for path in (upstream / 'volumes').rglob('*'):
        os.chown(path, 1002, 1002)
        path.chmod(0o700 if path.is_dir() else 0o600)
    spec = importlib.util.spec_from_file_location('rehearse', HERE / 'rehearse.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.readable_container_inputs(upstream)
    assert private.stat().st_mode & 0o777 == 0o600
    assert runtime.stat().st_mode & 0o777 == 0o700
    print('Linux input modes repaired; private runtime/env retained.', flush=True)


def probe(source):
    identity = 'snapflow-bootstrap-test-' + uuid.uuid4().hex[:12]
    password = secrets.token_hex(24)
    db = identity + '-db'
    created_volume = created_db = False
    def run(args, **kwargs):
        return subprocess.run(['docker', *map(str, args)], check=True, capture_output=True, text=True, **kwargs)
    try:
        run(['volume', 'create', '--label', 'snapflow.test=bootstrap-linux', identity])
        created_volume = True
        run(['run', '--rm', '--network', 'none', '--volume', identity + ':/probe',
             '--volume', str(source.resolve()) + ':/pinned:ro',
             '--volume', str(ROOT) + ':/source:ro', '--entrypoint', 'python',
             'snapflow/v3-python-fastapi-base:latest', '/source/deploy/production/probe_bootstrap_linux.py',
             '--seed', '/pinned'])
        mountpoint = run(['volume', 'inspect', identity, '--format', '{{.Mountpoint}}']).stdout.strip()
        migrations = {'realtime.sql':'migrations/99-realtime.sql', 'webhooks.sql':'init-scripts/98-webhooks.sql',
                      'roles.sql':'init-scripts/99-roles.sql', 'jwt.sql':'init-scripts/99-jwt.sql',
                      '_supabase.sql':'migrations/97-_supabase.sql', 'logs.sql':'migrations/99-logs.sql',
                      'pooler.sql':'migrations/99-pooler.sql'}
        args = ['create', '--name', db, '--label', 'snapflow.test=bootstrap-linux', '--network', 'none']
        for key, value in dict(POSTGRES_HOST='/var/run/postgresql', PGPORT='5432', POSTGRES_PORT='5432',
                              PGPASSWORD=password, POSTGRES_PASSWORD=password, PGDATABASE='postgres',
                              POSTGRES_DB='postgres', JWT_EXP='3600').items():
            args += ['--env', key + '=' + value]
        for name, target in migrations.items():
            args += ['--volume', mountpoint + '/runtime/upstream/volumes/db/' + name +
                     ':/docker-entrypoint-initdb.d/' + target + ':ro']
        args += ['supabase/postgres:17.6.1.136', 'postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf',
                 '-c', 'log_min_messages=fatal', '-c', 'cron.launch_active_jobs=off']
        run(args)
        created_db = True
        run(['start', db])
        query = ("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='_supabase'),"
                 "EXISTS(SELECT 1 FROM pg_authid WHERE rolname='authenticator' AND rolpassword IS NOT NULL);")
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                result = run(['exec', db, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atc', query]).stdout.strip()
                if result == 't|t':
                    run(['exec', db, 'pg_isready', '-U', 'postgres', '-h', 'localhost'])
                    print(json.dumps(dict(bootstrap='passed', internal_database_created=True,
                                          authenticator_password_assigned=True,
                                          linux_input_owner=1002, private_modes_preserved=True)))
                    return
            except subprocess.CalledProcessError:
                pass
            time.sleep(0.5)
        logs = run(['logs', '--tail', '40', db]).stdout
        print(logs.replace(password, '[FIXTURE SECRET REDACTED]'), file=sys.stderr)
        raise RuntimeError('Isolated Linux bootstrap did not complete')
    finally:
        if created_db:
            run(['rm', '--force', '--volumes', db])
        if created_volume:
            run(['volume', 'rm', identity])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path)
    parser.add_argument('--seed', type=Path)
    options = parser.parse_args()
    if options.seed:
        seed(options.seed)
    elif options.upstream:
        probe(options.upstream)
    else:
        parser.error('--upstream is required')
