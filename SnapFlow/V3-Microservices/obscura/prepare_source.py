"""Download the exact upstream release sources into ignored local build input."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

def prepare(here):
    lock = json.loads((here / 'source.lock.json').read_text(encoding='utf-8'))
    out = here / 'build-input'
    out.mkdir(exist_ok=True)
    archive = out / 'upstream.tar.gz'
    if not archive.exists():
        partial = archive.with_suffix('.part')
        try:
            with urlopen(lock['url'], timeout=60) as response, partial.open('wb') as target:
                while chunk := response.read(1024*1024):
                    target.write(chunk)
            if hashlib.sha256(partial.read_bytes()).hexdigest() != lock['sha256']:
                raise RuntimeError('Obscura source checksum does not match the pinned lock')
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != lock['sha256']:
        raise RuntimeError('Existing Obscura archive differs from the pinned lock')
    print(json.dumps({'commit':lock['commit'], 'sha256':digest, 'archive_bytes':archive.stat().st_size}), flush=True)


if __name__ == '__main__':
    prepare(Path(__file__).resolve().parent)
