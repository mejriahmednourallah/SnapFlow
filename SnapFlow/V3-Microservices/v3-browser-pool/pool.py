"""
BrowserPool — shared Playwright Chromium runtime.

Bounded concurrency, per-job timeout, crash recovery, and browser recycling
so every caller (visual-regression, scanner, aggregator) shares one browser
fleet instead of each launching its own.
"""

import asyncio
import io
import logging
import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from PIL import Image
from playwright.async_api import async_playwright, Browser, Playwright

logger = logging.getLogger("browser-pool")

POOL_CONCURRENCY = int(os.getenv("BROWSER_POOL_CONCURRENCY", "3"))
RECYCLE_AFTER    = int(os.getenv("BROWSER_POOL_RECYCLE_AFTER", "50"))
DEFAULT_TIMEOUT  = int(os.getenv("BROWSER_POOL_DEFAULT_TIMEOUT_MS", "30000"))
_CHROME_NO_SANDBOX = os.getenv("CHROME_NO_SANDBOX", "").strip().lower() in ("1", "true", "yes", "on")

# Seconds to wait when all slots are busy before giving up.
_ACQUIRE_TIMEOUT = float(os.getenv("BROWSER_POOL_ACQUIRE_TIMEOUT_S", "8"))


# ── Status vocabulary ──────────────────────────────────────────────────────────

class PageStatus(str, Enum):
    SUCCESS          = "success"
    TIMEOUT          = "timeout"
    NAVIGATION_ERROR = "navigation_error"
    TLS_ERROR        = "tls_error"
    BLOCKED          = "blocked"
    POOL_EXHAUSTED   = "pool_exhausted"


# ── Result data classes ────────────────────────────────────────────────────────

@dataclass
class RenderResult:
    status:        PageStatus
    url:           str
    rendered_html: Optional[str] = None
    title:         Optional[str] = None
    page_height:   Optional[int] = None
    page_width:    Optional[int] = None
    final_url:     Optional[str] = None
    error:         Optional[str] = None


@dataclass
class ScreenshotResult:
    status:        PageStatus
    url:           str
    image_bytes:   Optional[bytes] = None
    width:         Optional[int]   = None
    height:        Optional[int]   = None
    coverage_mode: str             = "viewport_only"
    error:         Optional[str]   = None


# ── Browser pool ───────────────────────────────────────────────────────────────

class BrowserPool:
    def __init__(self) -> None:
        self._playwright:       Optional[Playwright] = None
        self._browser:          Optional[Browser]    = None
        self._semaphore:        Optional[asyncio.Semaphore] = None
        self._recycle_lock      = asyncio.Lock()
        self._pages_served      = 0
        self._active_sessions   = 0
        self._crash_count       = 0
        self._timeout_count     = 0
        self._success_count     = 0
        self._started           = False

    # ── Lifecycle ──────────────────────────────────────────────────────────────

    async def start(self) -> None:
        self._playwright = await async_playwright().start()
        self._browser    = await self._launch()
        self._semaphore  = asyncio.Semaphore(POOL_CONCURRENCY)
        self._started    = True
        logger.info(
            "BrowserPool ready: concurrency=%d  recycle_after=%d  timeout_ms=%d",
            POOL_CONCURRENCY, RECYCLE_AFTER, DEFAULT_TIMEOUT,
        )

    async def stop(self) -> None:
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass
        if self._playwright:
            await self._playwright.stop()
        self._started = False

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _browser_args(self) -> list[str]:
        args = ["--disable-dev-shm-usage"]
        if _CHROME_NO_SANDBOX:
            args += ["--no-sandbox", "--disable-gpu"]
        return args

    async def _launch(self) -> Browser:
        return await self._playwright.chromium.launch(args=self._browser_args())

    async def _maybe_recycle(self) -> None:
        """Recycle the browser every RECYCLE_AFTER pages to cap memory growth."""
        if self._pages_served > 0 and self._pages_served % RECYCLE_AFTER == 0:
            logger.info("Recycling browser after %d pages served", self._pages_served)
            try:
                await self._browser.close()
            except Exception as e:
                logger.warning("Error closing old browser: %s", e)
                self._crash_count += 1
            try:
                self._browser = await self._launch()
                logger.info("Browser recycled successfully")
            except Exception as e:
                logger.error("Browser recycle failed: %s", e)
                self._crash_count += 1

    def _classify_error(self, exc: Exception) -> PageStatus:
        msg = str(exc).lower()
        if "timeout" in msg or "timed out" in msg:
            return PageStatus.TIMEOUT
        if any(k in msg for k in ("ssl", "tls", "certificate", "err_cert")):
            return PageStatus.TLS_ERROR
        if any(k in msg for k in ("connection_refused", "connection_reset", "name_not_resolved", "err_aborted")):
            return PageStatus.NAVIGATION_ERROR
        if any(k in msg for k in ("403", "blocked", "forbidden", "access denied")):
            return PageStatus.BLOCKED
        return PageStatus.NAVIGATION_ERROR

    async def _acquire(self) -> bool:
        """Try to acquire a semaphore slot within the acquire timeout."""
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=_ACQUIRE_TIMEOUT)
            return True
        except asyncio.TimeoutError:
            return False

    # ── Public API ─────────────────────────────────────────────────────────────

    async def render(
        self,
        url:         str,
        timeout_ms:  int = DEFAULT_TIMEOUT,
        wait_until:  str = "networkidle",
    ) -> RenderResult:
        """Open *url*, wait for the DOM to settle, and return the rendered HTML."""
        if not self._started:
            return RenderResult(status=PageStatus.POOL_EXHAUSTED, url=url, error="Pool not started")

        if not await self._acquire():
            return RenderResult(status=PageStatus.POOL_EXHAUSTED, url=url,
                                error="All browser slots busy — queue timeout")
        self._active_sessions += 1
        try:
            async with self._recycle_lock:
                await self._maybe_recycle()
                browser = self._browser

            context = await browser.new_context()
            page    = await context.new_page()
            try:
                await page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                html        = await page.content()
                title       = await page.title()
                page_height = await page.evaluate("document.documentElement.scrollHeight")
                page_width  = await page.evaluate("document.documentElement.scrollWidth")
                final_url   = page.url
                self._pages_served += 1
                self._success_count += 1
                return RenderResult(
                    status=PageStatus.SUCCESS,
                    url=url,
                    rendered_html=html,
                    title=title,
                    page_height=page_height,
                    page_width=page_width,
                    final_url=final_url,
                )
            except asyncio.TimeoutError:
                self._timeout_count += 1
                return RenderResult(status=PageStatus.TIMEOUT, url=url,
                                    error=f"Navigation timeout after {timeout_ms} ms")
            except Exception as exc:
                st = self._classify_error(exc)
                if st == PageStatus.TIMEOUT:
                    self._timeout_count += 1
                return RenderResult(status=st, url=url, error=str(exc))
            finally:
                await page.close()
                await context.close()
        finally:
            self._active_sessions -= 1
            self._semaphore.release()

    async def screenshot(
        self,
        url:        str,
        width:      int  = 1280,
        height:     int  = 800,
        full_page:  bool = True,
        timeout_ms: int  = DEFAULT_TIMEOUT,
    ) -> ScreenshotResult:
        """Capture a screenshot of *url* and return raw PNG bytes."""
        if not self._started:
            return ScreenshotResult(status=PageStatus.POOL_EXHAUSTED, url=url, error="Pool not started")

        if not await self._acquire():
            return ScreenshotResult(status=PageStatus.POOL_EXHAUSTED, url=url,
                                    error="All browser slots busy — queue timeout")
        self._active_sessions += 1
        try:
            async with self._recycle_lock:
                await self._maybe_recycle()
                browser = self._browser

            context = await browser.new_context(viewport={"width": width, "height": height})
            page    = await context.new_page()
            try:
                await page.goto(url, wait_until="networkidle", timeout=timeout_ms)

                coverage_mode = "viewport_only"
                image_bytes: Optional[bytes] = None
                actual_height = height

                if full_page:
                    scroll_h: int = await page.evaluate("document.documentElement.scrollHeight")
                    if scroll_h <= 15000:
                        image_bytes   = await page.screenshot(full_page=True)
                        coverage_mode = "full_page"
                        actual_height = scroll_h
                    else:
                        # Segmented: top / middle / bottom bands stitched vertically.
                        positions = [
                            0,
                            max(0, scroll_h // 2 - height // 2),
                            max(0, scroll_h - height),
                        ]
                        segments: list[Image.Image] = []
                        for y in positions:
                            await page.evaluate(f"window.scrollTo(0, {y})")
                            raw = await page.screenshot(full_page=False)
                            segments.append(Image.open(io.BytesIO(raw)).convert("RGB"))
                        total_h  = sum(s.height for s in segments)
                        stitched = Image.new("RGB", (segments[0].width, total_h))
                        cursor   = 0
                        for seg in segments:
                            stitched.paste(seg, (0, cursor))
                            cursor += seg.height
                        buf = io.BytesIO()
                        stitched.save(buf, format="PNG")
                        image_bytes   = buf.getvalue()
                        coverage_mode = "segmented"
                        actual_height = total_h
                else:
                    image_bytes = await page.screenshot(full_page=False)

                self._pages_served += 1
                self._success_count += 1
                return ScreenshotResult(
                    status=PageStatus.SUCCESS,
                    url=url,
                    image_bytes=image_bytes,
                    width=width,
                    height=actual_height,
                    coverage_mode=coverage_mode,
                )
            except asyncio.TimeoutError:
                self._timeout_count += 1
                return ScreenshotResult(status=PageStatus.TIMEOUT, url=url,
                                        error=f"Navigation timeout after {timeout_ms} ms")
            except Exception as exc:
                st = self._classify_error(exc)
                if st == PageStatus.TIMEOUT:
                    self._timeout_count += 1
                return ScreenshotResult(status=st, url=url, error=str(exc))
            finally:
                await page.close()
                await context.close()
        finally:
            self._active_sessions -= 1
            self._semaphore.release()

    # ── Observability ──────────────────────────────────────────────────────────

    def health(self) -> dict:
        alive = (
            self._started
            and self._browser is not None
            and not getattr(self._browser, "_closed", False)
        )
        return {
            "status":          "ok" if alive else "degraded",
            "pool_size":       POOL_CONCURRENCY,
            "active_sessions": self._active_sessions,
            "recycle_after":   RECYCLE_AFTER,
            "pages_served":    self._pages_served,
            "success_count":   self._success_count,
            "timeout_count":   self._timeout_count,
            "crash_count":     self._crash_count,
            "browser_alive":   alive,
        }
