"""Actual packaged NLP processes sharing LanguageTool and isolated SQL.

Twelve controlled FR/EN/AR pages; network probes are replaced only for the owned
fixture. This measures worker throughput, not full VPS audit performance.
"""
import json
import multiprocessing
import os
from pathlib import Path
import sys
import time
from threading import Thread, Event

sys.path.insert(0, '/app')
import main as nlp

BASES = {
    'en': 'The museum displays ancient sculptures and paintings in spacious galleries. Visitors enjoy guided tours through the permanent collection. ',
    'fr': 'Notre entreprise propose des solutions utiles pour les clients. Nous accompagnons les projets avec une assistance professionnelle et des services adaptés. ',
    'ar': 'نقدم خدمات واضحة للعملاء ونساعد الشركات في تطوير مشاريعها. يمكن للزائر التواصل مع فريق الدعم للحصول على معلومات إضافية حول الخدمات المتاحة. ',
}

def worker():
    nlp.check_llms_txt = lambda *_args: {'llms_txt_present':False, 'status_code':404}
    nlp._head_last_modified_date = lambda *_args: (_ for _ in ()).throw(AssertionError('captured headers ignored'))
    while nlp.process_pending_pages():
        pass
    assert nlp._LT_FR is None, 'remote worker started a local Java process'

def run():
    if os.environ.get('DB_NAME') != 'snapflow_evidence':
        raise RuntimeError('isolated database required')
    observations = []
    # Warm server dictionaries before either layout. Otherwise one worker pays
    # the cold Java cost and two workers inherit its cache: an unfair comparison.
    for language, text in BASES.items():
        nlp._load_language_tool(language).check(text)
    for round_index, workers in enumerate((1, 2, 2, 1)):
        scan_id = 'shared_lt_fixture_' + str(round_index)
        conn = nlp.get_db_connection()
        with conn, conn.cursor() as cur:
            cur.execute('DELETE FROM scan_pages WHERE scan_id=%s', (scan_id,))
            for index in range(12):
                language = list(BASES)[index % 3]
                heading = 'تواصل' if language == 'ar' else 'Contact'
                html = '<html lang="'+language+'"><title>'+heading+'</title><main><h1>'+heading+'</h1><p>'+BASES[language]*16+'</p></main></html>'
                cur.execute("""INSERT INTO scan_pages(scan_id,domain,url,html,raw_html,rendered_html,metrics,nlp_ready)
                    VALUES(%s,'fixture.test',%s,%s,%s,%s,%s,TRUE)""", (scan_id,'https://fixture.test/'+language+'/contact/'+str(index),html,html,html,
                    json.dumps({'response_headers':{'last-modified':'Thu, 01 Oct 2026 10:00:00 GMT'}})))
        conn.close()
        start = time.perf_counter()
        stopped = Event()
        memory = []
        def sample():
            while not stopped.wait(.1):
                memory.append(int(Path('/sys/fs/cgroup/memory.current').read_text()))
        sampler = Thread(target=sample, daemon=True)
        sampler.start()
        children = [multiprocessing.get_context('spawn').Process(target=worker) for _ in range(workers)]
        for child in children: child.start()
        for child in children:
            child.join(240)
            if child.is_alive():
                child.terminate()
                child.join()
                raise RuntimeError('worker timed out')
            assert child.exitcode == 0, child.exitcode
        elapsed = time.perf_counter()-start
        stopped.set()
        sampler.join()
        conn = nlp.get_db_connection()
        with conn.cursor() as cur:
            cur.execute('SELECT url,content_revision,nlp_revision,nlp_results FROM scan_pages WHERE scan_id=%s ORDER BY url', (scan_id,))
            rows = cur.fetchall()
        conn.close()
        assert len(rows) == 12
        outputs = []
        for url, revision, analyzed, result in rows:
            assert analyzed == revision and result['status'] == 'evaluated', (url, result.get('status'))
            scope = result['spelling_scope']
            assert scope['status'] == 'evaluated' and scope['checked_word_count'] > 0, (url, scope)
            assert result['last_pub_date'] == '2026-10-01'
            outputs.append(dict(url=url, language=result['content_language'], word_count=result['word_count'], typo_density=result['typo_density'], scope=scope))
        observations.append(dict(round=round_index, workers=workers, pages=len(rows), seconds=elapsed,
            worker_container_sampled_peak_bytes=max(memory) if memory else None,
            pages_per_second=len(rows)/elapsed, outputs=outputs))
    normalized = lambda rows: [{k:v for k,v in row.items() if k!='url'} for row in rows]
    assert all(normalized(observations[0]['outputs']) == normalized(row['outputs']) for row in observations), 'parallelism changed NLP evidence'
    report = dict(methodology='Actual packaged Python 3.11 NLP processes + LanguageTool 6.8 HTTP server + real PostgreSQL; controlled text, not full scan acceptance', observations=observations)
    Path('/workspace/output/nlp-accuracy-study/shared-languagetool.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({ 'observations': [{k:v for k,v in row.items() if k!='outputs'} for row in observations]}))

if __name__ == '__main__':
    run()
