"""Real process interruption and durable data checks on the owned rehearsal."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'deploy/production'))
import rehearse

runtime=Path(sys.argv[1]).resolve()
db='snapflow-rehearsal-snapflow-db-1'
worker='snapflow-rehearsal-snapflow-nlp-worker-1'
def sql(query):
    return subprocess.check_output(['docker','exec',db,'psql','-X','-U','snapflow','-d','snapflow_v3','-Atc',query],text=True).strip()
def get(path):
    with urllib.request.urlopen('http://127.0.0.1:18081'+path,timeout=20) as response: return json.load(response)

resumed=len(sys.argv)>2
if resumed:
    scan=sys.argv[2]
else:
    request=urllib.request.Request('http://127.0.0.1:18081/scan',data=json.dumps(dict(url='http://preprod-fixture:18991/',max_pages=6)).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request) as response: scan=json.load(response)['scan_id']
assert re.fullmatch(r'scan_[0-9a-f]+',scan)
start=time.monotonic(); interrupted=resumed; samples=[]
for attempt in range(0 if resumed else 1500):
    claims=int(sql(f"SELECT count(*) FROM scan_pages WHERE scan_id='{scan}' AND nlp_claim_token IS NOT NULL AND nlp_revision IS DISTINCT FROM content_revision;"))
    if claims:
        subprocess.run(['docker','kill','--signal','KILL',worker],check=True,capture_output=True)
        subprocess.run(['docker','start',worker],check=True,capture_output=True)
        interrupted=True; break
    if get(f'/scan/{scan}/status')['status'] in ('complete','failed'): break
    time.sleep(.1)
assert interrupted,'Did not interrupt an in-flight NLP claim'
print('Resuming persistence checks after earlier interruption phase.' if resumed else 'Interrupted and restarted the NLP process with a real pending claim.',flush=True)
for attempt in range(210):
    state=get(f'/scan/{scan}/status')
    # Docker working-set counters are sampled; they are not host available RAM.
    raw=subprocess.check_output(['docker','stats','--no-stream','--format','{{json .}}'],text=True)
    samples.append(dict(seconds=round(time.monotonic()-start,2),state=state['status'],containers=[json.loads(line) for line in raw.splitlines()]))
    if state['status'] in ('complete','failed'): break
    time.sleep(2)
assert state['status']=='complete',state
pages=json.loads(sql(f"SELECT json_agg(json_build_object('current',nlp_revision=content_revision,'rendered',rendered_html IS NOT NULL)) FROM scan_pages WHERE scan_id='{scan}';"))
assert len(pages)==6 and all(p['current'] and p['rendered'] for p in pages),pages
report=get(f'/scan/{scan}/kpis')
assert not report.get('nlp_partiel'), 'Report completed before the interrupted page recovered'

# Check imported IDs and password hashes without exposing either.
data=next((runtime/'import').rglob('data.sql')).read_text(encoding='utf-8')
match=re.search(r'COPY "?auth"?\."?users"? \((.*?)\) FROM stdin;\n(.*?)\n\\\.',data,re.S)
assert match, 'Auth users COPY missing'
columns=[c.strip().strip('"') for c in match.group(1).split(',')]
expected={row.split('\t')[columns.index('id')]:row.split('\t')[columns.index('encrypted_password')] for row in match.group(2).splitlines()}
ids=','.join("'"+uid+"'" for uid in expected)
query=f"SELECT id, encrypted_password FROM auth.users WHERE id IN ({ids});"
result=rehearse.compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atc',query],capture_output=True,text=True)
actual=dict(line.split('|',1) for line in result.stdout.splitlines())
assert actual==expected,'Imported user IDs/password hashes changed'
key_digest=hashlib.sha256((runtime/'runtime.env').read_bytes()).hexdigest()
rehearse.configure(runtime)
assert hashlib.sha256((runtime/'runtime.env').read_bytes()).hexdigest()==key_digest,'Repeated configure changed credentials'
# Stop dependents before their DB; `compose restart` does not wait for DB health
# and the simultaneous restart reproduced an Auth migration startup race.
for stack in ['snapflow','supabase']:
    rehearse.compose(runtime,stack,['stop'],capture_output=True)
for stack in ['supabase','snapflow']:
    rehearse.compose(runtime,stack,['up','-d','--wait','--wait-timeout','240'],capture_output=True)
assert get(f'/scan/{scan}/kpis')==report,'Report changed after full service restart'
result=rehearse.compose(runtime,'supabase',['exec','-T','supabase-db','psql','-X','-U','supabase_admin','-d','postgres','-Atc',query],capture_output=True,text=True)
assert dict(line.split('|',1) for line in result.stdout.splitlines())==expected
artifact=dict(assertions='passed',scan_id=scan,seconds=round(time.monotonic()-start,2),resumed_after_interruption_phase=resumed,interrupted_claim=True,current_pages=6,imported_user_ids_and_password_hashes_preserved=len(expected),credentials_reused=True,report_unchanged_after_restart=True,ordered_stop_start=True,resource_samples=samples,scope='Real SIGKILL of in-flight NLP and full local Compose service restart; if resumed, seconds and samples cover only resumed verification, not original recovery duration. Local resources do not establish VPS headroom.')
(ROOT/'output/capacity-study/production-restart.json').write_text(json.dumps(artifact,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in artifact.items() if k!='resource_samples'}))
