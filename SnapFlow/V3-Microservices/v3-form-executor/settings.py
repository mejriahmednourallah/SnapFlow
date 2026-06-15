from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    poll_interval_seconds: float = 1.0
    execution_timeout_ms: int = 90_000
    execution_timeout_max_ms: int = 240_000
    node_timeout_ms: int = 15_000
    navigation_timeout_ms: int = 30_000
    settle_ms: int = 500
    headless: bool = True
    ignore_https_errors: bool = False
    chrome_no_sandbox: bool = False
    artifact_dir: str = "/tmp/form-test-artifacts"
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    artifact_bucket: str = "form-test-artifacts"
    max_network_events: int = 200
    max_console_events: int = 100
    captcha_api_key: str = ""
    captcha_timeout_s: int = 120
    captcha_poll_interval_s: int = 5
    concurrency: int = 3
    artifact_retention_days: int = 30
    artifact_cleanup_interval_seconds: int = 3600

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.getenv("FORM_EXECUTOR_DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("FORM_EXECUTOR_DATABASE_URL is required")
        return cls(
            database_url=database_url,
            poll_interval_seconds=float(os.getenv("FORM_EXECUTOR_POLL_INTERVAL", "1")),
            execution_timeout_ms=int(os.getenv("FORM_EXECUTOR_TIMEOUT_MS", "90000")),
            execution_timeout_max_ms=int(
                os.getenv("FORM_EXECUTOR_TIMEOUT_MAX_MS", "240000")
            ),
            node_timeout_ms=int(os.getenv("FORM_EXECUTOR_NODE_TIMEOUT_MS", "15000")),
            navigation_timeout_ms=int(os.getenv("FORM_EXECUTOR_NAVIGATION_TIMEOUT_MS", "30000")),
            settle_ms=int(os.getenv("FORM_EXECUTOR_SETTLE_MS", "500")),
            headless=_bool("FORM_EXECUTOR_HEADLESS", True),
            ignore_https_errors=_bool("FORM_EXECUTOR_IGNORE_HTTPS_ERRORS", False),
            chrome_no_sandbox=_bool("CHROME_NO_SANDBOX", False),
            artifact_dir=os.getenv("FORM_EXECUTOR_ARTIFACT_DIR", "/tmp/form-test-artifacts"),
            supabase_url=os.getenv("SUPABASE_URL", "").rstrip("/"),
            supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
            artifact_bucket=os.getenv("FORM_EXECUTOR_ARTIFACT_BUCKET", "form-test-artifacts"),
            max_network_events=int(os.getenv("FORM_EXECUTOR_MAX_NETWORK_EVENTS", "200")),
            max_console_events=int(os.getenv("FORM_EXECUTOR_MAX_CONSOLE_EVENTS", "100")),
            captcha_api_key=os.getenv("FORM_EXECUTOR_2CAPTCHA_API_KEY", ""),
            captcha_timeout_s=int(os.getenv("FORM_EXECUTOR_CAPTCHA_TIMEOUT_S", "120")),
            captcha_poll_interval_s=int(os.getenv("FORM_EXECUTOR_CAPTCHA_POLL_INTERVAL_S", "5")),
            concurrency=max(1, int(os.getenv("FORM_EXECUTOR_CONCURRENCY", "3"))),
            artifact_retention_days=max(
                1, int(os.getenv("FORM_EXECUTOR_ARTIFACT_RETENTION_DAYS", "30"))
            ),
            artifact_cleanup_interval_seconds=max(
                60,
                int(os.getenv("FORM_EXECUTOR_ARTIFACT_CLEANUP_INTERVAL_SECONDS", "3600")),
            ),
        )
