"""Short PostgreSQL claims; safe with PgBouncer transaction pooling.

Only the current page is claimed. Analysis runs outside the claim transaction;
the token and revision guard publication, and abandoned claims expire.
"""
import uuid
import json
import logging
import threading

CLAIM_LEASE_SECONDS = 90


class ClaimHeartbeat:
    """Keep live analysis leased while crashed workers recover within 90s."""
    def __init__(self, connect, row):
        self.connect, self.row = connect, row
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stopped.set()
        self.thread.join(timeout=15)

    def _run(self):
        while not self.stopped.wait(CLAIM_LEASE_SECONDS / 3):
            conn = None
            try:
                conn = self.connect()
                with conn.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout = '5s'")
                    cur.execute("""UPDATE scan_pages
                        SET nlp_claim_until = CURRENT_TIMESTAMP + %s * INTERVAL '1 second'
                        WHERE id = %s AND content_revision = %s AND nlp_claim_token = %s""",
                        (CLAIM_LEASE_SECONDS, self.row['id'], self.row['content_revision'], str(self.row['nlp_claim_token'])))
                    renewed = cur.rowcount == 1
                conn.commit()
                if not renewed:
                    break
            except Exception:
                logging.getLogger(__name__).warning('NLP claim heartbeat failed for page %s', self.row['id'])
            finally:
                if conn is not None:
                    conn.close()

# Recheck a transient supported-language provider failure, with a persisted
# bounded attempt count. Unsupported languages do not consume retry work.
SPELLING_RETRY_SQL = """COALESCE(nlp_results#>'{spelling_scope,provider_failures}' ?| ARRAY['fr','en','ar'], FALSE)
    AND COALESCE((nlp_results->>'spelling_provider_retry_count')::int, 0) < 3"""


def claim_page(conn, cur, lease_seconds=CLAIM_LEASE_SECONDS):
    token = str(uuid.uuid4())
    cur.execute("""
        WITH candidate AS (
            SELECT id FROM scan_pages
            WHERE nlp_ready
              AND (nlp_results IS NULL OR nlp_revision IS DISTINCT FROM content_revision OR (""" + SPELLING_RETRY_SQL + """))
              AND (nlp_claim_until IS NULL OR nlp_claim_until < CURRENT_TIMESTAMP)
              AND COALESCE(rendered_html, html, raw_html) IS NOT NULL
            ORDER BY (nlp_results IS NOT NULL AND nlp_revision = content_revision), id
            LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        UPDATE scan_pages p
        SET nlp_claim_token = %s, nlp_claim_until = CURRENT_TIMESTAMP + %s * INTERVAL '1 second'
        FROM candidate c WHERE p.id = c.id
        RETURNING p.id, p.url, p.html, p.raw_html, p.rendered_html, p.metrics,
                  p.content_revision, p.nlp_claim_token, p.nlp_revision, p.nlp_results
    """, (token, lease_seconds))
    row = cur.fetchone()
    conn.commit()
    return row


def publish_page(conn, cur, row, payload):
    parsed = json.loads(payload) if isinstance(payload, str) else dict(payload)
    scope = parsed.get('spelling_scope') or {}
    retryable = any(language in (scope.get('provider_failures') or {}) for language in ('fr', 'en', 'ar'))
    previous = row.get('nlp_results') or {}
    count = previous.get('spelling_provider_retry_count', 0) if row.get('nlp_revision') == row['content_revision'] else 0
    if retryable:
        parsed['spelling_provider_retry_count'] = count + 1
    payload = json.dumps(parsed)
    cur.execute("""
        UPDATE scan_pages SET nlp_results = %s, nlp_revision = %s,
                             nlp_claim_token = NULL,
                             nlp_claim_until = CASE WHEN %s THEN CURRENT_TIMESTAMP + INTERVAL '30 seconds' ELSE NULL END
        WHERE id = %s AND content_revision = %s AND nlp_claim_token = %s
    """, (payload, row["content_revision"], retryable and count + 1 < 3,
           row["id"], row["content_revision"], str(row["nlp_claim_token"])))
    published = cur.rowcount == 1
    if not published:
        release_page(cur, row)
    conn.commit()
    return published


def release_page(cur, row, retry_seconds=0):
    cur.execute("""
        UPDATE scan_pages SET nlp_claim_token = NULL,
          nlp_claim_until = CASE WHEN %s > 0 THEN CURRENT_TIMESTAMP + %s * INTERVAL '1 second' ELSE NULL END
        WHERE id = %s AND nlp_claim_token = %s
    """, (retry_seconds, retry_seconds, row["id"], str(row["nlp_claim_token"])))
