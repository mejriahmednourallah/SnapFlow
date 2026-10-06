"""Fetch the versioned official render+stealth release, recording provenance."""
import hashlib
import json
from pathlib import Path
import tarfile
from urllib.request import urlopen

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / 'output/playwright/obscura-study/stealth-release'
NAME = 'obscura-x86_64-linux-stealth.tar.gz'
URL = f'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.3/{NAME}'

OUT.mkdir(parents=True, exist_ok=True)
archive = OUT / NAME
if not archive.exists():
    with urlopen(URL, timeout=60) as response, archive.open('wb') as target:
        while chunk := response.read(1024 * 1024):
            target.write(chunk)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
with tarfile.open(archive) as bundle:
    members = []
    for member in bundle.getmembers():
        name = Path(member.name).name
        if member.isfile() and name in {'obscura', 'obscura-worker', 'LICENSE', 'LICENSE-APACHE', 'LICENSE-MIT'}:
            source = bundle.extractfile(member)
            (OUT / name).write_bytes(source.read())
            members.append(name)
if 'obscura' not in members:
    raise RuntimeError('Official archive did not contain the expected executable')
(OUT / 'provenance.json').write_text(json.dumps({'version':'v0.2.3', 'url':URL,
    'archive_sha256':digest, 'members':members,
    'verification':'SHA256 recorded locally; no upstream checksum asset supplied'}, indent=2), encoding='utf-8')
print(json.dumps({'archive_sha256':digest, 'members':members}), flush=True)
