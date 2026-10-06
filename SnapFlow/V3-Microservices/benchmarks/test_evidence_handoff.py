"""Real PostgreSQL acceptance tests for scanner/NLP ownership and freshness."""
import json
import os
from pathlib import Path
import sys
from concurrent.futures import ThreadPoolExecutor

import psycopg2
from psycopg2.extras import RealDictCursor
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "v3-nlp-worker"))
from page_queue import claim_page, publish_page

DSN = os.environ.get("EVIDENCE_TEST_DSN")
pytestmark = pytest.mark.skipif(not DSN, reason="Use an isolated PostgreSQL EVIDENCE_TEST_DSN")


@pytest.fixture
def database():
    conn = psycopg2.connect(DSN)
    if conn.info.dbname != 'snapflow_evidence':
        conn.close()
        raise RuntimeError('isolated fixture database required')
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute((ROOT / "db/init.sql").read_text(encoding="utf-8"))
    cur.execute("DELETE FROM scan_pages WHERE scan_id = 'evidence_fixture'")
    conn.commit()
    yield conn, cur
    conn.close()


def test_migration_preserves_populated_legacy_rows_and_is_idempotent():
    # Temporary legacy table shadows public.scan_pages only in this connection.
    # The function/DDL is rolled back too; no application tables are reset.
    conn = psycopg2.connect(DSN)
    try:
        if conn.info.dbname != 'snapflow_evidence':
            raise RuntimeError('isolated fixture database required')
        with conn.cursor() as cur:
            cur.execute('SET LOCAL search_path TO pg_temp, public')
            cur.execute("""CREATE TEMP TABLE scan_pages (
                id BIGSERIAL PRIMARY KEY, scan_id TEXT, html TEXT, raw_html TEXT,
                rendered_html TEXT, metrics JSONB DEFAULT '{}'::jsonb, nlp_results JSONB)""")
            cur.execute("INSERT INTO scan_pages(scan_id,html,raw_html,nlp_results) VALUES('legacy','original','original','{\"preserved\":true}')")
            migration = (ROOT / 'v3-scanner-go/db/evidence_schema.sql').read_text(encoding='utf-8')
            cur.execute(migration)
            cur.execute(migration)
            cur.execute('SELECT html,raw_html,nlp_results,content_revision,nlp_revision,nlp_ready FROM scan_pages')
            assert cur.fetchone() == ('original','original',{'preserved':True},1,1,True)
            cur.execute("UPDATE scan_pages SET html='hydrated',rendered_html='hydrated'")
            cur.execute('SELECT content_revision,nlp_revision FROM scan_pages')
            assert cur.fetchone() == (2,1)
    finally:
        conn.rollback()
        conn.close()


def seed(conn, cur, ready=True):
    cur.execute("INSERT INTO scan_pages(scan_id,domain,url,html,raw_html,nlp_ready) VALUES('evidence_fixture','fixture','https://fixture.test/page','<div id=\"root\"></div>','<div id=\"root\"></div>',%s) RETURNING id", (ready,))
    page_id = cur.fetchone()["id"]
    conn.commit()
    return page_id


def test_concurrent_workers_claim_only_one_revision_and_scanner_stays_unlocked(database):
    conn, cur = database
    page_id = seed(conn, cur)

    def worker():
        with psycopg2.connect(DSN) as peer:
            with peer.cursor(cursor_factory=RealDictCursor) as cursor:
                return claim_page(peer, cursor)

    with ThreadPoolExecutor(max_workers=2) as executor:
        rows = list(executor.map(lambda _: worker(), range(2)))
    claimed = [row for row in rows if row]
    assert len(claimed) == 1
    cur.execute("SET LOCAL lock_timeout = '1s'")
    cur.execute("UPDATE scan_pages SET rendered_html='<main>Fresh hydrated text</main>', html='<main>Fresh hydrated text</main>' WHERE id=%s", (page_id,))
    conn.commit()
    assert not publish_page(conn, cur, claimed[0], json.dumps({"status": "not_evaluated"}))
    fresh = claim_page(conn, cur)
    assert fresh["raw_html"] == '<div id="root"></div>'
    assert fresh["content_revision"] == claimed[0]["content_revision"] + 1
    assert publish_page(conn, cur, fresh, json.dumps({"status": "evaluated"}))
    assert claim_page(conn, cur) is None


def test_expired_worker_cannot_overwrite_replacement(database):
    conn, cur = database
    page_id = seed(conn, cur)
    old = claim_page(conn, cur)
    cur.execute("UPDATE scan_pages SET nlp_claim_until=CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id=%s", (page_id,))
    conn.commit()
    new = claim_page(conn, cur)
    assert old["nlp_claim_token"] != new["nlp_claim_token"]
    assert not publish_page(conn, cur, old, json.dumps({"old": True}))
    assert publish_page(conn, cur, new, json.dumps({"new": True}))
    cur.execute("SELECT nlp_results FROM scan_pages WHERE id=%s", (page_id,))
    assert cur.fetchone()["nlp_results"] == {"new": True}


def test_provider_failure_can_recover_without_content_change_and_retries_are_bounded(database):
    conn, cur = database
    page_id = seed(conn, cur)
    failed = json.dumps({'spelling_scope': {'status':'partial', 'checked_word_count':0, 'unmeasured_languages':{'fr':100}, 'provider_failures':{'fr':100}}})
    row = claim_page(conn, cur)
    assert publish_page(conn, cur, row, failed)
    assert claim_page(conn, cur) is None  # no hot retry loop
    cur.execute("UPDATE scan_pages SET nlp_claim_until=NOW()-INTERVAL '1 second' WHERE id=%s", (page_id,))
    conn.commit()
    recovered = claim_page(conn, cur)
    assert recovered['content_revision'] == row['content_revision']
    assert publish_page(conn, cur, recovered, json.dumps({'spelling_scope':{'status':'evaluated','checked_word_count':100}}))
    assert claim_page(conn, cur) is None
    # A new observation gets a fresh bounded retry allowance.
    cur.execute("UPDATE scan_pages SET html='new text' WHERE id=%s", (page_id,))
    conn.commit()
    for attempt in range(3):
        retry = claim_page(conn, cur)
        assert retry is not None
        assert publish_page(conn, cur, retry, failed)
        cur.execute("UPDATE scan_pages SET nlp_claim_until=NOW()-INTERVAL '1 second' WHERE id=%s", (page_id,))
        conn.commit()
    assert claim_page(conn, cur) is None
    cur.execute('SELECT nlp_results FROM scan_pages WHERE id=%s', (page_id,))
    assert cur.fetchone()['nlp_results']['spelling_provider_retry_count'] == 3


def test_readiness_and_idempotent_content_updates(database):
    conn, cur = database
    page_id = seed(conn, cur, ready=False)
    assert claim_page(conn, cur) is None
    cur.execute("UPDATE scan_pages SET nlp_ready=TRUE WHERE id=%s", (page_id,))
    conn.commit()
    row = claim_page(conn, cur)
    assert row["content_revision"] == 1
    assert publish_page(conn, cur, row, '{}')
    cur.execute("UPDATE scan_pages SET html=html, raw_html=raw_html, metrics=metrics || '{\"headless\":{\"available\":true}}'::jsonb WHERE id=%s", (page_id,))
    conn.commit()
    assert claim_page(conn, cur) is None


def test_rendered_only_content_survives_schema_reapplication(database):
    conn, cur = database
    cur.execute("INSERT INTO scan_pages(scan_id,domain,url,html,rendered_html) VALUES('evidence_fixture','fixture','https://fixture.test/rendered','<main>Rendered</main>','<main>Rendered</main>') RETURNING id")
    page_id = cur.fetchone()["id"]
    conn.commit()
    cur.execute((ROOT / "db/init.sql").read_text(encoding="utf-8"))
    cur.execute("SELECT raw_html, content_revision FROM scan_pages WHERE id=%s", (page_id,))
    assert cur.fetchone() == {"raw_html": None, "content_revision": 1}


def test_bootstrap_and_embedded_migration_are_identical():
    schema = (ROOT / "v3-scanner-go/db/evidence_schema.sql").read_text(encoding="utf-8")
    assert schema in (ROOT / "db/init.sql").read_text(encoding="utf-8")


def test_captured_modification_date_queues_nlp_but_response_clock_does_not(database):
    conn, cur = database
    page_id = seed(conn, cur)
    current = claim_page(conn, cur)
    assert publish_page(conn, cur, current, '{}')
    cur.execute("UPDATE scan_pages SET metrics=jsonb_build_object('rendered_discovery', jsonb_build_object('response_headers', jsonb_build_object('date','first'))) WHERE id=%s", (page_id,))
    conn.commit()
    assert claim_page(conn, cur) is None

    cur.execute("UPDATE scan_pages SET metrics=jsonb_set(metrics, '{rendered_discovery,response_headers,last-modified}', to_jsonb('Sun, 20 Sep 2026 10:00:00 GMT'::text)) WHERE id=%s", (page_id,))
    conn.commit()
    fresh = claim_page(conn, cur)
    assert fresh['content_revision'] == current['content_revision'] + 1
    assert publish_page(conn, cur, fresh, '{}')
    cur.execute("UPDATE scan_pages SET metrics=jsonb_set(metrics, '{rendered_discovery,response_headers,date}', to_jsonb('later'::text)) WHERE id=%s", (page_id,))
    conn.commit()
    assert claim_page(conn, cur) is None


def test_measurement_metadata_and_shadow_changes_refresh_without_clock_only_work(database):
    conn, cur = database
    page_id = seed(conn, cur)
    current = claim_page(conn, cur)
    assert publish_page(conn, cur, current, '{}')
    response = {'raw_html': '<main>Original navigation</main>', 'response_headers': {'last-modified': 'Sun, 20 Sep 2026 10:00:00 GMT'},
                'shadow_dom': {'text': 'Visible shadow evidence'}}
    cur.execute("UPDATE scan_pages SET metrics=jsonb_build_object('rendered_response', %s::jsonb) WHERE id=%s", (json.dumps(response), page_id))
    conn.commit()
    fresh = claim_page(conn, cur)
    assert fresh['content_revision'] == current['content_revision'] + 1
    assert publish_page(conn, cur, fresh, '{}')
    response['response_headers']['date'] = 'Current HTTP clock'
    cur.execute("UPDATE scan_pages SET metrics=jsonb_build_object('rendered_response', %s::jsonb) WHERE id=%s", (json.dumps(response), page_id))
    conn.commit()
    assert claim_page(conn, cur) is None
    response['shadow_dom']['text'] = 'Changed shadow evidence'
    cur.execute("UPDATE scan_pages SET metrics=jsonb_build_object('rendered_response', %s::jsonb) WHERE id=%s", (json.dumps(response), page_id))
    conn.commit()
    changed = claim_page(conn, cur)
    assert changed['content_revision'] == fresh['content_revision'] + 1
    assert publish_page(conn, cur, changed, '{}')
