"""Admission correctness against an isolated real PostgreSQL instance."""
import os
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import psycopg2
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'v3-aggregator'))
from scan_admission import ScanAdmission

DSN = os.environ.get('EVIDENCE_TEST_DSN')
pytestmark = pytest.mark.skipif(not DSN, reason='Requires isolated PostgreSQL fixture')


def test_fifo_single_audit_persists_and_expired_owner_cannot_release_successor():
    def connect():
        conn = psycopg2.connect(DSN)
        if conn.get_dsn_parameters()['dbname'] != 'snapflow_evidence':
            conn.close()
            raise RuntimeError('isolated fixture database required')
        return conn
    first, second = ScanAdmission(connect), ScanAdmission(connect)
    first.ensure()
    with connect() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM scan_admission_jobs')
        cur.execute("CREATE TABLE IF NOT EXISTS scan_state(scan_id TEXT PRIMARY KEY,state_json JSONB,updated_at TIMESTAMPTZ)")
    first.enqueue('admission_fixture_a', dict(url='https://fixture.test/a', max_pages=500), dict(status='pending'))
    first.enqueue('admission_fixture_b', dict(url='https://fixture.test/b', max_pages=150), dict(status='pending'))
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda admission: admission.claim(), [first, second]))
    claimed = [job for job in jobs if job]
    assert len(claimed) == 1 and claimed[0][0] == 'admission_fixture_a'
    owner = first if jobs[0] else second
    assert first.claim() is None and second.claim() is None
    assert owner.heartbeat('admission_fixture_a')
    # A new dispatcher still sees the durable running job and cannot overlap it.
    recovered = ScanAdmission(connect)
    assert recovered.claim() is None
    with connect() as conn, conn.cursor() as cur:
        cur.execute("UPDATE scan_admission_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE scan_id='admission_fixture_a'")
    assert recovered.claim()[0] == 'admission_fixture_b'
    owner.finish('admission_fixture_b', 'complete')
    assert recovered.heartbeat('admission_fixture_b')
    recovered.finish('admission_fixture_b', 'complete')
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT scan_id,status FROM scan_admission_jobs ORDER BY scan_id')
        assert cur.fetchall() == [('admission_fixture_a', 'failed'), ('admission_fixture_b', 'complete')]
        cur.execute("SELECT state_json->>'status' FROM scan_state WHERE scan_id='admission_fixture_a'")
        assert cur.fetchone()[0] == 'failed'
