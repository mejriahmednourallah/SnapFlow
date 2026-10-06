"""Real launcher/helper shell flow against recorded Docker commands.

Proves project routing and migration/startup ordering without touching a daemon.
Actual combined deployment remains a separate acceptance layer.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def run():
    root = Path('/workspace')
    product = root / 'V3-Microservices'
    observations = []
    with tempfile.TemporaryDirectory(prefix='snapflow-launcher-') as directory:
        work = Path(directory) / 'V3-Microservices'
        work.mkdir()
        supabase = Path(directory) / 'Front-Snap/supabase'
        supabase.mkdir(parents=True)
        (supabase / 'config.toml').write_text('project_id = "fixture-project"\n')
        (work / 'scripts').mkdir()
        (work / 'v3-scanner-go/db').mkdir(parents=True)
        (work / 'bin').mkdir()
        shutil.copy(product / 'run-all.sh', work / 'run-all.sh')
        shutil.copy(product / 'scripts/apply-evidence-migration.sh', work / 'scripts')
        (work / 'scripts/connect-local-supabase.sh').write_text('#!/bin/bash\n[ "$2" = fixture-project ]\n')
        shutil.copy(product / 'v3-scanner-go/db/evidence_schema.sql', work / 'v3-scanner-go/db')
        (work / 'BUILD_V3_BASE_IMAGES.sh').write_text('#!/bin/bash\nexit 0\n')
        env_text = '\n'.join(key + '=fixture' for key in (
            'DB_PASS','VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY',
            'FORM_EXECUTOR_DATABASE_URL','FORM_EXECUTOR_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY')) + '\n'
        for name in ('.env.local', '.env.preprod'):
            (work / name).write_text(env_text)
        fake = work / 'bin/docker'
        fake.write_text('''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
sql = sys.stdin.read() if 'exec' in args else ''
with open(os.environ['COMMAND_LOG'], 'a') as stream:
    stream.write(json.dumps(dict(args=args, migration='CREATE OR REPLACE FUNCTION' in sql))+'\\n')
if 'CREATE OR REPLACE FUNCTION' in sql and os.environ.get('FAIL_MIGRATION') == '1':
    sys.exit(17)
if 'to_regclass' in sql:
    print('f')
''')
        fake.chmod(0o755)
        for local, fail in ((False, False), (True, False), (True, True)):
            log = work / 'commands.jsonl'
            log.unlink(missing_ok=True)
            env = dict(os.environ, PATH=str(work / 'bin') + ':' + os.environ['PATH'],
                       COMMAND_LOG=str(log), FAIL_MIGRATION='1' if fail else '0')
            result = subprocess.run(['bash', str(work / 'run-all.sh')] + (['--local'] if local else []),
                env=env, capture_output=True, text=True, check=False)
            commands = [json.loads(line) for line in log.read_text().splitlines()]
            migration = next(index for index, row in enumerate(commands) if row['migration'])
            migrated = commands[migration]['args']
            if local:
                assert migrated[1:3] == ['-p','snapflow-local-preprod'], migrated
                assert '.env.local' in migrated
            else:
                assert '-p' not in migrated and '.env.preprod' in migrated
            db_start = next(index for index, row in enumerate(commands) if 'up' in row['args'] and row['args'][-1] == 'db')
            full_start = [index for index, row in enumerate(commands) if 'up' in row['args'] and row['args'][-1] != 'db']
            assert db_start < migration
            if fail:
                assert result.returncode == 17 and not full_start, (result, commands)
            else:
                assert result.returncode == 0 and migration < full_start[0], (result, commands)
                assert '--wait' in commands[full_start[0]]['args']
            observations.append(dict(local=local, migration_failure=fail, exit_code=result.returncode,
                correctly_routed=True, database_before_migration=True,
                workers_started_after_migration=not fail, commands=commands))
    artifact = dict(assertions='passed', observations=observations,
        methodology='Actual Bash launcher and migration helper in isolated files with a recording Docker CLI adapter; no actual deployment.')
    destination = root / 'output/capacity-study/launcher-controlflow.json'
    destination.write_text(json.dumps(artifact, indent=2), encoding='utf-8')
    print(json.dumps({'assertions':'passed','cases':len(observations)}))


if __name__ == '__main__':
    run()
