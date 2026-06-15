from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import requests
from psycopg2.extras import Json, RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from models import ExecutionRecord, ScenarioSnapshot
from redaction import redact, redact_text
from settings import Settings

logger = logging.getLogger("form-executor.storage")

CONTROL_COMMAND_MODES = {
    "retry": "full",
    "run_step": "step",
    "run_from": "from_step",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def control_command_execution_mode(command: str) -> str:
    try:
        return CONTROL_COMMAND_MODES[command]
    except KeyError as exc:
        raise ValueError(f"unsupported_control_command:{command}") from exc


class Storage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.pool = ThreadedConnectionPool(1, 5, dsn=settings.database_url)
        Path(settings.artifact_dir).mkdir(parents=True, exist_ok=True)
        self._artifact_cleanup_lock = threading.Lock()
        self._last_artifact_cleanup_monotonic = 0.0

    def close(self) -> None:
        self.pool.closeall()

    def _connection(self):
        return self.pool.getconn()

    def _release(self, connection) -> None:
        self.pool.putconn(connection)

    def health(self) -> bool:
        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone()[0] == 1
        finally:
            self._release(connection)

    def claim_next_execution(self) -> ExecutionRecord | None:
        connection = self._connection()
        try:
            connection.autocommit = False
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    WITH candidate AS (
                      SELECT result.id
                      FROM public.workflow_results result
                      JOIN public.form_workflows workflow
                        ON workflow.id = result.workflow_id
                      LEFT JOIN public.form_test_campaigns campaign
                        ON campaign.id = result.campaign_id
                      WHERE result.status = 'queued'
                        AND result.execution_source = 'pending_executor'
                        AND result.scenario_version_id IS NOT NULL
                        AND (
                          result.depends_on_execution_id IS NULL
                          OR EXISTS (
                            SELECT 1
                            FROM public.workflow_results dependency
                            WHERE dependency.id = result.depends_on_execution_id
                              AND dependency.status IN (
                                'passed', 'failed', 'error', 'blocked', 'cancelled',
                                'pass', 'fail', 'needs_review', 'inconclusive'
                              )
                          )
                        )
                        AND (
                          result.campaign_role IS DISTINCT FROM 'case'
                          OR campaign.reference_execution_id IS NOT NULL
                        )
                        AND (
                          result.schedule_id IS NULL
                          OR NOT EXISTS (
                            SELECT 1
                            FROM public.workflow_results active
                            WHERE active.schedule_id = result.schedule_id
                              AND active.id <> result.id
                              AND active.status IN ('running', 'stopping')
                          )
                        )
                        AND NOT EXISTS (
                          SELECT 1
                          FROM public.workflow_results active
                          JOIN public.form_workflows active_workflow
                            ON active_workflow.id = active.workflow_id
                          WHERE active.id <> result.id
                            AND active.status IN ('running', 'stopping')
                            AND lower(
                              COALESCE(
                                NULLIF(split_part(split_part(active_workflow.target_url, '://', 2), '/', 1), ''),
                                split_part(active_workflow.target_url, '/', 1)
                              )
                            ) = lower(
                              COALESCE(
                                NULLIF(split_part(split_part(workflow.target_url, '://', 2), '/', 1), ''),
                                split_part(workflow.target_url, '/', 1)
                              )
                            )
                        )
                        AND pg_try_advisory_xact_lock(
                          hashtext(
                            lower(
                              COALESCE(
                                NULLIF(split_part(split_part(workflow.target_url, '://', 2), '/', 1), ''),
                                split_part(workflow.target_url, '/', 1)
                              )
                            )
                          )
                        )
                      ORDER BY result.queued_at NULLS LAST, result.executed_at
                      FOR UPDATE OF result SKIP LOCKED
                      LIMIT 1
                    )
                    UPDATE public.workflow_results result
                    SET
                      status = 'running',
                      started_at = now(),
                      heartbeat_at = now(),
                      execution_source = 'chromium',
                      execution_engine = 'chromium',
                      failure_reason = NULL
                    FROM candidate
                    WHERE result.id = candidate.id
                    RETURNING
                      result.id,
                      result.workflow_id,
                      result.scenario_version_id,
                      result.execution_mode,
                      result.start_node_id,
                      result.environment,
                      result.campaign_id
                    """
                )
                row = cursor.fetchone()
                if row and row.get("campaign_id"):
                    cursor.execute(
                        "SELECT public.form_test_refresh_campaign(%s)",
                        (row["campaign_id"],),
                    )
            connection.commit()
            if not row:
                return None
            return ExecutionRecord(
                id=str(row["id"]),
                workflow_id=str(row["workflow_id"]),
                scenario_version_id=str(row["scenario_version_id"]),
                execution_mode=str(row.get("execution_mode") or "full"),
                start_node_id=str(row["start_node_id"]) if row.get("start_node_id") else None,
                environment=str(row.get("environment") or "default"),
            )
        except Exception:
            connection.rollback()
            raise
        finally:
            self._release(connection)

    def load_campaign_context(self, execution_id: str) -> dict[str, Any]:
        connection = self._connection()
        try:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    SELECT
                      result.campaign_id,
                      result.campaign_role,
                      result.evaluation_mode,
                      result.depends_on_execution_id,
                      campaign.reference_execution_id,
                      campaign.reference_conclusive,
                      reference.summary AS baseline_summary
                    FROM public.workflow_results result
                    LEFT JOIN public.form_test_campaigns campaign
                      ON campaign.id = result.campaign_id
                    LEFT JOIN public.workflow_results reference
                      ON reference.id = campaign.reference_execution_id
                    WHERE result.id = %s
                    """,
                    (execution_id,),
                )
                row = cursor.fetchone()
            return dict(row or {})
        finally:
            self._release(connection)

    def load_snapshot(self, execution: ExecutionRecord) -> ScenarioSnapshot:
        connection = self._connection()
        try:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    SELECT snapshot, status
                    FROM public.form_scenario_versions
                    WHERE id = %s
                    """,
                    (execution.scenario_version_id,),
                )
                row = cursor.fetchone()
            if not row:
                raise RuntimeError("scenario_version_not_found")
            if row["status"] != "approved":
                raise RuntimeError("scenario_version_not_approved")
            snapshot = row["snapshot"]
            if isinstance(snapshot, str):
                snapshot = json.loads(snapshot)
            if not isinstance(snapshot, dict):
                raise RuntimeError("scenario_snapshot_invalid")
            return ScenarioSnapshot.from_json(snapshot)
        finally:
            self._release(connection)

    def log(
        self,
        execution_id: str,
        event_type: str,
        message: str,
        *,
        level: str = "info",
        step_result_id: str | None = None,
        details: dict[str, Any] | None = None,
        sensitive_values: set[str] | None = None,
    ) -> None:
        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.workflow_logs (
                      execution_id, step_result_id, level, event_type, message, details_redacted
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        execution_id,
                        step_result_id,
                        level,
                        event_type,
                        redact_text(message),
                        Json(redact(details or {}, sensitive_values)),
                    ),
                )
            connection.commit()
        finally:
            self._release(connection)

    def start_step(
        self,
        execution_id: str,
        node_id: str,
        sequence_number: int,
        step_type: str,
        input_data: dict[str, Any],
        sensitive_values: set[str],
    ) -> str:
        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.workflow_step_results (
                      execution_id, node_id, sequence_number, step_type, status,
                      started_at, input_redacted
                    ) VALUES (%s, %s, %s, %s, 'running', now(), %s)
                    RETURNING id
                    """,
                    (
                        execution_id,
                        node_id,
                        sequence_number,
                        step_type,
                        Json(redact(input_data, sensitive_values)),
                    ),
                )
                step_id = cursor.fetchone()[0]
            connection.commit()
            return str(step_id)
        finally:
            self._release(connection)

    def finish_step(
        self,
        step_id: str,
        *,
        status: str,
        duration_ms: int,
        output: dict[str, Any],
        assertions: list[dict[str, Any]],
        error_code: str | None,
        error_message: str | None,
        sensitive_values: set[str],
        captcha_detected: bool = False,
        captcha_type: str | None = None,
        captcha_solved: bool = False,
        captcha_solve_duration_ms: int | None = None,
        captcha_solve_cost: float | None = None,
    ) -> None:
        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE public.workflow_step_results
                    SET
                      status = %s,
                      completed_at = now(),
                      duration_ms = %s,
                      output_redacted = %s,
                      assertions = %s,
                      error_code = %s,
                      error_message = %s,
                      captcha_detected = %s,
                      captcha_type = %s,
                      captcha_solved = %s,
                      captcha_solve_duration_ms = %s,
                      captcha_solve_cost = %s
                    WHERE id = %s
                    """,
                    (
                        status,
                        duration_ms,
                        Json(redact(output, sensitive_values)),
                        Json(redact(assertions, sensitive_values)),
                        error_code,
                        redact_text(error_message),
                        captcha_detected,
                        captcha_type,
                        captcha_solved,
                        captcha_solve_duration_ms,
                        captcha_solve_cost,
                        step_id,
                    ),
                )
            connection.commit()
        finally:
            self._release(connection)

    def update_progress(
        self,
        execution_id: str,
        completed: int,
        total: int,
        current_node_id: str | None,
    ) -> None:
        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE public.workflow_results
                    SET
                      progress_completed = %s,
                      progress_total = %s,
                      current_node_id = %s,
                      heartbeat_at = now()
                    WHERE id = %s
                    """,
                    (completed, total, current_node_id, execution_id),
                )
            connection.commit()
        finally:
            self._release(connection)

    def should_stop(self, execution_id: str) -> bool:
        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT status = 'stopping'
                      OR EXISTS (
                        SELECT 1
                        FROM public.workflow_execution_commands command
                        WHERE command.execution_id = workflow_results.id
                          AND command.command = 'stop'
                          AND command.status IN ('pending', 'processing')
                      )
                    FROM public.workflow_results
                    WHERE id = %s
                    """,
                    (execution_id,),
                )
                row = cursor.fetchone()
                return bool(row and row[0])
        finally:
            self._release(connection)

    def finalize_execution(
        self,
        execution_id: str,
        *,
        status: str,
        duration_ms: int,
        final_url: str | None,
        failure_reason: str | None,
        assertions: list[dict[str, Any]],
        network_summary: dict[str, Any],
        summary: dict[str, Any],
    ) -> None:
        connection = self._connection()
        try:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    UPDATE public.workflow_results
                    SET
                      status = %s,
                      completed_at = now(),
                      stopped_at = CASE WHEN %s = 'cancelled' THEN now() ELSE stopped_at END,
                      heartbeat_at = now(),
                      duration_ms = %s,
                      final_url = %s,
                      failure_reason = %s,
                      error_message = CASE WHEN %s = 'error' THEN %s ELSE NULL END,
                      assertions = %s,
                      network_summary = %s,
                      summary = COALESCE(summary, '{}'::jsonb) || %s,
                      current_node_id = NULL,
                      progress_completed = CASE
                        WHEN %s = 'passed' THEN progress_total
                        ELSE progress_completed
                      END
                    WHERE id = %s
                    """,
                    (
                        status,
                        status,
                        duration_ms,
                        final_url,
                        failure_reason,
                        status,
                        failure_reason,
                        Json(redact(assertions)),
                        Json(redact(network_summary)),
                        Json(redact(summary)),
                        status,
                        execution_id,
                    ),
                )
                cursor.execute(
                    "SELECT campaign_id FROM public.workflow_results WHERE id = %s",
                    (execution_id,),
                )
                campaign_row = cursor.fetchone()
                cursor.execute(
                    """
                    UPDATE public.workflow_execution_commands
                    SET status = 'completed', processed_at = now()
                    WHERE execution_id = %s
                      AND command = 'stop'
                      AND status IN ('pending', 'processing')
                    """,
                    (execution_id,),
                )
            connection.commit()
            campaign_id = campaign_row.get("campaign_id") if campaign_row else None
            if campaign_id:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT public.form_test_refresh_campaign(%s)",
                        (campaign_id,),
                    )
                connection.commit()
        finally:
            self._release(connection)

    def save_artifact(
        self,
        execution_id: str,
        step_result_id: str | None,
        artifact_type: str,
        content: bytes,
        mime_type: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        extension = {
            "image/png": "png",
            "text/html": "html",
            "application/json": "json",
        }.get(mime_type, "bin")
        relative_path = (
            f"executions/{execution_id}/{step_result_id or 'execution'}/"
            f"{uuid.uuid4()}-{artifact_type}.{extension}"
        )

        uploaded = False
        upload_attempts = 0
        upload_error: str | None = None
        if self.settings.supabase_url and self.settings.supabase_service_role_key:
            for attempt in range(1, 4):
                upload_attempts = attempt
                try:
                    response = requests.post(
                        f"{self.settings.supabase_url}/storage/v1/object/"
                        f"{self.settings.artifact_bucket}/{relative_path}",
                        headers={
                            "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
                            "apikey": self.settings.supabase_service_role_key,
                            "Content-Type": mime_type,
                            "x-upsert": "false",
                        },
                        data=content,
                        timeout=20,
                    )
                    uploaded = response.ok
                    if uploaded:
                        upload_error = None
                        break
                    upload_error = f"http_{response.status_code}:{response.text[:200]}"
                except requests.RequestException as exc:
                    upload_error = f"{type(exc).__name__}:{exc}"
                logger.warning(
                    "Artifact upload failed attempt=%s path=%s error=%s",
                    attempt,
                    relative_path,
                    upload_error,
                )
                if attempt < 3:
                    time.sleep(0.25 * (2 ** (attempt - 1)))

        if not uploaded:
            local_path = Path(self.settings.artifact_dir, relative_path)
            local_path.parent.mkdir(parents=True, exist_ok=True)
            local_path.write_bytes(content)

        storage_backend = "supabase" if uploaded else "local"
        upload_status = (
            "available"
            if uploaded
            else "failed"
            if upload_attempts > 0
            else "local_only"
        )
        artifact_metadata = {
            **(metadata or {}),
            "storage_backend": storage_backend,
            "upload_status": upload_status,
            "upload_attempts": upload_attempts,
        }
        if upload_error:
            artifact_metadata["upload_error"] = redact_text(upload_error)

        connection = self._connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO public.workflow_artifacts (
                      execution_id, step_result_id, artifact_type, storage_path,
                      mime_type, size_bytes, redaction_status, metadata_redacted
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        execution_id,
                        step_result_id,
                        artifact_type,
                        relative_path,
                        mime_type,
                        len(content),
                        "redacted",
                        Json(redact(artifact_metadata)),
                    ),
                )
                artifact_id = cursor.fetchone()[0]
            connection.commit()
            return str(artifact_id)
        finally:
            self._release(connection)

    def cleanup_local_artifacts(self, *, force: bool = False) -> int:
        """Remove expired diagnostic fallbacks without touching Storage objects."""
        now_monotonic = time.monotonic()
        interval = self.settings.artifact_cleanup_interval_seconds
        with self._artifact_cleanup_lock:
            if (
                not force
                and now_monotonic - self._last_artifact_cleanup_monotonic < interval
            ):
                return 0
            self._last_artifact_cleanup_monotonic = now_monotonic

        root = Path(self.settings.artifact_dir)
        if not root.exists():
            return 0

        cutoff = time.time() - (self.settings.artifact_retention_days * 86400)
        removed = 0
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            try:
                if path.stat().st_mtime >= cutoff:
                    continue
                path.unlink()
                removed += 1
            except OSError as exc:
                logger.warning("Local artifact cleanup failed path=%s error=%s", path, exc)

        directories = sorted(
            (path for path in root.rglob("*") if path.is_dir()),
            key=lambda path: len(path.parts),
            reverse=True,
        )
        for directory in directories:
            try:
                directory.rmdir()
            except OSError:
                pass
        if removed:
            logger.info("Removed %s expired local form artifacts", removed)
        return removed

    def process_control_commands(self) -> int:
        connection = self._connection()
        created = 0
        try:
            connection.autocommit = False
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(
                    """
                    SELECT command.*, result.workflow_id, result.scenario_id,
                           result.scenario_version_id, result.environment,
                           result.requested_by, result.audit_run_id
                    FROM public.workflow_execution_commands command
                    JOIN public.workflow_results result ON result.id = command.execution_id
                    WHERE command.status = 'pending'
                      AND command.command IN ('retry', 'run_step', 'run_from')
                    ORDER BY command.requested_at
                    FOR UPDATE OF command SKIP LOCKED
                    LIMIT 10
                    """
                )
                commands = cursor.fetchall()
                for command in commands:
                    mode = control_command_execution_mode(command["command"])
                    cursor.execute(
                        """
                        INSERT INTO public.workflow_results (
                          workflow_id, scenario_id, scenario_version_id,
                          executed_by, requested_by, status, execution_mode,
                          execution_engine, execution_source, environment,
                          start_node_id, assertions, step_trace, network_summary,
                          summary, audit_run_id, queued_at
                        ) VALUES (
                          %s, %s, %s, %s, %s, 'queued', %s,
                          'chromium', 'pending_executor', %s,
                          %s, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
                          %s, %s, now()
                        )
                        """,
                        (
                            command["workflow_id"],
                            command["scenario_id"],
                            command["scenario_version_id"],
                            command["requested_by"],
                            command["requested_by"],
                            mode,
                            command["environment"],
                            command["node_id"],
                            Json({"parent_execution_id": str(command["execution_id"])}),
                            command["audit_run_id"],
                        ),
                    )
                    cursor.execute(
                        """
                        UPDATE public.workflow_execution_commands
                        SET status = 'completed', processed_at = now()
                        WHERE id = %s
                        """,
                        (command["id"],),
                    )
                    created += 1
            connection.commit()
            return created
        except Exception:
            connection.rollback()
            raise
        finally:
            self._release(connection)
