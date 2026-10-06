"""Judge actual captures against authored fixture content, not model agreement."""
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs

root = Path(__file__).resolve().parents[2]
prefix = os.environ.get('SNAPFLOW_ARTIFACT_PREFIX', 'preprod')
container = os.environ.get('SNAPFLOW_AUDIT_DB_CONTAINER', 'snapflow-local-preprod-db-1')
audit = json.loads((root/f'output/capacity-study/{prefix}-audit.json').read_text(encoding='utf-8-sig'))
observations = []
for scan in (audit['first_scan'], audit['second_scan']):
    assert scan.startswith('scan_') and all(c in '0123456789abcdef' for c in scan[5:])
    sql = f"""SELECT json_agg(json_build_object('url',url,'raw_html',raw_html,
      'rendered_html',rendered_html,'metrics',metrics,'nlp_results',nlp_results,
      'content_revision',content_revision,'nlp_revision',nlp_revision))
      FROM scan_pages WHERE scan_id='{scan}';"""
    rows = json.loads(subprocess.check_output(['docker','exec',container,
        'psql','-X','-U','snapflow','-d','snapflow_v3','-Atc',sql],text=True,encoding='utf-8'))
    assert len(rows) == 6
    judged = []
    for row in rows:
        url = urlparse(row['url']); path = url.path or '/'
        marker = {'/':'HOME_EVIDENCE','/delayed':'HYDRATED_EVIDENCE',
                  '/shadow':'SHADOW_EVIDENCE','/late':'FETCH_EVIDENCE'}.get(path)
        if path == '/guide':
            marker = 'QUERY_' + parse_qs(url.query)['topic'][0].upper() + '_EVIDENCE'
        assert marker, row['url']
        assert marker in row['rendered_html'], (row['url'], 'authored marker absent from captured DOM')
        assert row['nlp_revision'] == row['content_revision']
        words = row['nlp_results']['word_count']
        assert words >= 180, (row['url'], words, 'authored prose did not reach NLP')
        if path == '/shadow':
            assert 'NESTED_SHADOW_EVIDENCE' in json.dumps(row['metrics']), 'nested shadow capture missing'
        judged.append(dict(url=row['url'], expected_marker=marker, words=words,
            content_revision=row['content_revision'], nlp_revision=row['nlp_revision'],
            captured=True, acquisition=row['metrics'].get('acquisition'),
            spelling_scope=row['nlp_results'].get('spelling_scope')))
    observations.append(dict(scan_id=scan, pages=judged))
artifact = dict(assertions='passed', observations=observations,
    scope='Independently authored markers/prose counts, hydration/fetch/nested-shadow preservation, both meaningful query routes, and actual current NLP revisions. Not semantic-model or general KPI accuracy acceptance.')
(root/f'output/capacity-study/{prefix}-evidence.json').write_text(json.dumps(artifact,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'assertions':'passed','scans':2,'pages_per_scan':6,
    'word_counts':{s['scan_id']:[p['words'] for p in s['pages']] for s in observations}},ensure_ascii=False))
