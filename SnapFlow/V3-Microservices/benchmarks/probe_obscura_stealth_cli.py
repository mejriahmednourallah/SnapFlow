"""Fresh-process raw/Markdown probes to separate HTTP acquisition from CDP."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
from run_obscura_study import HERE, ROOT, NETWORK, docker, owned_remove
from run_obscura_stealth_study import FULL_STEALTH, redact_log

OUT = ROOT/'output/playwright/obscura-study/stealth/native-cli'
OUT.mkdir(parents=True, exist_ok=True)
rows = []
name = 'snapflow-stealth-native-probe'
try:
    for site, url in [('medianet', 'https://www.medianet.tn/'), ('biat', 'https://www.biat.com.tn/')]:
        for dump, budget in [('original', 10), ('markdown', 10), ('markdown', 30)]:
            owned_remove(name)
            command = ['docker', 'run', '--name', name, '--label', 'snapflow.study=obscura-memory',
                '--network', NETWORK, '--cpus', '2', '--memory', '2g', '-e', 'OBSCURA_BLOCK_TRACKERS=0',
                FULL_STEALTH, 'fetch', url, '--stealth', '--dump', dump, '--timeout', str(budget), '--wait', '1', '--quiet']
            began = time.perf_counter()
            try:
                result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=budget+10)
                row = {'site':site, 'url':url, 'dump':dump, 'budget_s':budget, 'exit_code':result.returncode,
                       'elapsed_ms':round((time.perf_counter()-began)*1000, 2), 'bytes':len(result.stdout.encode()),
                       'sha256':hashlib.sha256(result.stdout.encode()).hexdigest(), 'error':redact_log(result.stderr[-3000:])}
                (OUT/f'{site}-{dump}-{budget}.{ "html" if dump=="original" else "md"}').write_text(result.stdout, encoding='utf-8')
            except subprocess.TimeoutExpired:
                row = {'site':site, 'url':url, 'dump':dump, 'budget_s':budget, 'exit_code':None,
                       'elapsed_ms':round((time.perf_counter()-began)*1000, 2), 'error':'outer_process_timeout'}
            rows.append(row)
            (OUT/'probes.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps({k:row.get(k) for k in ['site','dump','budget_s','exit_code','elapsed_ms','bytes']}), flush=True)
            owned_remove(name)
finally:
    owned_remove(name)
