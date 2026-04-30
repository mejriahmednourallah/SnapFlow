"""
v3-browser-pool — shared browser rendering microservice.

Endpoints
---------
GET  /health               Pool liveness and metrics.
POST /render               Render a page and return HTML + metadata.
POST /screenshot           Capture a single-page screenshot (PNG, base64).
POST /batch-screenshot     Capture screenshots for a list of URLs in parallel.
"""

import asyncio
import base64
import logging
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from pool import BrowserPool, PageStatus

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browser-pool")

_pool = BrowserPool()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _pool.start()
    logger.info("Browser pool ready")
    yield
    await _pool.stop()
    logger.info("Browser pool stopped")


app = FastAPI(title="v3-browser-pool", version="1.0.0", lifespan=lifespan)


# ── Request models ─────────────────────────────────────────────────────────────

class RenderRequest(BaseModel):
    url:        str
    timeout_ms: Optional[int] = 30000
    # "load" | "domcontentloaded" | "networkidle" | "commit"
    wait_until: Optional[str] = "networkidle"


class ScreenshotRequest(BaseModel):
    url:        str
    width:      Optional[int]  = 1280
    height:     Optional[int]  = 800
    full_page:  Optional[bool] = True
    timeout_ms: Optional[int]  = 30000


class BatchScreenshotRequest(BaseModel):
    urls:       List[str]
    width:      Optional[int]  = 1280
    height:     Optional[int]  = 800
    full_page:  Optional[bool] = True
    timeout_ms: Optional[int]  = 30000
    max_pages:  Optional[int]  = 10


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return _pool.health()


@app.post("/render")
async def render(req: RenderRequest):
    result = await _pool.render(
        req.url,
        timeout_ms=req.timeout_ms,
        wait_until=req.wait_until or "networkidle",
    )
    return {
        "status":        result.status,
        "url":           result.url,
        "rendered_html": result.rendered_html,
        "title":         result.title,
        "page_height":   result.page_height,
        "page_width":    result.page_width,
        "final_url":     result.final_url,
        "fcp_ms":        result.fcp_ms,
        "lcp_ms":        result.lcp_ms,
        "cls":           result.cls,
        "dom_nodes":     result.dom_nodes,
        "http_requests": result.http_requests,
        "transfer_size_kb": result.transfer_size_kb,
        "asset_breakdown": result.asset_breakdown,
        "desktop_overflow": result.desktop_overflow,
        "tablet_overflow":  result.tablet_overflow,
        "mobile_overflow":  result.mobile_overflow,
        "invisible_links":  result.invisible_links,
        "console_errors": result.console_errors,
        "console_error_count": result.console_error_count,
        "error":         result.error,
    }


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest):
    result = await _pool.screenshot(
        req.url,
        width=req.width or 1280,
        height=req.height or 800,
        full_page=req.full_page if req.full_page is not None else True,
        timeout_ms=req.timeout_ms or 30000,
    )
    image_b64 = (
        base64.b64encode(result.image_bytes).decode("utf-8")
        if result.image_bytes
        else None
    )
    return {
        "status":        result.status,
        "url":           result.url,
        "image_b64":     image_b64,
        "width":         result.width,
        "height":        result.height,
        "coverage_mode": result.coverage_mode,
        "error":         result.error,
    }


@app.post("/batch-screenshot")
async def batch_screenshot(req: BatchScreenshotRequest):
    urls  = (req.urls or [])[:max(1, req.max_pages or 10)]
    tasks = [
        _pool.screenshot(
            url,
            width=req.width or 1280,
            height=req.height or 800,
            full_page=req.full_page if req.full_page is not None else True,
            timeout_ms=req.timeout_ms or 30000,
        )
        for url in urls
    ]
    results = await asyncio.gather(*tasks)
    pages   = []
    for r in results:
        image_b64 = (
            base64.b64encode(r.image_bytes).decode("utf-8") if r.image_bytes else None
        )
        pages.append(
            {
                "status":        r.status,
                "url":           r.url,
                "image_b64":     image_b64,
                "width":         r.width,
                "height":        r.height,
                "coverage_mode": r.coverage_mode,
                "error":         r.error,
            }
        )
    return {"pages": pages, "total": len(pages)}
