"""Replay paired actual-pool captures through packaged production NLP offline.

Record exact extraction and KPI observations for source review. Cross-engine
agreement is not an accuracy label. No browser or full-scan timing claim.
"""
import json
from pathlib import Path
import resource
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, '/app')
import main as nlp
assert Path(nlp.__file__).parent == Path('/app')
source = ROOT/'output/playwright/obscura-study/production-canonical-clean/round-1/observations.json'
captures = json.loads(source.read_text(encoding='utf-8'))
rows = []
for capture in captures:
    result = capture.get('result', {})
    if result.get('status') != 'success':
        continue
    rows.append(dict(id=len(rows)+1, url=capture['url'], content_revision=5,
        raw_html=result.get('raw_html'), rendered_html=result['rendered_html'],
        metrics={'rendered_discovery': result}, engine=result['engine']))
queue = iter(rows)
observations = []

class Cursor:
    def close(self): pass
class Connection:
    def cursor(self, **_kwargs): return Cursor()
    def close(self): pass
    def rollback(self): raise RuntimeError('Unexpected worker rollback')

began = 0
def claim(*_args):
    global began
    row = next(queue, None)
    began = time.perf_counter()
    return row

def publish(_conn, _cur, row, payload):
    result = json.loads(payload)
    assert result['status'] == 'evaluated', result
    assert result['content_revision'] == row['content_revision']
    html, raw, _metrics = nlp.select_page_evidence(row)
    text, selection, metadata = nlp.extract_text_main_content_first(html)
    assert raw == (row['raw_html'] or '')
    observations.append(dict(url=row['url'], engine=row['engine'], text=text,
        extraction_source=selection, extraction_metadata=metadata, nlp_results=result,
        original_response_available=row['raw_html'] is not None,
        elapsed_ms=(time.perf_counter()-began)*1000,
        markdown=row['metrics']['rendered_discovery']['text_projection']['markdown']))
    (ROOT/'output/nlp-accuracy-study/production-live-nlp-partial.json').write_text(
        json.dumps(observations, ensure_ascii=False, indent=2), encoding='utf-8')
    return True

nlp.get_db_connection = Connection
nlp.claim_page = claim
nlp.publish_page = publish
nlp._head_last_modified_date = lambda *_args: (_ for _ in ()).throw(RuntimeError('Unexpected HEAD request'))
nlp.check_llms_txt = lambda *_args: {'llms_txt_present':False, 'status_code':404}
nlp.NLP_SEMANTIC_ENABLED = False
started = time.perf_counter()
try:
    assert nlp.process_pending_pages() == len(rows) == len(observations)
    summary = dict(module=nlp.__file__, observations=observations,
        worker_batch_ms=(time.perf_counter()-started)*1000,
        worker_peak_rss_mib=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
        methodology='Saved matched production-pool live captures, packaged production NLP; DB/llms adapters; network disabled; no semantic model; outputs require independent source judgment')
    (ROOT/'output/nlp-accuracy-study/production-live-nlp.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    for item in observations:
        result = item['nlp_results']
        print(json.dumps(dict(url=item['url'], engine=item['engine'], words=result['word_count'],
            language=result['content_language'], page_type=result['page_type'],
            elapsed_ms=item['elapsed_ms'], typo_density=result['typo_density']), ensure_ascii=False), flush=True)
finally:
    if nlp._LT_FR is not None:
        nlp._LT_FR.close()
