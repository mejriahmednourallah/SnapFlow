"""Exercise bootstrap shell failure/cleanup control flow without deleting data.

Run in a Linux image with Python and Bash. CLI calls are explicit recording
adapters; this is not combined deployment acceptance.
"""
import json
from pathlib import Path
import re
import subprocess


def run():
    root = Path('/workspace')
    source = (root / 'Front-Snap/scripts/local-supabase-preprod.sh').read_text(encoding='utf-8')
    function = lambda name: re.search(r'^' + name + r'\(\) \{.*?^\}', source, re.M | re.S).group()
    failure_script = ('set -euo pipefail\n'
        'npx() { return 23; }\n'
        'wait_for_supabase_status() { echo WRONG_HEALTH_FALLBACK; }\n' +
        function('reset_local_database') + '\nreset_local_database\necho WRONG_SETUP_CONTINUED\n')
    failed = subprocess.run(['bash', '-c', failure_script], capture_output=True, text=True, check=False)
    assert failed.returncode == 23, failed
    assert 'WRONG_' not in failed.stdout, failed.stdout
    seed_script = ('set -euo pipefail\nREDMINE_BASE_URL=fixture REDMINE_API_KEY=fixture REDMINE_LOGIN_RATE_LIMIT_SALT=fixture\n'
        'node() { return 31; }\n' + function('seed_random_admin') +
        '\nseed_random_admin http://fixture fixture\necho WRONG_SETUP_CONTINUED\n')
    seed_failed = subprocess.run(['bash', '-c', seed_script], capture_output=True, text=True, check=False)
    assert seed_failed.returncode == 31, seed_failed
    assert 'WRONG_' not in seed_failed.stdout, seed_failed.stdout
    cleanup_script = ('set -euo pipefail\nV3_DIR=/tmp\nFRONT_DIR=/tmp\n'
        'read_env_value() { echo fixture-project; }\n'
        'require_value() { test -n "$2"; }\n'
        'docker() { printf "docker %s\\n" "$*"; }\n'
        'npx() { printf "npx %s\\n" "$*"; }\n' +
        function('cleanup_environment') + '\ncleanup_environment\n')
    cleaned = subprocess.run(['bash', '-c', cleanup_script], capture_output=True, text=True, check=True)
    assert 'npx supabase stop --project-id fixture-project --no-backup --yes' in cleaned.stdout
    assert '--all' not in cleaned.stdout and 'volume rm' not in cleaned.stdout
    artifact = dict(assertions='passed', failed_reset_exit_code=failed.returncode,
        failed_seed_exit_code=seed_failed.returncode,
        setup_continued=False, cleanup_commands=cleaned.stdout.splitlines(),
        methodology='Actual Bash function control flow from the bootstrap; recording CLI adapters, no real reset/cleanup. Combined deployment still pending.')
    destination = root / 'output/capacity-study/preprod-controlflow.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(artifact, indent=2), encoding='utf-8')
    print(json.dumps(artifact))


if __name__ == '__main__':
    run()
