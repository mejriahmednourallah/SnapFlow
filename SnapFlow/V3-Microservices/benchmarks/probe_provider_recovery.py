"""Actual packaged NLP/shared-LT outage and recovery on one owned SQL row.

Run fail with the study LT server stopped, recover after restarting it. The
retry clock is advanced only for this fixture; original content is unchanged.
"""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, '/app')
import main as nlp

SCAN = 'provider_recovery_fixture'
TEXT = 'Notre entreprise propose des solutions utiles pour les clients. Nous accompagnons les projets avec une assistance professionnelle et des services adaptés. '

def run(stage):
    if Path(nlp.__file__).parent != Path('/app') or nlp.DB_NAME != 'snapflow_evidence':
        raise RuntimeError('Requires packaged worker and isolated evidence database')
    nlp.check_llms_txt = lambda *_: {'llms_txt_present':False,'status_code':404}
    nlp._head_last_modified_date = lambda *_: (_ for _ in ()).throw(AssertionError('Unexpected extra HEAD'))
    conn = nlp.get_db_connection()
    with conn, conn.cursor() as cur:
        if stage == 'fail':
            cur.execute('DELETE FROM scan_pages WHERE scan_id=%s', (SCAN,))
            html = '<html lang="fr"><main><h1>Informations</h1><p>'+TEXT*16+'</p></main></html>'
            cur.execute("""INSERT INTO scan_pages(scan_id,domain,url,html,raw_html,rendered_html,metrics,nlp_ready)
                VALUES(%s,'fixture.test','https://fixture.test/fr/service',%s,%s,%s,%s,TRUE)""",
                (SCAN, html, html, html, json.dumps({'response_headers':{'last-modified':'Thu, 01 Oct 2026 10:00:00 GMT'}})))
        else:
            cur.execute("UPDATE scan_pages SET nlp_claim_until=NOW()-INTERVAL '1 second' WHERE scan_id=%s", (SCAN,))
    conn.close()
    assert nlp.process_pending_pages() == 1
    assert nlp.process_pending_pages() == 0
    conn = nlp.get_db_connection()
    with conn.cursor() as cur:
        cur.execute('SELECT content_revision,nlp_revision,nlp_results FROM scan_pages WHERE scan_id=%s', (SCAN,))
        revision, publication, result = cur.fetchone()
    conn.close()
    assert revision == publication == 1
    scope = result['spelling_scope']
    if stage == 'fail':
        assert scope['status'] == 'partial' and scope['checked_word_count'] == 0
        assert scope['provider_failures']['fr'] > 0
        assert result['spelling_provider_retry_count'] == 1
    else:
        assert scope['status'] == 'evaluated' and scope['checked_word_count'] > 0
        assert not scope.get('provider_failures')
    artifact = dict(stage=stage, content_revision=revision, nlp_revision=publication,
                    spelling_scope=scope, assertions='passed',
                    methodology='Actual packaged NLP, stopped/restarted shared LT 6.8 and PostgreSQL; owned fixture, retry clock advanced; not full scan acceptance')
    Path('/workspace/output/nlp-accuracy-study/provider-'+stage+'.json').write_text(json.dumps(artifact,indent=2), encoding='utf-8')
    print(json.dumps(artifact))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=['fail','recover'])
    run(parser.parse_args().stage)
