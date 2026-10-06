"""Check completed reports after an idle aggregator/NLP restart, without a scan."""
import json
import subprocess
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parents[2]
folder = root / 'output/capacity-study'
audit = json.loads((folder / 'preprod-audit.json').read_text(encoding='utf-8-sig'))
checks = []
for scan in (audit['first_scan'], audit['second_scan']):
    assert scan.startswith('scan_') and all(c in '0123456789abcdef' for c in scan[5:])
    expected = json.loads((folder / f'preprod-{scan}-report.json').read_text(encoding='utf-8'))
    with urlopen(f'http://127.0.0.1:8080/scan/{scan}/kpis', timeout=30) as response:
        actual = json.load(response)
    assert actual == expected, 'Completed persisted report changed after idle restart'
    sql = f"""SELECT json_build_object('pages',count(*),
      'current_nlp',count(*) FILTER (WHERE nlp_revision=content_revision),
      'claimed',count(*) FILTER (WHERE nlp_claim_token IS NOT NULL))
      FROM scan_pages WHERE scan_id='{scan}';"""
    counts = json.loads(subprocess.check_output(['docker','exec','snapflow-local-preprod-db-1',
        'psql','-X','-U','snapflow','-d','snapflow_v3','-Atc',sql], text=True,encoding='utf-8'))
    assert counts == dict(pages=6,current_nlp=6,claimed=0), counts
    checks.append(dict(scan_id=scan,persisted_report_identical=True,**counts))
artifact = dict(assertions='passed',checks=checks,
    scope='Completed report reload and current unclaimed observations after idle aggregator/NLP restart. Does not test a mid-acquisition crash or active claim-lease recovery.')
(folder / 'preprod-restart.json').write_text(json.dumps(artifact,indent=2),encoding='utf-8')
print(json.dumps(artifact))
