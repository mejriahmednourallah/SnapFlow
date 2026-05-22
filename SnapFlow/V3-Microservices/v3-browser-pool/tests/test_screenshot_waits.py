from main import BatchScreenshotRequest, ScreenshotRequest
from pool import BrowserPool, DEFAULT_SCREENSHOT_WAIT_UNTIL, _normalize_wait_until


def test_screenshot_requests_default_to_domcontentloaded():
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
