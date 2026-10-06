"""Replay saved engine observations through the packaged CPU worker offline.

Database claims/publication and llms.txt are replaced with deterministic local
observations. Extraction, language detection, spelling, page classification and
KPI production are real. This is not a new browser visit or a full scan test.
"""
import argparse
import json
from pathlib import Path
import resource
import statistics
import sys
import time
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument('--output', default='production-content-pipeline.json')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, '/app')
import main as nlp
if Path(nlp.__file__).parent != Path('/app'):
    raise RuntimeError('Probe must use the packaged worker')
sys.path.insert(0, str(ROOT / 'V3-Microservices/benchmarks/obscura-study'))
from fixtures import FIXTURES, MARKERS

cases = json.loads((ROOT / 'V3-Microservices/benchmarks/thin_content_contract_cases.json').read_text(encoding='utf-8'))['cases']
policy = []
for case in cases:
    result = nlp.check_thin_content_by_type(case['word_count'], case['page_type'], case['language'])
    assert result['word_count_threshold'] == case['threshold']
    assert result['thin_vs_page_type'] is case['thin']
    policy.append(dict(case=case['id'], result=result))

rows, expected = [], {}
language_texts = {
    'fr': 'Notre équipe vous accompagne avec des services professionnels adaptés à vos besoins. ' * 12,
    'ar': 'فريقنا يقدم خدمات مهنية لمساعدتك في اختيار حلول مناسبة لاحتياجاتك. ' * 12,
}
for language, text in language_texts.items():
    page_id = len(rows) + 1
    rows.append(dict(id=page_id, content_revision=3, url=f'https://fixture.test/{language}/contact',
                     raw_html=f'<html lang="{language}"><title>Contact</title><main><h1>Contact</h1><p>{text}</p></main></html>',
                     metrics={'response_headers': {'last-modified': 'Sun, 20 Sep 2026 10:00:00 GMT'}}))
    expected[page_id] = dict(language=language, page_type='contact', threshold={'fr':68, 'ar':64}[language])

base = ROOT / 'output/playwright/obscura-study/stealth-clean'
for round_name in ('round-0-chromium', 'round-0-obscura-full-stealth-unfiltered'):
    directory = base / round_name
    study = json.loads((directory / 'study.json').read_text(encoding='utf-8-sig'))
    for capture in study['rows']:
        if capture['phase'] != 'fixtures_c4' or capture['status'] != 'success':
            continue
        route = urlparse(capture['url']).path
        page_id = len(rows) + 1
        rows.append(dict(id=page_id, url=capture['url'], content_revision=3,
            rendered_html=(directory / f"fixtures_c4-{capture['index']}.html").read_text(encoding='utf-8'),
            metrics={'rendered_discovery': {
                'raw_html': '<html><title>Known content fixture</title><body>' + FIXTURES[route] + '</body></html>',
                'response_headers': {'last-modified': 'Sun, 20 Sep 2026 10:00:00 GMT'},
                'shadow_dom': capture['shadow'],
            }}))
        expected[page_id] = dict(engine=study['engine'], capture_round=round_name, route=route, marker=MARKERS[route])

class Cursor:
    def close(self):
        pass

class Connection:
    def cursor(self, **_kwargs):
        return Cursor()
    def close(self):
        pass
    def rollback(self):
        raise RuntimeError('Unexpected worker rollback')

observations = []
queue = iter(rows)
started = 0
def claim(*_args):
    global started
    row = next(queue, None)
    started = time.perf_counter()
    return row

def publish(_conn, _cur, row, payload):
    result = json.loads(payload)
    label = expected[row['id']]
    assert result['status'] == 'evaluated'
    assert result['content_revision'] == row['content_revision']
    html, raw, _metrics = nlp.select_page_evidence(row)
    text, _source, _meta = nlp.extract_text_main_content_first(html)
    assert 'HIDDEN_TEXT_SHOULD_NOT_BE_VISIBLE' not in text
    assert 'SCRIPT_TEXT_SHOULD_NOT_BE_CONTENT' not in text
    evidence = result['seo_kpis']['thin_content_by_type']
    assert evidence['word_count'] == result['word_count']
    assert evidence['language'] == result['content_language']
    assert result['last_pub_date'] == '2026-09-20'
    if 'language' in label:
        assert result['content_language'] == label['language']
        assert result['page_type'] == label['page_type']
        assert evidence['word_count_threshold'] == label['threshold']
    else:
        assert label['marker'] in text, (label, text)
    observations.append(dict(label=label, page_url=row['url'], content_revision=row['content_revision'],
        text=text, raw_html_preserved=bool(raw), elapsed_ms=(time.perf_counter()-started)*1000,
        nlp_results=result))
    return True

nlp.get_db_connection = Connection
nlp.claim_page = claim
nlp.publish_page = publish
nlp._head_last_modified_date = lambda *_args: (_ for _ in ()).throw(RuntimeError('Unexpected HEAD request'))
nlp.check_llms_txt = lambda *_args: {'llms_txt_present': False, 'status_code': 404, 'parse_status':'not_found'}
nlp.NLP_SEMANTIC_ENABLED = False
began = time.perf_counter()
try:
    processed = nlp.process_pending_pages()
    assert processed == len(rows) == len(observations)
    total_seconds = time.perf_counter()-began
    result = dict(python=sys.version, module=nlp.__file__, methodology='Saved captures, real packaged NLP, fake database, network disabled; no semantic model',
        policy_cases=policy, observations=observations, processed_pages=processed,
        worker_batch_seconds=total_seconds,
        warm_page_median_ms=statistics.median(row['elapsed_ms'] for row in observations[1:]),
        first_page_ms=observations[0]['elapsed_ms'], worker_peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024)
    peak = Path('/sys/fs/cgroup/memory.peak')
    if peak.exists():
        result['container_peak_memory_mib'] = int(peak.read_text()) / (1024*1024)
    path = ROOT / 'output/nlp-accuracy-study' / args.output
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({key:value for key,value in result.items() if key not in ('observations','policy_cases')},ensure_ascii=False))
finally:
    if nlp._LT_FR is not None:
        nlp._LT_FR.close()
