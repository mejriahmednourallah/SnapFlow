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

POOL_CONCURRENCY = int(os.getenv("BROWSER_POOL_CONCURRENCY", "15"))
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
    fcp_ms:        float = 0.0
    lcp_ms:        float = 0.0
    cls:           float = 0.0
    dom_nodes:     int = 0
    http_requests: int = 0
    transfer_size_kb: float = 0.0
    asset_breakdown: Optional[dict] = None
    desktop_overflow: bool = False
    tablet_overflow:  bool = False
    mobile_overflow:  bool = False
    invisible_links:  int = 0
    console_errors: Optional[list[str]] = None
    console_error_count: int = 0
    tracker_timeline: Optional[list[dict]] = None
    cmp_banner: Optional[dict] = None
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
        if (
            self._pages_served > 0
            and self._pages_served % RECYCLE_AFTER == 0
            and self._active_sessions <= 1
        ):
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

    async def _safe_close_page(self, page) -> None:
        if page is None:
            return
        try:
            await page.close()
        except Exception as exc:
            logger.debug("Ignoring page close error: %s", exc)

    async def _safe_close_context(self, context) -> None:
        if context is None:
            return
        try:
            await context.close()
        except Exception as exc:
            logger.debug("Ignoring context close error: %s", exc)

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

    async def _measure_render_metrics(self, page) -> dict:
        metrics = await page.evaluate(
            """async () => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const round = (value, places = 2) => {
                    if (!Number.isFinite(value) || value < 0) return 0;
                    const scale = Math.pow(10, places);
                    return Math.round(value * scale) / scale;
                };
                const nav = performance.getEntriesByType('navigation')[0];
                const timing = performance.timing || {};
                const dcl = nav && nav.domContentLoadedEventEnd > 0
                    ? nav.domContentLoadedEventEnd
                    : (timing.domContentLoadedEventEnd > timing.navigationStart
                        ? timing.domContentLoadedEventEnd - timing.navigationStart
                        : 0);
                const paint = performance.getEntriesByType('paint')
                    .find((entry) => entry.name === 'first-contentful-paint');
                const fcp = paint && paint.startTime > 0 ? paint.startTime : dcl;

                const lcpPromise = new Promise((resolve) => {
                    let lcp = 0;
                    let debounceId = null;
                    try {
                        const observer = new PerformanceObserver((list) => {
                            const entries = list.getEntries();
                            if (entries.length > 0) {
                                lcp = entries[entries.length - 1].startTime || 0;
                            }
                            if (debounceId) clearTimeout(debounceId);
                            debounceId = setTimeout(() => {
                                observer.disconnect();
                                resolve(lcp);
                            }, 500);
                        });
                        observer.observe({type: 'largest-contentful-paint', buffered: true});
                        setTimeout(() => {
                            if (debounceId) clearTimeout(debounceId);
                            observer.disconnect();
                            resolve(lcp);
                        }, 2000);
                    } catch (e) {
                        resolve(0);
                    }
                });

                const clsPromise = new Promise((resolve) => {
                    let cls = 0;
                    try {
                        const observer = new PerformanceObserver((list) => {
                            for (const entry of list.getEntries()) {
                                if (!entry.hadRecentInput) cls += entry.value || 0;
                            }
                        });
                        observer.observe({type: 'layout-shift', buffered: true});
                        setTimeout(() => {
                            observer.disconnect();
                            resolve(cls);
                        }, 2000);
                    } catch (e) {
                        resolve(0);
                    }
                });

                const [lcp, cls] = await Promise.all([lcpPromise, clsPromise]);
                const breakdown = {
                    html: {size_bytes: 0, count: 0, co2_grams: 0},
                    scripts: {size_bytes: 0, count: 0, co2_grams: 0},
                    stylesheets: {size_bytes: 0, count: 0, co2_grams: 0},
                    images: {size_bytes: 0, count: 0, co2_grams: 0},
                    fonts: {size_bytes: 0, count: 0, co2_grams: 0},
                    other: {size_bytes: 0, count: 0, co2_grams: 0},
                };
                const classify = (entry) => {
                    const type = (entry.initiatorType || '').toLowerCase();
                    const name = (entry.name || '').toLowerCase();
                    if (type === 'navigation' || type === 'iframe') return 'html';
                    if (type === 'script' || name.endsWith('.js')) return 'scripts';
                    if (type === 'css' || type === 'link' || name.endsWith('.css')) return 'stylesheets';
                    if (type === 'img' || type === 'image' || /\\.(png|jpe?g|gif|webp|svg|avif)(\\?|$)/.test(name)) return 'images';
                    if (/\\.(woff2?|ttf|otf|eot)(\\?|$)/.test(name)) return 'fonts';
                    return 'other';
                };
                const sizeOf = (entry) => Math.max(
                    0,
                    entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0
                );
                const resources = [
                    ...performance.getEntriesByType('navigation'),
                    ...performance.getEntriesByType('resource'),
                ];
                const trackerCatalog = [
                    {fragment: 'google-analytics.com', vendor: 'Google Analytics', category: 'analytics'},
                    {fragment: 'googletagmanager.com', vendor: 'Google Tag Manager', category: 'tag_manager'},
                    {fragment: 'doubleclick.net', vendor: 'Google Ads', category: 'advertising'},
                    {fragment: 'facebook.net', vendor: 'Meta Pixel', category: 'advertising'},
                    {fragment: 'facebook.com/tr', vendor: 'Meta Pixel', category: 'advertising'},
                    {fragment: 'hotjar.com', vendor: 'Hotjar', category: 'analytics'},
                    {fragment: 'clarity.ms', vendor: 'Microsoft Clarity', category: 'analytics'},
                    {fragment: 'matomo', vendor: 'Matomo', category: 'analytics'},
                    {fragment: 'linkedin.com/px', vendor: 'LinkedIn Insight', category: 'advertising'},
                    {fragment: 'snap.licdn.com', vendor: 'LinkedIn Insight', category: 'advertising'},
                    {fragment: 'tiktok.com/i18n/pixel', vendor: 'TikTok Pixel', category: 'advertising'},
                    {fragment: 'criteo.com', vendor: 'Criteo', category: 'advertising'},
                ];
                const trackerTimeline = [];
                let transferBytes = 0;
                resources.forEach((entry, index) => {
                    const size = sizeOf(entry);
                    const category = classify(entry);
                    transferBytes += size;
                    breakdown[category].size_bytes += size;
                    breakdown[category].count += 1;
                    const name = String(entry.name || '');
                    const lowerName = name.toLowerCase();
                    const matched = trackerCatalog.find((item) => lowerName.includes(item.fragment));
                    if (matched && trackerTimeline.length < 50) {
                        let host = '';
                        try { host = new URL(name, window.location.href).host; } catch (e) {}
                        trackerTimeline.push({
                            page_url: window.location.href,
                            tracker_domain: host || matched.fragment,
                            request_url: name,
                            category: matched.category,
                            vendor: matched.vendor,
                            resource_type: entry.initiatorType || 'resource',
                            order: index + 1,
                            before_consent: true,
                            source: 'browser_pool_runtime',
                        });
                    }
                });
                const invisibleLinks = Array.from(document.querySelectorAll('a')).filter((el) => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display === 'none'
                        || style.visibility === 'hidden'
                        || style.opacity === '0'
                        || rect.width === 0
                        || rect.height === 0;
                }).length;
                const overflow = () => document.documentElement.scrollWidth >
                    (Math.max(document.documentElement.clientWidth, window.innerWidth || 0) + 5);
                const bannerSelectors = [
                    '[id*="cookie" i]', '[class*="cookie" i]',
                    '[id*="consent" i]', '[class*="consent" i]',
                    '[id*="tarteaucitron" i]', '[class*="tarteaucitron" i]',
                    '[id*="didomi" i]', '[class*="didomi" i]',
                    '[id*="onetrust" i]', '[class*="onetrust" i]',
                    '[aria-label*="cookie" i]', '[aria-label*="consent" i]',
                ];
                let cmpBanner = null;
                for (const selector of bannerSelectors) {
                    const element = document.querySelector(selector);
                    if (!element) continue;
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    const visible = style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && style.opacity !== '0'
                        && rect.width > 0
                        && rect.height > 0;
                    if (!visible) continue;
                    cmpBanner = {
                        selector,
                        text: (element.innerText || element.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240),
                        visible: true,
                        source: 'browser_pool_runtime',
                    };
                    break;
                }
                return {
                    fcp_ms: round(fcp, 1),
                    lcp_ms: round(lcp, 1),
                    cls: round(cls, 3),
                    dom_nodes: document.querySelectorAll('*').length,
                    http_requests: resources.length,
                    transfer_size_kb: round(transferBytes / 1024, 2),
                    asset_breakdown: breakdown,
                    desktop_overflow: overflow(),
                    invisible_links: invisibleLinks,
                    tracker_timeline: trackerTimeline,
                    cmp_banner: cmpBanner,
                };
            }"""
        )
        await page.set_viewport_size({"width": 768, "height": 1024})
        await page.wait_for_timeout(200)
        metrics["tablet_overflow"] = await page.evaluate(
            "() => document.documentElement.scrollWidth > (Math.max(document.documentElement.clientWidth, window.innerWidth || 0) + 5)"
        )
        await page.set_viewport_size({"width": 375, "height": 812})
        await page.wait_for_timeout(200)
        metrics["mobile_overflow"] = await page.evaluate(
            "() => document.documentElement.scrollWidth > (Math.max(document.documentElement.clientWidth, window.innerWidth || 0) + 5)"
        )
        return metrics

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

            context = None
            page = None
            console_errors: list[str] = []
            try:
                context = await browser.new_context(viewport={"width": 1366, "height": 768})
                page    = await context.new_page()
                page.on(
                    "console",
                    lambda msg: console_errors.append(f"[{msg.type}] {msg.text}")
                    if msg.type in ("error", "warning")
                    else None,
                )
                await page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                html        = await page.content()
                title       = await page.title()
                page_height = await page.evaluate("document.documentElement.scrollHeight")
                page_width  = await page.evaluate("document.documentElement.scrollWidth")
                final_url   = page.url
                metrics     = await self._measure_render_metrics(page)
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
                    fcp_ms=metrics.get("fcp_ms", 0.0),
                    lcp_ms=metrics.get("lcp_ms", 0.0),
                    cls=metrics.get("cls", 0.0),
                    dom_nodes=metrics.get("dom_nodes", 0),
                    http_requests=metrics.get("http_requests", 0),
                    transfer_size_kb=metrics.get("transfer_size_kb", 0.0),
                    asset_breakdown=metrics.get("asset_breakdown"),
                    desktop_overflow=metrics.get("desktop_overflow", False),
                    tablet_overflow=metrics.get("tablet_overflow", False),
                    mobile_overflow=metrics.get("mobile_overflow", False),
                    invisible_links=metrics.get("invisible_links", 0),
                    console_errors=console_errors,
                    console_error_count=len(console_errors),
                    tracker_timeline=metrics.get("tracker_timeline") or [],
                    cmp_banner=metrics.get("cmp_banner") or None,
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
                await self._safe_close_page(page)
                await self._safe_close_context(context)
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

            context = None
            page = None
            try:
                context = await browser.new_context(viewport={"width": width, "height": height})
                page    = await context.new_page()
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
                await self._safe_close_page(page)
                await self._safe_close_context(context)
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
