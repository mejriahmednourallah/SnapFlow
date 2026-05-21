"""
v3-aggregator: Results Aggregation & Status Service
Acts as the V3 API gateway. Accepts scan requests, tracks progress,
and returns the final aggregated report via polling.
"""
import os
import uuid
import json
import time
import re
import threading
import asyncio
import logging
import requests
from concurrent.futures import ThreadPoolExecutor
from collections import Counter, defaultdict
from enum import Enum
from typing import Optional
from urllib.parse import urlparse

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from classifier import build_recommendations
from kpi_builder import build_kpi_centric_report

logging.basicConfig(level=logging.INFO, format="%(asctime)s [AGG] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="SnapFlow V3 Aggregator", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Config ───────────────────────────────────────────────────────────────────
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "snapflow_v3")
DB_USER = os.getenv("DB_USER", "snapflow")
DB_PASS = os.getenv("DB_PASS", "snapflow")
SCANNER_API_URL = os.getenv("SCANNER_API_URL", "http://scanner:8081")
VISUAL_REGRESSION_API_URL = os.getenv("VISUAL_REGRESSION_API_URL", "http://v3-visual-regression:8083")
MULTI_BROWSER_FALLBACK_TIMEOUT = int(os.getenv("MULTI_BROWSER_FALLBACK_TIMEOUT", "20"))


def _build_top_level_kpis(kpi_report: dict) -> dict:
    summary = kpi_report.get("summary") if isinstance(kpi_report, dict) else {}
    summary = summary if isinstance(summary, dict) else {}

    delivery = summary.get("delivery_overview") if isinstance(summary.get("delivery_overview"), dict) else {}
    client = summary.get("client_overview") if isinstance(summary.get("client_overview"), dict) else {}
    risk = summary.get("risk_breakdown") if isinstance(summary.get("risk_breakdown"), dict) else {}

    def _to_int(value, default=0):
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    return {
        "health_status": client.get("health_status", "unknown"),
        "headline": client.get("headline", ""),
        "key_points": client.get("key_points", []) if isinstance(client.get("key_points"), list) else [],
        "pages_scanned": _to_int(delivery.get("pages_scanned", 0)),
        "total_kpis": _to_int(delivery.get("total_kpis", 0)),
        "passed_kpis": _to_int(delivery.get("passed_kpis", 0)),
        "warning_kpis": _to_int(delivery.get("warning_kpis", 0)),
        "failed_kpis": _to_int(delivery.get("failed_kpis", 0)),
        "not_evaluated_kpis": _to_int(delivery.get("not_evaluated_kpis", 0)),
        "critical_kpis": _to_int(delivery.get("critical_kpis", 0)),
        "high_kpis": _to_int(delivery.get("high_kpis", 0)),
        "medium_kpis": _to_int(delivery.get("medium_kpis", 0)),
        "low_kpis": _to_int(delivery.get("low_kpis", 0)),
        "risk_breakdown": risk,
    }


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _to_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _jsonb_object(value, default: Optional[dict] = None) -> Optional[dict]:
    """Return a dict from a JSONB/text payload without raising on driver quirks."""
    fallback = default if default is not None else None
    if value is None:
        return fallback
    if isinstance(value, dict):
        return value
    if isinstance(value, type):
        return fallback
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8", errors="replace")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return fallback
        try:
            parsed = json.loads(text)
        except (TypeError, ValueError, json.JSONDecodeError):
            return fallback
        return parsed if isinstance(parsed, dict) else fallback
    return fallback


def _build_kpi_quality_drift_artifact(
    scan_id: str,
    scan_url: str,
    kpi_report: dict,
    previous_artifact: Optional[dict] = None,
    previous_scan_id: Optional[str] = None,
) -> dict:
    top_level = _build_top_level_kpis(kpi_report)
    total_kpis = max(_to_int(top_level.get("total_kpis", 0)), 0)
    passed_kpis = max(_to_int(top_level.get("passed_kpis", 0)), 0)
    warning_kpis = max(_to_int(top_level.get("warning_kpis", 0)), 0)
    failed_kpis = max(_to_int(top_level.get("failed_kpis", 0)), 0)
    not_evaluated_kpis = max(_to_int(top_level.get("not_evaluated_kpis", 0)), 0)
    critical_kpis = max(_to_int(top_level.get("critical_kpis", 0)), 0)

    evaluated_kpis = max(total_kpis - not_evaluated_kpis, 0)
    evaluation_coverage_pct = round((evaluated_kpis / max(total_kpis, 1)) * 100.0, 2) if total_kpis > 0 else 0.0
    pass_rate_pct = round((passed_kpis / max(evaluated_kpis, 1)) * 100.0, 2) if evaluated_kpis > 0 else 0.0
    warning_rate_pct = round((warning_kpis / max(evaluated_kpis, 1)) * 100.0, 2) if evaluated_kpis > 0 else 0.0
    failure_rate_pct = round((failed_kpis / max(evaluated_kpis, 1)) * 100.0, 2) if evaluated_kpis > 0 else 0.0
    critical_rate_pct = round((critical_kpis / max(evaluated_kpis, 1)) * 100.0, 2) if evaluated_kpis > 0 else 0.0

    risk_breakdown = top_level.get("risk_breakdown", {})
    risk_breakdown = risk_breakdown if isinstance(risk_breakdown, dict) else {}
    high_conf_failed_total = 0
    for bucket in risk_breakdown.values():
        if isinstance(bucket, dict):
            high_conf_failed_total += _to_int(bucket.get("high_confidence_failed", 0), 0)

    quality_score = round(
        max(
            0.0,
            min(
                100.0,
                100.0
                - failure_rate_pct
                - (warning_rate_pct * 0.40)
                - ((100.0 - evaluation_coverage_pct) * 0.30)
                - (critical_rate_pct * 0.50),
            ),
        ),
        2,
    )

    quality_status = "good"
    if quality_score < 60.0:
        quality_status = "at_risk"
    elif quality_score < 80.0:
        quality_status = "watch"

    alerts = []
    if evaluation_coverage_pct < 95.0:
        alerts.append("coverage_below_95")
    if failure_rate_pct > 15.0:
        alerts.append("failure_rate_above_15")
    if critical_kpis > 0:
        alerts.append("critical_kpis_present")
    if high_conf_failed_total > 0:
        alerts.append("high_confidence_failures_present")

    drift = {
        "available": False,
        "previous_scan_id": previous_scan_id,
        "trend": "unknown",
        "deltas": {},
    }

    if isinstance(previous_artifact, dict):
        prev_quality = previous_artifact.get("quality", {})
        prev_coverage = _to_float(prev_quality.get("coverage", {}).get("evaluation_coverage_pct", 0.0), 0.0)
        prev_pass_rate = _to_float(prev_quality.get("rates", {}).get("pass_rate_pct", 0.0), 0.0)
        prev_fail_rate = _to_float(prev_quality.get("rates", {}).get("failure_rate_pct", 0.0), 0.0)
        prev_warning_rate = _to_float(prev_quality.get("rates", {}).get("warning_rate_pct", 0.0), 0.0)
        prev_not_evaluated = _to_int(prev_quality.get("coverage", {}).get("not_evaluated_kpis", 0), 0)
        prev_score = _to_float(prev_quality.get("quality_score", 0.0), 0.0)
        prev_health = str(previous_artifact.get("health_status", "unknown") or "unknown")

        delta_score = round(quality_score - prev_score, 2)
        trend = "stable"
        if delta_score >= 2.0:
            trend = "improving"
        elif delta_score <= -2.0:
            trend = "regressing"

        drift = {
            "available": True,
            "previous_scan_id": previous_scan_id,
            "trend": trend,
            "deltas": {
                "quality_score": delta_score,
                "evaluation_coverage_pct": round(evaluation_coverage_pct - prev_coverage, 2),
                "pass_rate_pct": round(pass_rate_pct - prev_pass_rate, 2),
                "failure_rate_pct": round(failure_rate_pct - prev_fail_rate, 2),
                "warning_rate_pct": round(warning_rate_pct - prev_warning_rate, 2),
                "not_evaluated_kpis": not_evaluated_kpis - prev_not_evaluated,
            },
            "health_status_changed": top_level.get("health_status", "unknown") != prev_health,
        }

    return {
        "scan_id": scan_id,
        "scan_url": scan_url,
        "kpi_mode": "new",
        "generated_at": int(time.time()),
        "health_status": top_level.get("health_status", "unknown"),
        "quality": {
            "coverage": {
                "total_kpis": total_kpis,
                "evaluated_kpis": evaluated_kpis,
                "not_evaluated_kpis": not_evaluated_kpis,
                "evaluation_coverage_pct": evaluation_coverage_pct,
            },
            "distribution": {
                "passed_kpis": passed_kpis,
                "warning_kpis": warning_kpis,
                "failed_kpis": failed_kpis,
                "critical_kpis": critical_kpis,
                "high_confidence_failed_kpis": high_conf_failed_total,
            },
            "rates": {
                "pass_rate_pct": pass_rate_pct,
                "warning_rate_pct": warning_rate_pct,
                "failure_rate_pct": failure_rate_pct,
                "critical_rate_pct": critical_rate_pct,
            },
            "quality_score": quality_score,
            "quality_status": quality_status,
            "operational_alerts": alerts,
        },
        "drift": drift,
    }


def _load_previous_quality_drift_artifact(scan_url: str, exclude_scan_id: str) -> tuple[Optional[str], Optional[dict]]:
    if not scan_url:
        return None, None
    try:
        conn = get_db()
        cur = conn.cursor(psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT scan_id, quality_drift_artifact
            FROM scan_kpi_outputs
            WHERE scan_url = %s AND scan_id <> %s
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (scan_url, exclude_scan_id),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return None, None
        artifact = _jsonb_object(row.get("quality_drift_artifact"))
        return row.get("scan_id"), artifact
    except Exception as exc:
        logger.warning("Could not load previous quality artifact for %s: %s", scan_url, exc)
        return None, None


def _scanner_base_candidates() -> list[str]:
    """Return ordered scanner base URLs with local fallbacks for non-Docker runs."""
    configured = (SCANNER_API_URL or "").strip().rstrip("/")
    candidates: list[str] = []

    def _add(url: str):
        if url and url not in candidates:
            candidates.append(url)

    _add(configured)

    try:
        parsed = urlparse(configured)
        scheme = parsed.scheme or "http"
        port = parsed.port or (443 if scheme == "https" else 80)
    except Exception:
        scheme = "http"
        port = 8081

    for host in ("localhost", "127.0.0.1", "host.docker.internal", "scanner"):
        _add(f"{scheme}://{host}:{port}")

    return candidates

# In-memory scan status store (survives container restarts only via DB)
scans: dict[str, dict] = {}
scans_lock = threading.RLock()
_kpi_build_locks: dict[str, threading.Lock] = {}
_kpi_build_locks_guard = threading.Lock()
_heartbeat_started = False

# Ignore trivial high-frequency words when building cannibalization clusters.
_CANNIBALIZATION_NOISE = {
    "plus", "plu", "tres", "bien", "tout", "tous", "site", "accueil",
    "home", "nous", "vous", "page", "pages", "service", "services",
    "information", "actualite", "actualites", "news", "detail", "details",
    "projet", "projets",
}

# ─── DB_SSL_MODE support ──────────────────────────────────────────────────────
_DB_SSL_MODE = os.getenv("DB_SSL_MODE", "disable")


def _persist_scan_state(scan_id: str, state: dict) -> None:
    """[A-1] Write scan state to DB so it survives container restarts."""
    try:
        conn = get_db()
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO scan_state (scan_id, state_json, updated_at)
            VALUES (%s, %s, NOW())
            ON CONFLICT (scan_id)
            DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
            """,
            (scan_id, json.dumps(state)),
        )
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("[A-1] Could not persist scan state for %s: %s", scan_id, exc)


def _load_scan_state_from_db(scan_id: str) -> Optional[dict]:
    """[A-1] Reload scan state from DB after a restart."""
    try:
        conn = get_db()
        cur = conn.cursor(psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT state_json FROM scan_state WHERE scan_id = %s",
            (scan_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            raw = row["state_json"]
            return raw if isinstance(raw, dict) else json.loads(raw)
    except Exception as exc:
        logger.warning("[A-1] Could not reload scan state for %s: %s", scan_id, exc)
    return None


def _persist_kpi_payload(scan_id: str, payload: dict, scan_url: Optional[str] = None) -> None:
    """Persist canonical KPI payload and top-level KPI block for fast retrieval."""
    try:
        conn = get_db()
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO scan_kpi_outputs (scan_id, scan_url, kpi_json, top_level_kpis, quality_drift_artifact, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
            ON CONFLICT (scan_id)
            DO UPDATE SET
                scan_url = EXCLUDED.scan_url,
                kpi_json = EXCLUDED.kpi_json,
                top_level_kpis = EXCLUDED.top_level_kpis,
                quality_drift_artifact = EXCLUDED.quality_drift_artifact,
                updated_at = NOW()
            """,
            (
                scan_id,
                scan_url,
                json.dumps(payload),
                json.dumps(payload.get("top_level_kpis", {})),
                json.dumps(payload.get("quality_drift_artifact", {})),
            ),
        )
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("Could not persist KPI payload for %s: %s", scan_id, exc)


def _load_persisted_kpi_payload(scan_id: str) -> Optional[dict]:
    try:
        conn = get_db()
        cur = conn.cursor(psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT kpi_json, top_level_kpis, quality_drift_artifact FROM scan_kpi_outputs WHERE scan_id = %s",
            (scan_id,),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return None

        payload = _jsonb_object(row.get("kpi_json"))
        if payload is None:
            return None
        if isinstance(payload, dict) and "top_level_kpis" not in payload:
            top_level = _jsonb_object(row.get("top_level_kpis"), {})
            payload["top_level_kpis"] = top_level
        if isinstance(payload, dict) and "quality_drift_artifact" not in payload:
            artifact = _jsonb_object(row.get("quality_drift_artifact"), {})
            payload["quality_drift_artifact"] = artifact
        return payload
    except Exception as exc:
        logger.warning("Could not load persisted KPI payload for %s: %s", scan_id, exc)
        return None


def _get_kpi_build_lock(scan_id: str) -> threading.Lock:
    with _kpi_build_locks_guard:
        lock = _kpi_build_locks.get(scan_id)
        if lock is None:
            lock = threading.Lock()
            _kpi_build_locks[scan_id] = lock
        return lock


def _build_and_persist_kpi_payload(
    scan_id: str,
    scan: Optional[dict] = None,
    wait_for_lock: bool = True,
) -> Optional[dict]:
    """Build the canonical KPI payload once and persist it for fast polling reads."""
    cached = _load_persisted_kpi_payload(scan_id)
    if cached is not None:
        return cached

    build_lock = _get_kpi_build_lock(scan_id)
    acquired = build_lock.acquire(blocking=wait_for_lock)
    if not acquired:
        return None

    try:
        cached = _load_persisted_kpi_payload(scan_id)
        if cached is not None:
            return cached

        started = time.time()
        scan_meta = scan or get_scan_entry(scan_id) or {}
        report = build_report(scan_id)
        if report.get("error"):
            raise RuntimeError(str(report["error"]))

        kpi_report = build_kpi_centric_report(report)
        if kpi_report.get("error"):
            raise RuntimeError(str(kpi_report["error"]))

        if scan_meta.get("nlp_partiel"):
            kpi_report["nlp_partiel"] = True
            kpi_report["nlp_partiel_avertissement"] = (
                "L'enrichissement NLP est incomplet pour ce scan. "
                "Les KPIs de contenu, lisibilite et RGPD peuvent etre imprecis."
            )

        kpi_report["kpi_mode"] = "new"
        kpi_report["top_level_kpis"] = _build_top_level_kpis(kpi_report)
        prev_scan_id, prev_artifact = _load_previous_quality_drift_artifact(scan_meta.get("url", ""), scan_id)
        kpi_report["quality_drift_artifact"] = _build_kpi_quality_drift_artifact(
            scan_id,
            scan_meta.get("url", ""),
            kpi_report,
            previous_artifact=prev_artifact,
            previous_scan_id=prev_scan_id,
        )
        _persist_kpi_payload(scan_id, kpi_report, scan_url=scan_meta.get("url", ""))
        logger.info("KPI payload ready for %s in %.1fs", scan_id, time.time() - started)
        return kpi_report
    finally:
        build_lock.release()


def _ensure_scan_state_table() -> None:
    """[A-1] Create scan_state table if absent (idempotent)."""
    try:
        conn = get_db()
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS scan_state (
                scan_id  TEXT PRIMARY KEY,
                state_json JSONB NOT NULL,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS scan_kpi_outputs (
                scan_id TEXT PRIMARY KEY,
                scan_url TEXT,
                kpi_json JSONB NOT NULL,
                top_level_kpis JSONB NOT NULL DEFAULT '{}'::jsonb,
                quality_drift_artifact JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        cur.execute("ALTER TABLE scan_kpi_outputs ADD COLUMN IF NOT EXISTS scan_url TEXT")
        cur.execute(
            "ALTER TABLE scan_kpi_outputs ADD COLUMN IF NOT EXISTS quality_drift_artifact JSONB NOT NULL DEFAULT '{}'::jsonb"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_scan_kpi_outputs_scan_url_updated ON scan_kpi_outputs (scan_url, updated_at DESC)"
        )
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("[A-1] Could not ensure scan_state table: %s", exc)


def create_scan_entry(scan_id: str, req: "ScanRequest"):
    state = {
        "scan_id": scan_id,
        "url": req.url,
        "status": ScanStatus.PENDING,
        "started_at": time.time(),
        "error": None,
        "enable_visual_regression": bool(req.enable_visual_regression),
        "visual_baseline_scan_id": req.visual_baseline_scan_id,
    }
    with scans_lock:
        scans[scan_id] = state
    _persist_scan_state(scan_id, state)  # [A-1] survive restarts


def get_scan_entry(scan_id: str) -> Optional[dict]:
    with scans_lock:
        scan = scans.get(scan_id)
        if scan:
            return dict(scan)
    # [A-1] Not in memory — try DB (handles container restarts)
    db_state = _load_scan_state_from_db(scan_id)
    if db_state:
        with scans_lock:
            scans[scan_id] = db_state  # warm in-memory cache
        return dict(db_state)
    return None


def update_scan_entry(scan_id: str, **updates):
    with scans_lock:
        if scan_id in scans:
            scans[scan_id].update(updates)
            state_copy = dict(scans[scan_id])
        else:
            state_copy = None
    if state_copy:
        _persist_scan_state(scan_id, state_copy)  # [A-1]


def azure_heartbeat_loop(site_name: str, interval_seconds: int):
    # Delay first ping to let app fully start.
    time.sleep(60)
    url = f"https://{site_name}.azurewebsites.net/health"
    logger.info("Azure heartbeat enabled: %s every %ss", url, interval_seconds)
    while True:
        try:
            requests.get(url, timeout=10)
        except Exception as exc:
            logger.debug("heartbeat failed: %s", exc)
        time.sleep(interval_seconds)


@app.on_event("startup")
def startup_heartbeat():
    global _heartbeat_started
    _ensure_scan_state_table()  # [A-1] idempotent table creation
    logger.info("KPI mode: new (legacy path removed)")
    with scans_lock:
        if _heartbeat_started:
            return
        site_name = os.getenv("WEBSITE_SITE_NAME", "").strip()
        if not site_name:
            _heartbeat_started = True
            return
        interval_seconds = int(os.getenv("HEARTBEAT_INTERVAL_SECONDS", "600"))
        t = threading.Thread(
            target=azure_heartbeat_loop,
            args=(site_name, interval_seconds),
            daemon=True,
        )
        t.start()
        _heartbeat_started = True


class ScanStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    NLP_PROCESSING = "nlp_processing"
    FINALIZING = "finalizing"
    COMPLETE = "complete"
    FAILED = "failed"


class ScanRequest(BaseModel):
    url: str
    max_pages: Optional[int] = 150
    headless_concurrency: Optional[int] = 3
    enable_visual_regression: Optional[bool] = False
    visual_baseline_scan_id: Optional[str] = None


def get_db():
    return psycopg2.connect(
        host=DB_HOST, port=DB_PORT, dbname=DB_NAME,
        user=DB_USER, password=DB_PASS,
    )


def count_pages(scan_id: str) -> tuple[int, int]:
    """Returns (total_pages, nlp_done_pages) for a scan."""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*), COUNT(nlp_results) FROM scan_pages WHERE scan_id = %s",
            (scan_id,)
        )
        total, nlp_done = cur.fetchone()
        cur.close()
        conn.close()
        return int(total or 0), int(nlp_done or 0)
    except Exception:
        return 0, 0


def _j(val) -> dict:
    """Safely parse a JSON value that might already be a dict."""
    if val is None:
        return {}
    return val if isinstance(val, dict) else json.loads(val)


def _is_valid_cannibalization_term(stem: str, keyword: str) -> bool:
    stem_norm = (str(stem or "").strip().lower())
    kw_norm = (str(keyword or "").strip().lower())
    if not stem_norm and not kw_norm:
        return False
    return stem_norm not in _CANNIBALIZATION_NOISE and kw_norm not in _CANNIBALIZATION_NOISE


def _build_brand_exclusion_terms(domain_url: str) -> set[str]:
    parsed = urlparse(str(domain_url or "").strip())
    host = (parsed.netloc or parsed.path or "").lower().replace("www.", "")
    root = host.split(".")[0]
    tokens = set()
    for token in re.findall(r"[a-zA-Z]{3,}", root):
        tokens.add(token.lower())
    if root:
        if len(root) >= 3:
            tokens.add(root)
        for part in re.findall(r"[a-zA-Z]{3,}", re.sub(r"[^a-zA-Z]+", " ", root)):
            tokens.add(part.lower())
        for size in (3, 4):
            if len(root) >= size:
                tokens.add(root[:size].lower())
                tokens.add(root[-size:].lower())
    return {t for t in tokens if t}


def _build_broken_link_kpi(summary_row) -> dict:
    """Extract broken link KPI from scan_summaries.broken_links_summary."""
    if not summary_row:
        return {
            "broken_link_count": None,
            "broken_links": [],
            "passed": None,
            "status": "non_evalue",
            "raison_non_evalue": "donnees_absentes",
        }
    raw = _j(summary_row.get("broken_links_summary"))
    if not raw:
        return {
            "broken_link_count": None,
            "broken_links": [],
            "passed": None,
            "status": "non_evalue",
            "raison_non_evalue": "resume_vide",
        }
    passed_val = raw.get("broken_links_passed")  # Never default True
    if passed_val is None:
        status = "non_evalue"
        passed = None
    else:
        passed = bool(passed_val)
        status = "passing" if passed else "failing"
    return {
        "broken_link_count": raw.get("broken_link_count", 0),
        "broken_links":      raw.get("broken_links", []),
        "passed":            passed,
        "status":            status,
    }


def _load_form_fuzzer_table_stats(cur, scan_id: str) -> dict:
    """Best-effort aggregate from form_fuzz_results for backward-compatible fallback."""
    try:
        cur.execute(
            """
            SELECT
                COUNT(*) AS tests_run,
                COUNT(
                    DISTINCT (
                        COALESCE(NULLIF(BTRIM(LOWER(form_id)), ''), '__missing_form_id__')
                        || '|'
                        || COALESCE(NULLIF(BTRIM(LOWER(action_url)), ''), '__missing_action_url__')
                    )
                ) AS forms_tested,
                COUNT(*) FILTER (WHERE anomaly = TRUE) AS anomalies_count,
                COUNT(DISTINCT page_url) FILTER (WHERE anomaly = TRUE) AS affected_pages
            FROM form_fuzz_results
            WHERE scan_id = %s
            """,
            (scan_id,),
        )
        totals = cur.fetchone() or {}

        cur.execute(
            """
            SELECT
                COALESCE(NULLIF(anomaly_reason, ''), 'unknown') AS reason,
                COUNT(*) AS count
            FROM form_fuzz_results
            WHERE scan_id = %s AND anomaly = TRUE
            GROUP BY COALESCE(NULLIF(anomaly_reason, ''), 'unknown')
            ORDER BY count DESC
            LIMIT 10
            """,
            (scan_id,),
        )
        reason_rows = cur.fetchall() or []

        cur.execute(
            """
            SELECT
                page_url,
                COUNT(*) AS anomalies
            FROM form_fuzz_results
            WHERE scan_id = %s
              AND anomaly = TRUE
            GROUP BY page_url
            ORDER BY anomalies DESC
            LIMIT 20
            """,
            (scan_id,),
        )
        anomaly_rows = cur.fetchall() or []

        cur.execute(
            """
            SELECT DISTINCT page_url
            FROM form_fuzz_results
            WHERE scan_id = %s
              AND anomaly = TRUE
              AND COALESCE(NULLIF(page_url, ''), '') <> ''
            ORDER BY page_url
            LIMIT 100
            """,
            (scan_id,),
        )
        affected_page_rows = cur.fetchall() or []

        cur.execute(
            """
            SELECT
                page_url,
                action_url,
                form_id,
                test_type,
                payload,
                response_type,
                status_code,
                anomaly,
                anomaly_reason,
                duration_ms,
                error
            FROM form_fuzz_results
            WHERE scan_id = %s
              AND anomaly = TRUE
            ORDER BY created_at DESC, id DESC
            """,
            (scan_id,),
        )
        anomalous_test_rows = cur.fetchall() or []
    except Exception:
        return {}

    anomalies_by_type = {
        str(r.get("reason", "unknown")): int(r.get("count", 0) or 0)
        for r in reason_rows
        if isinstance(r, dict)
    }
    top_findings = [
        {
            "type": str(r.get("reason", "unknown")),
            "count": int(r.get("count", 0) or 0),
        }
        for r in reason_rows
        if isinstance(r, dict)
    ]
    top_affected = [
        {
            "page_url": str(r.get("page_url") or ""),
            "anomalies": int(r.get("anomalies", 0) or 0),
        }
        for r in anomaly_rows
        if isinstance(r, dict)
    ]
    affected_page_urls = [
        str(r.get("page_url") or "")
        for r in affected_page_rows
        if isinstance(r, dict) and str(r.get("page_url") or "").strip()
    ]
    anomalous_tests_all = []
    for row in anomalous_test_rows:
        if not isinstance(row, dict):
            continue
        payload = row.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {"raw": payload}
        elif payload is None:
            payload = {}
        anomalous_tests_all.append({
            "page_url": str(row.get("page_url") or ""),
            "action_url": str(row.get("action_url") or ""),
            "form_id": str(row.get("form_id") or ""),
            "test_type": str(row.get("test_type") or ""),
            "payload": payload if isinstance(payload, dict) else payload,
            "response_type": str(row.get("response_type") or ""),
            "status_code": int(row.get("status_code", 0) or 0),
            "anomaly": bool(row.get("anomaly")),
            "anomaly_reason": str(row.get("anomaly_reason") or ""),
            "duration_ms": int(row.get("duration_ms", 0) or 0),
            "error": str(row.get("error") or ""),
        })

    return {
        "forms_tested": int(totals.get("forms_tested", 0) or 0),
        "tests_run": int(totals.get("tests_run", 0) or 0),
        "anomalies_count": int(totals.get("anomalies_count", 0) or 0),
        "affected_pages": int(totals.get("affected_pages", 0) or 0),
        "affected_page_urls": affected_page_urls,
        "anomalous_tests_all": anomalous_tests_all,
        "anomalies_by_type": anomalies_by_type,
        "top_findings": top_findings,
        "top_affected": top_affected,
    }


def _build_functional_fuzzer_kpi(summary_row: dict | None, table_stats: dict | None = None) -> dict:
    """Return additive functional_fuzzer_kpi with robust summary->table fallback."""
    table_stats = table_stats or {}
    raw = _j((summary_row or {}).get("form_fuzzer_summary"))

    has_summary = bool(raw)
    tests_run = int(raw.get("tests_run", 0) or 0)
    forms_tested = int(raw.get("forms_tested", 0) or 0)
    forms_discovered = int(raw.get("forms_discovered", 0) or 0)
    unique_transactional_forms_detected = int(raw.get("unique_transactional_forms_detected", 0) or 0)
    unique_transactional_forms_tested = int(raw.get("unique_transactional_forms_tested", 0) or 0)
    non_transactional_forms_tested = int(raw.get("non_transactional_forms_tested", 0) or 0)
    suppressed_low_confidence_anomalies = int(raw.get("suppressed_low_confidence_anomalies", 0) or 0)
    anomalies_count = int(raw.get("anomalies_found", 0) or 0)
    affected_pages = int(raw.get("affected_pages", 0) or 0)
    affected_page_urls = [
        str(u or "").strip()
        for u in (raw.get("affected_page_urls", []) if isinstance(raw, dict) else [])
        if str(u or "").strip()
    ]

    if not has_summary or (tests_run == 0 and int(table_stats.get("tests_run", 0) or 0) > 0):
        tests_run = int(table_stats.get("tests_run", 0) or 0)
        forms_tested = int(table_stats.get("forms_tested", 0) or 0)
        if forms_discovered == 0:
            forms_discovered = forms_tested
        anomalies_count = int(table_stats.get("anomalies_count", 0) or 0)
        affected_pages = int(table_stats.get("affected_pages", 0) or 0)
        affected_page_urls = [
            str(u or "").strip()
            for u in (table_stats.get("affected_page_urls", []) if isinstance(table_stats, dict) else [])
            if str(u or "").strip()
        ]

    anomalies_by_type = table_stats.get("anomalies_by_type", {}) if isinstance(table_stats, dict) else {}
    top_findings = table_stats.get("top_findings", []) if isinstance(table_stats, dict) else []
    top_affected = table_stats.get("top_affected", []) if isinstance(table_stats, dict) else []
    anomalous_tests_all = raw.get("anomalous_tests_all", []) if isinstance(raw, dict) else []
    if (not isinstance(anomalous_tests_all, list) or not anomalous_tests_all) and isinstance(table_stats, dict):
        anomalous_tests_all = table_stats.get("anomalous_tests_all", []) or []
    affected_pages_estimated = False
    if affected_pages == 0 and anomalies_count > 0:
        # Last-resort fallback for legacy payloads that do not include explicit affected pages.
        fallback_urls = {
            str(item.get("page_url") or "").strip()
            for item in top_affected
            if isinstance(item, dict) and str(item.get("page_url") or "").strip()
        }
        affected_pages = len(fallback_urls)
        affected_pages_estimated = bool(fallback_urls)
        if not affected_page_urls:
            affected_page_urls = sorted(fallback_urls)[:100]
    skipped_reason = raw.get("skipped_reason")
    enabled_raw = raw.get("enabled")
    # [A-2] Only use the table fallback when the summary JSON doesn't have an
    # explicit 'enabled' field. Never override an explicit enabled=false from DB.
    if enabled_raw is None:
        enabled = bool(tests_run > 0)
    else:
        enabled = bool(enabled_raw)
    if unique_transactional_forms_detected == 0 and forms_discovered > 0:
        unique_transactional_forms_detected = forms_discovered
    if unique_transactional_forms_tested == 0 and forms_tested > 0:
        unique_transactional_forms_tested = forms_tested

    if unique_transactional_forms_tested == 0:
        passed = None
        fuzzer_status = "non_evalue"
    else:
        passed = anomalies_count == 0
        fuzzer_status = "passing" if passed else "failing"

    return {
        "enabled": enabled,
        "skipped_reason": skipped_reason,
        "forms_discovered": forms_discovered,
        "total_forms_tested": forms_tested,
        "unique_transactional_forms_detected": unique_transactional_forms_detected,
        "unique_transactional_forms_tested": unique_transactional_forms_tested,
        "non_transactional_forms_tested": non_transactional_forms_tested,
        "tests_run": tests_run,
        "anomalies_count": anomalies_count,
        "suppressed_low_confidence_anomalies": suppressed_low_confidence_anomalies,
        "affected_pages": affected_pages,
        "affected_page_urls": affected_page_urls,
        "anomalous_tests_all": anomalous_tests_all if isinstance(anomalous_tests_all, list) else [],
        "anomalies_by_type": anomalies_by_type,
        "top_findings": top_findings,
        "top_affected": top_affected,
        "affected_pages_estimated": affected_pages_estimated,
        "duration_ms": int(raw.get("duration_ms", 0) or 0),
        "passed": passed,
        "status": fuzzer_status,
        "source": "summary" if has_summary else ("table" if tests_run > 0 else "none"),
    }


def evaluate_footer_rgpd_alignment(scan_id: str, scan_url: str, page_rows: list[dict]) -> dict:
    meta = get_scan_entry(scan_id) or {}
    if not meta.get("enable_visual_regression"):
        return {
            "status": "not_evaluated",
            "reason": "visual_regression_disabled",
        }

    baseline_scan_id = meta.get("visual_baseline_scan_id")
    if not baseline_scan_id:
        return {
            "status": "not_evaluated",
            "reason": "baseline_scan_id_missing",
        }

    import random as _random

    _RGPD_KEYWORDS = [
        "privacy", "confidential", "cookie", "rgpd", "gdpr",
        "mentions-legales", "legal", "politique-confidentialite",
        "politique-de-confidentialite", "donnees-personnelles",
        "personal-data", "terms", "conditions",
    ]

    # 1. Keyword-matched RGPD pages
    rgpd_urls: list[str] = []
    contact_urls: list[str] = []
    form_urls: list[str] = []
    outbound_counts: list[tuple[int, str]] = []

    for row in page_rows:
        u = row.get("url", "").strip()
        lower = u.lower()
        if any(k in lower for k in _RGPD_KEYWORDS):
            rgpd_urls.append(u)
        if "contact" in lower:
            contact_urls.append(u)
        # Pages with forms (inferred from non-zero form count or form indicator)
        if row.get("form_count", 0) or row.get("has_form"):
            form_urls.append(u)
        # Track outbound link counts to find likely sitemap/index page
        ext_links = int(row.get("external_links", 0) or 0)
        int_links = int(row.get("internal_links", 0) or 0)
        outbound_counts.append((ext_links + int_links, u))

    # 2. Page with most outbound links (likely index/sitemap)
    outbound_counts.sort(key=lambda x: x[0], reverse=True)
    high_outbound = [u for _, u in outbound_counts[:2]]

    # 3. Assemble candidate pool (deduplicated, keyword pages first)
    candidate_pool: list[str] = list(dict.fromkeys(rgpd_urls + contact_urls + form_urls + high_outbound))

    # 4. If fewer than 3 RGPD-keyword pages found, fill with random pages
    if len(rgpd_urls) < 3:
        all_page_urls = [row.get("url", "") for row in page_rows if row.get("url")]
        remaining = [u for u in all_page_urls if u not in candidate_pool]
        needed = max(3 - len(rgpd_urls), 0)
        sample = _random.sample(remaining, min(needed, len(remaining)))
        candidate_pool.extend(sample)

    # 5. Always include the homepage first, cap at 10
    if scan_url:
        candidate_pool.insert(0, scan_url)
    urls = list(dict.fromkeys(candidate_pool))[:10]

    if not urls:
        return {
            "status": "not_evaluated",
            "reason": "no_candidate_urls",
        }

    try:
        requests.post(
            f"{VISUAL_REGRESSION_API_URL}/screenshot",
            json={"scan_id": scan_id, "urls": urls, "max_pages": len(urls)},
            timeout=60,
        ).raise_for_status()

        compare_resp = requests.post(
            f"{VISUAL_REGRESSION_API_URL}/compare",
            json={"scan_id_baseline": baseline_scan_id, "scan_id_new": scan_id, "urls": urls},
            timeout=60,
        )
        compare_resp.raise_for_status()
        compare_data = compare_resp.json()
    except Exception as exc:
        return {
            "status": "not_available",
            "reason": f"visual_regression_call_failed: {exc}",
        }

    pages = compare_data.get("pages", [])
    diffs = [float(p.get("diff_pct", 0.0) or 0.0) for p in pages if p.get("status") in {"ok", "regression"}]
    max_diff = max(diffs) if diffs else 0.0
    avg_diff = round(sum(diffs) / len(diffs), 2) if diffs else 0.0
    passed = not bool(compare_data.get("overall_regression", False))
    return {
        "status": "evaluated",
        "passed": passed,
        "baseline_scan_id": baseline_scan_id,
        "urls_compared": len(pages),
        "avg_diff_pct": avg_diff,
        "max_diff_pct": max_diff,
        "details": pages,
    }


def evaluate_multi_browser_compatibility(scan_url: str) -> dict:
    def _extract_title(html: str) -> str:
        if not isinstance(html, str):
            return ""
        match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.IGNORECASE | re.DOTALL)
        if not match:
            return ""
        return re.sub(r"\s+", " ", match.group(1)).strip()

    def _normalize_title(title: str) -> str:
        token = re.sub(r"\s+", " ", str(title or "").strip().lower())
        token = re.sub(r"\d+", "", token)
        return token

    def _http_user_agent_fallback(url: str, root_reason: str) -> dict:
        profiles = [
            {
                "engine": "chromium_desktop",
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            },
            {
                "engine": "webkit_mobile",
                "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            },
            {
                "engine": "firefox_desktop",
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
            },
        ]

        def _fetch_profile(profile: dict) -> dict:
            snapshot = {
                "engine": profile["engine"],
                "status_code": None,
                "final_url": None,
                "title": "",
            }
            try:
                resp = requests.get(
                    url,
                    headers={
                        "User-Agent": profile["user_agent"],
                        "Accept": "text/html,application/xhtml+xml",
                        "Accept-Language": "en-US,en;q=0.9",
                    },
                    timeout=MULTI_BROWSER_FALLBACK_TIMEOUT,
                    allow_redirects=True,
                )
                snapshot["status_code"] = int(resp.status_code)
                snapshot["final_url"] = str(resp.url)
                snapshot["title"] = _extract_title(resp.text)
            except Exception as exc:
                snapshot["error"] = str(exc)
            return snapshot

        with ThreadPoolExecutor(max_workers=len(profiles)) as _pool:
            snapshots = list(_pool.map(_fetch_profile, profiles))

        successful = [
            item for item in snapshots
            if item.get("status_code") is not None and int(item.get("status_code", 0)) < 500
        ]
        if len(successful) < 2:
            return {
                "status": "not_available",
                "reason": root_reason,
                "fallback": "http_user_agent",
                "snapshots": snapshots,
            }

        normalized_titles = {
            _normalize_title(item.get("title"))
            for item in successful
            if _normalize_title(item.get("title"))
        }
        # HTTP user-agent snapshots are only diagnostic and must not produce
        # an evaluated compatibility verdict without real browser-engine diffing.
        return {
            "status": "not_available",
            "reason": f"visual_engine_comparison_unavailable: {root_reason}",
            "engines_observed": [item.get("engine") for item in successful],
            "title_variants": len(normalized_titles),
            "fallback": "http_user_agent",
            "snapshots": snapshots,
        }

    if not scan_url:
        return {
            "status": "not_available",
            "reason": "scan_url_missing",
        }
    try:
        resp = requests.post(
            f"{VISUAL_REGRESSION_API_URL}/browser-compat",
            json={"url": scan_url, "threshold_pct": 5.0},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        return _http_user_agent_fallback(scan_url, f"browser_compat_call_failed: {exc}")

    if data.get("status") != "evaluated":
        return _http_user_agent_fallback(scan_url, data.get("reason", "browser_compat_not_evaluated"))

    return {
        "status": "evaluated",
        "passed": bool(data.get("passed", False)),
        "diff_pct": float(data.get("diff_pct", 0.0) or 0.0),
        "threshold_pct": float(data.get("threshold_pct", 5.0) or 5.0),
        "engines": data.get("engines", ["chromium", "webkit"]),
        "browser_matrix": _safe_list(data.get("browser_matrix") or data.get("rows")),
        "rows": _safe_list(data.get("rows") or data.get("browser_matrix")),
    }


# ─── Phase N: UX 11-point checklist ──────────────────────────────────────────

def build_ux_checklist(site_metrics: dict, pages_count: int) -> list:
    """
    Phase N-1: Build the formal UX 11-point checklist.
    Each item: {"item": str, "passed": bool, "evidence": str}
    """
    ux   = site_metrics.get("ux", {})
    perf = site_metrics.get("performance", {})

    missing_product_imgs  = ux.get("pages_with_missing_product_images", 0)
    low_text_pages        = ux.get("pages_with_low_text_density", 0)
    raw_ip_kpi            = ux.get("raw_ip_link_kpi", {})
    email_kpi             = ux.get("plain_email_kpi", {})
    missing_links         = ux.get("pages_missing_contextual_links", 0)
    maps                  = ux.get("pages_with_maps", 0)
    simulators            = ux.get("simulator_count", 0)
    funnels               = ux.get("pages_with_conversion_funnels", 0)
    button_kpi            = perf.get("button_kpi", {})
    console_kpi           = perf.get("console_error_kpi", {})

    checklist = [
        {
            "item":     "Product cards all have images",
            "passed":   missing_product_imgs == 0,
            "evidence": f"{missing_product_imgs} page(s) have product cards missing images"
                        if missing_product_imgs else "All product card images present",
        },
        {
            "item":     "No low-content pages",
            "passed":   low_text_pages == 0,
            "evidence": f"{low_text_pages} page(s) have insufficient text density"
                        if low_text_pages else "All pages have adequate text density",
        },
        {
            "item":     "No raw IP address links",
            "passed":   raw_ip_kpi.get("passed", True),
            "evidence": f"{raw_ip_kpi.get('total_raw_ip_links', 0)} raw IP link(s) found on "
                        f"{raw_ip_kpi.get('pages_with_raw_ip_links', 0)} page(s)"
                        if not raw_ip_kpi.get("passed", True)
                        else "No raw IP address links found",
        },
        {
            "item":     "No plain email addresses exposed",
            "passed":   email_kpi.get("passed", True),
            "evidence": f"Plain emails found: {email_kpi.get('plain_emails_found', [])}"
                        if not email_kpi.get("passed", True)
                        else "No plain email addresses found",
        },
        {
            "item":     "Contextual internal links present",
            "passed":   missing_links < max(pages_count, 1),
            "evidence": f"{missing_links} page(s) lack contextual internal links"
                        if missing_links > 0
                        else "Contextual internal links found on all pages",
        },
        {
            "item":     "Map / location widget present",
            "passed":   maps > 0,
            "evidence": f"Map widget found on {maps} page(s)" if maps > 0 else "No map widget detected",
        },
        {
            "item":     "Simulator / calculator present",
            "passed":   simulators > 0,
            "evidence": f"Simulator found on {simulators} page(s)" if simulators > 0 else "No simulator detected",
        },
        {
            "item":     "Conversion funnel page present",
            "passed":   funnels > 0,
            "evidence": f"Funnel page found on {funnels} page(s)" if funnels > 0 else "No conversion funnel detected",
        },
        {
            "item":     "Text / content ratio adequate across pages",
            "passed":   low_text_pages == 0,
            "evidence": f"{low_text_pages} page(s) have low text-to-HTML ratio"
                        if low_text_pages else "All pages have adequate content ratio",
        },
        {
            "item":     "No non-functional buttons",
            "passed":   button_kpi.get("passed", True),
            "evidence": f"{button_kpi.get('pages_with_nonfunc_buttons', 0)} page(s) have non-functional buttons"
                        if not button_kpi.get("passed", True)
                        else "All detected buttons appear functional",
        },
        {
            "item":     "No JavaScript console errors on homepage",
            "passed":   console_kpi.get("homepage_console_error_count", 0) == 0,
            "evidence": f"{console_kpi.get('homepage_console_error_count', 0)} console error(s): "
                        f"{console_kpi.get('homepage_console_errors', [])[:3]}"
                        if console_kpi.get("homepage_console_error_count", 0) > 0
                        else "Homepage has no console errors",
        },
    ]
    return checklist


# ─── Phase N: RGPD 11-point checklist ────────────────────────────────────────

def build_rgpd_checklist(domain_analysis: dict, site_metrics: dict | None = None) -> list:
    """
    Phase N-2: Build the formal RGPD 11-point checklist.
    Each item: {"item": str, "passed": bool, "evidence": str}
    """
    priv_kpi  = domain_analysis.get("privacy_kpi", {})
    priv_raw  = domain_analysis.get("privacy", {})
    cookie_kpi = domain_analysis.get("cookie_kpi", {})
    exp_kpi    = domain_analysis.get("exposed_path_kpi", {})

    # Cookie consent: can be a dict {"has_banner": bool, ...} or a bool
    consent_raw = priv_kpi.get("cookie_consent", {})
    if isinstance(consent_raw, dict):
        has_consent_banner = consent_raw.get("has_banner", consent_raw.get("present", False))
    else:
        has_consent_banner = bool(consent_raw)

    # BL-01: Fallback to NLP CMP detection if Go static crawl missed the JS-injected banner
    cmp_nlp_detected = False
    if not has_consent_banner and site_metrics and site_metrics.get("pages_evaluated"):
        for p in site_metrics.get("pages_evaluated", []):
            nlp_res = p.get("nlp_results", {}) or {}
            if isinstance(nlp_res, dict) and nlp_res.get("cmp_detected"):
                cmp_nlp_detected = True
                break

    # Normalize all CMP signals into a single authoritative field `cmp_present`.
    # This eliminates contradictory signals when main.py injects cmp_nlp_detected
    # but classifier.py only reads has_banner/present/detected.
    consent_dict = priv_kpi.get("cookie_consent", {})
    if not isinstance(consent_dict, dict):
        consent_dict = {}
    cmp_present = bool(
        has_consent_banner
        or cmp_nlp_detected
        or consent_dict.get("cmp_nlp_detected")
        or consent_dict.get("detected")
        or consent_dict.get("present")
    )
    normalized_consent = {
        **consent_dict,
        "has_banner": has_consent_banner,
        "cmp_nlp_detected": cmp_nlp_detected or bool(consent_dict.get("cmp_nlp_detected")),
        "cmp_present": cmp_present,
        "source": consent_dict.get("source", "nlp" if cmp_nlp_detected else "scanner"),
    }
    priv_kpi["cookie_consent"] = normalized_consent
    domain_analysis.setdefault("privacy", {})["cookie_consent"] = normalized_consent

    rgpd_keywords_raw = priv_raw.get("rgpd_keywords", []) or []
    rgpd_keywords_found = [k for k in rgpd_keywords_raw if isinstance(k, dict) and k.get("found", False)]
    rgpd_keywords_found_names = [k.get("keyword", "") for k in rgpd_keywords_found]
    rgpd_keywords_all_names = [k.get("keyword", "") for k in rgpd_keywords_raw if isinstance(k, dict) and k.get("keyword")]
    rgpd_checked_total = len(rgpd_keywords_all_names)
    rgpd_found_total = len(rgpd_keywords_found_names)
    rgpd_missing_total = max(rgpd_checked_total - rgpd_found_total, 0)
    rgpd_found_preview = rgpd_keywords_found_names[:10]
    rgpd_all_preview = rgpd_keywords_all_names[:10]
    rgpd_remaining_found = max(rgpd_found_total - len(rgpd_found_preview), 0)

    checklist = [
        {
            "item":     "Cookie consent banner present",
            "passed":   bool(has_consent_banner),
            "evidence": "Cookie consent banner detected" if has_consent_banner
                        else "No cookie consent banner found",
        },
        {
            "item":     "Privacy policy link present",
            "passed":   bool(priv_kpi.get("has_privacy_policy")),
            "evidence": "Privacy policy link found" if priv_kpi.get("has_privacy_policy")
                        else "No privacy policy link detected",
        },
        {
            "item":     "Legal notice link present",
            "passed":   bool(priv_kpi.get("has_legal_notice")),
            "evidence": "Legal notice link found" if priv_kpi.get("has_legal_notice")
                        else "No legal notice link detected",
        },
        {
            "item":     "Cookie policy link present",
            "passed":   bool(priv_kpi.get("has_cookie_policy")),
            "evidence": "Cookie policy link found" if priv_kpi.get("has_cookie_policy")
                        else "No cookie policy link detected",
        },
        {
            "item":     "Security policy (PSSI) link present",
            "passed":   bool(priv_kpi.get("has_security_policy")),
            "evidence": "Security policy link found" if priv_kpi.get("has_security_policy")
                        else "No security policy link detected",
        },
        {
            "item":     "Data subject rights (information rights) mentioned",
            "passed":   bool(priv_kpi.get("has_information_rights")),
            "evidence": "Information rights language found" if priv_kpi.get("has_information_rights")
                        else "No information rights language detected",
        },
        {
            "item":     "Consent checkbox present on forms",
            "passed":   bool(priv_kpi.get("has_consent_checkbox")),
            "evidence": "Consent checkbox detected on form(s)" if priv_kpi.get("has_consent_checkbox")
                        else "No consent checkbox detected",
        },
        {
            "item":     "Finalité déclarée",
            "passed":   bool(priv_kpi.get("has_declared_purpose")),
            "evidence": "Finalité du traitement détectée" if priv_kpi.get("has_declared_purpose")
                        else "Aucune déclaration explicite de finalité détectée",
        },
        {
            "item":     "RGPD / GDPR keywords present on privacy page",
            "passed":   len(rgpd_keywords_found) > 3,
            "evidence": (
                f"RGPD rights keywords confirmed: {rgpd_found_total}/{rgpd_checked_total}. "
                f"Found sample: {rgpd_found_preview}"
                f"{' (+ ' + str(rgpd_remaining_found) + ' more found)' if rgpd_remaining_found > 0 else ''}"
                if len(rgpd_keywords_found) > 3
                else f"Only {rgpd_found_total} RGPD rights keyword(s) confirmed present "
                     f"(need > 3). Missing: {rgpd_missing_total}. Checked sample: {rgpd_all_preview}"
            ),
        },
        {
            "item":     "No tracking scripts without explicit consent",
            "passed":   not bool(priv_raw.get("tracking_without_consent", False)),
            "evidence": "No tracking scripts without consent detected"
                        if not priv_raw.get("tracking_without_consent", False)
                        else "Tracking scripts without consent detected",
        },
        {
            "item":     "All cookies have HttpOnly + Secure flags",
            "passed":   bool(cookie_kpi.get("passed", True)),
            "evidence": f"{cookie_kpi.get('missing_cookie_flag_count', 0)} cookie(s) missing flags: "
                        f"{cookie_kpi.get('cookies_with_missing_flags', [])[:3]}"
                        if not cookie_kpi.get("passed", True)
                        else "All cookies have required security flags",
        },
        {
            "item":     "No exposed sensitive paths (Google Dorks)",
            "passed":   bool(exp_kpi.get("passed", True)),
            "evidence": f"{exp_kpi.get('google_dorks_vuln_count', 0)} exposed path(s): "
                        f"{exp_kpi.get('exposed_paths', [])[:3]}"
                        if not exp_kpi.get("passed", True)
                        else "No sensitive paths exposed",
        },
        # Gap #38: data charter
        {
            "item":     "Charte de donn\u00e9es pr\u00e9sente",
            "passed":   bool(priv_raw.get("has_data_charter", False)),
            "evidence": f"Charte trouv\u00e9e: {priv_raw.get('data_charter_url', '')}"
                        if priv_raw.get("has_data_charter", False)
                        else "Aucune charte de donn\u00e9es (charte des donn\u00e9es / data charter) d\u00e9tect\u00e9e",
        },
    ]

    # Gap #41 and #42 — NLP-derived RGPD signal pages (optional; 0 when not provided)
    content_metrics = (site_metrics or {}).get("content", {})
    retention_pages = content_metrics.get("rgpd_retention_signal_pages", 0)
    minimization_pages = content_metrics.get("rgpd_minimization_signal_pages", 0)

    checklist.append({
        "id":      "rgpd_data_retention",
        "item":    "Dur\u00e9e de conservation mentionn\u00e9e",
        "passed":  retention_pages > 0,
        "evidence": f"{retention_pages} page(s) mentionnent la dur\u00e9e de conservation"
                    if retention_pages > 0
                    else "Dur\u00e9e de conservation des donn\u00e9es non mentionn\u00e9e",
    })
    checklist.append({
        "id":      "rgpd_data_minimization",
        "item":    "Minimisation des donn\u00e9es mentionn\u00e9e",
        "passed":  minimization_pages > 0,
        "evidence": f"{minimization_pages} page(s) abordent la minimisation des donn\u00e9es"
                    if minimization_pages > 0
                    else "Minimisation des donn\u00e9es (art. 5(1)(c) RGPD) non mentionn\u00e9e",
    })

    return checklist


def _safe_list(value) -> list:
    if isinstance(value, list):
        return value
    return []


def _safe_dict(value) -> dict:
    if isinstance(value, dict):
        return value
    return {}


def _evidence_snippet(value, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(limit - 1, 0)].rstrip() + "..."


def _status_from_bool(value) -> str:
    if value is None:
        return "not_available"
    return "passing" if bool(value) else "failing"


def _kpi(kpi_name: str, status: str, evidence: dict, kpi_type: str, axis: str, client_impact: Optional[str]) -> dict:
    return {
        "kpi_name": kpi_name,
        "status": status,
        "evidence": evidence if isinstance(evidence, dict) else {"summary": "Evidence could not be normalized"},
        "type": kpi_type,
        "axis": axis,
        "client_impact": client_impact,
    }


def _issue_lookup(issues: dict, axis: str, contains: str) -> dict:
    axis_issues = _safe_list((issues or {}).get(axis.lower()))
    needle = contains.lower()
    for issue in axis_issues:
        text = str(issue.get("issue", ""))
        if needle in text.lower():
            return issue
    return {}


def _all_pages_or_note(pages: list, total_count: Optional[int] = None) -> tuple[list, Optional[str]]:
    cleaned = [p for p in pages if p]
    note = None
    if total_count is not None and total_count > len(cleaned):
        remaining = total_count - len(cleaned)
        note = f"{remaining} additional pages were affected but were not enumerated in the aggregated scan output"
    return cleaned, note


def _grade_metric(value, green, yellow, higher_is_better: bool = False) -> str:
    if value is None:
        return "red"
    if higher_is_better:
        if value >= green:
            return "green"
        if value >= yellow:
            return "yellow"
        return "red"
    if value < green:
        return "green"
    if value < yellow:
        return "yellow"
    return "red"


def _extract_image_issue_path(text: str) -> str:
    match = re.search(r"Non-optimized image format detected:\s*(.+?)\s*\(", text or "")
    return match.group(1).strip() if match else text or "Unknown image"


def _normalize_header_rows(headers: list, missing_headers: list) -> list:
    rows = []
    present_map = {}
    for header in _safe_list(headers):
        if not isinstance(header, dict):
            continue
        name = str(header.get("header", "")).strip()
        if not name:
            continue
        present_map[name.lower()] = header

    required_headers = [
        "Strict-Transport-Security",
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
    ]
    for name in required_headers:
        data = present_map.get(name.lower())
        if data:
            row = {
                "header": name,
                "value": data.get("value"),
                "status": "present",
            }
            value = str(data.get("value") or "")
            if name == "Content-Security-Policy" and "unsafe-inline" in value:
                row["warning"] = "CSP includes unsafe-inline, which weakens protection against inline script injection"
            rows.append(row)
        elif name in _safe_list(missing_headers):
            rows.append({
                "header": name,
                "value": None,
                "status": "missing",
                "risk": f"Missing {name} reduces baseline browser-enforced protection",
                "fix": f"Set the {name} response header at the reverse proxy or application layer",
            })
    for name in _safe_list(missing_headers):
        if name not in required_headers:
            rows.append({
                "header": name,
                "value": None,
                "status": "missing",
                "risk": f"Missing {name} was flagged by the scanner",
                "fix": f"Add the {name} header where HTTP security headers are configured",
            })
    return rows


def _technology_rows(tech: dict, cms_kpi: dict) -> list:
    rows = []
    seen = set()
    for item in _safe_list(tech.get("stack")):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "Unknown")
        version = item.get("version")
        category = item.get("category") or "unknown"
        key = (name, version, category)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "name": name,
            "version": version,
            "category": category,
            "source": item.get("source"),
        })

    server_tech = cms_kpi.get("server_tech")
    server_version = cms_kpi.get("server_version")
    if server_tech and (server_tech, server_version, "server") not in seen:
        rows.append({
            "name": server_tech,
            "version": server_version or None,
            "category": "server",
            "source": "headers",
        })
    return rows


def _tracking_tools_from_stack(stack: list) -> list:
    tools = []
    for item in _safe_list(stack):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "")
        category = str(item.get("category") or "")
        lower = name.lower()
        if "tag manager" in lower or "analytics" in lower or category == "analytics":
            tools.append(name)
    return list(dict.fromkeys(tools))


def _find_privacy_link(links: list, link_type: str) -> Optional[str]:
    for link in _safe_list(links):
        if isinstance(link, dict) and link.get("type") == link_type:
            return link.get("url")
    return None


def _build_normalized_kpis(report: dict, context: dict) -> list:
    from datetime import date

    site_metrics = _safe_dict(report.get("site_metrics"))
    domain_analysis = _safe_dict(report.get("domain_analysis"))
    issues = _safe_dict(report.get("issues"))
    headless_sample = _safe_list(report.get("headless_sample"))
    image_compression = _safe_dict(report.get("image_compression"))

    seo = _safe_dict(site_metrics.get("seo"))
    perf = _safe_dict(site_metrics.get("performance"))
    ux = _safe_dict(site_metrics.get("ux"))
    content = _safe_dict(site_metrics.get("content"))
    security = _safe_dict(domain_analysis.get("security"))
    privacy = _safe_dict(domain_analysis.get("privacy"))
    functional = _safe_dict(domain_analysis.get("functional"))
    functional_fuzzer = _safe_dict(domain_analysis.get("functional_fuzzer_kpi"))
    cms_kpi = _safe_dict(domain_analysis.get("cms_kpi"))
    cookie_kpi = _safe_dict(domain_analysis.get("cookie_kpi"))
    exposed_path_kpi = _safe_dict(domain_analysis.get("exposed_path_kpi"))
    vulnerability_kpi = _safe_dict(domain_analysis.get("vulnerability_kpi"))

    privacy_links = _safe_list(privacy.get("privacy_links"))
    tech_stack = _safe_list(_safe_dict(domain_analysis.get("tech")).get("stack"))
    tracking_tools = _tracking_tools_from_stack(tech_stack)

    seo_missing_meta_issue = _issue_lookup(issues, "seo", "Missing meta description")
    seo_heading_issue = _issue_lookup(issues, "seo", "Invalid heading hierarchy")
    ux_contextual_issue = _issue_lookup(issues, "ux", "Missing contextual internal links")
    ux_menu_issue = _issue_lookup(issues, "ux", "Menu structure issues")
    ux_missing_image_issue = _issue_lookup(issues, "ux", "cards without images")

    homepage_sample = headless_sample[0] if headless_sample else {}
    worst_lcp_pages = sorted(
        [row for row in headless_sample if row.get("lcp_ms") is not None],
        key=lambda row: float(row.get("lcp_ms") or 0.0),
        reverse=True,
    )[:3]

    image_issue_groups = []
    for issue in sorted(_safe_list(issues.get("seo")), key=lambda item: int(item.get("count", 0) or 0), reverse=True):
        text = str(issue.get("issue", ""))
        if "Non-optimized image format" not in text:
            continue
        item = {
            "name": _extract_image_issue_path(text),
            "count": int(issue.get("count", 0) or 0),
            "example_urls": _safe_list(issue.get("example_urls"))[:3],
            "note": "High ROI asset: this image appears on 50+ pages and should be converted to WebP or AVIF first"
                    if int(issue.get("count", 0) or 0) >= 50 else "Legacy raster asset detected in a non-modern format",
            "fix": "Convert the asset to WebP or AVIF and update the Drupal/media template to serve the optimized variant",
        }
        image_issue_groups.append(item)

    email_items = []
    for issue in _safe_list(issues.get("ux")):
        text = str(issue.get("issue", ""))
        prefix = "Email address found without mailto link: "
        if not text.startswith(prefix):
            continue
        email = text.replace(prefix, "", 1).strip()
        item = {
            "name": email,
            "pages_affected": int(issue.get("count", 0) or 0),
            "example_page": (_safe_list(issue.get("example_urls")) or [None])[0],
            "note": "Address is visible as plain text and should be wrapped in a mailto link",
        }
        if email.endswith("Suivez") or " " in email:
            item["note"] = "Malformed email token suggests a template concatenation or rendering bug"
            item["risk"] = "Visitors may copy an invalid address and the malformed token exposes a content rendering defect"
        email_items.append(item)

    raw_ip_items = []
    for page_url in _safe_list(context.get("raw_ip_page_urls")):
        raw_ip_items.append({
            "name": page_url,
            "note": "This page contains at least one raw IP-based link target according to the UX scan",
            "fix": "Replace raw IP links with canonical hostnames and update the source content or template",
        })

    menu_items = []
    menu_pages = []
    for page_url, page_issues in _safe_dict(context.get("menu_issue_map")).items():
        menu_pages.append(page_url)
        menu_items.append({
            "name": page_url,
            "note": "; ".join(_safe_list(page_issues)) or "Menu structure issue detected",
        })

    seo_avg = seo.get("avg_score")
    seo_avg_status = "not_available" if seo_avg is None else ("passing" if float(seo_avg) >= 80 else "failing")
    seo_avg_evidence = {
        "summary": "Average SEO score was not available in this scan" if seo_avg is None else f"Average SEO score is {seo_avg}/100",
        "metric": seo_avg,
        "unit": "score",
        "threshold": {"green": "≥ 80", "yellow": "≥ 60", "red": "< 60"},
        "current_grade": _grade_metric(float(seo_avg) if seo_avg is not None else None, 80, 60, higher_is_better=True),
        "warning": "This KPI was not evaluated in this scan" if seo_avg is None else "Average score can hide severe page-level SEO defects that still affect search entry pages",
    }
    if seo_avg_status == "failing":
        seo_avg_evidence["fix"] = "Prioritize pages missing metadata, broken links, and image format issues before re-running the crawl"

    broken_link_kpi = _safe_dict(seo.get("broken_link_kpi"))
    broken_links = _safe_list(broken_link_kpi.get("broken_links"))
    broken_link_items = []
    for link in broken_links:
        if not isinstance(link, dict):
            continue
        status_code = link.get("status_code")
        broken_link_items.append({
            "name": link.get("url"),
            "status_code": status_code,
            "error": link.get("error"),
            "found_on": link.get("found_on"),
            "anchor_text": link.get("anchor_text"),
            "note": "Homepage or key navigation link is returning an error" if link.get("found_on") == report.get("domain") else "Broken destination discovered during crawl",
            "fix": "Update the href target or restore the destination URL so the link returns a 200 response",
        })

    meta_pages, meta_note = _all_pages_or_note(_safe_list(context.get("seo_missing_meta_pages")), int(seo.get("pages_missing_meta_desc", 0) or 0))
    title_pages, title_note = _all_pages_or_note(_safe_list(context.get("seo_missing_title_pages")), int(seo.get("pages_missing_title", 0) or 0))
    alt_pages, alt_note = _all_pages_or_note(_safe_list(context.get("seo_missing_alt_pages")), len(_safe_list(context.get("seo_missing_alt_pages"))))
    heading_pages, heading_note = _all_pages_or_note(
        list(dict.fromkeys(_safe_list(context.get("seo_bad_heading_pages")) + _safe_list(seo_heading_issue.get("example_urls")))),
        int(seo_heading_issue.get("count", 0) or len(_safe_list(context.get("seo_bad_heading_pages"))))
    )
    nonfunc_pages, nonfunc_note = _all_pages_or_note(_safe_list(context.get("nonfunc_button_page_urls")), int(perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0) or 0))
    nonfunc_button_items = []
    for item in _safe_list(_safe_dict(perf.get("button_kpi")).get("broken_buttons"))[:50]:
        if not isinstance(item, dict):
            continue
        nonfunc_button_items.append({
            "name": item.get("label") or "(unnamed)",
            "url": item.get("url"),
            "selector": item.get("selector"),
            "issue_type": item.get("issue_type"),
            "note": f"{item.get('tag') or 'element'} flagged as {item.get('issue_type') or 'non_functional'}",
            "fix": "Bind this element to a real href/click handler or remove the dead control",
        })
    missing_contextual_pages, contextual_note = _all_pages_or_note(
        _safe_list(context.get("missing_contextual_link_pages")),
        int(ux.get("pages_missing_contextual_links", 0) or 0),
    )
    missing_product_pages, product_note = _all_pages_or_note(
        list(dict.fromkeys(_safe_list(context.get("missing_product_image_pages")) + _safe_list(ux_missing_image_issue.get("example_urls")))),
        int(ux.get("pages_with_missing_product_images", 0) or 0),
    )
    keyword_stuffing_pages, stuffing_note = _all_pages_or_note(
        _safe_list(context.get("keyword_stuffing_pages")),
        int(content.get("pages_with_keyword_stuffing", 0) or 0),
    )

    duplicate_kpi = _safe_dict(seo.get("duplicate_content_kpi"))
    multi_browser = _safe_dict(seo.get("multi_browser_compatibility"))
    social_kpi = _safe_dict(seo.get("social_sharing_kpi"))
    mobile_kpi = _safe_dict(perf.get("mobile_kpi"))
    footer_rgpd = _safe_dict(ux.get("footer_rgpd_alignment_kpi"))
    freshness_kpi = _safe_dict(content.get("freshness_kpi"))
    typo_detection = _safe_dict(content.get("typo_detection"))
    audience_segments = _safe_dict(content.get("audience_segments"))

    latest_pub_date = freshness_kpi.get("latest_pub_date")
    freshness_anomaly = None
    if latest_pub_date:
        try:
            year = int(str(latest_pub_date).split("-", 1)[0])
            if year > 2100 or year < 1990:
                freshness_anomaly = year
        except (TypeError, ValueError):
            freshness_anomaly = None

    ssl = _safe_dict(security.get("ssl"))
    expiry = ssl.get("expiry")
    days_remaining = None
    if expiry:
        try:
            days_remaining = (date.fromisoformat(str(expiry)) - date.today()).days
        except ValueError:
            days_remaining = None

    cookies_with_missing_flags = _safe_list(cookie_kpi.get("cookies_with_missing_flags"))
    cookie_items = []
    for item in cookies_with_missing_flags:
        if isinstance(item, dict):
            name = item.get("name") or item.get("cookie") or "Unknown cookie"
            cookie_items.append({
                "name": name,
                "note": item.get("note") or "Cookie is missing one or more security attributes",
                "risk": item.get("risk") or "Missing Secure or HttpOnly flags increases session theft and downgrade risks",
                "fix": item.get("fix") or "Set Secure and HttpOnly on the cookie at the application or reverse proxy layer",
            })
        else:
            cookie_items.append({
                "name": str(item),
                "note": "Cookie is missing one or more required flags",
                "risk": "Cookies without Secure and HttpOnly are easier to steal or expose to client-side scripts",
                "fix": "Update the cookie configuration to emit Secure and HttpOnly attributes",
            })

    exposed_path_items = []
    for path in _safe_list(exposed_path_kpi.get("exposed_paths")):
        exposed_path_items.append({
            "name": path,
            "note": "Sensitive or internal file is directly reachable by URL",
            "risk": "Public exposure of internal files can leak source, credentials, or deployment metadata",
            "fix": "Block this path at Apache or the reverse proxy and remove the file from the public web root if not meant to be public",
        })

    module_versions = _safe_list(cms_kpi.get("module_versions"))
    cve_severity = _safe_dict(cms_kpi.get("cve_severity"))
    cve_total = sum(int(cve_severity.get(level, 0) or 0) for level in ("critical", "high", "medium", "low"))

    rgpd_keywords = _safe_list(privacy.get("rgpd_keywords"))
    found_keywords = [item.get("keyword") for item in rgpd_keywords if isinstance(item, dict) and item.get("found")]
    missing_keywords = [item.get("keyword") for item in rgpd_keywords if isinstance(item, dict) and not item.get("found")]
    forms = _safe_list(functional.get("forms"))
    form_types = [form.get("type") for form in forms if isinstance(form, dict) and form.get("type")]

    fuzzer_tests_run = int(functional_fuzzer.get("tests_run", 0) or 0)
    fuzzer_anomalies = int(functional_fuzzer.get("anomalies_count", 0) or 0)
    fuzzer_enabled = functional_fuzzer.get("enabled")
    if fuzzer_tests_run <= 0:
        fuzzer_status = "not_available"
    else:
        fuzzer_status = "passing" if fuzzer_anomalies == 0 else "failing"

    typo_tokens = [str(token) for token in _safe_list(typo_detection.get("sample_tokens"))]
    typo_warning = None
    if any(any(ch in token for ch in "àâçéèêëîïôûùüÿœæ") for token in typo_tokens) or any(token.lower() in {"biat", "tunisie", "tunisienne", "arabe"} for token in typo_tokens):
        typo_warning = "Sample typo tokens include French, brand, or domain-specific terms; manual review is required before correcting content automatically"

    invisible_counts = [int(row.get("invisible_links", 0) or 0) for row in headless_sample if row.get("invisible_links") is not None]
    invisible_systematic = bool(invisible_counts) and len(set(invisible_counts)) == 1

    kpis = [
        _kpi("Average SEO Score", seo_avg_status, seo_avg_evidence, "recommendation", "SEO", "Low SEO quality reduces discoverability and weakens the visibility of high-value pages in search results"),
        _kpi("Broken Links", "passing" if int(broken_link_kpi.get("broken_link_count", 0) or 0) == 0 else "failing", {
            "summary": "No broken links were found" if int(broken_link_kpi.get("broken_link_count", 0) or 0) == 0 else f"{int(broken_link_kpi.get('broken_link_count', 0) or 0)} broken links found across the site",
            "items": broken_link_items,
            **({"fix": "Repair or remove each broken URL, then re-crawl the affected templates and navigation links"} if broken_link_items else {}),
        }, "bug", "SEO", "Broken links damage crawl quality and send visitors into dead ends on key journeys"),
        _kpi("Missing Meta Descriptions", "passing" if int(seo.get("pages_missing_meta_desc", 0) or 0) == 0 else "failing", {
            "summary": "All pages have meta descriptions" if int(seo.get("pages_missing_meta_desc", 0) or 0) == 0 else f"{int(seo.get('pages_missing_meta_desc', 0) or 0)} pages are missing a meta description",
            "affected_pages": meta_pages or _safe_list(seo_missing_meta_issue.get("example_urls")),
            **({"fix": "Add a unique meta description in the Drupal SEO fields for each affected page"} if int(seo.get("pages_missing_meta_desc", 0) or 0) > 0 else {}),
            **({"note": meta_note} if meta_note else {}),
        }, "recommendation", "SEO", "Missing meta descriptions reduce click-through rate because search snippets become generic or auto-generated"),
        _kpi("Missing Page Titles", "passing" if int(seo.get("pages_missing_title", 0) or 0) == 0 else "failing", {
            "summary": "All pages have a title tag" if int(seo.get("pages_missing_title", 0) or 0) == 0 else f"{int(seo.get('pages_missing_title', 0) or 0)} pages are missing a title tag",
            "affected_pages": title_pages,
            **({"fix": "Populate the HTML title field for each affected page in the CMS or template"} if int(seo.get("pages_missing_title", 0) or 0) > 0 else {}),
            **({"note": title_note} if title_note else {}),
        }, "bug", "SEO", "Missing title tags make search results ambiguous and reduce the relevance of landing pages"),
        _kpi("Images Missing Alt Text", "passing" if int(seo.get("images_missing_alt", 0) or 0) == 0 else "failing", {
            "summary": "All scanned images include alt text" if int(seo.get("images_missing_alt", 0) or 0) == 0 else f"{int(seo.get('images_missing_alt', 0) or 0)} images are missing alt text across {len(alt_pages)} page(s)",
            "affected_pages": alt_pages,
            **({"fix": "Add meaningful alt attributes to editorial and functional images in the CMS media library"} if int(seo.get("images_missing_alt", 0) or 0) > 0 else {}),
            **({"note": alt_note} if alt_note else {}),
        }, "recommendation", "SEO", "Images without alt text reduce accessibility and waste image search visibility opportunities"),
        _kpi("Heading Hierarchy", "passing" if bool(_safe_dict(seo.get("homepage_h1_kpi")).get("passed", True)) and not seo_heading_issue else "failing", {
            "summary": "Heading hierarchy is valid on sampled pages" if bool(_safe_dict(seo.get("homepage_h1_kpi")).get("passed", True)) and not seo_heading_issue else f"{int(seo_heading_issue.get('count', 0) or len(heading_pages))} pages have invalid heading hierarchy",
            "affected_pages": heading_pages,
            **({"note": ((heading_note + ". ") if heading_note else "") + "The homepage is affected and should be fixed first"} if report.get("domain") in heading_pages else ({"note": heading_note} if heading_note else {})),
            **({"fix": "Ensure each page outputs exactly one H1 and that lower-level headings follow a logical nesting order"} if heading_pages or seo_heading_issue else {}),
        }, "recommendation", "SEO", "Broken heading structure weakens topical clarity for search engines and makes pages harder to scan for users"),
        _kpi("Duplicate Content", _status_from_bool(duplicate_kpi.get("passed")), {
            "summary": f"Duplicate content rate is {duplicate_kpi.get('duplicate_content_rate_pct', 0)}% across {duplicate_kpi.get('duplicate_page_count', 0)} page(s)",
            "metric": duplicate_kpi.get("duplicate_content_rate_pct", 0),
            "unit": "%",
            "threshold": {"green": "0%", "yellow": "< 5%", "red": "≥ 5%"},
            "current_grade": _grade_metric(float(duplicate_kpi.get("duplicate_content_rate_pct", 0) or 0), 0.000001, 5),
            "warning": "Site-wide duplication can be understated if template-heavy pages were outside the sampled set",
            **({"fix": "Consolidate duplicate pages with canonicals, redirects, or differentiated copy"} if not duplicate_kpi.get("passed", False) else {}),
        }, "recommendation", "SEO", "Duplicate content splits ranking signals and makes it harder for search engines to choose the right landing page"),
        _kpi("Sitemap Present", _status_from_bool(seo.get("has_sitemap")), {
            "summary": "XML sitemap detected" if seo.get("has_sitemap") else "No XML sitemap was detected",
            "detail": {"detected": bool(seo.get("has_sitemap"))},
            **({"fix": "Publish a sitemap.xml file and reference it in robots.txt"} if not seo.get("has_sitemap") else {}),
        }, "recommendation", "SEO", "Without a sitemap, search engines discover deep pages less reliably and indexing becomes slower"),
        _kpi("Robots.txt Present", _status_from_bool(seo.get("has_robots_txt")), {
            "summary": "robots.txt detected" if seo.get("has_robots_txt") else "robots.txt was not detected",
            "detail": {"detected": bool(seo.get("has_robots_txt"))},
            **({"fix": "Add a robots.txt file at the site root and declare crawl rules plus the sitemap location"} if not seo.get("has_robots_txt") else {}),
        }, "recommendation", "SEO", "Missing robots.txt leaves crawl guidance implicit and can lead to avoidable indexing inefficiencies"),
        _kpi("Image Format Optimization", "passing" if not image_issue_groups else "failing", {
            "summary": "All image issues are served in optimized formats" if not image_issue_groups else f"{len(image_issue_groups)} non-optimized image assets were identified in the SEO issue set",
            "items": image_issue_groups,
            **({"fix": "Convert repeated PNG/JPEG assets to WebP or AVIF and update Drupal image styles to emit optimized derivatives"} if image_issue_groups else {}),
        }, "recommendation", "SEO", "Heavy legacy image formats slow pages down and consume bandwidth on repeated template assets"),
        _kpi("Social Sharing Tags", _status_from_bool(social_kpi.get("passed")), {
            "summary": f"Average social sharing score is {social_kpi.get('avg_social_sharing_score', 0.0)}/100 across {social_kpi.get('pages_with_social_sharing', 0)} pages with detected sharing signals",
            "metric": social_kpi.get("avg_social_sharing_score", 0.0),
            "unit": "score",
            "threshold": {"green": "≥ 70", "yellow": "≥ 40", "red": "< 40"},
            "current_grade": _grade_metric(float(social_kpi.get("avg_social_sharing_score", 0.0) or 0.0), 70, 40, higher_is_better=True),
            "warning": "Missing Open Graph and Twitter metadata causes low-quality previews when pages are shared in social or messaging apps",
            **({"fix": "Add og:type, core Open Graph fields, and twitter:card metadata in the page head templates"} if not social_kpi.get("passed", False) else {}),
        }, "recommendation", "SEO", "Poor social metadata reduces click-through from shared links and weakens campaign distribution quality"),
        _kpi("Multi-Browser Compatibility", "not_available" if multi_browser.get("status") == "not_available" else _status_from_bool(multi_browser.get("passed")), {
            "summary": "Multi-browser compatibility test could not be run" if multi_browser.get("status") == "not_available" else ("Chromium and WebKit rendered consistently" if multi_browser.get("passed") else "Cross-browser visual differences exceeded the allowed threshold"),
            **({"reason": multi_browser.get("reason", "This KPI was not evaluated in this scan")} if multi_browser.get("status") == "not_available" else {"detail": {"diff_pct": multi_browser.get("diff_pct"), "threshold_pct": multi_browser.get("threshold_pct"), "engines": multi_browser.get("engines")}}),
            **({"fix": "Repair the Playwright/browser dependencies and rerun browser compatibility tests"} if multi_browser.get("status") == "not_available" else ({"fix": "Compare the Chromium and WebKit render trees and repair CSS or JS logic that diverges between engines"} if not multi_browser.get("passed", False) else {})),
        }, "recommendation", "SEO", "Browser-specific rendering defects can break discovery paths and form submissions for a portion of visitors"),

        _kpi("First Contentful Paint", "not_available" if perf.get("avg_fcp_ms") is None else ("passing" if float(perf.get("avg_fcp_ms") or 0) < 1800 else "failing"), {
            "summary": "First Contentful Paint was not available in this scan" if perf.get("avg_fcp_ms") is None else f"Average FCP is {perf.get('avg_fcp_ms')}ms",
            "metric": perf.get("avg_fcp_ms"),
            "unit": "ms",
            "threshold": {"green": "< 1800ms", "yellow": "< 3000ms", "red": "≥ 3000ms"},
            "current_grade": _grade_metric(float(perf.get("avg_fcp_ms") or 0) if perf.get("avg_fcp_ms") is not None else None, 1800, 3000),
            "homepage_fcp_ms": homepage_sample.get("fcp_ms"),
            "warning": "Homepage FCP is significantly worse than the average and should be prioritized" if homepage_sample.get("fcp_ms") and float(homepage_sample.get("fcp_ms") or 0) > 2000 and float(perf.get("avg_fcp_ms") or 0) < 1800 else "No homepage-vs-average FCP gap was detected in sampled pages",
            **({"fix": "Reduce render-blocking CSS/JS and optimize above-the-fold assets on the homepage"} if perf.get("avg_fcp_ms") is not None and float(perf.get("avg_fcp_ms") or 0) >= 1800 else {}),
        }, "performance", "Performance", "Slow first paint makes the site feel unresponsive and increases abandonment on entry pages"),
        _kpi("Largest Contentful Paint", "not_available" if perf.get("avg_lcp_ms") is None else ("passing" if float(perf.get("avg_lcp_ms") or 0) < 2500 else "failing"), {
            "summary": "Largest Contentful Paint was not available in this scan" if perf.get("avg_lcp_ms") is None else f"Average LCP is {perf.get('avg_lcp_ms')}ms",
            "metric": perf.get("avg_lcp_ms"),
            "unit": "ms",
            "threshold": {"green": "< 2500ms", "yellow": "< 4000ms", "red": "≥ 4000ms"},
            "current_grade": _grade_metric(float(perf.get("avg_lcp_ms") or 0) if perf.get("avg_lcp_ms") is not None else None, 2500, 4000),
            "warning": "The homepage or other top-entry pages are much slower than the average" if worst_lcp_pages and float(worst_lcp_pages[0].get("lcp_ms") or 0) >= 4000 else "No severe LCP outlier was detected in the sampled pages",
            "worst_pages": [{"url": row.get("url"), "lcp_ms": row.get("lcp_ms")} for row in worst_lcp_pages],
            **({"fix": "Optimize the hero or other largest visible assets on the slowest pages, starting with the homepage"} if perf.get("avg_lcp_ms") is not None and float(perf.get("avg_lcp_ms") or 0) >= 2500 else {}),
        }, "performance", "Performance", "Slow largest paint delays perceived load completion on the pages that matter most to visitors"),
        _kpi("Cumulative Layout Shift", "not_available" if perf.get("avg_cls") is None else ("passing" if float(perf.get("avg_cls") or 0) < 0.1 else "failing"), {
            "summary": "Cumulative Layout Shift was not available in this scan" if perf.get("avg_cls") is None else f"Average CLS is {perf.get('avg_cls')}",
            "metric": perf.get("avg_cls"),
            "unit": "score",
            "threshold": {"green": "< 0.1", "yellow": "< 0.25", "red": "≥ 0.25"},
            "current_grade": _grade_metric(float(perf.get("avg_cls") or 0) if perf.get("avg_cls") is not None else None, 0.1, 0.25),
            "homepage_cls": homepage_sample.get("cls"),
            "warning": "Homepage layout is noticeably less stable than the average" if homepage_sample.get("cls") is not None and float(homepage_sample.get("cls") or 0) >= 0.25 else "No major CLS outlier was detected on the homepage sample",
            **({"fix": "Reserve dimensions for images, embeds, and banners and avoid injecting content above existing layout"} if perf.get("avg_cls") is not None and float(perf.get("avg_cls") or 0) >= 0.1 else {}),
        }, "performance", "Performance", "Layout shifts cause accidental clicks and reduce trust during critical user journeys"),
        _kpi("Eco Index", "not_available" if perf.get("avg_eco_index") is None else ("passing" if float(perf.get("avg_eco_index") or 0) >= 60 else "failing"), {
            "summary": "Eco Index was not available in this scan" if perf.get("avg_eco_index") is None else f"Average Eco Index is {perf.get('avg_eco_index')}",
            "metric": perf.get("avg_eco_index"),
            "unit": "score",
            "threshold": {"green": "≥ 60", "yellow": "≥ 45", "red": "< 45"},
            "current_grade": _grade_metric(float(perf.get("avg_eco_index") or 0) if perf.get("avg_eco_index") is not None else None, 60, 45, higher_is_better=True),
            "warning": "Repeated low eco scores usually correlate with heavy templates, large assets, and unnecessary client-side work",
            "rows": [{"url": row.get("url"), "eco_score": row.get("eco_score"), "eco_index": row.get("eco_index")} for row in headless_sample],
            **({"fix": "Reduce total page weight, unused assets, and repeated template media on the lowest-scoring pages"} if perf.get("avg_eco_index") is not None and float(perf.get("avg_eco_index") or 0) < 60 else {}),
        }, "performance", "Performance", "Inefficient pages cost more bandwidth and energy while degrading user experience on slower devices"),
        _kpi("HTML Compression", _status_from_bool(perf.get("html_compression_applied")), {
            "summary": "HTML compression is enabled" if perf.get("html_compression_applied") else "HTML compression is not enabled",
            "detail": {"enabled": bool(perf.get("html_compression_applied"))},
            **({"fix": "Enable gzip or Brotli compression for HTML responses in Apache, Nginx, or the edge proxy"} if not perf.get("html_compression_applied") else {}),
        }, "performance", "Performance", "Uncompressed HTML increases transfer size and slows first render on every page"),
        _kpi("Non-Functional Buttons", _status_from_bool(_safe_dict(perf.get("button_kpi")).get("passed")), {
            "summary": "No non-functional buttons were detected" if _safe_dict(perf.get("button_kpi")).get("passed") else f"{int(_safe_dict(perf.get('button_kpi')).get('pages_with_nonfunc_buttons', 0) or 0)} pages contain buttons with no action",
            "affected_pages": nonfunc_pages,
            "total_broken_buttons": int(_safe_dict(perf.get("button_kpi")).get("total_nonfunc_buttons", 0) or 0),
            "items": nonfunc_button_items,
            "note": ((nonfunc_note + ". ") if nonfunc_note else "") + "The headless scan flags buttons that lack href, onclick, or form association",
            **({"fix": "Inspect the listed pages and wire each button to a real link, click handler, or form submit action"} if not _safe_dict(perf.get("button_kpi")).get("passed", True) else {}),
        }, "bug", "Performance", "Users clicking dead buttons lose confidence and cannot complete high-value actions"),
        _kpi("JavaScript Console Errors", _status_from_bool(_safe_dict(perf.get("console_error_kpi")).get("passed")), {
            "summary": "No JavaScript console errors were retained in the aggregated scan" if _safe_dict(perf.get("console_error_kpi")).get("passed") else f"{int(_safe_dict(perf.get('console_error_kpi')).get('pages_with_console_errors', 0) or 0)} pages emitted JavaScript console errors",
            "items": ([{"name": report.get("domain"), "note": msg, "fix": "Trace the stack or script responsible and repair the runtime error"} for msg in _safe_list(_safe_dict(perf.get("console_error_kpi")).get("homepage_console_errors"))] if _safe_dict(perf.get("console_error_kpi")).get("homepage_console_errors") else [{"name": page, "note": "Console errors were detected on this page but the aggregated report did not retain the exact browser log", "fix": "Open the page in DevTools and reproduce the console error to identify the offending script"} for page in _safe_list(context.get("console_error_page_urls"))]),
            **({"fix": "Repair the scripts throwing browser-side errors and re-run the headless scan"} if not _safe_dict(perf.get("console_error_kpi")).get("passed", True) else {}),
        }, "bug", "Performance", "Browser errors can break interactive components and silently block key conversion paths"),
        _kpi("Mobile Performance", "not_available" if not mobile_kpi.get("available") else _status_from_bool(mobile_kpi.get("passed")), {
            "summary": "This KPI was not evaluated in this scan" if not mobile_kpi.get("available") else ("Mobile metrics passed on the sampled page" if mobile_kpi.get("passed") else "Mobile metrics failed on the sampled page"),
            **({"reason": "Mobile headless metrics were not captured by the scanner for this scan"} if not mobile_kpi.get("available") else {"detail": {"fcp_ms": mobile_kpi.get("fcp_ms"), "lcp_ms": mobile_kpi.get("lcp_ms"), "cls": mobile_kpi.get("cls"), "speed_index_ms": mobile_kpi.get("speed_index_ms"), "issues": mobile_kpi.get("issues", [])}}),
            **({"fix": "Restore mobile headless capture in the scanner and re-run the audit"} if not mobile_kpi.get("available") else ({"fix": "Optimize mobile-specific render path issues reported in the sampled page metrics"} if not mobile_kpi.get("passed", True) else {})),
        }, "performance", "Performance", "Poor mobile performance directly hurts engagement for users on phones, which are often the dominant traffic source"),

        _kpi("Menu Structure", _status_from_bool(_safe_dict(ux.get("menu_structure_kpi")).get("passed")), {
            "summary": "Menu structure looks coherent on sampled pages" if _safe_dict(ux.get("menu_structure_kpi")).get("passed") else f"{int(_safe_dict(ux.get('menu_structure_kpi')).get('pages_with_menu_issues', 0) or len(menu_pages))} pages have menu structure issues",
            "affected_pages": menu_pages or _safe_list(ux_menu_issue.get("example_urls")),
            "items": menu_items,
            **({"fix": "Restore submenu markup and repair empty or non-actionable navigation links in the shared navigation template"} if not _safe_dict(ux.get("menu_structure_kpi")).get("passed", True) else {}),
        }, "recommendation", "UX", "Weak navigation structure makes content harder to discover and increases drop-off from primary menus"),
        _kpi("Plain Email Addresses Exposed", _status_from_bool(_safe_dict(ux.get("plain_email_kpi")).get("passed")), {
            "summary": "No plain-text email addresses were exposed" if _safe_dict(ux.get("plain_email_kpi")).get("passed") else f"{len(email_items)} unique plain-text email addresses were found across {int(_safe_dict(ux.get('plain_email_kpi')).get('pages_with_plain_emails', 0) or 0)} pages",
            "items": email_items,
            **({"fix": "Replace visible email strings with proper mailto links and repair malformed tokens in templates or editorial content"} if not _safe_dict(ux.get("plain_email_kpi")).get("passed", True) else {}),
        }, "bug", "UX", "Exposed plain-text emails attract scraping and create broken contact experiences when addresses are malformed"),
        _kpi("Raw IP Links", _status_from_bool(_safe_dict(ux.get("raw_ip_link_kpi")).get("passed")), {
            "summary": "No raw IP links were detected" if _safe_dict(ux.get("raw_ip_link_kpi")).get("passed") else f"{int(_safe_dict(ux.get('raw_ip_link_kpi')).get('total_raw_ip_links', 0) or 0)} raw IP links were found across {int(_safe_dict(ux.get('raw_ip_link_kpi')).get('pages_with_raw_ip_links', 0) or 0)} pages",
            "items": raw_ip_items,
            **({"fix": "Replace IP-based URLs with canonical hostnames and update the source template or content block"} if not _safe_dict(ux.get("raw_ip_link_kpi")).get("passed", True) else {}),
        }, "bug", "UX", "Raw IP links look untrustworthy and often bypass the intended domain, certificate, or routing setup"),
        _kpi("Product Images Missing", "passing" if int(ux.get("pages_with_missing_product_images", 0) or 0) == 0 else "failing", {
            "summary": "No product or content cards were missing images" if int(ux.get("pages_with_missing_product_images", 0) or 0) == 0 else f"{int(ux.get('pages_with_missing_product_images', 0) or 0)} pages contain cards without images",
            "affected_pages": missing_product_pages,
            **({"fix": "Populate missing card thumbnails in the CMS or adjust the component fallback image logic"} if int(ux.get("pages_with_missing_product_images", 0) or 0) > 0 else {}),
            **({"note": product_note} if product_note else {}),
        }, "recommendation", "UX", "Cards without images weaken content scanning and make important offers look incomplete"),
        _kpi("Internal Contextual Links", "passing" if int(ux.get("pages_missing_contextual_links", 0) or 0) == 0 else "failing", {
            "summary": "Contextual internal links were found on all pages" if int(ux.get("pages_missing_contextual_links", 0) or 0) == 0 else f"{int(ux.get('pages_missing_contextual_links', 0) or 0)} pages are missing contextual internal links in the main content area",
            "affected_pages": missing_contextual_pages or _safe_list(ux_contextual_issue.get("example_urls")),
            "note": ((contextual_note + ". ") if contextual_note else "") + f"Headless sampling also found {int(ux.get('total_invisible_links', 0) or 0)} invisible links, which suggests structural link noise rather than useful contextual linking",
            **({"fix": "Add meaningful in-content links between related pages instead of relying on repeated template navigation"} if int(ux.get("pages_missing_contextual_links", 0) or 0) > 0 else {}),
        }, "recommendation", "UX", "Missing contextual links weakens discovery paths and reduces the chance that visitors continue deeper into the site"),
        _kpi("Invisible Links", "passing" if int(ux.get("total_invisible_links", 0) or 0) <= 100 else "failing", {
            "summary": f"{int(ux.get('total_invisible_links', 0) or 0)} invisible links were detected in the sampled pages",
            "metric": int(ux.get("total_invisible_links", 0) or 0),
            "unit": "links",
            "threshold": {"green": "< 100", "yellow": "< 500", "red": "≥ 500"},
            "current_grade": _grade_metric(float(ux.get("total_invisible_links", 0) or 0), 100, 500),
            "warning": "All sampled pages reported the same invisible link count, which indicates a systematic template-level pattern" if invisible_systematic else "Invisible link counts vary across sampled pages",
            **({"fix": "Inspect shared templates and remove hidden anchors or off-screen duplicated navigation links"} if int(ux.get("total_invisible_links", 0) or 0) > 100 else {}),
        }, "recommendation", "UX", "Invisible links create DOM noise, confuse assistive tech, and often signal poor template hygiene"),
        _kpi("Footer RGPD Alignment", "not_available" if footer_rgpd.get("status") == "not_evaluated" else ("passing" if footer_rgpd.get("passed") else "failing"), {
            "summary": "This KPI was not evaluated in this scan" if footer_rgpd.get("status") == "not_evaluated" else ("Footer RGPD links align with the baseline" if footer_rgpd.get("passed") else "Footer RGPD area diverges from the validated baseline"),
            **({"reason": footer_rgpd.get("reason", "Visual regression was not available for footer RGPD alignment")} if footer_rgpd.get("status") == "not_evaluated" else {"detail": {"baseline_scan_id": footer_rgpd.get("baseline_scan_id"), "avg_diff_pct": footer_rgpd.get("avg_diff_pct"), "max_diff_pct": footer_rgpd.get("max_diff_pct"), "urls_compared": footer_rgpd.get("urls_compared")}}),
            **({"fix": "Enable visual regression with a baseline scan to evaluate footer compliance consistency"} if footer_rgpd.get("status") == "not_evaluated" else ({"fix": "Review footer legal links and layout regressions against the approved baseline pages"} if not footer_rgpd.get("passed", True) else {})),
        }, "rgpd", "UX", "Inconsistent legal/footer navigation makes compliance information harder for visitors to find and trust"),

        _kpi("Content Freshness", "failing" if freshness_anomaly is not None else _status_from_bool(freshness_kpi.get("passed")), {
            "summary": "Latest published content date field contains an invalid value" if freshness_anomaly is not None else (f"Latest detected publication date is {latest_pub_date}" if latest_pub_date else "No publication date was detected in the scan"),
            **({"anomaly": f"Date '{latest_pub_date}' is outside a realistic operating range and likely comes from a CMS parsing or content field error", "raw_value": latest_pub_date, "fix": "Investigate the CMS publication date field and repair the source content or migration data producing this value"} if freshness_anomaly is not None else {"detail": {"latest_pub_date": latest_pub_date, "passed": bool(freshness_kpi.get("passed"))}, **({"fix": "Publish or update fresh dated content and verify date metadata is exposed correctly"} if latest_pub_date is None or not freshness_kpi.get("passed", False) else {})}),
        }, "recommendation", "Content", "Stale or invalid content dates weaken credibility and can reduce engagement on news or investor-facing pages"),
        _kpi("Thin Content (NLP)", "passing" if int(content.get("pages_thin_content_nlp", 0) or 0) == 0 else "failing", {
            "summary": f"{int(content.get('pages_thin_content_nlp', 0) or 0)} pages fall below the NLP thin-content threshold",
            "metric": int(content.get("pages_thin_content_nlp", 0) or 0),
            "unit": "pages",
            "threshold": {"green": "0", "yellow": "< 10", "red": "≥ 10"},
            "current_grade": _grade_metric(float(content.get("pages_thin_content_nlp", 0) or 0), 0.000001, 10),
            "warning": "Thin content pages often correspond to low-value listing or placeholder pages that need stronger editorial intent",
            **({"fix": "Expand thin pages with meaningful copy, structured content, and relevant internal links or consolidate them"} if int(content.get("pages_thin_content_nlp", 0) or 0) > 0 else {}),
        }, "recommendation", "Content", "Thin pages struggle to rank, fail to answer visitor questions, and dilute overall content quality"),
        _kpi("Keyword Stuffing", "passing" if int(content.get("pages_with_keyword_stuffing", 0) or 0) == 0 else "failing", {
            "summary": "No keyword stuffing pages were detected" if int(content.get("pages_with_keyword_stuffing", 0) or 0) == 0 else f"{int(content.get('pages_with_keyword_stuffing', 0) or 0)} pages were flagged for keyword stuffing",
            "affected_pages": keyword_stuffing_pages,
            **({"note": stuffing_note or "The aggregated report retains the page count but not always the full offending phrase context"} if int(content.get("pages_with_keyword_stuffing", 0) or 0) > 0 else {}),
            **({"fix": "Rewrite affected copy to remove repetitive keyword patterns and restore natural language variation"} if int(content.get("pages_with_keyword_stuffing", 0) or 0) > 0 else {}),
        }, "recommendation", "Content", "Keyword stuffing makes copy harder to read and can trigger search quality downgrades"),
        _kpi("Keyword Cannibalization", "passing" if not _safe_list(content.get("cannibalized_keywords")) else "failing", {
            "summary": "No severe keyword cannibalization was detected" if not _safe_list(content.get("cannibalized_keywords")) else f"{len(_safe_list(content.get('cannibalized_keywords')))} keyword cluster(s) are competing across multiple pages",
            "cannibalized_keywords": [{
                "keyword": item.get("keyword") or item.get("keyword_stem"),
                "page_count": int(item.get("count", 0) or 0),
                "competing_pages": _safe_list(item.get("pages")) + ([f"... {max(int(item.get('count', 0) or 0) - len(_safe_list(item.get('pages'))), 0)} additional pages not enumerated in this scan"] if int(item.get("count", 0) or 0) > len(_safe_list(item.get("pages"))) else []),
            } for item in _safe_list(content.get("cannibalized_keywords"))],
            **({"note": "Brand keywords are expected site-wide, but each major section still needs its own differentiated primary topic signal"} if _safe_list(content.get("cannibalized_keywords")) else {}),
            **({"fix": "Assign a clear primary keyword/theme to each competing section and adjust titles, headings, and internal linking accordingly"} if _safe_list(content.get("cannibalized_keywords")) else {}),
        }, "recommendation", "Content", "Cannibalized keywords split topical authority and make it unclear which page should rank for important queries"),
        _kpi("Typo Density", _status_from_bool(typo_detection.get("passed")), {
            "summary": f"Average typo density is {typo_detection.get('avg_typo_density', 0.0)} across {typo_detection.get('pages_with_typos', 0)} pages with detected typo signals",
            "metric": typo_detection.get("avg_typo_density", 0.0),
            "unit": "ratio",
            "threshold": {"green": "< 0.08", "yellow": "< 0.15", "red": "≥ 0.15"},
            "current_grade": _grade_metric(float(typo_detection.get("avg_typo_density", 0.0) or 0.0), 0.08, 0.15),
            "warning": typo_warning or "Sample tokens look like standard dictionary candidates",
            **({"fix": "Review the affected editorial pages manually before bulk-correcting tokens so domain-specific terms are preserved"} if not typo_detection.get("passed", False) else {}),
        }, "recommendation", "Content", "High typo density weakens perceived professionalism and undermines trust in sensitive content"),
        _kpi("Audience Segmentation", "passing", {
            "summary": "Audience segmentation distribution was inferred from NLP page classification",
            "rows": ([{"dimension": "segment", "name": key, "count": value} for key, value in _safe_dict(audience_segments.get("counts")).items()] + [{"dimension": "confidence", "name": key, "count": value} for key, value in _safe_dict(audience_segments.get("confidence")).items()]),
            "note": "This KPI is informational and does not pass or fail the site; it shows how the content mix is distributed across audience types",
        }, "recommendation", "Content", "Clear audience segmentation helps teams see whether content inventory matches target customer groups"),
        _kpi("Image Compression", _status_from_bool(image_compression.get("passed")), {
            "summary": "Image compression checks passed" if image_compression.get("passed") else f"{int(image_compression.get('unoptimised_count', 0) or 0)} sampled images look unoptimised",
            "items": [{
                "name": item.get("url"),
                "size_kb": item.get("size_kb"),
                "content_type": item.get("content_type"),
                "note": "Large raster image should be recompressed or converted to a next-generation format",
                "fix": "Generate a smaller derivative or modern format variant and reference it in the page template",
            } for item in _safe_list(image_compression.get("unoptimised_images"))],
            **({"fix": "Compress or convert the listed images and update the media pipeline to avoid publishing oversized assets"} if not image_compression.get("passed", False) else {}),
        }, "recommendation", "Content", "Oversized images increase page weight and degrade both performance and hosting efficiency"),

        _kpi("SSL Certificate", "not_available" if days_remaining is None else ("passing" if ssl.get("valid") and days_remaining > 30 else "failing"), {
            "summary": "SSL certificate data was not available" if days_remaining is None else f"SSL certificate is {'valid' if ssl.get('valid') else 'invalid'} with {days_remaining} days remaining until expiry",
            "detail": {"valid": bool(ssl.get("valid")), "issuer": ssl.get("issuer"), "protocol": ssl.get("protocol"), "expiry": expiry, "days_remaining": days_remaining},
            **({"fix": "Renew or replace the certificate before expiry and verify the full certificate chain"} if days_remaining is not None and (not ssl.get("valid") or days_remaining <= 30) else {}),
        }, "security", "Security", "SSL issues directly erode trust and can block secure access to the site"),
        _kpi("HTTP Security Headers", "passing" if not _safe_list(security.get("missing_headers")) else "failing", {
            "summary": "All required HTTP security headers are present" if not _safe_list(security.get("missing_headers")) else f"{len(_safe_list(security.get('missing_headers')))} required HTTP security headers are missing",
            "rows": _normalize_header_rows(_safe_list(security.get("headers")), _safe_list(security.get("missing_headers"))),
            **({"fix": "Set the missing headers in Apache, Nginx, or the upstream application response configuration"} if _safe_list(security.get("missing_headers")) else {}),
        }, "security", "Security", "Missing security headers reduce browser-side defenses against framing, MIME confusion, and script injection"),
        _kpi("Cookie Security Flags", _status_from_bool(cookie_kpi.get("passed")), {
            "summary": "All cookies have required security flags" if cookie_kpi.get("passed") else f"{int(cookie_kpi.get('missing_cookie_flag_count', 0) or 0)} cookies are missing Secure or HttpOnly flags",
            "items": cookie_items,
            **({"fix": "Set Secure and HttpOnly on each affected cookie in the application or edge layer"} if not cookie_kpi.get("passed", True) else {}),
        }, "security", "Security", "Weak cookie flags increase the risk of session theft and client-side exposure of sensitive tokens"),
        _kpi("Exposed Sensitive Paths", _status_from_bool(exposed_path_kpi.get("passed")), {
            "summary": "No exposed sensitive paths were detected" if exposed_path_kpi.get("passed") else f"{int(exposed_path_kpi.get('google_dorks_vuln_count', 0) or 0)} exposed sensitive path(s) were detected",
            "items": exposed_path_items,
            **({"fix": "Block public access to the listed files and remove any sensitive artifacts from the web root"} if not exposed_path_kpi.get("passed", True) else {}),
        }, "security", "Security", "Exposed paths can leak internal implementation details or sensitive files to attackers and search engines"),
        _kpi("Vulnerability Scan", _status_from_bool(vulnerability_kpi.get("passed")), {
            "summary": "No SQLi, XSS, or DDoS signals were retained in the aggregated scan" if vulnerability_kpi.get("passed") else "One or more vulnerability signal categories returned non-zero counts",
            "rows": [
                {"category": "SQLi", "count": int(vulnerability_kpi.get("sqli_vulnerable_count", 0) or 0)},
                {"category": "XSS", "count": int(vulnerability_kpi.get("xss_vulnerable_count", 0) or 0)},
                {"category": "DDoS", "count": int(vulnerability_kpi.get("ddos_signal_count", 0) or 0)},
            ],
            **({"fix": "Investigate the flagged category, confirm exploitability, and patch the affected endpoint or infrastructure control"} if not vulnerability_kpi.get("passed", True) else {}),
        }, "security", "Security", "Confirmed vulnerability signals indicate real security exposure that can impact availability or data integrity"),
        _kpi("Technology Stack", "passing" if not cms_kpi.get("cms_version_eol") and cve_total == 0 else "failing", {
            "summary": "No end-of-life platform version or known CVE totals were detected" if not cms_kpi.get("cms_version_eol") and cve_total == 0 else "Technology stack includes an end-of-life component or known CVE exposure",
            "rows": _technology_rows(_safe_dict(domain_analysis.get("tech")), cms_kpi),
            "note": f"CVE totals: critical={int(cve_severity.get('critical', 0) or 0)}, high={int(cve_severity.get('high', 0) or 0)}, medium={int(cve_severity.get('medium', 0) or 0)}, low={int(cve_severity.get('low', 0) or 0)}. Module versions detected: {len(module_versions)}",
            **({"warning": "Some modules have explicit versions and should still be reviewed for patch level even if the CMS core is not end-of-life"} if module_versions else {}),
            **({"fix": "Upgrade end-of-life components and patch any dependency versions associated with known CVEs"} if cms_kpi.get("cms_version_eol") or cve_total > 0 else {}),
        }, "security", "Security", "Outdated stack components increase patching risk and expose the site to avoidable vulnerabilities"),

        _kpi("Cookie Consent Banner", "passing" if _safe_dict(privacy.get("cookie_consent")).get("detected") else "failing", {
            "summary": "Cookie consent banner detected" if _safe_dict(privacy.get("cookie_consent")).get("detected") else "No cookie consent banner or CMP detected",
            "detail": {"detected": bool(_safe_dict(privacy.get("cookie_consent")).get("detected")), "tracking_tools_found": tracking_tools},
            **({"fix": "Implement a CMP that blocks analytics and tag manager scripts until consent is granted"} if not _safe_dict(privacy.get("cookie_consent")).get("detected") else {}),
        }, "rgpd", "Privacy", "Loading trackers before consent exposes the business to compliance and trust risks"),
        _kpi("Privacy Policy", _status_from_bool(privacy.get("has_privacy_policy")), {
            "summary": "Privacy policy link detected" if privacy.get("has_privacy_policy") else "No privacy policy link was detected",
            "detail": {"detected": bool(privacy.get("has_privacy_policy")), "url": _find_privacy_link(privacy_links, "privacy_policy")},
            **({"fix": "Publish a privacy policy page and link it from the footer and relevant forms"} if not privacy.get("has_privacy_policy") else {}),
        }, "rgpd", "Privacy", "Without a privacy policy, visitors cannot understand how their personal data is handled"),
        _kpi("Legal Notice", _status_from_bool(privacy.get("has_legal_notice")), {
            "summary": "Legal notice link detected" if privacy.get("has_legal_notice") else "No legal notice link was detected",
            "detail": {"detected": bool(privacy.get("has_legal_notice")), "url": _find_privacy_link(privacy_links, "legal_notice")},
            **({"fix": "Add a legal notice page and expose it from the footer"} if not privacy.get("has_legal_notice") else {}),
        }, "rgpd", "Privacy", "Missing legal notice information weakens corporate transparency and compliance posture"),
        _kpi("Cookie Policy", _status_from_bool(privacy.get("has_cookie_policy")), {
            "summary": "Cookie policy link detected" if privacy.get("has_cookie_policy") else "No cookie policy link was detected",
            "detail": {"detected": bool(privacy.get("has_cookie_policy")), "url": _find_privacy_link(privacy_links, "cookie_policy")},
            **({"fix": "Publish a cookie policy describing categories, lifetimes, and third-party cookies"} if not privacy.get("has_cookie_policy") else {}),
        }, "rgpd", "Privacy", "Visitors need a cookie policy to understand what tracking technologies are present and why"),
        _kpi("Data Subject Rights", _status_from_bool(privacy.get("has_information_rights")), {
            "summary": f"{len(found_keywords)} data subject rights keyword(s) were detected and {len(missing_keywords)} were missing",
            "detail": {"found_keywords": found_keywords, "missing_keywords": missing_keywords, "found_count": len(found_keywords), "missing_count": len(missing_keywords)},
            **({"fix": "Add clear wording about access, rectification, erasure, portability, and objection rights in the privacy content"} if not privacy.get("has_information_rights") else {}),
        }, "rgpd", "Privacy", "If rights are not clearly stated, users cannot understand or exercise their data protection rights"),
        _kpi("Consent Checkbox on Forms", _status_from_bool(privacy.get("has_consent_checkbox")), {
            "summary": "Consent checkbox detected on form(s)" if privacy.get("has_consent_checkbox") else "No consent checkbox was detected near forms collecting personal data",
            "detail": {"detected": bool(privacy.get("has_consent_checkbox")), "form_types": form_types},
            **({"fix": "Add an explicit consent checkbox with legal wording to forms processing personal data"} if not privacy.get("has_consent_checkbox") else {}),
        }, "rgpd", "Privacy", "Forms collecting data without explicit consent cues increase legal and trust risk"),
        _kpi("Declared Processing Purpose", _status_from_bool(privacy.get("has_declared_purpose")), {
            "summary": "Processing purpose is declared" if privacy.get("has_declared_purpose") else "No explicit processing purpose was detected",
            "detail": {"detected": bool(privacy.get("has_declared_purpose"))},
            **({"fix": "State the purpose of processing next to forms and inside the privacy notice"} if not privacy.get("has_declared_purpose") else {}),
        }, "rgpd", "Privacy", "Visitors need to know why their data is collected before they decide to share it"),
        _kpi("Data Retention Mention", "passing" if int(content.get("rgpd_retention_signal_pages", 0) or 0) >= 1 else "failing", {
            "summary": f"Data retention language was detected on {int(content.get('rgpd_retention_signal_pages', 0) or 0)} pages",
            "detail": {"page_count": int(content.get("rgpd_retention_signal_pages", 0) or 0)},
            **({"fix": "Document data retention periods in the privacy notice and relevant form flows"} if int(content.get("rgpd_retention_signal_pages", 0) or 0) < 1 else {}),
        }, "rgpd", "Privacy", "Missing retention information leaves users unaware of how long their personal data is kept"),
        _kpi("Data Minimization Mention", "passing" if int(content.get("rgpd_minimization_signal_pages", 0) or 0) >= 1 else "failing", {
            "summary": f"Data minimization language was detected on {int(content.get('rgpd_minimization_signal_pages', 0) or 0)} pages",
            "detail": {"page_count": int(content.get("rgpd_minimization_signal_pages", 0) or 0)},
            **({"fix": "Explain that only necessary data is collected and align form fields with that principle"} if int(content.get("rgpd_minimization_signal_pages", 0) or 0) < 1 else {}),
        }, "rgpd", "Privacy", "Without minimization language, users cannot assess whether data collection is proportionate"),

        _kpi("Contact Form", _status_from_bool(functional.get("has_contact")), {
            "summary": "Contact form detected" if functional.get("has_contact") else "No contact form was detected",
            "detail": {"detected": bool(functional.get("has_contact")), "form_types_found": form_types},
            **({"fix": "Add a contact form or clearly expose an equivalent contact journey on the site"} if not functional.get("has_contact") else {}),
        }, "recommendation", "Functional", "Without a contact form, users may abandon support or sales enquiries before reaching the business"),
        _kpi("Search Functionality", _status_from_bool(functional.get("has_search")), {
            "summary": "Search form detected" if functional.get("has_search") else "No search functionality was detected",
            "detail": {"detected": bool(functional.get("has_search")), "action": next((form.get("action") for form in forms if isinstance(form, dict) and form.get("type") == "search"), None), "method": next((form.get("method") for form in forms if isinstance(form, dict) and form.get("type") == "search"), None)},
            **({"fix": "Expose an internal search form with a working action endpoint"} if not functional.get("has_search") else {}),
        }, "recommendation", "Functional", "Missing search makes it harder for visitors to reach deep content quickly on a large site"),
        _kpi("Newsletter Subscription", _status_from_bool(functional.get("has_newsletter")), {
            "summary": "Newsletter subscription form detected" if functional.get("has_newsletter") else "No newsletter subscription entry point was detected",
            "detail": {"detected": bool(functional.get("has_newsletter")), "form_types_found": form_types},
            **({"fix": "Add a newsletter signup form or equivalent opt-in acquisition component"} if not functional.get("has_newsletter") else {}),
        }, "recommendation", "Functional", "Without a newsletter signup, the site loses a common retention and lead nurturing channel"),
        _kpi("Login / User Area", _status_from_bool(functional.get("has_login")), {
            "summary": "Login or user area entry point detected" if functional.get("has_login") else "No login or user area entry point was detected",
            "detail": {"detected": bool(functional.get("has_login"))},
            **({"fix": "Expose the login journey clearly if authenticated services are part of the offering"} if not functional.get("has_login") else {}),
        }, "recommendation", "Functional", "If authenticated services exist but login is hard to find, users will fail to reach their account journey"),
        _kpi("Appointment Booking", _status_from_bool(functional.get("has_rdv")), {
            "summary": "Appointment booking flow detected" if functional.get("has_rdv") else "No appointment booking flow was detected",
            "detail": {"detected": bool(functional.get("has_rdv"))},
            **({"fix": "Add or expose a booking journey if appointments are part of the service model"} if not functional.get("has_rdv") else {}),
        }, "recommendation", "Functional", "Missing booking flows can block users from converting on appointment-driven services"),
        _kpi("Form Fuzzer Robustness", fuzzer_status, {
            "summary": (
                "Form fuzzer did not execute in this scan"
                if fuzzer_tests_run <= 0
                else (
                    "Form fuzzer found no anomalies"
                    if fuzzer_anomalies == 0
                    else f"Form fuzzer detected {fuzzer_anomalies} anomaly event(s)"
                )
            ),
            "detail": {
                "enabled": bool(fuzzer_enabled),
                "skipped_reason": functional_fuzzer.get("skipped_reason"),
                "forms_discovered": int(functional_fuzzer.get("forms_discovered", 0) or 0),
                "total_forms_tested": int(functional_fuzzer.get("total_forms_tested", 0) or 0),
                "tests_run": fuzzer_tests_run,
                "anomalies_count": fuzzer_anomalies,
                "anomalies_by_type": _safe_dict(functional_fuzzer.get("anomalies_by_type")),
                "top_findings": _safe_list(functional_fuzzer.get("top_findings")),
                "top_affected": _safe_list(functional_fuzzer.get("top_affected")),
                "source": functional_fuzzer.get("source", "none"),
            },
            **({"fix": "Enable form-fuzzer execution in staging and ensure in-scope forms are discoverable by the crawler"} if fuzzer_tests_run <= 0 else {}),
            **({"fix": "Review the top anomaly types, reproduce each finding, and harden server-side validation and sanitization for affected forms"} if fuzzer_tests_run > 0 and fuzzer_anomalies > 0 else {}),
        }, "security", "Functional", "Unchecked form handling can hide validation flaws and injection vectors that impact both security and conversion paths"),
    ]

    return kpis


def build_report(scan_id: str) -> dict:
    """Build the Plan A three-tier scan report from DB data."""
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute(
            "SELECT url, metrics, nlp_results FROM scan_pages WHERE scan_id = %s ORDER BY id ASC",
            (scan_id,)
        )
        page_rows = cur.fetchall()

        cur.execute(
            "SELECT domain, domain_security, domain_tech, domain_privacy, domain_functional, image_compression, broken_links_summary, seo_kpi_extended, scan_telemetry, form_fuzzer_summary FROM scan_summaries WHERE scan_id = %s",
            (scan_id,)
        )
        summary_row = cur.fetchone()

        form_fuzzer_table_stats = _load_form_fuzzer_table_stats(cur, scan_id)

        cur.close()
        conn.close()
    except Exception as e:
        return {"error": str(e)}

    # ─── Tier 1: Domain Analysis ───────────────────────────────────────────────
    domain_analysis = {}
    raw_priv = {}
    privacy_kpi = {
        "has_privacy_policy": False,
        "has_legal_notice": False,
        "has_cookie_policy": False,
        "has_security_policy": False,
        "has_information_rights": False,
        "has_consent_checkbox": False,
        "has_declared_purpose": False,
        "cookie_consent": {},
        "passed": False,
        "issues": [],
    }
    if summary_row:
        raw_tech = _j(summary_row.get("domain_tech"))

        # ── CMS KPI: pass/fail based on EOL version detection ─────────────────
        cms_name    = raw_tech.get("cms", "")
        cms_version = raw_tech.get("cms_version", "")
        cms_eol     = raw_tech.get("cms_version_eol", False)
        cms_passed  = raw_tech.get("passed", True)
        cms_issues  = raw_tech.get("issues", [])

        cms_kpi = {
            "cms_detected":     cms_name or None,
            "cms_version":      cms_version or None,
            "cms_version_eol":  cms_eol,
            "cms_support_status": raw_tech.get("cms_support_status", ""),
            "passed":           cms_passed,
            "issues":           cms_issues,
            # Full detected stack (servers, frameworks, analytics, CDN …)
            "stack":            raw_tech.get("stack", []),
            # Gap #2: explicit module versions
            "module_versions":  raw_tech.get("module_versions", []),
            # Gap #3: server/language version from headers
            "server_tech":      raw_tech.get("server_tech", ""),
            "server_version":   raw_tech.get("server_version", ""),
            "server_banner":    raw_tech.get("server_banner", ""),
            "os_hint":          raw_tech.get("os_hint", ""),
            "language":         raw_tech.get("language", ""),
            "language_version": raw_tech.get("language_version", ""),
            # Gap #5: CVE severity breakdown
            "cve_severity": {
                "critical": raw_tech.get("cve_severity", {}).get("critical", 0),
                "high":     raw_tech.get("cve_severity", {}).get("high", 0),
                "medium":   raw_tech.get("cve_severity", {}).get("medium", 0),
                "low":      raw_tech.get("cve_severity", {}).get("low", 0),
            },
        }

        raw_sec = _j(summary_row.get("domain_security"))

        # ── Cookie flag KPI (Phase B) ──────────────────────────────────────────
        cookie_kpi = {
            "cookies_with_missing_flags": raw_sec.get("cookies_with_missing_flags", []),
            "missing_cookie_flag_count":  raw_sec.get("missing_cookie_flag_count", 0),
            "passed":                     raw_sec.get("cookie_kpi_passed", True),
        }

        # ── Exposed path KPI (Phase B) ────────────────────────────────────────
        exposed_path_kpi = {
            "exposed_paths":        raw_sec.get("exposed_paths", []),
            "google_dorks_vuln_count": raw_sec.get("google_dorks_vuln_count", 0),
            "passed":               raw_sec.get("exposed_path_kpi_passed", True),
        }

        service_exposure = _safe_dict(raw_sec.get("service_exposure", {}))
        open_services = _safe_list(service_exposure.get("open_services", []))
        critical_open = 0
        high_open = 0
        for svc in open_services:
            if not isinstance(svc, dict):
                continue
            risk = str(svc.get("risk", "")).strip().lower()
            if risk == "critical":
                critical_open += 1
            elif risk == "high":
                high_open += 1
        service_exposure_kpi = {
            "enabled": service_exposure.get("enabled", False),
            "host": service_exposure.get("host", ""),
            "open_services": open_services,
            "status": service_exposure.get("status", "non_evalue"),
            "severity": service_exposure.get("severity", "info"),
            "impact": service_exposure.get("impact", ""),
            "critical_open_count": critical_open,
            "high_open_count": high_open,
            "passed": critical_open == 0 and high_open == 0,
            "warning": service_exposure.get("warning", ""),
        }

        # Vulnerability KPI bridge (SQLi / XSS / DDoS signals)
        sqli_tests = raw_sec.get("sqli_tests", [])
        xss_tests = raw_sec.get("xss_tests", [])
        ddos_indicators = raw_sec.get("ddos_indicators", {})
        sqli_vulnerable_count = sum(1 for t in sqli_tests if isinstance(t, dict) and t.get("vulnerable"))
        xss_vulnerable_count = sum(1 for t in xss_tests if isinstance(t, dict) and t.get("vulnerable"))
        ddos_signal_count = 0
        if isinstance(ddos_indicators, dict):
            for v in ddos_indicators.values():
                try:
                    ddos_signal_count += int(v or 0)
                except (TypeError, ValueError):
                    continue
        vulnerability_kpi = {
            "sqli_tests": sqli_tests,
            "xss_tests": xss_tests,
            "ddos_indicators": ddos_indicators,
            "sqli_vulnerable_count": sqli_vulnerable_count,
            "xss_vulnerable_count": xss_vulnerable_count,
            "ddos_signal_count": ddos_signal_count,
            "passed": (sqli_vulnerable_count + xss_vulnerable_count + ddos_signal_count) == 0,
        }

        raw_priv = _j(summary_row.get("domain_privacy"))

        # ── Privacy / RGPD KPI (Phase C) ──────────────────────────────────────
        privacy_kpi = {
            "has_privacy_policy":     raw_priv.get("has_privacy_policy", False),
            "has_legal_notice":       raw_priv.get("has_legal_notice", False),
            "has_cookie_policy":      raw_priv.get("has_cookie_policy", False),
            # Phase C new fields
            "has_security_policy":    raw_priv.get("has_security_policy", False),
            "has_information_rights": raw_priv.get("has_information_rights", False),
            "has_consent_checkbox":   raw_priv.get("has_consent_checkbox", False),
            "has_declared_purpose":   raw_priv.get("has_declared_purpose", False),
            "cookie_consent":         raw_priv.get("cookie_consent", {}),
            "passed":                 raw_priv.get("passed", False),
            "issues":                 raw_priv.get("issues", []),
        }

        raw_func = _j(summary_row.get("domain_functional"))
        functional_kpi = {
            "has_search":      raw_func.get("has_search", False),
            "has_login":       raw_func.get("has_login", False),
            "has_contact":     raw_func.get("has_contact", False),
            "has_newsletter":  raw_func.get("has_newsletter", False),
            "has_cart":        raw_func.get("has_cart", False),
            "has_rdv":         raw_func.get("has_rdv", False),
            "total_forms":     raw_func.get("total_forms", 0),
            "passed":          raw_func.get("passed", False),
            "issues":          raw_func.get("issues", []),
            "search_executed":  raw_func.get("search_executed", False),
            "search_passed":    raw_func.get("search_passed"),
            "search_tests":     _safe_list(raw_func.get("search_tests")),
            "search_rows":      _safe_list(raw_func.get("search_rows")),
        }
        functional_fuzzer_kpi = _build_functional_fuzzer_kpi(summary_row, form_fuzzer_table_stats)

        domain_analysis = {
            "security":        raw_sec,
            "cookie_kpi":      cookie_kpi,
            "exposed_path_kpi": exposed_path_kpi,
            "service_exposure_kpi": service_exposure_kpi,
            "vulnerability_kpi": vulnerability_kpi,
            "tech":            raw_tech,
            "cms_kpi":         cms_kpi,
            "privacy":         raw_priv,
            "privacy_kpi":     privacy_kpi,
            "functional":      raw_func,
            "functional_kpi":  functional_kpi,
            "functional_fuzzer_kpi": functional_fuzzer_kpi,
        }

    # ─── Tier 2: Site Metrics (aggregated from pages) ─────────────────────────
    seo_scores = []
    seo_missing_meta = 0
    seo_missing_title = 0
    seo_missing_alt = 0
    seo_bad_h1 = 0
    seo_missing_meta_pages = []
    seo_missing_title_pages = []
    seo_missing_alt_pages = []
    seo_bad_heading_pages = []
    seo_not_url_clean = 0
    seo_without_lazy = 0
    seo_node_style_url_count = 0
    seo_internal_links_recount = 0
    seo_external_links_recount = 0
    seo_external_domains_recount = set()
    seo_contextual_internal_links_total = 0
    seo_low_confidence_hash_pages = 0
    # Phase K: homepage H1 detection and duplicate content rate
    seo_content_hashes: dict = {}   # {hash: [url, ...]}
    homepage_h1_missing = False
    scan_start_url = (get_scan_entry(scan_id) or {}).get("url", "").rstrip("/")
    ux_missing_images = 0
    ux_low_text_ratio = 0
    ux_missing_links = 0
    ux_maps = 0
    ux_simulators = 0
    ux_funnels = 0
    ux_invisible_links_total = 0
    ux_raw_ip_link_total = 0
    ux_pages_with_raw_ip = 0
    ux_plain_emails_all: list = []
    ux_pages_with_plain_emails = 0
    ux_raw_ip_page_urls = []
    ux_missing_product_image_pages = []
    ux_missing_contextual_link_pages = []
    ux_mobile_checked_pages = 0
    ux_mobile_overflow_pages = 0
    ux_mobile_overflow_urls = []
    ux_mobile_rows = []
    headless_fcp = []
    headless_lcp = []
    headless_cls = []
    headless_speed = []
    headless_eco = []
    broken_links = []
    duplicate_pages = []
    headless_sample = []
    perf_console_error_pages = 0
    perf_nonfunc_button_pages = 0
    perf_console_error_page_urls = []
    perf_nonfunc_button_page_urls = []
    perf_nonfunc_button_total = 0
    perf_nonfunc_button_details = []
    homepage_console_errors: list = []   # Phase M-4: actual error messages from homepage
    homepage_console_error_count = 0
    mobile_metrics_data = None  # Phase H: set from the homepage headless result
    # Phase L: content freshness + page classification
    content_pub_dates: list = []      # all non-None last_pub_date values
    content_news_page_count = 0
    content_partenariat_page_count = 0
    nlp_faq_pages = 0  # Gap #9: FAQ pages detected by NLP worker
    nlp_rgpd_retention_pages = 0    # Gap #41: pages mentioning data retention duration
    nlp_rgpd_minimization_pages = 0  # Gap #42: pages mentioning data minimization
    nlp_keyword_stuffing_pages = 0
    context_keyword_stuffing_pages = []
    nlp_landing_pages = 0
    nlp_product_pages = 0
    nlp_thin_content_pages = 0
    nlp_not_evaluated_pages = 0
    nlp_seo_h1_missing_pages = 0
    nlp_seo_h1_multiple_pages = 0
    nlp_seo_title_too_long_pages = 0
    nlp_seo_meta_missing_pages = 0
    nlp_seo_no_internal_links_pages = 0
    nlp_seo_schema_faq_pages = 0
    nlp_seo_llms_present_pages = 0
    nlp_content_transactional_no_cta_pages = 0
    nlp_content_high_broken_structure_pages = 0
    nlp_content_low_lexical_diversity_pages = 0
    nlp_content_formal_tone_pages = 0
    nlp_content_commercial_tone_pages = 0
    lexical_diversity_sum = 0.0
    lexical_diversity_count = 0
    reading_minutes_sum = 0.0
    reading_minutes_count = 0
    nlp_rgpd_rights_low_pages = 0
    nlp_rgpd_pre_consent_violation_pages = 0
    nlp_rgpd_privacy_score_low_pages = 0
    nlp_rgpd_dpo_incomplete_pages = 0
    rgpd_privacy_policy_inferred_urls = set()
    rgpd_declared_purpose_inferred_urls = set()
    typo_pages = 0
    typo_density_total = 0.0
    typo_density_samples = []
    seo_non_clean_url_rows = []
    seo_external_link_rows = []
    seo_h1_quality_rows = []
    seo_meta_nlp_rows = []
    seo_llms_rows_by_url = {}
    perf_console_error_rows = []
    content_freshness_rows = []
    content_thin_rows = []
    content_cta_rows = []
    content_broken_structure_rows = []
    content_lexical_rows = []
    rgpd_retention_rows = []
    rgpd_minimization_rows = []
    rgpd_purpose_rows = []
    rgpd_rights_rows = []
    rgpd_pre_consent_rows = []
    rgpd_privacy_score_rows = []
    rgpd_runtime_pre_consent_urls = set()
    rgpd_cookie_consent_rows = []
    audience_rows = []
    cannibalization_map = defaultdict(list)
    cannibalization_keywords = defaultdict(list)
    brand_exclusion_terms = _build_brand_exclusion_terms(scan_start_url)
    audience_segment_counts = defaultdict(int)
    audience_confidence_counts = {"low": 0, "medium": 0, "high": 0}
    menu_bad_pages = 0
    menu_issue_samples = []
    menu_issue_map = {}
    evidence_provenance_counts = {
        "static": 0,
        "runtime": 0,
        "mixed": 0,
        "unknown": 0,
    }
    ux_content_zone_detected_pages = 0
    ux_contextual_reliable_pages = 0
    
    # ─── Tier 3: Issues Aggregation Dictionary ──────────────────────────────
    # Structure: {"seo": {"Missing H1": {"count": 1, "urls": ["url1"]}}}
    issue_aggregator = {"seo": {}, "ux": {}, "nlp": {}}

    for row in page_rows:
        page_url = row["url"]
        m = _j(row.get("metrics"))
        nlp = _j(row.get("nlp_results"))

        evidence_provenance = str(m.get("evidence_provenance", "")).strip().lower()
        if evidence_provenance not in evidence_provenance_counts:
            evidence_provenance = "unknown"
        evidence_provenance_counts[evidence_provenance] += 1

        # m contains {"seo": {...}, "ux": {...}} or legacy flat SEO result
        seo = _safe_dict(m.get("seo", m))  # fallback to flat if old format
        ux  = _safe_dict(m.get("ux", {}))
        seo_meta = _safe_dict(seo.get("meta"))

        # Aggregate SEO
        score = seo.get("score", 0)
        if score:
            seo_scores.append(score)
        if not seo_meta.get("has_meta_description", True):
            seo_missing_meta += 1
            seo_missing_meta_pages.append(page_url)
        if not seo_meta.get("title"):
            seo_missing_title += 1
            seo_missing_title_pages.append(page_url)
        seo_missing_alt_count = seo.get("images_no_alt", 0)
        seo_missing_alt  += seo_missing_alt_count
        if seo_missing_alt_count > 0:
            seo_missing_alt_pages.append(page_url)
        if not seo.get("heading_valid", True):
            seo_bad_h1 += 1
            seo_bad_heading_pages.append(page_url)
        if not seo.get("url_clean", True):
            seo_not_url_clean += 1
            seo_non_clean_url_rows.append({
                "url": page_url,
                "issue": "non_clean_url",
                "guidance": "Use short readable slugs without node ids or tracking query strings",
            })
        if not seo.get("has_lazy_images", True):
            seo_without_lazy += 1
        seo_node_style_url_count += seo.get("node_style_url_count", 0)
        links = _safe_dict(seo.get("links"))
        seo_internal_links_recount += int(links.get("internal_links", 0) or 0)
        seo_external_links_recount += int(links.get("external_links", 0) or 0)
        for domain in _safe_list(links.get("external_domains", [])):
            if not isinstance(domain, str):
                continue
            normalized = domain.strip().lower()
            if normalized.startswith("www."):
                normalized = normalized[4:]
            if normalized:
                seo_external_domains_recount.add(normalized)
                if len(seo_external_link_rows) < 200:
                    seo_external_link_rows.append({
                        "page_url": page_url,
                        "external_domain": normalized,
                        "quality_signal": "domain_detected",
                    })

        # Phase K-1: detect homepage H1
        if page_url.rstrip("/") == scan_start_url:
            headings = _safe_list(seo.get("headings"))
            has_h1 = any(isinstance(h, dict) and str(h.get("tag", "")).lower() == "h1" for h in headings)
            homepage_h1_missing = not has_h1
        # Phase K-2: track content hashes for duplicate rate
        ch = str(seo.get("content_hash", "") or "").strip()
        try:
            ch_conf = float(seo.get("content_hash_confidence", 0.0) or 0.0)
        except (TypeError, ValueError):
            ch_conf = 0.0
        if ch and ch_conf >= 0.45:
            seo_content_hashes.setdefault(ch, []).append(page_url)
        else:
            seo_low_confidence_hash_pages += 1

        # Aggregate UX
        missing_imgs = ux.get("product_cards_missing_images", [])
        if missing_imgs:
            ux_missing_images += 1
            ux_missing_product_image_pages.append(page_url)
        if not ux.get("is_readable", True):
            ux_low_text_ratio += 1
        ux_issues_list = _safe_list(ux.get("issues"))
        for iss in ux_issues_list:
            if "Maillage" in iss:
                ux_missing_links += 1
                ux_missing_contextual_link_pages.append(page_url)
                break
        if ux.get("has_map"):
            ux_maps += 1
        seo_contextual_internal_links_total += int(ux.get("contextual_internal_links", 0) or 0)
        if bool(ux.get("content_zone_detected")):
            ux_content_zone_detected_pages += 1
        if bool(ux.get("contextual_measurement_reliable")):
            ux_contextual_reliable_pages += 1
        if ux.get("simulator_count", 0) > 0:
            ux_simulators += 1
        if ux.get("is_funnel_step"):
            ux_funnels += 1
        menu_ok = ux.get("menu_structure_ok")
        if menu_ok is False:
            menu_bad_pages += 1
            menu_issues = _safe_list(ux.get("menu_structure_issues"))
            menu_issue_map[page_url] = menu_issues
            for issue in menu_issues[:2]:
                menu_issue_samples.append(f"{page_url}: {issue}")
        # Phase E: aggregate raw IP and plain email KPIs
        ip_count = ux.get("raw_ip_link_count", 0)
        if ip_count > 0:
            ux_raw_ip_link_total += ip_count
            ux_pages_with_raw_ip += 1
            ux_raw_ip_page_urls.append(page_url)
        page_emails = ux.get("plain_emails_found", [])
        if page_emails:
            ux_plain_emails_all.extend(page_emails)
            ux_pages_with_plain_emails += 1

        # Headless (stored per page in metrics under "headless" key or as legacy flat)
        headless = m.get("headless", {})
        if headless:
            if headless.get("fcp_ms"):
                headless_fcp.append(headless["fcp_ms"])
            if headless.get("lcp_ms"):
                headless_lcp.append(headless["lcp_ms"])
            if headless.get("cls") is not None:
                headless_cls.append(headless["cls"])
            speed_index_ms = headless.get("speed_index_ms")
            if speed_index_ms is not None and speed_index_ms > 0:
                headless_speed.append(speed_index_ms)
            if headless.get("eco_index") is not None:
                headless_eco.append(headless["eco_index"])
            if headless.get("invisible_links", 0) > 0:
                ux_invisible_links_total += headless["invisible_links"]
            mobile_overflow = headless.get("mobile_overflow")
            if mobile_overflow is not None:
                ux_mobile_checked_pages += 1
                is_mobile_overflow = (
                    mobile_overflow
                    if isinstance(mobile_overflow, bool)
                    else str(mobile_overflow).strip().lower() in {"1", "true", "yes"}
                )
                ux_mobile_rows.append({
                    "page_url": page_url,
                    "viewport": "mobile",
                    "overflow": bool(is_mobile_overflow),
                    "tap_issue": False,
                    "layout_issue": "horizontal_overflow" if is_mobile_overflow else "none",
                })
                if is_mobile_overflow:
                    ux_mobile_overflow_pages += 1
                    ux_mobile_overflow_urls.append(page_url)
            cmp_banner = _safe_dict(headless.get("cmp_banner"))
            if cmp_banner:
                rgpd_cookie_consent_rows.append({
                    "page_url": page_url,
                    "selector": cmp_banner.get("selector"),
                    "visible": cmp_banner.get("visible"),
                    "text": _evidence_snippet(cmp_banner.get("text")),
                    "source": cmp_banner.get("source") or "runtime",
                })
            tracker_timeline = _safe_list(headless.get("tracker_timeline"))
            if tracker_timeline:
                rgpd_runtime_pre_consent_urls.add(page_url)
                for tracker in tracker_timeline[:50]:
                    if not isinstance(tracker, dict):
                        continue
                    rgpd_pre_consent_rows.append({
                        "page_url": page_url,
                        "tracker_domain": tracker.get("tracker_domain"),
                        "category": tracker.get("category"),
                        "order": tracker.get("order"),
                        "before_consent": tracker.get("before_consent", True),
                        "request_url": tracker.get("request_url"),
                        "vendor": tracker.get("vendor"),
                        "resource_type": tracker.get("resource_type"),
                        "source": tracker.get("source") or "runtime_network",
                    })
            # Phase G: console errors + non-functional buttons
            if headless.get("console_error_count", 0) > 0:
                perf_console_error_pages += 1
                perf_console_error_page_urls.append(page_url)
                messages = _safe_list(headless.get("console_errors"))
                if messages:
                    for message in messages[:10]:
                        perf_console_error_rows.append({
                            "page_url": page_url,
                            "message": _evidence_snippet(message, 260),
                            "source": "browser_console",
                            "line": None,
                            "count": 1,
                        })
                else:
                    perf_console_error_rows.append({
                        "page_url": page_url,
                        "message": "Console errors detected but messages were not retained",
                        "source": "browser_console",
                        "line": None,
                        "count": int(headless.get("console_error_count", 0) or 0),
                    })
            if headless.get("non_functional_button_count", 0) > 0:
                perf_nonfunc_button_pages += 1
                perf_nonfunc_button_page_urls.append(page_url)
                details = headless.get("non_functional_button_details") or []
                if isinstance(details, list) and details:
                    seen_button_details = set()
                    for detail in details:
                        if not isinstance(detail, dict):
                            continue
                        detail_key = (
                            page_url,
                            str(detail.get("href") or "").strip().lower(),
                            str(detail.get("label") or detail.get("label_or_text") or "").strip().lower(),
                            str(detail.get("issue_type") or "").strip().lower(),
                        )
                        if detail_key in seen_button_details:
                            continue
                        seen_button_details.add(detail_key)
                        perf_nonfunc_button_details.append({
                            "url": page_url,
                            "label": detail.get("label") or "(unnamed)",
                            "selector": detail.get("selector"),
                            "tag": detail.get("tag"),
                            "issue_type": detail.get("issue_type"),
                            "href": detail.get("href"),
                            "onclick": detail.get("onclick"),
                            "form_action": detail.get("form_action"),
                        })
                else:
                    for label in (headless.get("non_functional_buttons") or []):
                        perf_nonfunc_button_details.append({
                            "url": page_url,
                            "label": str(label or "(unnamed)"),
                            "selector": None,
                            "tag": None,
                            "issue_type": "button_without_action",
                            "href": None,
                            "onclick": None,
                            "form_action": None,
                        })
                perf_nonfunc_button_total += int(headless.get("non_functional_button_count", 0) or 0)
            # Phase M-4: capture homepage console errors list
            if page_url.rstrip("/") == scan_start_url:
                homepage_console_error_count = headless.get("console_error_count", 0)
                homepage_console_errors = headless.get("console_errors") or []
            # Phase H: mobile metrics (only present on homepage result)
            # Use is not None to distinguish missing (None) from a valid empty/zero result
            # Also normalize trailing slash to avoid URL mismatch between scanner and DB
            if headless.get("mobile_metrics") is not None and mobile_metrics_data is None:
                if page_url.rstrip("/") == scan_start_url.rstrip("/"):
                    mobile_metrics_data = headless["mobile_metrics"]
                else:
                    # Fallback: keep the first available mobile metrics sample
                    # if homepage URL matching fails due normalization differences.
                    mobile_metrics_data = headless["mobile_metrics"]
            headless_sample.append({
                "url": page_url,
                "fcp_ms": headless.get("fcp_ms"),
                "lcp_ms": headless.get("lcp_ms"),
                "cls": headless.get("cls"),
                "speed_index_ms": headless.get("speed_index_ms"),
                "eco_score": headless.get("eco_score"),
                "eco_index": headless.get("eco_index"),
                "mobile_overflow": headless.get("mobile_overflow"),
                "tablet_overflow": headless.get("tablet_overflow"),
                "invisible_links": headless.get("invisible_links", 0),
                "unused_js_kb": round(headless.get("unused_js_bytes", 0) / 1024, 1),
                "unused_css_kb": round(headless.get("unused_css_bytes", 0) / 1024, 1),
            })

        # ─── Tier 3: Issues per URL Aggregation ─────────────────────────────────
        seo_page_issues = seo.get("issues", [])
        if seo_page_issues:
            for iss in seo_page_issues:
                if iss not in issue_aggregator["seo"]:
                    issue_aggregator["seo"][iss] = {"count": 0, "urls": []}
                issue_aggregator["seo"][iss]["count"] += 1
                if len(issue_aggregator["seo"][iss]["urls"]) < 5:
                    issue_aggregator["seo"][iss]["urls"].append(page_url)
                    
        if ux_issues_list:
            for iss in ux_issues_list:
                if iss not in issue_aggregator["ux"]:
                    issue_aggregator["ux"][iss] = {"count": 0, "urls": []}
                issue_aggregator["ux"][iss]["count"] += 1
                if len(issue_aggregator["ux"][iss]["urls"]) < 5:
                    issue_aggregator["ux"][iss]["urls"].append(page_url)
                    
        nlp_issues = nlp.get("issues", []) if nlp else []
        if nlp_issues:
            for iss in nlp_issues:
                if iss not in issue_aggregator["nlp"]:
                    issue_aggregator["nlp"][iss] = {"count": 0, "urls": []}
                issue_aggregator["nlp"][iss]["count"] += 1
                if len(issue_aggregator["nlp"][iss]["urls"]) < 5:
                    issue_aggregator["nlp"][iss]["urls"].append(page_url)

        # Phase L: collect date + classification from nlp_results
        if nlp:
            nlp_status = str(nlp.get("status", "evaluated")).strip().lower()
            if nlp_status == "not_evaluated":
                nlp_not_evaluated_pages += 1
                continue

            lpd = nlp.get("last_pub_date")
            if lpd:
                try:
                    from datetime import date as _date
                    pub = _date.fromisoformat(str(lpd))
                    if pub <= _date.today():
                        content_pub_dates.append(str(lpd))
                        content_freshness_rows.append({
                            "page_url": page_url,
                            "latest_date": str(lpd),
                            "source": nlp.get("last_pub_date_source"),
                            "page_type": nlp.get("page_type"),
                            "stale_threshold_days": 365,
                        })
                except (TypeError, ValueError):
                    pass
            if nlp.get("is_news_page"):
                content_news_page_count += 1
            if nlp.get("is_partenariat_page"):
                content_partenariat_page_count += 1
            if nlp.get("page_type") == "faq":  # Gap #9
                nlp_faq_pages += 1
            if nlp.get("page_type") == "landing":
                nlp_landing_pages += 1
            if nlp.get("page_type") == "product":
                nlp_product_pages += 1
            if nlp.get("content_type_hint") == "stuffed":
                nlp_keyword_stuffing_pages += 1
                context_keyword_stuffing_pages.append(page_url)
                content_thin_rows.append({
                    "page_url": page_url,
                    "word_count": nlp.get("word_count"),
                    "typo_density": nlp.get("typo_density"),
                    "stuffing_signal": True,
                    "snippet": _evidence_snippet(_safe_dict(_safe_dict(nlp.get("content_kpis")).get("above_fold")).get("above_fold_snippet")),
                })
            if (nlp.get("word_count") or 0) < 300:
                nlp_thin_content_pages += 1
                content_thin_rows.append({
                    "page_url": page_url,
                    "word_count": nlp.get("word_count"),
                    "typo_density": nlp.get("typo_density"),
                    "stuffing_signal": nlp.get("content_type_hint") == "stuffed",
                    "snippet": _evidence_snippet(_safe_dict(_safe_dict(nlp.get("content_kpis")).get("above_fold")).get("above_fold_snippet")),
                })
            typo_density = float(nlp.get("typo_density", 0.0) or 0.0)
            # Count typo-affected pages only at the failing threshold.
            # Tiny non-zero densities are often benign/noise and can inflate page counts.
            if typo_density >= 0.08:
                typo_pages += 1
                typo_density_total += typo_density
                typo_density_samples.extend(nlp.get("typo_samples", [])[:3])

            stem = nlp.get("dominant_keyword_stem")
            kw = nlp.get("dominant_keyword")
            if stem and _is_valid_cannibalization_term(stem, kw):
                if str(stem).strip().lower() in brand_exclusion_terms or str(kw).strip().lower() in brand_exclusion_terms:
                    pass
                else:
                    cannibalization_map[stem].append(page_url)
                    if kw:
                        cannibalization_keywords[stem].append(kw)

            audience = nlp.get("audience_segment", {})
            seg = audience.get("segment", "unknown")
            conf = audience.get("confidence", "low")
            audience_segment_counts[seg] += 1
            if conf in audience_confidence_counts:
                audience_confidence_counts[conf] += 1
            if len(audience_rows) < 200:
                audience_rows.append({
                    "page_url": page_url,
                    "segment": seg,
                    "confidence": conf,
                    "source": audience.get("source"),
                    "snippet": _evidence_snippet(_safe_dict(_safe_dict(nlp.get("content_kpis")).get("above_fold")).get("above_fold_snippet")),
                })

            rgpd_text = nlp.get("rgpd_text_analysis", {})
            page_url_lower = page_url.lower()
            legal_privacy_url = any(token in page_url_lower for token in (
                "mentions-legales",
                "conditions-generales",
                "privacy",
                "confidential",
                "politique",
                "donnees-personnelles",
                "cookies",
            ))
            if legal_privacy_url and (rgpd_text.get("has_rgpd_content_signal") or rgpd_text.get("used_strong_signal")):
                rgpd_privacy_policy_inferred_urls.add(page_url)
            if legal_privacy_url and rgpd_text.get("purpose_mentioned"):
                rgpd_declared_purpose_inferred_urls.add(page_url)
            if rgpd_text.get("data_retention_mentioned"):   # Gap #41
                nlp_rgpd_retention_pages += 1
                rgpd_retention_rows.append({
                    "page_url": page_url,
                    "snippet": _evidence_snippet((_safe_list(rgpd_text.get("retention_phrases")) or [""])[0]),
                    "retention_period": rgpd_text.get("retention_period"),
                })
            if rgpd_text.get("data_minimization_mentioned"):  # Gap #42
                nlp_rgpd_minimization_pages += 1
                rgpd_minimization_rows.append({
                    "page_url": page_url,
                    "snippet": _evidence_snippet((_safe_list(rgpd_text.get("minimization_phrases")) or _safe_list(rgpd_text.get("purpose_phrases")) or [""])[0]),
                })
            if rgpd_text.get("purpose_mentioned"):
                rgpd_purpose_rows.append({
                    "page_url": page_url,
                    "purpose": "mentioned",
                    "snippet": _evidence_snippet((_safe_list(rgpd_text.get("purpose_phrases")) or [""])[0]),
                })

            # Nested NLP KPI aggregation (flat-safe)
            seo_kpis = _j(nlp.get("seo_kpis"))
            if seo_kpis:
                h1_quality = _j(seo_kpis.get("h1_quality"))
                title_quality = _j(seo_kpis.get("title_quality"))
                meta_desc = _j(seo_kpis.get("meta_description"))
                links_kpi = _j(seo_kpis.get("links"))
                schema_kpi = _j(seo_kpis.get("schema_org"))
                llms_kpi = _j(seo_kpis.get("llms_txt"))
                if h1_quality.get("h1_missing"):
                    nlp_seo_h1_missing_pages += 1
                    seo_h1_quality_rows.append({
                        "page_url": page_url,
                        "issue": "h1_missing",
                        "h1_text": h1_quality.get("h1_text"),
                        "h1_count": h1_quality.get("h1_count"),
                        "title": title_quality.get("title_text"),
                    })
                if h1_quality.get("h1_multiple"):
                    nlp_seo_h1_multiple_pages += 1
                    seo_h1_quality_rows.append({
                        "page_url": page_url,
                        "issue": "h1_multiple",
                        "h1_text": h1_quality.get("h1_text"),
                        "h1_count": h1_quality.get("h1_count"),
                        "title": title_quality.get("title_text"),
                    })
                if title_quality.get("title_too_long"):
                    nlp_seo_title_too_long_pages += 1
                    seo_meta_nlp_rows.append({
                        "page_url": page_url,
                        "issue": "title_too_long",
                        "meta_description": meta_desc.get("meta_description_text"),
                        "length": title_quality.get("title_length"),
                    })
                if not meta_desc.get("meta_description_present", True):
                    nlp_seo_meta_missing_pages += 1
                    seo_meta_nlp_rows.append({
                        "page_url": page_url,
                        "issue": "meta_missing",
                        "meta_description": meta_desc.get("meta_description_text"),
                        "length": meta_desc.get("meta_description_length"),
                    })
                if links_kpi.get("has_no_internal_links"):
                    nlp_seo_no_internal_links_pages += 1
                if schema_kpi.get("schema_faq_present"):
                    nlp_seo_schema_faq_pages += 1
                if llms_kpi.get("llms_txt_present"):
                    nlp_seo_llms_present_pages += 1
                llms_url = llms_kpi.get("llms_url") or f"https://{base_domain}/llms.txt"
                if llms_url and llms_url not in seo_llms_rows_by_url:
                    useful_lines = _safe_list(llms_kpi.get("useful_lines"))
                    seo_llms_rows_by_url[llms_url] = {
                        "llms_url": llms_url,
                        "status": llms_kpi.get("status_code"),
                        "content_type": llms_kpi.get("content_type"),
                        "length": llms_kpi.get("length"),
                        "useful_line": _evidence_snippet(useful_lines[0] if useful_lines else ""),
                        "parse_status": llms_kpi.get("parse_status") or ("present" if llms_kpi.get("llms_txt_present") else "missing"),
                    }

            content_kpis = _j(nlp.get("content_kpis"))
            if content_kpis:
                intent_kpi = _j(content_kpis.get("intent"))
                cta_kpi = _j(content_kpis.get("cta"))
                tone_kpi = _j(content_kpis.get("tone"))
                if intent_kpi.get("intent") == "transactional" and int(cta_kpi.get("cta_count", 0) or 0) == 0:
                    nlp_content_transactional_no_cta_pages += 1
                    content_cta_rows.append({
                        "page_url": page_url,
                        "intent": intent_kpi.get("intent"),
                        "cta_count": cta_kpi.get("cta_count", 0),
                        "snippet": _evidence_snippet(_safe_dict(content_kpis.get("above_fold")).get("above_fold_snippet")),
                    })
                if int(content_kpis.get("broken_structure_index", 0) or 0) >= 50:
                    nlp_content_high_broken_structure_pages += 1
                    content_broken_structure_rows.append({
                        "page_url": page_url,
                        "broken_structure_index": content_kpis.get("broken_structure_index"),
                        "page_type": nlp.get("page_type"),
                        "snippet": _evidence_snippet(_safe_dict(content_kpis.get("above_fold")).get("above_fold_snippet")),
                    })
                lex_div = content_kpis.get("lexical_diversity")
                if isinstance(lex_div, (int, float)):
                    lexical_diversity_sum += float(lex_div)
                    lexical_diversity_count += 1
                    if float(lex_div) < 0.4:
                        nlp_content_low_lexical_diversity_pages += 1
                        content_lexical_rows.append({
                            "page_url": page_url,
                            "lexical_diversity": round(float(lex_div), 4),
                            "token_count": content_kpis.get("lexical_diversity_token_count"),
                            "threshold": 0.4,
                        })
                reading_kpi = _j(content_kpis.get("reading_time"))
                if isinstance(reading_kpi.get("reading_time_minutes"), (int, float)):
                    reading_minutes_sum += float(reading_kpi.get("reading_time_minutes"))
                    reading_minutes_count += 1
                tone = tone_kpi.get("tone")
                if tone == "formal":
                    nlp_content_formal_tone_pages += 1
                elif tone == "commercial":
                    nlp_content_commercial_tone_pages += 1

            rgpd_kpis = _j(nlp.get("rgpd_kpis"))
            if rgpd_kpis:
                rights_kpi = _j(rgpd_kpis.get("rights_coverage"))
                pre_consent_kpi = _j(rgpd_kpis.get("pre_consent"))
                privacy_score_kpi = _j(rgpd_kpis.get("privacy_score"))
                dpo_kpi = _j(rgpd_kpis.get("dpo_contact"))
                rights_score = rights_kpi.get("rights_coverage_score")
                if isinstance(rights_score, int) and rights_score < 4:
                    nlp_rgpd_rights_low_pages += 1
                if isinstance(rights_score, int):
                    rgpd_rights_rows.append({
                        "page_url": page_url,
                        "rights_found": ", ".join(_safe_list(rights_kpi.get("rights_found"))),
                        "rights_missing": ", ".join(_safe_list(rights_kpi.get("rights_missing"))),
                        "score": rights_score,
                    })
                if pre_consent_kpi.get("pre_consent_violation") is True:
                    nlp_rgpd_pre_consent_violation_pages += 1
                    for order, tracker in enumerate(_safe_list(pre_consent_kpi.get("pre_consent_trackers")), start=1):
                        rgpd_pre_consent_rows.append({
                            "page_url": page_url,
                            "tracker_domain": tracker,
                            "category": "advertising",
                            "order": order,
                            "before_consent": True,
                        })
                privacy_score = privacy_score_kpi.get("privacy_policy_score")
                if isinstance(privacy_score, int) and privacy_score < 60:
                    nlp_rgpd_privacy_score_low_pages += 1
                    rgpd_privacy_score_rows.append({
                        "page_url": page_url,
                        "score": privacy_score,
                        "weakness": ", ".join([
                            name for name, present in [
                                ("retention", rgpd_text.get("data_retention_mentioned")),
                                ("minimization", rgpd_text.get("data_minimization_mentioned")),
                                ("purpose", privacy_score_kpi.get("purpose_mentioned")),
                                ("legal_basis", privacy_score_kpi.get("legal_basis_mentioned")),
                            ]
                            if not present
                        ]),
                        "snippet": _evidence_snippet(_safe_dict(_safe_dict(nlp.get("content_kpis")).get("above_fold")).get("above_fold_snippet")),
                    })
                if privacy_score_kpi.get("purpose_mentioned") is True:
                    rgpd_declared_purpose_inferred_urls.add(page_url)
                dpo_score = dpo_kpi.get("dpo_completeness_score")
                if isinstance(dpo_score, int) and dpo_score < 2:
                    nlp_rgpd_dpo_incomplete_pages += 1

    # Format the issue_aggregator for the final JSON
    formatted_issues = {}
    for axis, issues_dict in issue_aggregator.items():
        if issues_dict:
            formatted_issues[axis] = []
            for iss_text, data in issues_dict.items():
                formatted_issues[axis].append({
                    "issue": iss_text,
                    "count": data["count"],
                    "example_urls": data["urls"]
                })

    avg = lambda lst: round(sum(lst) / len(lst), 1) if lst else None

    # ─── Phase K post-loop computations ──────────────────────────────────────
    # K-2: duplicate content rate
    total_pages = len(page_rows)
    dup_page_count = sum(len(v) for v in seo_content_hashes.values() if len(v) > 1)
    hash_eligible_pages = sum(len(v) for v in seo_content_hashes.values())
    dup_content_rate_pct = round(dup_page_count / hash_eligible_pages * 100, 1) if hash_eligible_pages > 0 else 0.0
    duplication_reliability = "reliable"
    duplication_note = ""
    if seo_low_confidence_hash_pages > 0:
        duplication_reliability = "partial"
        duplication_note = (
            f"{seo_low_confidence_hash_pages} page(s) had low-confidence content extraction "
            "and were excluded from duplicate-content computation"
        )
    if dup_content_rate_pct >= 80.0 and seo_low_confidence_hash_pages > 0:
        duplication_reliability = "pipeline_suspect"
        duplication_note = (
            "Very high duplication rate combined with low-confidence extraction; "
            "treat this as a pipeline-quality warning before classifying as real duplication"
        )
    if duplication_reliability == "pipeline_suspect":
        dup_content_kpi_passed = None
    else:
        dup_content_kpi_passed = dup_content_rate_pct <= 10.0
    # K-3: unique external domains (from DB — computed by Go scanner)
    raw_seo_kpi = _j(summary_row.get("seo_kpi_extended")) if summary_row else {}
    unique_external_domains = int(raw_seo_kpi.get("unique_external_domains", 0) or 0)
    if unique_external_domains <= 0 and seo_external_domains_recount:
        unique_external_domains = len(seo_external_domains_recount)
    seo_has_robots_txt = bool(raw_seo_kpi.get("has_robots_txt", False) or raw_seo_kpi.get("robots_url"))
    if not seo_has_robots_txt:
        robots_disclosure = _safe_dict(raw_sec.get("robots_txt_info_disclosure", {}))
        if _safe_list(robots_disclosure.get("disclosed_paths")):
            seo_has_robots_txt = True
            raw_seo_kpi["robots_detected_via"] = raw_seo_kpi.get("robots_detected_via") or "security_reuse"
            raw_seo_kpi["robots_url"] = raw_seo_kpi.get("robots_url") or f"{scan_start_url.rstrip('/')}/robots.txt"
    seo_has_sitemap = bool(raw_seo_kpi.get("has_sitemap", False) or raw_seo_kpi.get("sitemap_url"))
    contextual_reliable_coverage_pct = round((ux_contextual_reliable_pages / max(total_pages, 1)) * 100, 2) if total_pages else 0.0
    summary_internal_links = int(raw_seo_kpi.get("total_internal_links", 0) or 0)
    summary_external_links = int(raw_seo_kpi.get("total_external_links", 0) or 0)
    if summary_internal_links > 0:
        effective_total_internal_links = summary_internal_links
        internal_linking_source = "seo_summary"
        internal_linking_note = ""
    else:
        effective_total_internal_links = seo_internal_links_recount
        internal_linking_source = "page_recount"
        internal_linking_note = (
            "Summary internal-link total was empty; KPI uses per-page SEO link recount fallback"
            if effective_total_internal_links > 0 else
            "Internal-link total could not be reconstructed from summary or per-page SEO metrics"
        )
    effective_total_external_links = summary_external_links if summary_external_links > 0 else seo_external_links_recount
    runtime_pre_consent_violation_pages = len(rgpd_runtime_pre_consent_urls)
    if rgpd_cookie_consent_rows:
        consent = privacy_kpi.setdefault("cookie_consent", {})
        consent["rows"] = rgpd_cookie_consent_rows[:50]
        consent["has_banner"] = True
        consent["cmp_present"] = True
    # ─── Phase L post-loop computations ─────────────────────────────────────
    latest_pub_date = max(content_pub_dates) if content_pub_dates else None
    # Freshness KPI: passed if latest date is within the last 365 days
    from datetime import date as _date
    freshness_passed: bool
    if latest_pub_date:
        try:
            pub = _date.fromisoformat(latest_pub_date)
            freshness_passed = pub <= _date.today() and (_date.today() - pub).days <= 365
        except ValueError:
            freshness_passed = False
    else:
        freshness_passed = False  # no dates found → cannot confirm freshness
    # Bug 3 fallback retained: if still missing after page-level scan, keep None safely.
    avg_typo_density = round(typo_density_total / max(typo_pages, 1), 4) if typo_pages > 0 else 0.0
    avg_lexical_diversity = round(lexical_diversity_sum / max(lexical_diversity_count, 1), 4) if lexical_diversity_count > 0 else None
    avg_reading_time_minutes = round(reading_minutes_sum / max(reading_minutes_count, 1), 2) if reading_minutes_count > 0 else None
    cannibalized_keywords = []
    for stem, pages in cannibalization_map.items():
        if len(pages) < 5:
            continue
        surface = ""
        if cannibalization_keywords.get(stem):
            surface = Counter(cannibalization_keywords[stem]).most_common(1)[0][0]
        cannibalized_keywords.append({
            "keyword_stem": stem,
            "keyword": surface,
            "count": len(pages),
            "pages": pages[:10],
        })
    duplicate_clusters = []
    for idx, (content_hash, urls) in enumerate(seo_content_hashes.items(), start=1):
        if len(urls) <= 1:
            continue
        for url in urls[:10]:
            duplicate_clusters.append({
                "cluster": idx,
                "url": url,
                "similarity": 1.0,
                "hash": content_hash[:12],
                "confidence": "hash_match",
            })

    menu_passed = menu_bad_pages == 0
    with ThreadPoolExecutor(max_workers=2) as _pool:
        _footer_fut = _pool.submit(evaluate_footer_rgpd_alignment, scan_id, scan_start_url, page_rows)
        _compat_fut = _pool.submit(evaluate_multi_browser_compatibility, scan_start_url)
        footer_rgpd_alignment = _footer_fut.result()
        multi_browser_compat = _compat_fut.result()
    inferred_privacy_urls = sorted(rgpd_privacy_policy_inferred_urls)
    inferred_purpose_urls = sorted(rgpd_declared_purpose_inferred_urls)
    if not bool(privacy_kpi.get("has_privacy_policy")) and inferred_privacy_urls:
        privacy_kpi["has_privacy_policy"] = True
        raw_priv["has_privacy_policy"] = True
        raw_priv["privacy_policy_inferred_from_content"] = True
        raw_priv["privacy_policy_inferred_urls"] = inferred_privacy_urls
    if not bool(privacy_kpi.get("has_declared_purpose")) and inferred_purpose_urls:
        privacy_kpi["has_declared_purpose"] = True
        raw_priv["has_declared_purpose"] = True
        raw_priv["declared_purpose_inferred_from_content"] = True
        raw_priv["declared_purpose_inferred_urls"] = inferred_purpose_urls

    site_metrics = {
        "seo": {
            "avg_score": avg(seo_scores),
            "pages_missing_meta_desc": seo_missing_meta,
            "pages_missing_title": seo_missing_title,
            "images_missing_alt": seo_missing_alt,
            "pages_with_bad_h1": seo_bad_h1,
            "pages_not_url_clean": seo_not_url_clean,
            "pages_without_lazy_loading": seo_without_lazy,
            "has_sitemap": seo_has_sitemap,
            "has_robots_txt": seo_has_robots_txt,
            "total_internal_links": effective_total_internal_links,
            "total_external_links": effective_total_external_links,
            "total_contextual_internal_links": seo_contextual_internal_links_total,
            "internal_linking_source": internal_linking_source,
            "internal_linking_note": internal_linking_note,
            "node_style_url_count": seo_node_style_url_count,
            "non_clean_urls_all": seo_non_clean_url_rows[:200],
            "node_style_url_kpi_passed": seo_node_style_url_count == 0,
            # Phase J: broken links KPI
            "broken_link_kpi": _build_broken_link_kpi(summary_row),
            # Phase K: site-wide aggregations
            "homepage_h1_kpi": {
                "homepage_h1_missing": homepage_h1_missing,
                "passed": not homepage_h1_missing,
            },
            "duplicate_content_kpi": {
                "duplicate_content_rate_pct": dup_content_rate_pct,
                "duplicate_page_count": dup_page_count,
                "hash_eligible_pages": hash_eligible_pages,
                "hash_low_confidence_pages": seo_low_confidence_hash_pages,
                "duplication_reliability": duplication_reliability,
                "pipeline_suspect": duplication_reliability == "pipeline_suspect",
                "note": duplication_note,
                "duplicate_clusters": duplicate_clusters[:200],
                "passed": dup_content_kpi_passed,
            },
            "unique_external_domains": unique_external_domains,
            "external_link_rows": seo_external_link_rows[:200],
            "robots_url": raw_seo_kpi.get("robots_url"),
            "robots_detected_via": raw_seo_kpi.get("robots_detected_via"),
            "sitemap_url": raw_seo_kpi.get("sitemap_url"),
            "sitemap_detected_via": raw_seo_kpi.get("sitemap_detected_via"),
            "multi_browser_compatibility": multi_browser_compat,
            "social_sharing_kpi": {
                "pages_with_social_sharing": int(raw_seo_kpi.get("pages_with_social_sharing", 0) or 0),
                "avg_social_sharing_score": float(raw_seo_kpi.get("avg_social_sharing_score", 0.0) or 0.0),
                "passed": bool(raw_seo_kpi.get("social_sharing_kpi_passed", False)),
            },
            "nlp_seo_kpis": {
                "h1_missing_pages": nlp_seo_h1_missing_pages,
                "h1_multiple_pages": nlp_seo_h1_multiple_pages,
                "title_too_long_pages": nlp_seo_title_too_long_pages,
                "meta_missing_pages": nlp_seo_meta_missing_pages,
                "no_internal_links_pages": nlp_seo_no_internal_links_pages,
                "schema_faq_pages": nlp_seo_schema_faq_pages,
                "llms_txt_present_pages": nlp_seo_llms_present_pages,
            },
            "nlp_seo_h1_kpi": {
                "h1_missing_pages": nlp_seo_h1_missing_pages,
                "h1_multiple_pages": nlp_seo_h1_multiple_pages,
                "rows": seo_h1_quality_rows[:200],
            },
            "nlp_seo_meta_kpi": {
                "title_too_long_pages": nlp_seo_title_too_long_pages,
                "meta_missing_pages": nlp_seo_meta_missing_pages,
                "rows": seo_meta_nlp_rows[:200],
            },
            "nlp_seo_ai_readiness_kpi": {
                "llms_txt_present_pages": nlp_seo_llms_present_pages,
                "rows": list(seo_llms_rows_by_url.values())[:20],
            },
            "contextual_link_measurement": {
                "pages_checked": total_pages,
                "content_zone_detected_pages": ux_content_zone_detected_pages,
                "reliable_pages": ux_contextual_reliable_pages,
                "reliable_coverage_pct": contextual_reliable_coverage_pct,
                "passed": ux_contextual_reliable_pages == total_pages if total_pages else False,
            },
            "evidence_provenance": {
                "static_pages": evidence_provenance_counts["static"],
                "runtime_pages": evidence_provenance_counts["runtime"],
                "mixed_pages": evidence_provenance_counts["mixed"],
                "unknown_pages": evidence_provenance_counts["unknown"],
            },
        },
        "ux": {
            "pages_with_missing_product_images": ux_missing_images,
            "pages_with_low_text_density": ux_low_text_ratio,
            "pages_missing_contextual_links": ux_missing_links,
            "pages_with_maps": ux_maps,
            "pages_with_simulators": ux_simulators,
            "simulator_count": ux_simulators,      # Phase M-6: alias for N checklist
            "pages_with_conversion_funnels": ux_funnels,
            "total_invisible_links": ux_invisible_links_total,
            "raw_ip_link_kpi": {
                "total_raw_ip_links": ux_raw_ip_link_total,
                "pages_with_raw_ip_links": ux_pages_with_raw_ip,
                "passed": ux_pages_with_raw_ip == 0,
            },
            "plain_email_kpi": {
                "plain_emails_found": list(dict.fromkeys(ux_plain_emails_all)),  # deduplicated
                "pages_with_plain_emails": ux_pages_with_plain_emails,
                "passed": ux_pages_with_plain_emails == 0,
            },
            "menu_structure_kpi": {
                "passed": menu_passed,
                "pages_with_menu_issues": menu_bad_pages,
                "evidence": menu_issue_samples[:5],
            },
            "mobile_friendly_kpi": {
                "available": ux_mobile_checked_pages > 0,
                "pages_checked": ux_mobile_checked_pages,
                "pages_with_mobile_overflow": ux_mobile_overflow_pages,
                "affected_page_urls": sorted(set(ux_mobile_overflow_urls)),
                "rows": [
                    {
                        "page_url": url,
                        "viewport": "mobile",
                        "overflow": True,
                        "tap_issue": None,
                        "layout_issue": "horizontal_overflow",
                    }
                    for url in sorted(set(ux_mobile_overflow_urls))
                ] or ux_mobile_rows[:200],
                "passed": (ux_mobile_overflow_pages == 0) if ux_mobile_checked_pages > 0 else None,
                "reason": None if ux_mobile_checked_pages > 0 else "mobile_overflow_not_collected",
            },
            "footer_rgpd_alignment_kpi": footer_rgpd_alignment,
        },
        "performance": {
            "avg_fcp_ms": avg(headless_fcp),
            "avg_lcp_ms": avg(headless_lcp),
            "avg_cls": avg(headless_cls),
            "avg_speed_index_ms": avg(headless_speed),
            "avg_eco_index": avg(headless_eco),
            "html_compression_applied": bool((domain_analysis.get("security", {}) or {}).get("has_compression", False)),
            "headless_rows": headless_sample[:200],
            "total_resource_size_kb": float(raw_seo_kpi.get("total_resource_size_kb", 0.0) or 0.0),
            "gateway_timeout_count": int(raw_seo_kpi.get("gateway_timeout_count", 0) or 0),
            "headless_sample_size": len(headless_sample),
            "console_error_kpi": {
                "pages_with_console_errors": perf_console_error_pages,
                "page_urls": perf_console_error_page_urls[:200],
                # Phase M-4: homepage-specific (most critical for UX)
                "homepage_console_error_count": homepage_console_error_count,
                "homepage_console_errors": homepage_console_errors,
                "rows": perf_console_error_rows[:200],
                "passed": perf_console_error_pages == 0,
            },
            "button_kpi": {
                "pages_with_nonfunc_buttons": perf_nonfunc_button_pages,
                "total_nonfunc_buttons": perf_nonfunc_button_total,
                "broken_buttons": perf_nonfunc_button_details[:200],
                "passed": perf_nonfunc_button_pages == 0,
            },
            "mobile_kpi": {
                "fcp_ms": mobile_metrics_data.get("fcp_ms") if mobile_metrics_data else None,
                "lcp_ms": mobile_metrics_data.get("lcp_ms") if mobile_metrics_data else None,
                "cls": mobile_metrics_data.get("cls") if mobile_metrics_data else None,
                "speed_index_ms": mobile_metrics_data.get("speed_index_ms") if mobile_metrics_data else None,
                "issues": mobile_metrics_data.get("issues", []) if mobile_metrics_data else [],
                "passed": mobile_metrics_data.get("passed", False) if mobile_metrics_data else None,
                "available": mobile_metrics_data is not None,
            },
        },
        # Phase L + M-7: content freshness, page classification, image compression
        "content": {
            "freshness_kpi": {
                "latest_pub_date": latest_pub_date,
                "rows": content_freshness_rows[:200],
                "passed": freshness_passed,
            },
            "news_page_count": content_news_page_count,
            "partenariat_page_count": content_partenariat_page_count,
            # M-7: mirror image compression stats inside content section
            "image_compression_stats": _j(summary_row.get("image_compression")) if summary_row else {},
            # Gap #9: FAQ pages detected by NLP worker
            "faq_pages": nlp_faq_pages,
            "landing_page_count": nlp_landing_pages,
            "product_page_count": nlp_product_pages,
            "nlp_not_evaluated_pages": nlp_not_evaluated_pages,
            "pages_with_keyword_stuffing": nlp_keyword_stuffing_pages,
            "pages_thin_content_nlp": nlp_thin_content_pages,
            "thin_content_rows": content_thin_rows[:200],
            "cannibalized_keywords": cannibalized_keywords,
            "typo_detection": {
                "pages_with_typos": typo_pages,
                "avg_typo_density": avg_typo_density,
                "sample_tokens": list(dict.fromkeys(typo_density_samples))[:10],
                "passed": avg_typo_density < 0.08,
            },
            "audience_segments": {
                "counts": dict(audience_segment_counts),
                "confidence": audience_confidence_counts,
                "rows": audience_rows[:200],
            },
            "advanced_content_kpis": {
                "transactional_no_cta_pages": nlp_content_transactional_no_cta_pages,
                "high_broken_structure_pages": nlp_content_high_broken_structure_pages,
                "low_lexical_diversity_pages": nlp_content_low_lexical_diversity_pages,
                "formal_tone_pages": nlp_content_formal_tone_pages,
                "commercial_tone_pages": nlp_content_commercial_tone_pages,
                "avg_lexical_diversity": avg_lexical_diversity,
                "avg_reading_time_minutes": avg_reading_time_minutes,
                "cta_rows": content_cta_rows[:200],
                "broken_structure_rows": content_broken_structure_rows[:200],
                "lexical_diversity_rows": content_lexical_rows[:200],
            },
            "migration_note": "UX thin-content KPI (<50 words) kept unchanged; NLP thin-content KPI (<300 words) added in parallel.",
            # Gap #41/#42: RGPD signal pages from NLP analysis
            "rgpd_retention_signal_pages": nlp_rgpd_retention_pages,
            "rgpd_minimization_signal_pages": nlp_rgpd_minimization_pages,
            "rgpd_retention_rows": rgpd_retention_rows[:200],
            "rgpd_minimization_rows": rgpd_minimization_rows[:200],
            "rgpd_purpose_rows": rgpd_purpose_rows[:200],
            "advanced_rgpd_kpis": {
                "rights_low_pages": nlp_rgpd_rights_low_pages,
                "pre_consent_violation_pages": nlp_rgpd_pre_consent_violation_pages + runtime_pre_consent_violation_pages,
                "runtime_pre_consent_violation_pages": runtime_pre_consent_violation_pages,
                "privacy_score_low_pages": nlp_rgpd_privacy_score_low_pages,
                "dpo_incomplete_pages": nlp_rgpd_dpo_incomplete_pages,
                "rights_rows": rgpd_rights_rows[:200],
                "pre_consent_rows": rgpd_pre_consent_rows[:200],
                "privacy_score_rows": rgpd_privacy_score_rows[:200],
            },
        },
    }

    # Phase N: build formal checklists
    ux_checklist   = build_ux_checklist(site_metrics, len(page_rows))
    rgpd_checklist = build_rgpd_checklist(domain_analysis, site_metrics)
    not_available_kpis = []
    if site_metrics["seo"]["multi_browser_compatibility"].get("status") != "evaluated":
        not_available_kpis.append({
            "id": "seo_multi_browser_compatibility",
            "label": "Compatibilité multi-navigateurs",
            "status": site_metrics["seo"]["multi_browser_compatibility"].get("status", "not_available"),
            "reason": site_metrics["seo"]["multi_browser_compatibility"].get("reason", "Not available"),
        })
    if site_metrics["ux"]["footer_rgpd_alignment_kpi"].get("status") != "evaluated":
        not_available_kpis.append({
            "id": "ux_footer_rgpd_alignment",
            "label": "Désalignement footer RGPD",
            "status": site_metrics["ux"]["footer_rgpd_alignment_kpi"].get("status", "not_available"),
            "reason": site_metrics["ux"]["footer_rgpd_alignment_kpi"].get("reason", "Not available"),
        })

    report = {
        "scan_id": scan_id,
        "domain": (get_scan_entry(scan_id) or {}).get("url", summary_row.get("domain", "") if summary_row else ""),
        "pages_scanned": len(page_rows),
        "service_name": "v3-aggregator",
        "scan_telemetry": _j(summary_row.get("scan_telemetry")) if summary_row else {},
        "domain_analysis": domain_analysis,
        "site_metrics": site_metrics,
        "issues": formatted_issues,
        "headless_sample": headless_sample,
        "image_compression": _j(summary_row.get("image_compression")) if summary_row else {},
        # Phase N
        "ux_checklist":   ux_checklist,
        "rgpd_checklist": rgpd_checklist,
        "not_available_kpis": not_available_kpis,
    }

    report["kpis"] = _build_normalized_kpis(report, {
        "seo_missing_meta_pages": seo_missing_meta_pages,
        "seo_missing_title_pages": seo_missing_title_pages,
        "seo_missing_alt_pages": seo_missing_alt_pages,
        "seo_bad_heading_pages": seo_bad_heading_pages,
        "missing_product_image_pages": ux_missing_product_image_pages,
        "missing_contextual_link_pages": ux_missing_contextual_link_pages,
        "raw_ip_page_urls": ux_raw_ip_page_urls,
        "nonfunc_button_page_urls": perf_nonfunc_button_page_urls,
        "console_error_page_urls": perf_console_error_page_urls,
        "menu_issue_map": menu_issue_map,
        "keyword_stuffing_pages": context_keyword_stuffing_pages,
    })

    return report



def run_scanner(scan_id: str, url: str, max_pages: int, headless_concurrency: int):
    """Triggers the Go scanner API via HTTP."""
    update_scan_entry(scan_id, status=ScanStatus.RUNNING)

    # Extract domains for colly limit rules
    domain = url.split("://")[-1].split("/")[0]
    base_domain = domain.replace("www.", "")
    domains = [f"{base_domain}", f"www.{base_domain}"]

    payload = {
        "scan_id": scan_id,
        "url": url,
        "domains": domains,
        "max_pages": max_pages,
        "headless_concurrency": headless_concurrency
    }
    
    logger.info(f"Triggering scanner API for {url}")

    response = None
    attempt_errors: list[str] = []
    scanner_candidates = _scanner_base_candidates()
    primary_scanner = (SCANNER_API_URL or "").strip().rstrip("/")

    for scanner_base in scanner_candidates:
        try:
            logger.info("Trying scanner endpoint: %s", scanner_base)
            response = requests.post(f"{scanner_base}/scan", json=payload, timeout=900)
            response.raise_for_status()
            if scanner_base != primary_scanner:
                logger.warning(
                    "Primary scanner endpoint unavailable (%s). Using fallback: %s",
                    primary_scanner,
                    scanner_base,
                )
            break
        except requests.exceptions.RequestException as e:
            attempt_errors.append(f"{scanner_base}: {e}")

    if response is None:
        update_scan_entry(scan_id, status=ScanStatus.FAILED)
        err_msg = (
            "Scanner unreachable on all candidates. "
            "Set SCANNER_API_URL to a reachable scanner service. "
            f"Attempts: {' | '.join(attempt_errors)}"
        )
        if len(err_msg) > 500:
            err_msg = err_msg[0:500]
        update_scan_entry(scan_id, error=err_msg)
        logger.error(f"Scanner API failed for {scan_id}: {err_msg}")
        return

    update_scan_entry(scan_id, status=ScanStatus.NLP_PROCESSING)
    logger.info(f"Scanner done for {scan_id}. Waiting for NLP worker...")

    total = 0
    nlp_done = 0
    # Poll until NLP finishes all pages (max 5 minutes)
    for _ in range(100):
        total, nlp_done = count_pages(scan_id)
        if total > 0 and nlp_done >= total:
            break
        time.sleep(3)

    nlp_partiel = total > 0 and nlp_done < total
    if nlp_partiel:
        logger.warning(
            f"NLP partiel pour {scan_id}: {nlp_done}/{total} pages enrichies. "
            "Le rapport contiendra des KPIs NLP incomplets."
        )
    update_scan_entry(scan_id, status=ScanStatus.FINALIZING, nlp_partiel=nlp_partiel)
    logger.info(f"Scanner/NLP done for {scan_id}; building KPI payload before completion.")
    try:
        _build_and_persist_kpi_payload(scan_id, scan=get_scan_entry(scan_id), wait_for_lock=True)
    except Exception as exc:
        err_msg = f"KPI payload build failed: {exc}"
        if len(err_msg) > 500:
            err_msg = err_msg[:500]
        update_scan_entry(scan_id, status=ScanStatus.FAILED, error=err_msg)
        logger.exception("KPI payload build failed for %s", scan_id)
        return
    update_scan_entry(scan_id, status=ScanStatus.COMPLETE, nlp_partiel=nlp_partiel)
    logger.info(f"Scan {scan_id} complet avec {total} pages (nlp_partiel={nlp_partiel}).")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "v3-aggregator"}


@app.post("/scan")
async def start_scan(req: ScanRequest):
    """Start a new scan asynchronously. Returns a scan_id for polling."""
    scan_id = f"scan_{uuid.uuid4().hex[:12]}"
    create_scan_entry(scan_id, req)
    logger.info(f"Starting async scan {scan_id} for {req.url}")
    thread = threading.Thread(
        target=run_scanner,
        args=(scan_id, req.url, req.max_pages or 150, req.headless_concurrency or 3),
        daemon=True,
    )
    thread.start()
    return {"scan_id": scan_id, "status": ScanStatus.PENDING}

@app.post("/scan/sync")
async def start_scan_sync(req: ScanRequest):
    """Start a completely synchronous scan.
    This blocks until 100% complete (including NLP) and returns the final JSON output.
    Perfect for quick Postman testing without polling logic.
    """
    scan_id = f"scan_{uuid.uuid4().hex[:12]}"
    create_scan_entry(scan_id, req)
    logger.info(f"Starting SYNC scan {scan_id} for {req.url}")
    
    # Keep response synchronous for caller, while avoiding event-loop blocking.
    await asyncio.to_thread(
        run_scanner,
        scan_id,
        req.url,
        req.max_pages or 150,
        req.headless_concurrency or 3,
    )
    
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan["status"] == ScanStatus.FAILED:
        raise HTTPException(status_code=500, detail=f"Scanner failed: {scan.get('error')}")
        
    return await asyncio.to_thread(build_report, scan_id)

@app.get("/scan/{scan_id}/status")
async def get_status(scan_id: str):
    """Poll this endpoint to check scan progress."""
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    total, nlp_done = await asyncio.to_thread(count_pages, scan_id)

    return {
        "scan_id": scan_id,
        "status": scan["status"],
        "url": scan["url"],
        "pages_crawled": total,
        "pages_nlp_done": nlp_done,
        "kpi_mode": "new",
        "elapsed_seconds": round(time.time() - scan["started_at"], 1),
        "error": scan.get("error"),
    }


@app.get("/scan/{scan_id}/result")
async def get_result(scan_id: str):
    """Returns the full aggregated report. Only available when status=complete."""
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan["status"] != ScanStatus.COMPLETE:
        raise HTTPException(
            status_code=202,
            detail=f"Scan not yet complete. Current status: {scan['status']}"
        )

    return await asyncio.to_thread(build_report, scan_id)


@app.get("/scan/{scan_id}/recommendations")
async def get_recommendations(scan_id: str):
    """Returns classified and prioritized recommendations from existing report data."""
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan["status"] != ScanStatus.COMPLETE:
        raise HTTPException(
            status_code=202,
            detail=f"Recommendations not available yet. Current status: {scan['status']}"
        )

    payload = await asyncio.to_thread(build_recommendations, scan_id)
    if payload.get("error"):
        raise HTTPException(status_code=500, detail=payload["error"])
    return payload


@app.get("/scan/{scan_id}/kpis")
async def get_kpis(scan_id: str):
    """Returns KPI-centric report grouped by audit axes."""
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    payload = _load_persisted_kpi_payload(scan_id)
    if payload is not None:
        return payload

    if scan["status"] == ScanStatus.FINALIZING:
        raise HTTPException(
            status_code=202,
            detail="KPI report is being finalized"
        )
    if scan["status"] != ScanStatus.COMPLETE:
        raise HTTPException(
            status_code=202,
            detail=f"KPI report not available yet. Current status: {scan['status']}"
        )

    try:
        payload = await asyncio.to_thread(
            _build_and_persist_kpi_payload,
            scan_id,
            scan,
            False,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if payload is None:
        raise HTTPException(
            status_code=202,
            detail="KPI report is already being finalized"
        )
    return payload



@app.get("/scan/{scan_id}/kpis/top")
async def get_top_level_kpis(scan_id: str):
    """Returns only the canonical top-level KPI overview block."""
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan["status"] != ScanStatus.COMPLETE:
        raise HTTPException(
            status_code=202,
            detail=f"KPI report not available yet. Current status: {scan['status']}"
        )

    payload = _load_persisted_kpi_payload(scan_id)
    if payload is None:
        payload = await get_kpis(scan_id)

    top_level = payload.get("top_level_kpis", {}) if isinstance(payload, dict) else {}
    if not isinstance(top_level, dict) or not top_level:
        top_level = _build_top_level_kpis(payload if isinstance(payload, dict) else {})

    return {
        "scan_id": scan_id,
        "kpi_mode": "new",
        "top_level_kpis": top_level,
    }


@app.get("/scan/{scan_id}/kpis/quality")
async def get_kpi_quality_drift(scan_id: str):
    """Returns persisted KPI quality/drift artifact for operational monitoring."""
    scan = get_scan_entry(scan_id)
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan["status"] != ScanStatus.COMPLETE:
        raise HTTPException(
            status_code=202,
            detail=f"KPI report not available yet. Current status: {scan['status']}"
        )

    payload = _load_persisted_kpi_payload(scan_id)
    if payload is None:
        payload = await get_kpis(scan_id)

    artifact = payload.get("quality_drift_artifact", {}) if isinstance(payload, dict) else {}
    if not isinstance(artifact, dict) or not artifact:
        artifact = _build_kpi_quality_drift_artifact(scan_id, scan.get("url", ""), payload if isinstance(payload, dict) else {})

    return {
        "scan_id": scan_id,
        "kpi_mode": "new",
        "quality_drift_artifact": artifact,
    }


@app.get("/scan/{scan_id}/kpi")
async def get_kpi(scan_id: str):
    """Alias de /kpis pour compatibilité client."""
    return await get_kpis(scan_id)
