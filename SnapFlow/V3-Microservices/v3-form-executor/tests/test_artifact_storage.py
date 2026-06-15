from __future__ import annotations

import os
import time
from types import SimpleNamespace

import requests

import storage as storage_module
from storage import Storage


class FakeCursor:
    def __init__(self):
        self.params = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, query, params):
        self.params = params

    def fetchone(self):
        return ("artifact-id",)


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        return None


def make_storage(tmp_path):
    instance = Storage.__new__(Storage)
    instance.settings = SimpleNamespace(
        artifact_dir=str(tmp_path),
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role",
        artifact_bucket="form-test-artifacts",
        artifact_retention_days=30,
        artifact_cleanup_interval_seconds=3600,
    )
    instance._artifact_cleanup_lock = storage_module.threading.Lock()
    instance._last_artifact_cleanup_monotonic = 0.0
    connection = FakeConnection()
    instance._connection = lambda: connection
    instance._release = lambda unused: None
    return instance, connection


def metadata_from(connection):
    return connection.cursor_instance.params[-1].adapted


def test_artifact_upload_retries_and_marks_available(monkeypatch, tmp_path):
    instance, connection = make_storage(tmp_path)
    responses = [
        SimpleNamespace(ok=False, status_code=503, text="temporary"),
        SimpleNamespace(ok=True, status_code=200, text=""),
    ]
    calls = []

    def fake_post(*args, **kwargs):
        calls.append((args, kwargs))
        return responses.pop(0)

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(storage_module.time, "sleep", lambda unused: None)

    instance.save_artifact(
        "execution-1",
        "step-1",
        "screenshot",
        b"png",
        "image/png",
        {"capture_reason": "assertion"},
    )

    metadata = metadata_from(connection)
    assert len(calls) == 2
    assert metadata["storage_backend"] == "supabase"
    assert metadata["upload_status"] == "available"
    assert metadata["upload_attempts"] == 2
    assert metadata["capture_reason"] == "assertion"
    assert connection.cursor_instance.params[3].startswith(
        "executions/execution-1/step-1/"
    )


def test_artifact_upload_failure_is_not_presented_as_available(monkeypatch, tmp_path):
    instance, connection = make_storage(tmp_path)

    def fail_post(*args, **kwargs):
        raise requests.ConnectionError("storage offline")

    monkeypatch.setattr(requests, "post", fail_post)
    monkeypatch.setattr(storage_module.time, "sleep", lambda unused: None)

    instance.save_artifact(
        "execution-2",
        "step-2",
        "screenshot",
        b"png",
        "image/png",
    )

    metadata = metadata_from(connection)
    assert metadata["storage_backend"] == "local"
    assert metadata["upload_status"] == "failed"
    assert metadata["upload_attempts"] == 3
    assert "ConnectionError" in metadata["upload_error"]
    relative_path = connection.cursor_instance.params[3]
    assert (tmp_path / relative_path).exists()


def test_local_artifact_cleanup_removes_only_expired_files(tmp_path):
    instance, _ = make_storage(tmp_path)
    expired = tmp_path / "executions" / "old.png"
    recent = tmp_path / "executions" / "recent.png"
    expired.parent.mkdir(parents=True)
    expired.write_bytes(b"old")
    recent.write_bytes(b"recent")
    old_timestamp = time.time() - (31 * 86400)
    os.utime(expired, (old_timestamp, old_timestamp))

    removed = instance.cleanup_local_artifacts(force=True)

    assert removed == 1
    assert not expired.exists()
    assert recent.exists()
