"""Representative real builds on disposable Docker 20.10; host daemon untouched."""
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import time
import urllib.request
import hashlib
import yaml

ROOT=Path(__file__).resolve().parents[2]
runtime=Path(sys.argv[1]).resolve()
engine='snapflow-rehearsal-engine20'
def run(args,**kwargs):
    return subprocess.run(['docker','exec','-i',engine,*args],check=True,**kwargs)
def text(args):return run(args,capture_output=True,text=True).stdout.strip()
version=json.loads(text(['docker','version','--format','{{json .Server}}']))
assert version['Version']=='20.10.24'
plugin_before=text(['docker','buildx','version'])
compose_version=text(['docker','compose','version'])
directories=['Front-Snap','V3-Microservices/v3-aggregator','V3-Microservices/v3-scanner-go']
archive=io.BytesIO()
with tarfile.open(fileobj=archive,mode='w') as tar:
    for directory in directories:
        for path in (ROOT/directory).rglob('*'):
            relative=path.relative_to(ROOT)
            if any(p in {'node_modules','.git','__pycache__','.venv','.pytest_cache','dist','output'} for p in relative.parts):continue
            if any(p.startswith('.env') or 'local-login' in p for p in relative.parts):continue
            if path.is_file() and not path.is_symlink():tar.add(path,arcname=relative.as_posix(),recursive=False)
run(['mkdir','-p','/checkout'])
run(['tar','-xf','-','-C','/checkout'],input=archive.getvalue(),capture_output=True)
services={
 'frontend':dict(build=dict(context='/checkout/Front-Snap',args=dict(VITE_SUPABASE_URL='http://127.0.0.1:18080',VITE_SUPABASE_PUBLISHABLE_KEY='owned-build-probe')),ports=['18080:3000']),
 'aggregator':dict(build=dict(context='/checkout/V3-Microservices/v3-aggregator')),
 'scanner':dict(build=dict(context='/checkout/V3-Microservices/v3-scanner-go')),
}
config=runtime/'engine20.compose.yml';config.write_text(yaml.safe_dump(dict(services=services)),encoding='utf-8')
subprocess.run(['docker','cp',str(config),engine+':/checkout/compose.yml'],check=True)
save=subprocess.Popen(['docker','save','snapflow/v3-python-fastapi-base:latest'],stdout=subprocess.PIPE)
loaded=run(['docker','load'],stdin=save.stdout,capture_output=True)
save.stdout.close();assert save.wait()==0
print('Docker 20.10 loaded the current CPU base; source contexts copied without secrets.',flush=True)
start=time.monotonic(); upgraded=False
log=runtime/'engine20-build.private.log'
command=['docker','compose','-p','owned-build','-f','/checkout/compose.yml','--parallel','1','build']
with log.open('wb') as handle:
    attempt=subprocess.run(['docker','exec',engine,*command],stdout=handle,stderr=subprocess.STDOUT)
if attempt.returncode:
    content=log.read_text(errors='replace')
    if 'buildx' not in content.lower():raise RuntimeError('Docker 20 build failed; inspect private engine20 log')
    # Compose 5 requires a newer client-side build plugin; the daemon stays 20.10.
    release='v0.17.1'
    url=f'https://github.com/docker/buildx/releases/download/{release}/buildx-{release}.linux-amd64'
    blob=urllib.request.urlopen(url,timeout=90).read()
    checks=urllib.request.urlopen(f'https://github.com/docker/buildx/releases/download/{release}/checksums.txt',timeout=60).read().decode()
    checksum=next(line.split()[0] for line in checks.splitlines() if line.endswith(f'buildx-{release}.linux-amd64'))
    assert hashlib.sha256(blob).hexdigest()==checksum
    path=runtime/'buildx-v0.17.1-linux';path.write_bytes(blob)
    subprocess.run(['docker','cp',str(path),engine+':/root/.docker/cli-plugins/docker-buildx'],check=True)
    run(['chmod','+x','/root/.docker/cli-plugins/docker-buildx'])
    upgraded=True
    print('Installed checksum-verified Buildx v0.17.1 in the disposable daemon container; retrying build.',flush=True)
    with log.open('ab') as handle:run(command,stdout=handle,stderr=subprocess.STDOUT)
artifact=dict(assertions='passed',engine=version['Version'],api=version['ApiVersion'],compose=compose_version,buildx_before=plugin_before,buildx_after=text(['docker','buildx','version']),client_plugin_updated=upgraded,builds=list(services),seconds=round(time.monotonic()-start,2),cpu_limit=4,memory_limit_gib=8,scope='Actual frontend, CPU aggregator and Go scanner builds on isolated Docker 20.10.24 with Compose 5.1.3; not a full stack capacity test or host/VPS daemon upgrade.')
(ROOT/'output/capacity-study/production-engine20.json').write_text(json.dumps(artifact,indent=2),encoding='utf-8')
print(json.dumps(artifact))
