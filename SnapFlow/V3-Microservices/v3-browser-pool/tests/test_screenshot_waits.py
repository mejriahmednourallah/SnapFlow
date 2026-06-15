from pathlib import Path

from main import BatchScreenshotRequest, RenderRequest, ScreenshotRequest
from pool import (
    BrowserPool,
    DEFAULT_SCREENSHOT_WAIT_UNTIL,
    _sanitize_network_request,
    _host_matches_allowed,
    _normalise_allowed_domains,
    _normalize_wait_until,
    _rewrite_obscura_ws_url,
)


def test_form_discovery_exploration_is_bounded_and_never_submits():
    source = (Path(__file__).resolve().parents[1] / "pool.py").read_text(encoding="utf-8")
    assert 'exploration["paths_explored"] < 8' in source
    assert 'exploration["interactions"] < 24' in source
    assert "for interaction in path[:6]" in source
    assert 'type === "submit"' in source
    assert "form_exploration=payload.get" in source


def test_screenshot_requests_default_to_domcontentloaded():
    assert RenderRequest(url="https://example.com").wait_until == "domcontentloaded"
    assert RenderRequest(url="https://example.com").engine == "chromium"
    assert ScreenshotRequest(url="https://example.com").wait_until == "domcontentloaded"
    assert BatchScreenshotRequest(urls=["https://example.com"]).wait_until == "domcontentloaded"
    assert DEFAULT_SCREENSHOT_WAIT_UNTIL == "domcontentloaded"


def test_invalid_screenshot_wait_until_falls_back_to_default():
    assert _normalize_wait_until("not-a-real-state") == "domcontentloaded"
    assert _normalize_wait_until(None) == "domcontentloaded"


def test_networkidle_remains_available_when_explicit():
    assert _normalize_wait_until("networkidle") == "networkidle"
    assert _normalize_wait_until(" LOAD ") == "load"


def test_health_exposes_https_error_policy():
    health = BrowserPool().health()
    assert "ignore_https_errors" in health
    assert isinstance(health["ignore_https_errors"], bool)
    assert "obscura_discovery_enabled" in health
    assert "obscura_cdp_url_configured" in health
    assert "obscura_cdp_ws_url_configured" in health
    assert "obscura_resolved_endpoint" in health
    assert "obscura_endpoint_last_error" in health
    assert "obscura_active_sessions" in health
    assert "obscura_max_sessions" in health


def test_network_request_sanitizer_removes_sensitive_query_values():
    row = _sanitize_network_request(
        "POST",
        "https://api.example.com/v1/search?q=test&token=secret&api_key=123",
        200,
        "fetch",
    )
    assert row["method"] == "POST"
    assert row["host"] == "api.example.com"
    assert row["path"] == "/v1/search"
    assert row["query_keys"] == ["q"]
    assert row["sensitive_query_key_count"] == 2
    assert "secret" not in str(row)


def test_allowed_domains_match_www_and_base_domain_variants():
    allowed = _normalise_allowed_domains(["www.example.com"])
    assert "example.com" in allowed
    assert _host_matches_allowed("example.com", list(allowed))
    assert _host_matches_allowed("www.example.com", list(allowed))
    assert _host_matches_allowed("blog.example.com", list(allowed))


def test_obscura_localhost_websocket_is_rewritten_to_service_host():
    rewritten = _rewrite_obscura_ws_url(
        "ws://127.0.0.1:9222/devtools/browser/abc",
        "http://obscura:9222",
    )
    assert rewritten == "ws://obscura:9222/devtools/browser/abc"


def test_obscura_non_local_websocket_is_preserved():
    advertised = "ws://remote-browser:9222/devtools/browser/abc"
    rewritten = _rewrite_obscura_ws_url(advertised, "http://obscura:9222")
    assert rewritten == advertised
