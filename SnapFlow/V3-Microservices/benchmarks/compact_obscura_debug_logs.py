"""Bound generated diagnostic logs, retaining startup/errors and raw hashes."""
from collections import deque
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'output/playwright/obscura-study/stealth'
token = next((line.split('=', 1)[1].strip() for line in
    (ROOT/'V3-Microservices/benchmarks/obscura.env').read_text(encoding='utf-8').splitlines()
    if line.startswith('OBSCURA_CDP_TOKEN=')), '')
manifest = []
for log in OUT.glob('round-*/engine.log'):
    size = log.stat().st_size
    if size < 1024*1024:
        continue
    digest = hashlib.sha256()
    head, errors, tail = [], deque(maxlen=50), deque(maxlen=30)
    with log.open('rb') as stream:
        for index, line in enumerate(stream):
            digest.update(line)
            text = line.decode('utf-8', errors='replace').rstrip()[:1600]
            if token:
                text = text.replace(token, '[REDACTED_CDP_TOKEN]')
            if index < 35:
                head.append(text)
            if any(term in text for term in ['WARN', 'ERROR', 'failed', 'timeout', 'Stealth mode']):
                errors.append(text)
            tail.append(text)
    manifest.append({'file':str(log.relative_to(OUT)), 'original_bytes':size,
                     'original_sha256':digest.hexdigest(), 'retention':'first 35 / last 50 error lines / last 30 lines, each truncated at 1600 chars'})
    log.write_text('\n'.join(head+['\n[COMPACTED GENERATED DEBUG LOG; see compacted-logs.json]\n']+
                   list(errors)+['\n[TAIL]\n']+list(tail))+'\n', encoding='utf-8')
(OUT/'compacted-logs.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'compacted':len(manifest), 'original_bytes':sum(r['original_bytes'] for r in manifest)}), flush=True)
