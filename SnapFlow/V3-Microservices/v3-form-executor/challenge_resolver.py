from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any

import requests

logger = logging.getLogger("form-executor.challenge_resolver")

# ─── API config ───────────────────────────────────────────────────────────────
CAPTCHA_API_KEY = (os.getenv("FORM_EXECUTOR_2CAPTCHA_API_KEY") or "").strip()
CAPTCHA_TIMEOUT_S = int(os.getenv("FORM_EXECUTOR_CAPTCHA_TIMEOUT_S", "120"))
CAPTCHA_POLL_INTERVAL_S = int(os.getenv("FORM_EXECUTOR_CAPTCHA_POLL_INTERVAL_S", "5"))

_2CAPTCHA_CREATE_TASK = "https://api.2captcha.com/createTask"
_2CAPTCHA_GET_RESULT = "https://api.2captcha.com/getTaskResult"

# ─── CAPTCHA type selectors ───────────────────────────────────────────────────
_RECAPTCHA_V2_SELECTORS = (
    "iframe[src*='recaptcha/api2/bframe'], "
    "iframe[src*='google.com/recaptcha/api2/'], "
    ".g-recaptcha"
)
_HCAPTCHA_SELECTORS = (
    "iframe[src*='hcaptcha.com/captcha'], "
    "iframe[src*='hcaptcha.com/iframe'], "
    "div.h-captcha"
)
_TURNSTILE_SELECTORS = (
    "iframe[src*='challenges.cloudflare.com/turnstile'], "
    "div.cf-turnstile"
)
_IMAGE_CAPTCHA_SELECTORS = (
    "img[src*='captcha' i], "
    "img[id*='captcha' i], img[class*='captcha' i]"
)
_GENERIC_CAPTCHA_SELECTORS = (
    "[class*='captcha' i], [id*='captcha' i]"
)
_OTP_SELECTORS = (
    "input[autocomplete='one-time-code'], input[name*='otp' i], "
    "input[id*='otp' i], input[name*='verification' i]"
)

# ─── Data classes ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CaptchaInfo:
    """Detailed CAPTCHA detection result."""
    captcha_type: str  # recaptcha_v2, hcaptcha, turnstile, image_captcha, otp
    site_key: str | None = None
    image_url: str | None = None
    page_url: str = ""
    is_invisible: bool = False


@dataclass(frozen=True)
class Challenge:
    """High-level challenge result used by the executor."""
    challenge_type: str  # captcha, otp
    reason: str
    captcha_info: CaptchaInfo | None = None


@dataclass
class SolveResult:
    """Outcome of a 2Captcha resolution attempt."""
    success: bool
    token: str | None = None
    task_id: str | None = None
    task_type: str | None = None
    solve_duration_ms: int = 0
    cost: float = 0.0
    error: str | None = None
    provider_error_code: str | None = None
    provider_error_description: str | None = None


@dataclass(frozen=True)
class TaskCreationResult:
    task_id: str | None = None
    error_code: str | None = None
    error_description: str | None = None


@dataclass(frozen=True)
class TaskPollResult:
    status: str
    token: str | None = None
    error_code: str | None = None
    error_description: str | None = None


# ─── Detection ────────────────────────────────────────────────────────────────


async def detect_captcha(page) -> CaptchaInfo | None:
    """Detect CAPTCHA type and extract relevant parameters from the page."""
    page_url = page.url

    # ─ reCAPTCHA v2 ─
    recaptcha_frame = page.locator(_RECAPTCHA_V2_SELECTORS)
    if await recaptcha_frame.count() > 0:
        site_key = await _extract_site_key(page, "g-recaptcha", "data-sitekey")
        if not site_key:
            site_key = await _extract_site_key_from_src(page, "recaptcha")
        return CaptchaInfo(
            captcha_type="recaptcha_v2",
            site_key=site_key,
            page_url=page_url,
            is_invisible=await _is_invisible_recaptcha(page),
        )

    # ─ hCaptcha ─
    hcaptcha_frame = page.locator(_HCAPTCHA_SELECTORS)
    if await hcaptcha_frame.count() > 0:
        site_key = await _extract_site_key(page, "h-captcha", "data-sitekey")
        if not site_key:
            site_key = await _extract_site_key_from_src(page, "hcaptcha")
        return CaptchaInfo(
            captcha_type="hcaptcha",
            site_key=site_key,
            page_url=page_url,
        )

    # ─ Cloudflare Turnstile ─
    turnstile_el = page.locator(_TURNSTILE_SELECTORS)
    if await turnstile_el.count() > 0:
        site_key = await _extract_site_key(page, "cf-turnstile", "data-sitekey")
        return CaptchaInfo(
            captcha_type="turnstile",
            site_key=site_key,
            page_url=page_url,
        )

    # ─ Image CAPTCHA ─
    image_el = page.locator(_IMAGE_CAPTCHA_SELECTORS)
    if await image_el.count() > 0:
        img_src = ""
        try:
            img_handle = image_el.first
            img_src = (await img_handle.get_attribute("src")) or ""
        except Exception:
            pass
        return CaptchaInfo(
            captcha_type="image_captcha",
            image_url=img_src,
            page_url=page_url,
        )

    # ─ Generic CAPTCHA (class/id contains "captcha") ─
    generic = page.locator(_GENERIC_CAPTCHA_SELECTORS)
    if await generic.count() > 0:
        return CaptchaInfo(
            captcha_type="generic_captcha",
            page_url=page_url,
        )

    return None


async def detect_challenge(page) -> Challenge | None:
    """Detect a CAPTCHA or OTP without attempting external resolution."""
    otp_el = page.locator(_OTP_SELECTORS)
    if await otp_el.count() > 0:
        return Challenge("otp", "otp_required")

    captcha_info = await detect_captcha(page)
    if captcha_info is None:
        return None

    return Challenge(
        "captcha",
        f"captcha_detected:{captcha_info.captcha_type}",
        captcha_info=captcha_info,
    )


# ─── Solvability ──────────────────────────────────────────────────────────────


_SOLVABLE_CAPTCHA_TYPES = frozenset({"recaptcha_v2", "hcaptcha", "image_captcha"})


def is_captcha_solvable(captcha_info: CaptchaInfo) -> bool:
    """Determine whether a detected CAPTCHA can be solved via 2Captcha."""
    if captcha_info.captcha_type not in _SOLVABLE_CAPTCHA_TYPES:
        return False
    if captcha_info.captcha_type in {"recaptcha_v2", "hcaptcha"}:
        return bool(captcha_info.site_key)
    if captcha_info.captcha_type == "image_captcha":
        return bool(captcha_info.image_url)
    return False


# ─── Site key extraction helpers ──────────────────────────────────────────────


async def _extract_site_key(page, css_class: str, attr: str) -> str | None:
    try:
        el = page.locator(f".{css_class}[{attr}]").first
        if await el.count() > 0:
            return (await el.get_attribute(attr)) or None
    except Exception:
        pass
    return None


async def _is_invisible_recaptcha(page) -> bool:
    try:
        if await page.locator(".g-recaptcha[data-size='invisible']").count() > 0:
            return True
        frames = page.locator("iframe[src*='recaptcha']")
        for index in range(await frames.count()):
            src = (await frames.nth(index).get_attribute("src")) or ""
            if "size=invisible" in src.lower():
                return True
    except Exception:
        pass
    return False


async def _extract_site_key_from_src(page, keyword: str) -> str | None:
    try:
        src = await page.evaluate(
            f"""(keyword) => {{
                const frames = document.querySelectorAll('iframe[src*="' + keyword + '"]');
                for (const f of frames) {{
                    const m = f.src.match(/[?&]k=([^&]+)/);
                    if (m) return m[1];
                }}
                return null;
            }}""",
            keyword,
        )
        return src or None
    except Exception:
        return None


# ─── 2Captcha resolution ─────────────────────────────────────────────────────


async def resolve_captcha(
    page,
    captcha_info: CaptchaInfo,
    *,
    cache: dict[str, SolveResult] | None = None,
) -> SolveResult:
    """Attempt one idempotent CAPTCHA resolution via the 2Captcha API."""
    cache_key = _captcha_cache_key(captcha_info)
    if cache is not None and cache_key in cache:
        return cache[cache_key]

    if not CAPTCHA_API_KEY:
        result = SolveResult(success=False, error="no_captcha_api_key_configured")
        if cache is not None:
            cache[cache_key] = result
        return result

    if not is_captcha_solvable(captcha_info):
        result = SolveResult(
            success=False,
            error=f"unsupported_captcha_type:{captcha_info.captcha_type}",
        )
        if cache is not None:
            cache[cache_key] = result
        return result

    start_time = time.monotonic()
    task_payload = _build_2captcha_task(captcha_info)
    task_type = str(task_payload.get("task", {}).get("type") or "")

    try:
        creation = await _create_2captcha_task(task_payload)
        if not creation.task_id:
            error_code = creation.error_code or "UNKNOWN"
            result = SolveResult(
                success=False,
                task_type=task_type,
                solve_duration_ms=int((time.monotonic() - start_time) * 1000),
                error=f"2captcha_create_task_error:{error_code}",
                provider_error_code=creation.error_code,
                provider_error_description=creation.error_description,
            )
            if cache is not None:
                cache[cache_key] = result
            return result

        deadline = time.monotonic() + CAPTCHA_TIMEOUT_S
        token = None
        poll_error: TaskPollResult | None = None
        while time.monotonic() < deadline:
            await asyncio.sleep(CAPTCHA_POLL_INTERVAL_S)
            poll_result = await _poll_2captcha_result(creation.task_id)
            if poll_result.status == "ready" and poll_result.token:
                token = poll_result.token
                break
            if poll_result.status == "error":
                poll_error = poll_result
                break

        solve_duration_ms = int((time.monotonic() - start_time) * 1000)

        if poll_error is not None:
            error_code = poll_error.error_code or "UNKNOWN"
            result = SolveResult(
                success=False,
                task_id=creation.task_id,
                task_type=task_type,
                solve_duration_ms=solve_duration_ms,
                error=f"2captcha_result_error:{error_code}",
                provider_error_code=poll_error.error_code,
                provider_error_description=poll_error.error_description,
            )
            if cache is not None:
                cache[cache_key] = result
            return result

        if not token:
            result = SolveResult(
                success=False,
                task_id=creation.task_id,
                task_type=task_type,
                solve_duration_ms=solve_duration_ms,
                error="2captcha_timeout",
            )
            if cache is not None:
                cache[cache_key] = result
            return result

        await _inject_captcha_token(page, captcha_info, token)
        result = SolveResult(
            success=True,
            token="[REDACTED]",
            task_id=creation.task_id,
            task_type=task_type,
            solve_duration_ms=solve_duration_ms,
            cost=_estimate_cost(captcha_info.captcha_type),
        )
        if cache is not None:
            cache[cache_key] = result
        return result

    except Exception as exc:
        result = SolveResult(
            success=False,
            task_type=task_type,
            solve_duration_ms=int((time.monotonic() - start_time) * 1000),
            error=f"2captcha_error:{exc}",
        )
        if cache is not None:
            cache[cache_key] = result
        return result


def _build_2captcha_task(captcha_info: CaptchaInfo) -> dict[str, Any]:
    """Build a 2Captcha createTask payload based on CAPTCHA type."""
    common = {
        "clientKey": CAPTCHA_API_KEY,
    }

    if captcha_info.captcha_type == "recaptcha_v2":
        return {
            **common,
            "task": {
                "type": "RecaptchaV2TaskProxyless",
                "websiteURL": captcha_info.page_url,
                "websiteKey": captcha_info.site_key,
                "isInvisible": captcha_info.is_invisible,
            },
        }

    if captcha_info.captcha_type == "hcaptcha":
        return {
            **common,
            "task": {
                "type": "HCaptchaTaskProxyless",
                "websiteURL": captcha_info.page_url,
                "websiteKey": captcha_info.site_key,
            },
        }

    if captcha_info.captcha_type == "image_captcha":
        return {
            **common,
            "task": {
                "type": "ImageToTextTask",
                "body": captcha_info.image_url or "",
                "case": True,
            },
        }

    return {**common, "task": {"type": "RecaptchaV2TaskProxyless"}}


async def _create_2captcha_task(payload: dict[str, Any]) -> TaskCreationResult:
    """Submit a task to 2Captcha and preserve provider diagnostics."""
    loop = asyncio.get_running_loop()
    try:
        response = await loop.run_in_executor(
            None,
            lambda: requests.post(
                _2CAPTCHA_CREATE_TASK,
                json=payload,
                timeout=30,
            ),
        )
        if response.status_code != 200:
            logger.warning("2Captcha createTask HTTP %s", response.status_code)
            return TaskCreationResult(
                error_code=f"HTTP_{response.status_code}",
                error_description="2Captcha createTask returned a non-200 response.",
            )
        data = response.json()
        if data.get("errorId") != 0:
            error_code = str(data.get("errorCode") or "UNKNOWN")
            error_description = str(data.get("errorDescription") or "Unknown provider error.")
            logger.warning("2Captcha createTask error %s: %s", error_code, error_description)
            return TaskCreationResult(
                error_code=error_code,
                error_description=error_description,
            )
        return TaskCreationResult(task_id=str(data.get("taskId") or ""))
    except Exception as exc:
        logger.warning("2Captcha createTask failed: %s", exc)
        return TaskCreationResult(
            error_code="REQUEST_FAILED",
            error_description=str(exc),
        )


async def _poll_2captcha_result(task_id: str) -> TaskPollResult:
    """Poll 2Captcha while preserving ready, pending, and error states."""
    loop = asyncio.get_running_loop()
    payload = {
        "clientKey": CAPTCHA_API_KEY,
        "taskId": int(task_id),
    }
    try:
        response = await loop.run_in_executor(
            None,
            lambda: requests.post(
                _2CAPTCHA_GET_RESULT,
                json=payload,
                timeout=15,
            ),
        )
        if response.status_code != 200:
            return TaskPollResult(
                status="error",
                error_code=f"HTTP_{response.status_code}",
                error_description="2Captcha getTaskResult returned a non-200 response.",
            )
        data = response.json()
        if data.get("errorId") != 0:
            return TaskPollResult(
                status="error",
                error_code=str(data.get("errorCode") or "UNKNOWN"),
                error_description=str(data.get("errorDescription") or "Unknown provider error."),
            )
        if data.get("status") == "ready":
            solution = data.get("solution") if isinstance(data.get("solution"), dict) else {}
            token = str(solution.get("gRecaptchaResponse") or solution.get("text") or solution.get("token") or "")
            return TaskPollResult(status="ready", token=token)
        return TaskPollResult(status="processing")
    except Exception as exc:
        return TaskPollResult(
            status="error",
            error_code="REQUEST_FAILED",
            error_description=str(exc),
        )


async def _inject_captcha_token(page, captcha_info: CaptchaInfo, token: str) -> None:
    """Inject the resolved CAPTCHA token into the page."""
    try:
        if captcha_info.captcha_type in {"recaptcha_v2", "hcaptcha"}:
            await page.evaluate(
                """([token, captchaType]) => {
                    const textareas = document.querySelectorAll('textarea.g-recaptcha-response, textarea.h-captcha-response, textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"]');
                    for (const ta of textareas) {
                        ta.value = token;
                        ta.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    // Also set the global callback if present
                    if (typeof window.___grecaptcha_cfg !== 'undefined' && window.___grecaptcha_cfg.clients) {
                        for (const clientId in window.___grecaptcha_cfg.clients) {
                            const client = window.___grecaptcha_cfg.clients[clientId];
                            if (client && client.callback) {
                                client.callback(token);
                            }
                        }
                    }
                    if (typeof window.hcaptcha !== 'undefined' && typeof window.hcaptcha.getResponse === 'function') {
                        // h-captcha uses data-callback
                        const hcaptchaDiv = document.querySelector('.h-captcha');
                        if (hcaptchaDiv) {
                            const cb = hcaptchaDiv.getAttribute('data-callback');
                            if (cb && typeof window[cb] === 'function') {
                                window[cb](token);
                            }
                        }
                    }
                }""",
                [token, captcha_info.captcha_type],
            )
        elif captcha_info.captcha_type == "image_captcha":
            await page.evaluate(
                """([token]) => {
                    const inputs = document.querySelectorAll('input[name*="captcha" i], input[id*="captcha" i], input[class*="captcha" i]');
                    for (const inp of inputs) {
                        inp.value = token;
                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }""",
                [token],
            )
    except Exception as exc:
        logger.warning("Failed to inject CAPTCHA token: %s", exc)


# ─── Cost estimation ──────────────────────────────────────────────────────────

_COST_MAP = {
    "recaptcha_v2": 0.00299,
    "hcaptcha": 0.00299,
    "image_captcha": 0.001,
    "turnstile": 0.00299,
}


def _estimate_cost(captcha_type: str) -> float:
    return _COST_MAP.get(captcha_type, 0.0)


# ─── Public orchestration ─────────────────────────────────────────────────────


async def resolve_or_block(
    page,
    api_key: str = "",
    timeout_s: int = 120,
    *,
    cache: dict[str, SolveResult] | None = None,
) -> SolveResult:
    """Detect and attempt to resolve any CAPTCHA on the page.
    This is the main entry point for the executor.
    """
    captcha_info = await detect_captcha(page)
    if captcha_info is None:
        return SolveResult(success=True, error=None)

    if not is_captcha_solvable(captcha_info):
        return SolveResult(
            success=False,
            error=f"unsupported_captcha_type:{captcha_info.captcha_type}",
        )

    if not CAPTCHA_API_KEY and not api_key:
        return SolveResult(
            success=False,
            error="no_captcha_api_key_configured",
        )

    return await resolve_captcha(page, captcha_info, cache=cache)


def _captcha_cache_key(captcha_info: CaptchaInfo) -> str:
    return "|".join(
        (
            captcha_info.captcha_type,
            captcha_info.page_url,
            captcha_info.site_key or "",
            captcha_info.image_url or "",
            "invisible" if captcha_info.is_invisible else "visible",
        )
    )
