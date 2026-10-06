"""Durable FIFO admission using short PostgreSQL transactions, not Redis.

The lease horizon exceeds a bounded scan. After dispatcher failure, an expired
job is failed, never automatically replayed against a potentially live scanner.
"""
import json
import uuid
from contextlib import closing


class ScanAdmission:
    def __init__(self, connect, lease_seconds=2400):
        self.connect = connect
        self.lease_seconds = lease_seconds
        self.owner = str(uuid.uuid4())

    def ensure(self):
        with closing(self.connect()) as conn, conn, conn.cursor() as cur:
            cur.execute("""CREATE TABLE IF NOT EXISTS scan_admission_jobs (
                scan_id TEXT PRIMARY KEY, request_json JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                owner UUID, lease_until TIMESTAMPTZ)""")
            cur.execute("CREATE INDEX IF NOT EXISTS scan_admission_pending ON scan_admission_jobs(created_at,scan_id) WHERE status='pending'")

    def enqueue(self, scan_id, request, state):
        with closing(self.connect()) as conn, conn, conn.cursor() as cur:
            cur.execute("INSERT INTO scan_admission_jobs(scan_id,request_json) VALUES(%s,%s)",
                        (scan_id, json.dumps(request)))
            cur.execute("""INSERT INTO scan_state(scan_id,state_json,updated_at) VALUES(%s,%s,NOW())
                ON CONFLICT(scan_id) DO UPDATE SET state_json=EXCLUDED.state_json,updated_at=NOW()""",
                        (scan_id, json.dumps(state)))

    def claim(self):
        with closing(self.connect()) as conn, conn, conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_xact_lock(72406184)")
            if not cur.fetchone()[0]:
                return None
            cur.execute("SELECT 1 FROM scan_admission_jobs WHERE status='running' AND lease_until>NOW() LIMIT 1")
            if cur.fetchone():
                return None
            cur.execute("""UPDATE scan_admission_jobs SET status='failed'
                WHERE status='running' AND lease_until<=NOW() RETURNING scan_id""")
            for (expired_id,) in cur.fetchall():
                cur.execute("""UPDATE scan_state SET state_json=state_json ||
                    '{"status":"failed","error":"scan admission lease expired; execution interrupted"}'::jsonb,
                    updated_at=NOW() WHERE scan_id=%s""", (expired_id,))
            cur.execute("""SELECT scan_id,request_json FROM scan_admission_jobs
                WHERE status='pending' ORDER BY created_at,scan_id LIMIT 1 FOR UPDATE SKIP LOCKED""")
            row = cur.fetchone()
            if row is None:
                return None
            cur.execute("""UPDATE scan_admission_jobs SET status='running',owner=%s,
                lease_until=NOW()+%s*INTERVAL '1 second' WHERE scan_id=%s""",
                        (self.owner, self.lease_seconds, row[0]))
            return row

    def heartbeat(self, scan_id):
        with closing(self.connect()) as conn, conn, conn.cursor() as cur:
            cur.execute("""UPDATE scan_admission_jobs SET lease_until=NOW()+%s*INTERVAL '1 second'
                WHERE scan_id=%s AND owner=%s AND status='running'""",
                        (self.lease_seconds, scan_id, self.owner))
            return cur.rowcount == 1

    def finish(self, scan_id, status):
        if status not in ('complete', 'failed'):
            status = 'failed'
        with closing(self.connect()) as conn, conn, conn.cursor() as cur:
            cur.execute("UPDATE scan_admission_jobs SET status=%s,lease_until=NULL WHERE scan_id=%s AND owner=%s",
                        (status, scan_id, self.owner))
