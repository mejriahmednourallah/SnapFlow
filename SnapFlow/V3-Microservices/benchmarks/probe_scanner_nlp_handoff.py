"""Packaged worker + real PostgreSQL against the owned scanner integration rows.

The preceding scanner uses a known browser-response adapter, not a real browser.
Only llms.txt network checking is replaced here; claims/publications are real.
"""
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlparse

sys.path.insert(0, '/app')
import main as nlp
import psycopg2.extras

if Path(nlp.__file__).parent != Path('/app') or nlp.DB_NAME != 'snapflow_evidence':
    raise RuntimeError('Requires packaged worker and isolated evidence database')
SCAN_ID = 'scanner_acquisition_fixture'

conn = nlp.get_db_connection()
with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
    cur.execute("SELECT scan_id FROM scan_pages WHERE nlp_ready AND "
                "(nlp_results IS NULL OR nlp_revision IS DISTINCT FROM content_revision)")
    pending = cur.fetchall()
    assert len(pending) == 6 and all(row['scan_id'] == SCAN_ID for row in pending), pending
    cur.execute('SELECT id, content_revision FROM scan_pages WHERE scan_id=%s', (SCAN_ID,))
    revisions = {row['id']: row['content_revision'] for row in cur.fetchall()}
conn.close()

# This owned site has no llms.txt. Captured headers must eliminate extra HEAD.
nlp.check_llms_txt = lambda *_args: {'llms_txt_present': False, 'status_code': 404}
nlp._head_last_modified_date = lambda *_args: (_ for _ in ()).throw(AssertionError('Unexpected HEAD request'))
nlp.NLP_SEMANTIC_ENABLED = False
started = time.perf_counter()
try:
    assert nlp.process_pending_pages() == 6
    first_cycle_ms = (time.perf_counter() - started) * 1000
    assert nlp.process_pending_pages() == 0
    conn = nlp.get_db_connection()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute('SELECT id,url,html,raw_html,rendered_html,metrics,content_revision,nlp_revision,nlp_results '
                    'FROM scan_pages WHERE scan_id=%s ORDER BY url', (SCAN_ID,))
        rows = cur.fetchall()
    conn.close()
    observations = []
    for row in rows:
        result = row['nlp_results']
        assert row['nlp_revision'] == row['content_revision'] == revisions[row['id']] == result['content_revision']
        assert result['status'] == 'evaluated'
        assert result['last_pub_date'] == '2026-09-20'
        html, raw, metrics = nlp.select_page_evidence(row)
        text, source, _ = nlp.extract_text_main_content_first(html)
        assert 'Recovered instructions describing this service.' in text
        assert 'Useful instructions for customers.' not in text
        assert 'Original ' in raw and 'Recovered ' not in raw
        assert metrics['response_headers']['last-modified'] == 'Sun, 20 Sep 2026 10:00:00 GMT'
        # Fixture has 250 prose words plus one H1 word on home, two on routes.
        # The root slash is punctuation, not a word in the producer's counter.
        expected_words = 251 if urlparse(row['url']).path == '/' else 252
        assert result['word_count'] == expected_words, (row['url'], result['word_count'])
        observations.append(dict(url=row['url'], selected_text=text, extraction_source=source,
                                 content_revision=row['content_revision'], nlp_revision=row['nlp_revision'],
                                 nlp_results=result, original_preserved=True))
    output = dict(assertions='passed', first_cycle_ms=first_cycle_ms, pages=6, repeat_cycle_pages=0,
                  worker_module=nlp.__file__, observations=observations,
                  methodology='Real scanner/HTTP crawl/PostgreSQL and packaged NLP claims/publications; '
                              'scanner browser-response and llms.txt are fixture adapters; not full live-stack acceptance')
    Path('/workspace/output/nlp-accuracy-study/scanner-worker-handoff.json').write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: output[key] for key in ('assertions', 'pages', 'first_cycle_ms', 'repeat_cycle_pages')}))
finally:
    if nlp._LT_FR is not None:
        nlp._LT_FR.close()
