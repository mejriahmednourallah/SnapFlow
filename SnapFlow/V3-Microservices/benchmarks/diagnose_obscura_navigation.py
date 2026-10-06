import json
from pathlib import Path
import subprocess
import time

from run_obscura_study import HERE,ROOT,IMAGE,NETWORK,OBSCURA,docker,owned_remove

output=ROOT/'output/playwright/obscura-study/navigation-diagnostics'
output.mkdir(parents=True,exist_ok=True)
engine='snapflow-study-diagnostic'
try:
    for label,url in [('biat','https://www.biat.com.tn/'),('medianet','https://www.medianet.tn/')]:
        for wait in ['domcontentloaded','commit']:
            owned_remove(engine)
            docker('run','-d','--name',engine,'--label','snapflow.study=obscura-memory','--network',NETWORK,
                   '--cpus','2','--memory','2g','--env-file',str(HERE/'obscura.env'),OBSCURA,capture=True)
            time.sleep(1)
            result=subprocess.run(['docker','run','--rm','--network',NETWORK,'--env-file',str(HERE/'obscura.env'),
                                  '--mount',f'type=bind,src={output},dst=/results',IMAGE,'python','diagnose_navigation.py',
                                  '--url',url,'--cdp-url',f'http://{engine}:9222','--wait-until',wait,
                                  '--output',f'/results/{label}-{wait}.json'],timeout=45)
            logs=docker('logs',engine,check=False,capture=True)
            (output/f'{label}-{wait}.log').write_text(logs.stdout+logs.stderr,encoding='utf-8')
            if result.returncode:
                raise RuntimeError('Navigation diagnostic process failed')
finally:
    owned_remove(engine)
