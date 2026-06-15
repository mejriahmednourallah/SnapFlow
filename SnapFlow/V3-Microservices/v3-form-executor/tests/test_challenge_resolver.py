"""Tests for challenge_resolver — CAPTCHA detection, classification, and 2Captcha integration."""
from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from playwright.async_api import async_playwright

from challenge_resolver import (
    CaptchaInfo,
    Challenge,
    SolveResult,
    TaskCreationResult,
    TaskPollResult,
    _build_2captcha_task,
    _estimate_cost,
    detect_captcha,
    detect_challenge,
    is_captcha_solvable,
    resolve_captcha,
    resolve_or_block,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ─── Unit: Cost estimation ───────────────────────────────────────────────────


def test_estimate_cost_recaptcha_v2():
    assert _estimate_cost("recaptcha_v2") == 0.00299


def test_estimate_cost_hcaptcha():
    assert _estimate_cost("hcaptcha") == 0.00299


def test_estimate_cost_image_captcha():
    assert _estimate_cost("image_captcha") == 0.001


def test_estimate_cost_unknown():
    assert _estimate_cost("unknown_type") == 0.0


def test_recaptcha_v2_uses_proxyless_task():
    payload = _build_2captcha_task(
        CaptchaInfo(
            captcha_type="recaptcha_v2",
            site_key="test-key",
            page_url="https://example.com/contact",
        )
    )
    assert payload["task"]["type"] == "RecaptchaV2TaskProxyless"
    assert payload["task"]["isInvisible"] is False
    assert "proxyType" not in payload["task"]


def test_invisible_recaptcha_v2_uses_proxyless_task():
    payload = _build_2captcha_task(
        CaptchaInfo(
            captcha_type="recaptcha_v2",
            site_key="test-key",
            page_url="https://example.com/contact",
            is_invisible=True,
        )
    )
    assert payload["task"]["type"] == "RecaptchaV2TaskProxyless"
    assert payload["task"]["isInvisible"] is True


def test_hcaptcha_uses_proxyless_task():
    payload = _build_2captcha_task(
        CaptchaInfo(
            captcha_type="hcaptcha",
            site_key="test-key",
            page_url="https://example.com/contact",
        )
    )
    assert payload["task"]["type"] == "HCaptchaTaskProxyless"
    assert "proxyType" not in payload["task"]


# ─── Unit: Solvability ───────────────────────────────────────────────────────


def test_recaptcha_v2_is_solvable_with_site_key():
    info = CaptchaInfo(captcha_type="recaptcha_v2", site_key="test-key", page_url="https://example.com")
    assert is_captcha_solvable(info) is True


def test_recaptcha_v2_not_solvable_without_site_key():
    info = CaptchaInfo(captcha_type="recaptcha_v2", site_key=None, page_url="https://example.com")
    assert is_captcha_solvable(info) is False


def test_hcaptcha_is_solvable_with_site_key():
    info = CaptchaInfo(captcha_type="hcaptcha", site_key="test-key", page_url="https://example.com")
    assert is_captcha_solvable(info) is True


def test_image_captcha_is_solvable_with_image_url():
    info = CaptchaInfo(captcha_type="image_captcha", image_url="https://example.com/captcha.png", page_url="https://example.com")
    assert is_captcha_solvable(info) is True


def test_image_captcha_not_solvable_without_image_url():
    info = CaptchaInfo(captcha_type="image_captcha", image_url=None, page_url="https://example.com")
    assert is_captcha_solvable(info) is False


def test_turnstile_is_not_solvable():
    info = CaptchaInfo(captcha_type="turnstile", site_key="test-key", page_url="https://example.com")
    assert is_captcha_solvable(info) is False


def test_generic_captcha_is_not_solvable():
    info = CaptchaInfo(captcha_type="generic_captcha", page_url="https://example.com")
    assert is_captcha_solvable(info) is False


# ─── Integration: CAPTCHA detection (browser) ─────────────────────────────────


@pytest.mark.asyncio
async def test_detect_recaptcha_v2(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/recaptcha-v2.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is not None
    assert result.captcha_type == "recaptcha_v2"
    assert result.site_key is not None
    assert result.is_invisible is False


@pytest.mark.asyncio
async def test_detect_invisible_recaptcha_v2(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/recaptcha-v2-invisible.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is not None
    assert result.captcha_type == "recaptcha_v2"
    assert result.site_key == "invisible-test-site-key"
    assert result.is_invisible is True


@pytest.mark.asyncio
async def test_detect_hcaptcha(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/hcaptcha.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is not None
    assert result.captcha_type == "hcaptcha"
    assert result.site_key is not None


@pytest.mark.asyncio
async def test_detect_image_captcha(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/image-captcha.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is not None
    assert result.captcha_type == "image_captcha"
    assert result.image_url is not None


@pytest.mark.asyncio
async def test_detect_generic_captcha(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/captcha.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is not None
    assert result.captcha_type == "generic_captcha"


@pytest.mark.asyncio
async def test_no_captcha_detected(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/no-captcha.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is None


@pytest.mark.asyncio
async def test_hidden_captcha_bookkeeping_field_is_not_a_challenge(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/contact.html")
        result = await detect_captcha(page)
        await browser.close()
    assert result is None


# ─── Integration: detect_challenge (CAPTCHA + OTP) ───────────────────────────


@pytest.mark.asyncio
async def test_detect_challenge_otp(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/otp.html")
        result = await detect_challenge(page)
        await browser.close()
    assert result is not None
    assert result.challenge_type == "otp"
    assert result.reason == "otp_required"


@pytest.mark.asyncio
async def test_detect_challenge_only_detects_captcha(monkeypatch, fixture_server):
    """Detection remains pure even when no 2Captcha key is configured."""
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/captcha.html")
        result = await detect_challenge(page)
        await browser.close()
    assert result is not None
    assert result.challenge_type == "captcha"
    assert result.reason == "captcha_detected:generic_captcha"
    assert result.captcha_info is not None
    assert result.captcha_info.captcha_type == "generic_captcha"


# ─── Integration: resolve_or_block ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_or_block_no_captcha(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/no-captcha.html")
        result = await resolve_or_block(page)
        await browser.close()
    assert result.success is True
    assert result.error is None


@pytest.mark.asyncio
async def test_resolve_or_block_unsupported_type(fixture_server):
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/captcha.html")  # generic_captcha = unsolvable
        result = await resolve_or_block(page)
        await browser.close()
    assert result.success is False
    assert "unsupported_captcha_type" in (result.error or "")


@pytest.mark.asyncio
async def test_resolve_or_block_no_api_key(monkeypatch, fixture_server):
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/recaptcha-v2.html")
        result = await resolve_or_block(page)
        await browser.close()
    assert result.success is False
    assert result.error == "no_captcha_api_key_configured"


# ─── Unit: 2Captcha API mock tests ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_captcha_with_mocked_2captcha(monkeypatch, fixture_server):
    """Simulate a successful 2Captcha resolution with mocked API responses."""
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "test-mock-key")

    # Mock createTask response
    mock_create_response = MagicMock()
    mock_create_response.status_code = 200
    mock_create_response.json.return_value = {"errorId": 0, "taskId": 12345}

    # Mock getTaskResult responses: first pending, then ready
    mock_pending = MagicMock()
    mock_pending.status_code = 200
    mock_pending.json.return_value = {"errorId": 0, "status": "processing"}

    mock_ready = MagicMock()
    mock_ready.status_code = 200
    mock_ready.json.return_value = {
        "errorId": 0,
        "status": "ready",
        "solution": {"gRecaptchaResponse": "test-token-abc123"},
    }

    # Poll twice: first pending, then ready
    mock_post = MagicMock(side_effect=[mock_create_response, mock_pending, mock_ready])

    with patch("challenge_resolver.requests.post", mock_post):
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page = await browser.new_page()
            await page.goto(f"{fixture_server}/recaptcha-v2.html")
            captcha_info = await detect_captcha(page)
            result = await resolve_captcha(page, captcha_info)
            await browser.close()

    assert result.success is True
    assert result.token == "[REDACTED]"
    assert result.task_id == "12345"
    assert result.solve_duration_ms > 0


@pytest.mark.asyncio
async def test_resolve_captcha_timeout(monkeypatch, fixture_server):
    """Simulate 2Captcha timeout after polling deadline."""
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "test-mock-key")
    monkeypatch.setattr("challenge_resolver.CAPTCHA_TIMEOUT_S", 1)  # very short timeout
    monkeypatch.setattr("challenge_resolver.CAPTCHA_POLL_INTERVAL_S", 1)

    mock_create_response = MagicMock()
    mock_create_response.status_code = 200
    mock_create_response.json.return_value = {"errorId": 0, "taskId": 99999}

    # Always pending
    mock_pending = MagicMock()
    mock_pending.status_code = 200
    mock_pending.json.return_value = {"errorId": 0, "status": "processing"}

    mock_post = MagicMock(side_effect=[mock_create_response, mock_pending, mock_pending, mock_pending, mock_pending])

    with patch("challenge_resolver.requests.post", mock_post):
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page = await browser.new_page()
            await page.goto(f"{fixture_server}/recaptcha-v2.html")
            captcha_info = await detect_captcha(page)
            result = await resolve_captcha(page, captcha_info)
            await browser.close()

    assert result.success is False
    assert result.error == "2captcha_timeout"


@pytest.mark.asyncio
async def test_resolve_captcha_create_task_error(monkeypatch, fixture_server):
    """Simulate 2Captcha createTask returning an error."""
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "test-mock-key")

    mock_error = MagicMock()
    mock_error.status_code = 200
    mock_error.json.return_value = {
        "errorId": 1,
        "errorCode": "ERROR_BAD_PROXY",
        "errorDescription": "ERROR_KEY_DOES_NOT_EXIST",
    }

    with patch("challenge_resolver.requests.post", return_value=mock_error):
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page = await browser.new_page()
            await page.goto(f"{fixture_server}/recaptcha-v2.html")
            captcha_info = await detect_captcha(page)
            result = await resolve_captcha(page, captcha_info)
            await browser.close()

    assert result.success is False
    assert result.error == "2captcha_create_task_error:ERROR_BAD_PROXY"
    assert result.provider_error_code == "ERROR_BAD_PROXY"
    assert result.provider_error_description == "ERROR_KEY_DOES_NOT_EXIST"


@pytest.mark.asyncio
async def test_resolve_captcha_poll_error_preserves_provider_details(monkeypatch, fixture_server):
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "test-mock-key")
    monkeypatch.setattr("challenge_resolver.CAPTCHA_POLL_INTERVAL_S", 0)

    mock_create = MagicMock()
    mock_create.status_code = 200
    mock_create.json.return_value = {"errorId": 0, "taskId": 12345}

    mock_poll_error = MagicMock()
    mock_poll_error.status_code = 200
    mock_poll_error.json.return_value = {
        "errorId": 1,
        "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
        "errorDescription": "The workers could not solve the CAPTCHA.",
    }

    with patch(
        "challenge_resolver.requests.post",
        MagicMock(side_effect=[mock_create, mock_poll_error]),
    ):
        async with async_playwright() as pw:
            browser = await pw.chromium.launch()
            page = await browser.new_page()
            await page.goto(f"{fixture_server}/recaptcha-v2.html")
            captcha_info = await detect_captcha(page)
            result = await resolve_captcha(page, captcha_info)
            await browser.close()

    assert result.success is False
    assert result.error == "2captcha_result_error:ERROR_CAPTCHA_UNSOLVABLE"
    assert result.provider_error_code == "ERROR_CAPTCHA_UNSOLVABLE"
    assert result.provider_error_description == "The workers could not solve the CAPTCHA."


@pytest.mark.asyncio
async def test_resolution_cache_prevents_duplicate_paid_task(monkeypatch, fixture_server):
    monkeypatch.setattr("challenge_resolver.CAPTCHA_API_KEY", "test-mock-key")
    create_task = AsyncMock(return_value=TaskCreationResult(task_id="12345"))
    monkeypatch.setattr("challenge_resolver._create_2captcha_task", create_task)
    monkeypatch.setattr(
        "challenge_resolver._poll_2captcha_result",
        AsyncMock(return_value=TaskPollResult(status="ready", token="test-token")),
    )

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr("challenge_resolver.asyncio.sleep", no_sleep)
    cache = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/recaptcha-v2.html")
        captcha_info = await detect_captcha(page)
        first = await resolve_captcha(page, captcha_info, cache=cache)
        second = await resolve_captcha(page, captcha_info, cache=cache)
        await browser.close()

    assert first.success is True
    assert second is first
    assert first.task_type == "RecaptchaV2TaskProxyless"
    assert create_task.await_count == 1


# ─── Regression: OTP is never resolved ────────────────────────────────────────


@pytest.mark.asyncio
async def test_otp_always_returns_blocked(fixture_server):
    """OTP challenges must always return blocked, never resolved."""
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        page = await browser.new_page()
        await page.goto(f"{fixture_server}/otp.html")
        result = await detect_challenge(page)
        await browser.close()
    assert result is not None
    assert result.challenge_type == "otp"
    # OTP should NOT be captcha_blocked or captcha_solved
    assert "captcha" not in result.challenge_type
