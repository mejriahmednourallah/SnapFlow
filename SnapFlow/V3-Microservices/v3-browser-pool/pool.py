"""
BrowserPool — shared Playwright Chromium runtime.

Bounded concurrency, per-job timeout, crash recovery, and browser recycling
so every caller (visual-regression, scanner, aggregator) shares one browser
fleet instead of each launching its own.
"""

import asyncio
import ipaddress
import io
import logging
import os
import socket
from dataclasses import dataclass
from enum import Enum
from typing import Optional
from urllib.parse import urlparse

from PIL import Image
from playwright.async_api import async_playwright, Browser, Playwright
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

logger = logging.getLogger("browser-pool")

_VALID_WAIT_UNTIL = {"commit", "domcontentloaded", "load", "networkidle"}


def _normalize_wait_until(value: Optional[str], default: str = "domcontentloaded") -> str:
    wait_until = (value or default or "domcontentloaded").strip().lower()
    if wait_until not in _VALID_WAIT_UNTIL:
        return default if default in _VALID_WAIT_UNTIL else "domcontentloaded"
    return wait_until


POOL_CONCURRENCY = int(os.getenv("BROWSER_POOL_CONCURRENCY", "15"))
RECYCLE_AFTER    = int(os.getenv("BROWSER_POOL_RECYCLE_AFTER", "50"))
DEFAULT_TIMEOUT  = int(os.getenv("BROWSER_POOL_DEFAULT_TIMEOUT_MS", "30000"))
_BROWSER_POOL_IGNORE_HTTPS_ERRORS = os.getenv("BROWSER_POOL_IGNORE_HTTPS_ERRORS", "").strip().lower() in ("1", "true", "yes", "on")
DEFAULT_SCREENSHOT_WAIT_UNTIL = _normalize_wait_until(
    os.getenv("BROWSER_POOL_SCREENSHOT_WAIT_UNTIL", "domcontentloaded"),
)
BROWSER_POOL_SCREENSHOT_SETTLE_MS = max(0, int(os.getenv("BROWSER_POOL_SCREENSHOT_SETTLE_MS", "1000")))
BROWSER_POOL_SCREENSHOT_LOAD_STATE_TIMEOUT_MS = max(0, int(os.getenv("BROWSER_POOL_SCREENSHOT_LOAD_STATE_TIMEOUT_MS", "8000")))
_CHROME_NO_SANDBOX = os.getenv("CHROME_NO_SANDBOX", "").strip().lower() in ("1", "true", "yes", "on")
_ENABLE_OBSCURA_DISCOVERY = os.getenv("ENABLE_OBSCURA_DISCOVERY", "").strip().lower() in ("1", "true", "yes", "on")
_OBSCURA_CDP_URL = os.getenv("OBSCURA_CDP_URL", "").strip()

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
    final_url:     Optional[str]   = None
    wait_until:    str             = DEFAULT_SCREENSHOT_WAIT_UNTIL
    load_state_timeout_ignored: bool = False
    error:         Optional[str]   = None


# ── Browser pool ───────────────────────────────────────────────────────────────

@dataclass
class DiscoveryResult:
    status: PageStatus
    url: str
    engine: str = "chromium"
    final_url: Optional[str] = None
    rendered_html: Optional[str] = None
    visible_text: Optional[str] = None
    title: Optional[str] = None
    headings: Optional[list[dict]] = None
    internal_links: Optional[list[str]] = None
    external_links: Optional[list[str]] = None
    forms: Optional[list[dict]] = None
    buttons: Optional[list[dict]] = None
    risk_flags: Optional[list[str]] = None
    candidate_messages: Optional[list[str]] = None
    detection_sources: Optional[list[str]] = None
    confidence: str = "low"
    error: Optional[str] = None


def _normalise_allowed_domains(domains: list[str]) -> set[str]:
    clean: set[str] = set()
    for domain in domains or []:
        host = urlparse(domain).hostname if "://" in domain else domain
        host = (host or "").strip().lower().strip(".")
        if host:
            clean.add(host)
    return clean


def _host_matches_allowed(host: str, allowed_domains: list[str]) -> bool:
    host = (host or "").strip().lower().strip(".")
    allowed = _normalise_allowed_domains(allowed_domains)
    if not host or not allowed:
        return False
    return any(host == domain or host.endswith("." + domain) for domain in allowed)


def _is_private_host(host: str) -> tuple[bool, str]:
    host = (host or "").strip().lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
        return True, "internal_hostname"
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True, "private_ip"
        return False, ""
    except ValueError:
        pass

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False, ""
    for info in infos:
        address = info[4][0]
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            continue
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return True, "private_dns"
    return False, ""


def _validate_discovery_target(url: str, allowed_domains: list[str]) -> tuple[bool, str]:
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "invalid_url"
    if parsed.scheme not in {"http", "https"}:
        return False, "unsupported_scheme"
    host = (parsed.hostname or "").lower()
    if not _host_matches_allowed(host, allowed_domains):
        return False, "outside_allowed_domains"
    private, reason = _is_private_host(host)
    if private:
        return False, reason
    return True, ""


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
            "BrowserPool ready: concurrency=%d  recycle_after=%d  timeout_ms=%d  ignore_https_errors=%s",
            POOL_CONCURRENCY, RECYCLE_AFTER, DEFAULT_TIMEOUT, _BROWSER_POOL_IGNORE_HTTPS_ERRORS,
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
                context = await browser.new_context(
                    viewport={"width": 1366, "height": 768},
                    ignore_https_errors=_BROWSER_POOL_IGNORE_HTTPS_ERRORS,
                )
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

    async def discover_rendered(
        self,
        url: str,
        allowed_domains: Optional[list[str]] = None,
        max_links: int = 30,
        extract_forms: bool = True,
        wait_ms: int = DEFAULT_TIMEOUT,
        force_chromium: bool = False,
    ) -> DiscoveryResult:
        """Discovery-only rendered extraction for routes, text, buttons and forms."""
        allowed_domains = allowed_domains or []
        ok, reason = _validate_discovery_target(url, allowed_domains)
        if not ok:
            return DiscoveryResult(status=PageStatus.BLOCKED, url=url, error=reason, risk_flags=[reason])
        if not self._started:
            return DiscoveryResult(status=PageStatus.POOL_EXHAUSTED, url=url, error="Pool not started")
        if not await self._acquire():
            return DiscoveryResult(status=PageStatus.POOL_EXHAUSTED, url=url, error="All browser slots busy - queue timeout")

        self._active_sessions += 1
        context = None
        page = None
        engine = "chromium"
        try:
            async with self._recycle_lock:
                await self._maybe_recycle()
                browser = self._browser

            use_obscura = _ENABLE_OBSCURA_DISCOVERY and bool(_OBSCURA_CDP_URL) and not force_chromium
            try:
                if use_obscura:
                    remote_browser = await self._playwright.chromium.connect_over_cdp(_OBSCURA_CDP_URL)
                    context = await remote_browser.new_context(
                        viewport={"width": 1366, "height": 768},
                        ignore_https_errors=_BROWSER_POOL_IGNORE_HTTPS_ERRORS,
                    )
                    engine = "obscura"
                else:
                    context = await browser.new_context(
                        viewport={"width": 1366, "height": 768},
                        ignore_https_errors=_BROWSER_POOL_IGNORE_HTTPS_ERRORS,
                    )
            except Exception as exc:
                logger.warning("Obscura discovery unavailable, falling back to Chromium: %s", exc)
                context = await browser.new_context(
                    viewport={"width": 1366, "height": 768},
                    ignore_https_errors=_BROWSER_POOL_IGNORE_HTTPS_ERRORS,
                )
                engine = "chromium"

            page = await context.new_page()
            timeout_ms = max(3000, min(wait_ms or DEFAULT_TIMEOUT, 60000))
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            await page.wait_for_timeout(min(max(timeout_ms // 8, 300), 2500))

            final_url = page.url
            final_host = urlparse(final_url).hostname or ""
            if not _host_matches_allowed(final_host, allowed_domains):
                return DiscoveryResult(
                    status=PageStatus.BLOCKED,
                    url=url,
                    engine=engine,
                    final_url=final_url,
                    error="redirected_outside_allowed_domains",
                    risk_flags=["redirected_outside_allowed_domains"],
                )

            payload = await page.evaluate(
                """({ allowedDomains, maxLinks, extractForms }) => {
                    const esc = (value) => {
                      if (!value) return "";
                      if (window.CSS && CSS.escape) return CSS.escape(String(value));
                      return String(value).replace(/["\\\\]/g, "\\\\$&");
                    };
                    const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
                    const short = (value, limit = 240) => {
                      const text = clean(value);
                      return text.length > limit ? text.slice(0, limit - 3) + "..." : text;
                    };
                    const allowed = (allowedDomains || [])
                      .map((d) => String(d || "").toLowerCase().replace(/^https?:\\/\\//, "").replace(/\\/$/, ""));
                    const isAllowed = (href) => {
                      try {
                        const host = new URL(href, location.href).hostname.toLowerCase();
                        return allowed.some((domain) => host === domain || host.endsWith("." + domain));
                      } catch {
                        return false;
                      }
                    };
                    const selectorFor = (el) => {
                      if (!el || !el.tagName) return "";
                      const tag = el.tagName.toLowerCase();
                      if (el.id) return `${tag}#${esc(el.id)}`;
                      const name = el.getAttribute("name");
                      if (name) return `${tag}[name="${esc(name)}"]`;
                      const type = el.getAttribute("type");
                      if (type) return `${tag}[type="${esc(type)}"]`;
                      const parent = el.parentElement;
                      if (!parent) return tag;
                      const siblings = Array.from(parent.children).filter((node) => node.tagName === el.tagName);
                      const idx = Math.max(1, siblings.indexOf(el) + 1);
                      return `${tag}:nth-of-type(${idx})`;
                    };
                    const labelFor = (field) => {
                      const id = field.id;
                      if (id) {
                        const label = document.querySelector(`label[for="${esc(id)}"]`);
                        if (label) return short(label.innerText, 120);
                      }
                      const wrapping = field.closest("label");
                      if (wrapping) return short(wrapping.innerText, 120);
                      const aria = field.getAttribute("aria-label") || field.getAttribute("aria-labelledby");
                      return aria ? short(aria, 120) : "";
                    };
                    const riskSet = new Set();
                    const classifyFieldRisk = (field) => {
                      const type = String(field.getAttribute("type") || field.tagName || "").toLowerCase();
                      const name = String(field.getAttribute("name") || field.id || "").toLowerCase();
                      const text = `${type} ${name} ${field.placeholder || ""}`.toLowerCase();
                      if (type === "password" || /login|signin|account|compte|connexion/.test(text)) riskSet.add("login");
                      if (type === "file" || /upload|fichier|piece|document/.test(text)) riskSet.add("upload");
                      if (/card|payment|paiement|stripe|checkout/.test(text)) riskSet.add("payment");
                    };

                    const bodyTextRaw = document.body ? document.body.innerText : "";
                    const bodyTextLower = bodyTextRaw.toLowerCase();
                    if (/captcha|recaptcha|hcaptcha/.test(bodyTextLower)) riskSet.add("captcha");
                    if (/rdv|rendez-vous|appointment|booking|reservation/.test(bodyTextLower)) riskSet.add("appointment");

                    const links = Array.from(document.querySelectorAll("a[href], [data-href], [data-url], [data-route]"))
                      .map((el) => el.getAttribute("href") || el.getAttribute("data-href") || el.getAttribute("data-url") || el.getAttribute("data-route"))
                      .filter(Boolean)
                      .map((href) => {
                        try { return new URL(href, location.href).href; } catch { return ""; }
                      })
                      .filter(Boolean);
                    const internalLinks = Array.from(new Set(links.filter(isAllowed))).slice(0, maxLinks || 30);
                    const externalLinks = Array.from(new Set(links.filter((href) => !isAllowed(href)))).slice(0, 20);

                    const forms = extractForms ? Array.from(document.querySelectorAll("form")).map((form, formIndex) => {
                      const fields = Array.from(form.querySelectorAll("input, textarea, select"))
                        .filter((field) => !["hidden", "submit", "button", "reset", "image"].includes(String(field.getAttribute("type") || "").toLowerCase()))
                        .map((field) => {
                          classifyFieldRisk(field);
                          return {
                            name: field.getAttribute("name") || field.id || field.tagName.toLowerCase(),
                            type: String(field.getAttribute("type") || field.tagName || "text").toLowerCase(),
                            label: labelFor(field),
                            selector: selectorFor(field),
                            placeholder: field.getAttribute("placeholder") || "",
                            required: field.hasAttribute("required") || field.getAttribute("aria-required") === "true",
                            visible: !!(field.offsetWidth || field.offsetHeight || field.getClientRects().length),
                            enabled: !field.disabled,
                          };
                        });
                      return {
                        selector: form.id ? `form#${esc(form.id)}` : `form:nth-of-type(${formIndex + 1})`,
                        action: form.getAttribute("action") || "",
                        method: String(form.getAttribute("method") || "get").toUpperCase(),
                        text: short(form.innerText, 320),
                        fields,
                        submit_selector: selectorFor(form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')),
                      };
                    }) : [];

                    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button'], a"))
                      .map((button) => ({
                        text: short(button.innerText || button.getAttribute("value") || button.getAttribute("aria-label") || "", 100),
                        selector: selectorFor(button),
                        href: button.getAttribute("href") || button.getAttribute("data-href") || "",
                        type: button.getAttribute("type") || button.getAttribute("role") || button.tagName.toLowerCase(),
                      }))
                      .filter((button) => button.text || button.href)
                      .slice(0, 80);
                    buttons.forEach((button) => {
                      const text = `${button.text} ${button.href}`.toLowerCase();
                      if (/login|connexion|compte/.test(text)) riskSet.add("login");
                      if (/rdv|rendez-vous|appointment|booking|reservation/.test(text)) riskSet.add("appointment");
                      if (/delete|supprimer|remove/.test(text)) riskSet.add("delete");
                    });

                    const bodyText = clean(bodyTextRaw);
                    const messageCandidates = bodyText
                      .split(/[\\n.?!]/)
                      .map((line) => short(line, 160))
                      .filter((line) => /merci|envoy|success|erreur|obligatoire|required|invalid|captcha|validation|rdv|rendez-vous/i.test(line))
                      .slice(0, 20);

                    return {
                      rendered_html: document.documentElement.outerHTML,
                      visible_text: short(bodyText, 12000),
                      title: document.title || "",
                      headings: Array.from(document.querySelectorAll("h1,h2,h3"))
                        .map((h) => ({ level: h.tagName.toLowerCase(), text: short(h.innerText, 180) }))
                        .slice(0, 80),
                      internal_links: internalLinks,
                      external_links: externalLinks,
                      forms,
                      buttons,
                      risk_flags: Array.from(riskSet),
                      candidate_messages: messageCandidates,
                    };
                }""",
                {
                    "allowedDomains": allowed_domains,
                    "maxLinks": max(1, min(max_links or 30, 200)),
                    "extractForms": extract_forms,
                },
            )

            payload = payload if isinstance(payload, dict) else {}
            forms = payload.get("forms") or []
            links = payload.get("internal_links") or []
            confidence = "high" if forms else ("medium" if links else "low")
            self._pages_served += 1
            self._success_count += 1
            return DiscoveryResult(
                status=PageStatus.SUCCESS,
                url=url,
                engine=engine,
                final_url=final_url,
                rendered_html=payload.get("rendered_html"),
                visible_text=payload.get("visible_text"),
                title=payload.get("title"),
                headings=payload.get("headings") or [],
                internal_links=links or [],
                external_links=payload.get("external_links") or [],
                forms=forms or [],
                buttons=payload.get("buttons") or [],
                risk_flags=payload.get("risk_flags") or [],
                candidate_messages=payload.get("candidate_messages") or [],
                detection_sources=["obscura_rendered" if engine == "obscura" else "chromium_rendered"],
                confidence=confidence,
            )
        except asyncio.TimeoutError:
            self._timeout_count += 1
            return DiscoveryResult(status=PageStatus.TIMEOUT, url=url, engine=engine, error=f"Navigation timeout after {wait_ms} ms")
        except Exception as exc:
            st = self._classify_error(exc)
            if st == PageStatus.TIMEOUT:
                self._timeout_count += 1
            return DiscoveryResult(status=st, url=url, engine=engine, error=str(exc))
        finally:
            await self._safe_close_page(page)
            await self._safe_close_context(context)
            self._active_sessions -= 1
            self._semaphore.release()

    async def screenshot(
        self,
        url:        str,
        width:      int  = 1280,
        height:     int  = 800,
        full_page:  bool = True,
        timeout_ms: int  = DEFAULT_TIMEOUT,
        wait_until: Optional[str] = DEFAULT_SCREENSHOT_WAIT_UNTIL,
    ) -> ScreenshotResult:
        """Capture a screenshot of *url* and return raw PNG bytes."""
        wait_until = _normalize_wait_until(wait_until, DEFAULT_SCREENSHOT_WAIT_UNTIL)
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
                context = await browser.new_context(
                    viewport={"width": width, "height": height},
                    ignore_https_errors=_BROWSER_POOL_IGNORE_HTTPS_ERRORS,
                )
                page    = await context.new_page()
                logger.info(
                    "screenshot navigation url=%s wait_until=%s timeout_ms=%d settle_ms=%d",
                    url,
                    wait_until,
                    timeout_ms,
                    BROWSER_POOL_SCREENSHOT_SETTLE_MS,
                )
                try:
                    await page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                except (asyncio.TimeoutError, PlaywrightTimeoutError):
                    self._timeout_count += 1
                    return ScreenshotResult(
                        status=PageStatus.TIMEOUT,
                        url=url,
                        wait_until=wait_until,
                        error=f"{wait_until}_timeout after {timeout_ms} ms",
                    )

                load_state_timeout_ignored = False
                if wait_until != "load" and BROWSER_POOL_SCREENSHOT_LOAD_STATE_TIMEOUT_MS > 0:
                    try:
                        await page.wait_for_load_state(
                            "load",
                            timeout=BROWSER_POOL_SCREENSHOT_LOAD_STATE_TIMEOUT_MS,
                        )
                    except (asyncio.TimeoutError, PlaywrightTimeoutError):
                        load_state_timeout_ignored = True
                        logger.info(
                            "screenshot load-state timeout ignored url=%s final_url=%s timeout_ms=%d",
                            url,
                            page.url,
                            BROWSER_POOL_SCREENSHOT_LOAD_STATE_TIMEOUT_MS,
                        )

                if BROWSER_POOL_SCREENSHOT_SETTLE_MS > 0:
                    await page.wait_for_timeout(BROWSER_POOL_SCREENSHOT_SETTLE_MS)

                logger.info(
                    "screenshot visual-ready url=%s final_url=%s wait_until=%s load_state_timeout_ignored=%s",
                    url,
                    page.url,
                    wait_until,
                    load_state_timeout_ignored,
                )

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
                    final_url=page.url,
                    wait_until=wait_until,
                    load_state_timeout_ignored=load_state_timeout_ignored,
                )
            except asyncio.TimeoutError:
                self._timeout_count += 1
                return ScreenshotResult(status=PageStatus.TIMEOUT, url=url,
                                        wait_until=wait_until,
                                        error=f"navigation_timeout after {timeout_ms} ms")
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
            "ignore_https_errors": _BROWSER_POOL_IGNORE_HTTPS_ERRORS,
        }
