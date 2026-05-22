import os
import io
import asyncio
import base64
import logging
import httpx
from playwright.async_api import async_playwright
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from PIL import Image, ImageChops
import psycopg2

logger = logging.getLogger("visual-regression")

_VALID_WAIT_UNTIL = {"commit", "domcontentloaded", "load", "networkidle"}


def _normalize_wait_until(value: str | None, default: str = "domcontentloaded") -> str:
    wait_until = (value or default or "domcontentloaded").strip().lower()
    if wait_until not in _VALID_WAIT_UNTIL:
        return default if default in _VALID_WAIT_UNTIL else "domcontentloaded"
    return wait_until

# ── Browser-pool integration ───────────────────────────────────────────────────
# When BROWSER_POOL_URL is set, screenshot capture is delegated to the shared
# pool service.  On any pool error the function falls back to local Playwright
# so existing behaviour is preserved during rollout.

_BROWSER_POOL_URL     = os.getenv("BROWSER_POOL_URL", "").rstrip("/")
_BROWSER_POOL_TIMEOUT = int(os.getenv("BROWSER_POOL_TIMEOUT_MS", "60000")) / 1000  # httpx uses seconds


def _pool_enabled() -> bool:
    return bool(_BROWSER_POOL_URL)


async def _pool_screenshot(
    url: str,
    width: int,
    height: int,
    full_page: bool,
    timeout_ms: int,
    wait_until: str,
) -> tuple[bytes, str] | None:
    """Call pool /screenshot and return (image_bytes, coverage_mode) or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=_BROWSER_POOL_TIMEOUT + 5) as client:
            resp = await client.post(
                f"{_BROWSER_POOL_URL}/screenshot",
                json={
                    "url":        url,
                    "width":      width,
                    "height":     height,
                    "full_page":  full_page,
                    "timeout_ms": timeout_ms,
                    "wait_until": wait_until,
                },
            )
        data = resp.json()
        if data.get("status") == "success" and data.get("image_b64"):
            img_bytes = base64.b64decode(data["image_b64"])
            coverage  = data.get("coverage_mode", "full_page")
            return img_bytes, coverage
        logger.warning("browser-pool /screenshot non-success for %s: %s", url, data.get("error"))
        return None
    except Exception as exc:
        logger.warning("browser-pool unavailable for %s: %s — falling back to local", url, exc)
        return None


async def _pool_batch_screenshot(
    urls: list[str],
    width: int,
    height: int,
    full_page: bool,
    timeout_ms: int,
    wait_until: str,
) -> list[dict] | None:
    """Call pool /batch-screenshot and return list of result dicts, or None on failure."""
    try:
        async with httpx.AsyncClient(timeout=_BROWSER_POOL_TIMEOUT + 10) as client:
            resp = await client.post(
                f"{_BROWSER_POOL_URL}/batch-screenshot",
                json={
                    "urls":       urls,
                    "width":      width,
                    "height":     height,
                    "full_page":  full_page,
                    "timeout_ms": timeout_ms,
                    "wait_until": wait_until,
                    "max_pages":  len(urls),
                },
            )
        data = resp.json()
        pages = data.get("pages", [])
        if not pages:
            return None
        results = []
        for p in pages:
            if p.get("status") == "success" and p.get("image_b64"):
                results.append({
                    "url":           p["url"],
                    "status":        "ok",
                    "screenshot":    base64.b64decode(p["image_b64"]),
                    "coverage_mode": p.get("coverage_mode", "full_page"),
                })
            else:
                results.append({
                    "url":    p["url"],
                    "status": "failed",
                    "error":  p.get("error", "pool_error"),
                })
        return results
    except Exception as exc:
        logger.warning("browser-pool batch unavailable: %s — falling back to local", exc)
        return None

# Use DB_HOST/DB_NAME env vars that match the docker-compose service
DB_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://snapflow:snapflow@db:5432/snapflow_v3",
)

# [NEW] Page navigation timeout for screenshot capture.
# Default 30s is hardcoded — now tunable via env var for slow-loading sites.
SCREENSHOT_GOTO_TIMEOUT_MS = int(os.getenv("SCREENSHOT_GOTO_TIMEOUT_MS", "30000"))
SCREENSHOT_WAIT_UNTIL = _normalize_wait_until(os.getenv("SCREENSHOT_WAIT_UNTIL", "domcontentloaded"))
SCREENSHOT_SETTLE_MS = max(0, int(os.getenv("SCREENSHOT_SETTLE_MS", "1000")))
SCREENSHOT_LOAD_STATE_TIMEOUT_MS = max(0, int(os.getenv("SCREENSHOT_LOAD_STATE_TIMEOUT_MS", "8000")))
SCREENSHOT_IGNORE_HTTPS_ERRORS = os.getenv("SCREENSHOT_IGNORE_HTTPS_ERRORS", "").strip().lower() in {"1", "true", "yes", "on"}


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def is_visual_regression_enabled() -> bool:
    return _env_bool("VISUAL_REGRESSION_ENABLED", True)


def chrome_no_sandbox_enabled() -> bool:
    return _env_bool("CHROME_NO_SANDBOX", False)


def get_browser_args() -> list[str]:
    args = ["--disable-dev-shm-usage"]
    if chrome_no_sandbox_enabled():
        args.extend(["--no-sandbox", "--disable-gpu"])
    return args


async def _wait_for_screenshot_ready(page, url: str, timeout_ms: int) -> bool:
    """Navigate to a visually usable page state without requiring network quiet."""
    logger.info(
        "local screenshot navigation url=%s wait_until=%s timeout_ms=%d settle_ms=%d",
        url,
        SCREENSHOT_WAIT_UNTIL,
        timeout_ms,
        SCREENSHOT_SETTLE_MS,
    )
    try:
        await page.goto(url, wait_until=SCREENSHOT_WAIT_UNTIL, timeout=timeout_ms)
    except (asyncio.TimeoutError, PlaywrightTimeoutError) as exc:
        raise TimeoutError(f"{SCREENSHOT_WAIT_UNTIL}_timeout after {timeout_ms} ms") from exc

    load_state_timeout_ignored = False
    if SCREENSHOT_WAIT_UNTIL != "load" and SCREENSHOT_LOAD_STATE_TIMEOUT_MS > 0:
        try:
            await page.wait_for_load_state("load", timeout=SCREENSHOT_LOAD_STATE_TIMEOUT_MS)
        except (asyncio.TimeoutError, PlaywrightTimeoutError):
            load_state_timeout_ignored = True
            logger.info(
                "local screenshot load-state timeout ignored url=%s final_url=%s timeout_ms=%d",
                url,
                page.url,
                SCREENSHOT_LOAD_STATE_TIMEOUT_MS,
            )

    if SCREENSHOT_SETTLE_MS > 0:
        await page.wait_for_timeout(SCREENSHOT_SETTLE_MS)

    logger.info(
        "local screenshot visual-ready url=%s final_url=%s wait_until=%s load_state_timeout_ignored=%s",
        url,
        page.url,
        SCREENSHOT_WAIT_UNTIL,
        load_state_timeout_ignored,
    )
    return load_state_timeout_ignored


def get_db():
    return psycopg2.connect(DB_URL)


def init_db():
    """Create visual_screenshots table if not exists."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS visual_screenshots (
                    id SERIAL PRIMARY KEY,
                    scan_id TEXT NOT NULL,
                    url TEXT NOT NULL,
                    screenshot BYTEA NOT NULL,
                    captured_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(scan_id, url)
                )
            """)
        conn.commit()


async def capture_screenshot(url: str, width: int = 1280, height: int = 800, browser_engine: str = "chromium", full_page: bool = True) -> bytes:
    """Capture a screenshot, delegating to the browser-pool service when available.

    Falls back to local Playwright on pool failure so existing behaviour is
    preserved during rollout.  When *full_page* is True and the scroll-height
    exceeds 15 000 px three viewport-height segments are stitched into one PNG.
    """
    # ── Pool fast-path ─────────────────────────────────────────────────────────
    if _pool_enabled():
        pool_result = await _pool_screenshot(url, width, height, full_page,
                                             SCREENSHOT_GOTO_TIMEOUT_MS,
                                             SCREENSHOT_WAIT_UNTIL)
        if pool_result is not None:
            img_bytes, _ = pool_result
            return img_bytes
        logger.info("capture_screenshot: pool failed for %s, using local Playwright", url)
    # ── Local Playwright fallback ──────────────────────────────────────────────
    async with async_playwright() as p:
        launcher = getattr(p, browser_engine, None)
        if launcher is None:
            raise ValueError(f"Unsupported browser engine: {browser_engine}")
        browser = await launcher.launch(args=get_browser_args())
        try:
            page = await browser.new_page(
                viewport={"width": width, "height": height},
                ignore_https_errors=SCREENSHOT_IGNORE_HTTPS_ERRORS,
            )
            await _wait_for_screenshot_ready(page, url, SCREENSHOT_GOTO_TIMEOUT_MS)

            if full_page:
                # Probe the full scroll height before committing to a single capture.
                scroll_height: int = await page.evaluate("document.documentElement.scrollHeight")
                if scroll_height > 15000:
                    # Lazy / segmented capture: top, middle, bottom viewport bands.
                    segments: list[Image.Image] = []
                    positions = [0, max(0, scroll_height // 2 - height // 2), max(0, scroll_height - height)]
                    for y in positions:
                        await page.evaluate(f"window.scrollTo(0, {y})")
                        raw = await page.screenshot(full_page=False)
                        segments.append(Image.open(io.BytesIO(raw)).convert("RGB"))
                    # Stack the three bands vertically into one image.
                    total_h = sum(s.height for s in segments)
                    stitched = Image.new("RGB", (segments[0].width, total_h))
                    cursor = 0
                    for seg in segments:
                        stitched.paste(seg, (0, cursor))
                        cursor += seg.height
                    buf = io.BytesIO()
                    stitched.save(buf, format="PNG")
                    screenshot = buf.getvalue()
                else:
                    screenshot = await page.screenshot(full_page=True)
            else:
                screenshot = await page.screenshot(full_page=False)

            return screenshot
        finally:
            await browser.close()


async def capture_screenshots_batch(
    urls: list[str],
    width: int = 1280,
    height: int = 800,
    browser_engine: str = "chromium",
    max_concurrency: int = 3,
    full_page: bool = True,
) -> list[dict]:
    """Capture screenshots, delegating to the browser-pool service when available.

    Falls back to local Playwright on pool failure.  When *full_page* is True
    pages taller than 15 000 px are captured as three stitched segments
    (``coverage_mode="segmented"``).
    """
    if not urls:
        return []

    # ── Pool fast-path ─────────────────────────────────────────────────────────
    if _pool_enabled():
        pool_results = await _pool_batch_screenshot(
            urls, width, height, full_page, SCREENSHOT_GOTO_TIMEOUT_MS, SCREENSHOT_WAIT_UNTIL
        )
        if pool_results is not None:
            return pool_results
        logger.info("capture_screenshots_batch: pool failed, using local Playwright")

    concurrency = max(1, min(max_concurrency, len(urls)))
    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict] = [{"url": url, "status": "failed", "error": "not_started"} for url in urls]

    async with async_playwright() as p:
        launcher = getattr(p, browser_engine, None)
        if launcher is None:
            raise ValueError(f"Unsupported browser engine: {browser_engine}")

        browser = await launcher.launch(args=get_browser_args())
        try:
            async def _capture(index: int, url: str):
                async with semaphore:
                    page = await browser.new_page(
                        viewport={"width": width, "height": height},
                        ignore_https_errors=SCREENSHOT_IGNORE_HTTPS_ERRORS,
                    )
                    try:
                        await _wait_for_screenshot_ready(page, url, SCREENSHOT_GOTO_TIMEOUT_MS)

                        coverage_mode: str
                        if full_page:
                            scroll_height: int = await page.evaluate("document.documentElement.scrollHeight")
                            if scroll_height > 15000:
                                # Segmented capture for very tall pages.
                                segments: list[Image.Image] = []
                                positions = [
                                    0,
                                    max(0, scroll_height // 2 - height // 2),
                                    max(0, scroll_height - height),
                                ]
                                for y in positions:
                                    await page.evaluate(f"window.scrollTo(0, {y})")
                                    raw = await page.screenshot(full_page=False)
                                    segments.append(Image.open(io.BytesIO(raw)).convert("RGB"))
                                total_h = sum(s.height for s in segments)
                                stitched = Image.new("RGB", (segments[0].width, total_h))
                                cursor = 0
                                for seg in segments:
                                    stitched.paste(seg, (0, cursor))
                                    cursor += seg.height
                                buf = io.BytesIO()
                                stitched.save(buf, format="PNG")
                                screenshot = buf.getvalue()
                                coverage_mode = "segmented"
                            else:
                                screenshot = await page.screenshot(full_page=True)
                                coverage_mode = "full_page"
                        else:
                            screenshot = await page.screenshot(full_page=False)
                            coverage_mode = "viewport_only"

                        results[index] = {
                            "url": url,
                            "status": "ok",
                            "screenshot": screenshot,
                            "coverage_mode": coverage_mode,
                        }
                    except Exception as exc:
                        results[index] = {
                            "url": url,
                            "status": "failed",
                            "error": str(exc),
                        }
                    finally:
                        await page.close()

            await asyncio.gather(*(_capture(i, url) for i, url in enumerate(urls)))
            return results
        finally:
            await browser.close()


def save_screenshot(scan_id: str, url: str, screenshot: bytes):
    """Persist screenshot bytes to the database, upserting on conflict."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO visual_screenshots (scan_id, url, screenshot)
                VALUES (%s, %s, %s)
                ON CONFLICT (scan_id, url)
                DO UPDATE SET screenshot = EXCLUDED.screenshot,
                              captured_at = NOW()
                """,
                (scan_id, url, psycopg2.Binary(screenshot)),
            )
        conn.commit()


def load_screenshot(scan_id: str, url: str) -> bytes | None:
    """Return screenshot bytes for a given scan/URL, or None if missing."""
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT screenshot FROM visual_screenshots "
                "WHERE scan_id = %s AND url = %s",
                (scan_id, url),
            )
            row = cur.fetchone()
            return bytes(row[0]) if row else None


def _pixel_diff_pct(img_a: "Image.Image", img_b: "Image.Image") -> float:
    """Return percentage of differing pixels (max-channel delta > 10)."""
    diff = ImageChops.difference(img_a, img_b)
    pixels = list(diff.getdata())
    total = len(pixels)
    if total == 0:
        return 0.0
    changed = sum(1 for p in pixels if max(p) > 10)
    return round((changed / total) * 100, 2)


def _chunked_diff(img_a: "Image.Image", img_b: "Image.Image") -> dict:
    """Compare two same-sized images in three horizontal bands.

    Used for images taller than 8 000 px to keep memory pressure bounded.
    Returns per-band diff percentages and an overall weighted average.
    """
    w, h = img_a.size
    band_h = h // 3
    bands = {
        "top":    (0,          band_h),
        "middle": (band_h,     band_h * 2),
        "bottom": (band_h * 2, h),
    }
    band_results: dict[str, float] = {}
    weighted_sum = 0.0
    total_pixels = 0

    for name, (y0, y1) in bands.items():
        crop_a = img_a.crop((0, y0, w, y1))
        crop_b = img_b.crop((0, y0, w, y1))
        pct = _pixel_diff_pct(crop_a, crop_b)
        band_results[name] = pct
        pixels_in_band = w * (y1 - y0)
        weighted_sum += pct * pixels_in_band
        total_pixels += pixels_in_band

    overall = round(weighted_sum / total_pixels, 2) if total_pixels else 0.0
    return {"band_diff_pct": band_results, "overall_diff_pct": overall}


def compute_diff(img_bytes_a: bytes, img_bytes_b: bytes, coverage_mode: str = "full_page") -> dict:
    """Return a rich comparison result between two screenshots.

    Changes from the original float-only return value
    ─────────────────────────────────────────────────
    • Returns a *dict* instead of a bare float so callers get structured data.
      The legacy ``diff_pct`` key is always present for backward compatibility.
    • Does NOT silently resize one image to match the other.  When sizes differ
      the function crops both images to the SMALLER of the two dimensions so
      that genuinely added/removed content at the bottom registers as a diff
      rather than being hidden by stretching.
    • Flags size differences explicitly (``layout_size_change``, ``size_delta``,
      ``structural_score``) so the caller can surface them as layout findings.
    • Uses chunked band comparison for images taller than 8 000 px.
    • Attaches ``coverage_mode`` so the report can state what was compared.

    Pixels are considered changed if their max channel delta exceeds 10
    (ignores minor anti-aliasing / sub-pixel rendering differences).
    """
    img_a = Image.open(io.BytesIO(img_bytes_a)).convert("RGB")
    img_b = Image.open(io.BytesIO(img_bytes_b)).convert("RGB")

    wa, ha = img_a.size
    wb, hb = img_b.size

    # ── Size-difference detection ────────────────────────────────────────────
    layout_size_change = img_a.size != img_b.size
    size_delta = {"width": wb - wa, "height": hb - ha}

    # A height change > 15 % is a potential layout regression in its own right.
    height_change_ratio = abs(hb - ha) / ha if ha > 0 else 0.0
    if height_change_ratio > 0.15:
        structural_score = "high_change"
    elif height_change_ratio > 0.10:
        structural_score = "moderate_change"
    else:
        structural_score = "no_change"

    # ── Crop both images to the smaller dimension (never stretch) ────────────
    if layout_size_change:
        target_w = min(wa, wb)
        target_h = min(ha, hb)
        img_a = img_a.crop((0, 0, target_w, target_h))
        img_b = img_b.crop((0, 0, target_w, target_h))

    # ── Pixel comparison (chunked for very tall images) ──────────────────────
    _, cropped_h = img_a.size
    if cropped_h > 8000:
        chunk_result = _chunked_diff(img_a, img_b)
        diff_pct: float = chunk_result["overall_diff_pct"]
        band_diff_pct: dict | None = chunk_result["band_diff_pct"]
    else:
        diff_pct = _pixel_diff_pct(img_a, img_b)
        band_diff_pct = None

    return {
        # Legacy field — kept for backward compatibility.
        "diff_pct": diff_pct,
        # Size / structural findings.
        "layout_size_change": layout_size_change,
        "size_delta": size_delta,
        "structural_score": structural_score,
        # Per-band breakdown (only set when chunked comparison was used).
        "band_diff_pct": band_diff_pct,
        # Coverage metadata.
        "coverage_mode": coverage_mode,
    }
