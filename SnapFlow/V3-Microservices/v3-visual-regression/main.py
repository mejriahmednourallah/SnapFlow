import logging
import io
import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image

from comparator import (
    init_db,
    capture_screenshot,
    capture_screenshots_batch,
    save_screenshot,
    load_screenshot,
    compute_diff,
    is_visual_regression_enabled,
    chrome_no_sandbox_enabled,
)
from services.image_comparator import compare_images_ssim
from services.zone_comparator import compute_zone_regression
from services.ux_kpis import (
    compute_visual_complexity,
    compute_cta_prominence,
    compute_first_impression_score,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("visual-regression")

REGRESSION_THRESHOLD = 5.0  # percentage of changed pixels that signals a regression
FUSED_REGRESSION_THRESHOLD = 0.22
VISUAL_SCREENSHOT_MAX_CONCURRENCY = max(1, int(os.getenv("VISUAL_SCREENSHOT_MAX_CONCURRENCY", "10")))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("visual_screenshots table ready")
    logger.info("VISUAL_REGRESSION_ENABLED=%s", is_visual_regression_enabled())
    logger.info("CHROME_NO_SANDBOX=%s", chrome_no_sandbox_enabled())
    logger.info("VISUAL_SCREENSHOT_MAX_CONCURRENCY=%s", VISUAL_SCREENSHOT_MAX_CONCURRENCY)
    yield


app = FastAPI(
    title="v3-visual-regression",
    version="1.0.0",
    lifespan=lifespan,
)


# ─── Request / Response models ────────────────────────────────────────────────

class ScreenshotRequest(BaseModel):
    scan_id: str
    urls: list[str]
    max_pages: Optional[int] = 10
    full_page: Optional[bool] = True


class CompareRequest(BaseModel):
    scan_id_baseline: str
    scan_id_new: str
    urls: list[str]
    cta_bbox: Optional[dict] = None  # Optional: {"x": int, "y": int, "w": int, "h": int, "fg_color": (r,g,b), "bg_color": (r,g,b)}
    viewport_height: Optional[int] = 768  # For UX KPI computation


class UXKPIsRequest(BaseModel):
    url: str
    cta_bbox: Optional[dict] = None
    viewport_height: Optional[int] = 768


class BrowserCompatRequest(BaseModel):
    url: str
    threshold_pct: Optional[float] = 5.0


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "healthy", "service": "v3-visual-regression"}


@app.post("/screenshot")
async def screenshot(req: ScreenshotRequest):
    """Capture screenshots for up to *max_pages* URLs and persist them.

    When *full_page* is True (default) the full scroll-height is captured so
    that below-the-fold regressions are not missed.  Pages taller than
    15 000 px are automatically captured as three stitched viewport segments
    (``coverage_mode="segmented"``).
    """
    urls = req.urls[: req.max_pages]  # enforce cap
    full_page: bool = req.full_page if req.full_page is not None else True
    results = []

    batch_results = await capture_screenshots_batch(
        urls,
        max_concurrency=VISUAL_SCREENSHOT_MAX_CONCURRENCY,
        full_page=full_page,
    )
    for item in batch_results:
        if item.get("status") == "ok":
            save_screenshot(req.scan_id, item["url"], item["screenshot"])
            coverage_mode = item.get("coverage_mode", "full_page" if full_page else "viewport_only")
            results.append({"url": item["url"], "status": "ok", "coverage_mode": coverage_mode})
            logger.info(
                "Captured %s for scan %s (coverage_mode=%s)",
                item["url"], req.scan_id, coverage_mode,
            )
        else:
            logger.warning("Screenshot failed for %s: %s", item["url"], item.get("error"))
            results.append({"url": item["url"], "status": "failed", "error": item.get("error", "unknown")})

    return {
        "scan_id": req.scan_id,
        "captured": sum(1 for r in results if r["status"] == "ok"),
        "full_page": full_page,
        "pages": results,
    }


@app.post("/compare")
async def compare(req: CompareRequest):  # [V-3] was sync def — made async to not block event loop
    """SSIM + Zone-based visual regression scoring with backward compatibility."""
    if not is_visual_regression_enabled():
        raise HTTPException(
            status_code=503,
            detail="Visual regression is disabled in this environment",
        )

    page_results = []
    has_regression = False

    for url in req.urls:
        try:
            img_a_bytes = load_screenshot(req.scan_id_baseline, url)
            img_b_bytes = load_screenshot(req.scan_id_new, url)

            if img_a_bytes is None and img_b_bytes is None:
                page_results.append({
                    "url": url,
                    "status": "non_evalue",
                    "raison_non_evalue": "captures_manquantes",
                    "diff_pct": None,
                    "overall_regression": None,
                })
            elif img_a_bytes is None:
                # [V-1] Baseline screenshot missing = new page, not a visual regression.
                page_results.append({
                    "url": url,
                    "status": "new_page",
                    "diff_pct": None,
                    "overall_regression": False,  # structural change, not a visual regression
                    "note": "Page was not present in the baseline scan",
                })
            elif img_b_bytes is None:
                # [V-2] New-scan screenshot missing = deleted/unreachable page, not a visual regression.
                page_results.append({
                    "url": url,
                    "status": "deleted_page",
                    "diff_pct": None,
                    "overall_regression": False,  # structural change, not a visual regression
                    "note": "Page was present in the baseline but was not crawled in the new scan",
                })
            else:
                img_a = Image.open(io.BytesIO(img_a_bytes)).convert("RGB")
                img_b = Image.open(io.BytesIO(img_b_bytes)).convert("RGB")

                width_a, height_a = img_a.size
                width_b, height_b = img_b.size

                # Infer coverage_mode from image height (heuristic).
                max_height = max(height_a, height_b)
                if max_height > 15000:
                    inferred_coverage_mode = "segmented"
                elif max_height > 900:
                    inferred_coverage_mode = "full_page"
                else:
                    inferred_coverage_mode = "viewport_only"

                # Flag size differences as layout findings before anything else.
                layout_size_change = img_a.size != img_b.size
                size_delta = {"width": width_b - width_a, "height": height_b - height_a}
                height_change_ratio = abs(height_b - height_a) / height_a if height_a > 0 else 0.0
                if height_change_ratio > 0.15:
                    structural_score = "high_change"
                elif height_change_ratio > 0.10:
                    structural_score = "moderate_change"
                else:
                    structural_score = "no_change"

                # BL-16: Reject comparisons where viewport width shifted (e.g. mobile vs desktop trace mixup)
                if abs(width_a - width_b) > 5:
                    page_results.append({
                        "url": url,
                        "status": "non_evalue",
                        "raison_non_evalue": "viewport_mismatch",
                        "diff_pct": None,
                        "overall_regression": None,
                        "note": f"Viewport width mismatch: {width_a}px vs {width_b}px",
                    })
                    continue

                # New SSIM + Zone-based comparison
                ssim_result = compare_images_ssim(img_a, img_b)
                zone_result = compute_zone_regression(img_a, img_b, cta_bbox=req.cta_bbox)

                # BL-17: Intentional Seasonal Hero updates (hero/header vary heavily, bulk content unchanged)
                zones = zone_result.get("zones", {})
                header_ssim = zones.get("header", {}).get("ssim_score")
                hero_ssim = zones.get("hero", {}).get("ssim_score")
                content_ssim = zones.get("content", {}).get("ssim_score")
                footer_ssim = zones.get("footer", {}).get("ssim_score")

                # If header/hero regressed significantly but content/footer barely moved
                if (
                    zone_result.get("severity") == "critical"
                    and isinstance(header_ssim, (int, float))
                    and isinstance(hero_ssim, (int, float))
                    and isinstance(content_ssim, (int, float))
                    and isinstance(footer_ssim, (int, float))
                    and min(header_ssim, hero_ssim) < 0.88
                    and min(content_ssim, footer_ssim) > 0.96
                ):
                    zone_result["severity"] = "info"  # Downgrade from critical
                    zone_result["critical_zones"] = [
                        z for z in zone_result.get("critical_zones", []) if z not in ["header", "hero"]
                    ]
                    
                ssim_delta = 1.0 - ssim_result["ssim_score"]
                weighted_zone_score = zone_result.get("weighted_regression_score")
                zone_norm = (float(weighted_zone_score) / 100.0) if isinstance(weighted_zone_score, (int, float)) else 0.0
                phash_norm = min(ssim_result["phash_distance"] / 20.0, 1.0)
                lpips_norm = min((ssim_result.get("lpips_distance") or 0.0), 1.0)

                # Calibrated fusion to reduce hard bucket false positives.
                fused_score = (
                    zone_norm * 0.45
                    + ssim_delta * 0.25
                    + phash_norm * 0.20
                    + lpips_norm * 0.10
                )

                # [V-4] Zone "critical" severity alone is not sufficient —
                # require fused_score >= a minimum threshold as an additional
                # guard to prevent runaway zone scorer false positives.
                CRITICAL_ZONE_FUSED_FLOOR = 0.10
                if zone_result["severity"] == "critical" and fused_score >= CRITICAL_ZONE_FUSED_FLOOR:
                    status = "regression"
                    has_regression = True
                elif fused_score >= FUSED_REGRESSION_THRESHOLD:
                    status = "regression"
                    has_regression = True
                else:
                    status = "ok"

                page_results.append({
                    "url": url,
                    # Legacy fields for backward compatibility
                    "status": status,
                    "diff_pct": ssim_result["diff_pct"],
                    "overall_regression": status == "regression",
                    # New SSIM metrics
                    "ssim_score": ssim_result["ssim_score"],
                    "ssim_delta": ssim_delta,
                    "phash_distance": ssim_result["phash_distance"],
                    "lpips_distance": ssim_result.get("lpips_distance"),
                    "lpips_enabled": bool(ssim_result.get("lpips_enabled", ssim_result.get("lpips_available", False))),
                    "regression_confidence": ssim_result["regression_confidence"],
                    "fused_regression_score": round(fused_score, 4),
                    "fused_threshold": FUSED_REGRESSION_THRESHOLD,
                    # New zone-based metrics
                    "zone_scores": {z: zones.get(z, {}) for z in ["header", "hero", "content", "footer", "cta"]},
                    "weighted_regression_score": weighted_zone_score,
                    "zone_severity": zone_result.get("severity"),
                    "critical_zones": zone_result.get("critical_zones", []),
                    # Structural / size-change findings (Issue 1).
                    "layout_size_change": layout_size_change,
                    "size_delta": size_delta,
                    "structural_score": structural_score,
                    # Coverage metadata (Issue 2).
                    "coverage_mode": inferred_coverage_mode,
                })
                logger.info(
                    "Compare %s: SSIM=%.4f, zone_score=%s, fused=%.4f, severity=%s, status=%s",
                    url,
                    ssim_result["ssim_score"],
                    str(weighted_zone_score),
                    fused_score,
                    zone_result.get("severity"),
                    status,
                )

        except Exception as exc:
            logger.error("Compare failed for %s: %s", url, exc)
            page_results.append({
                "url": url,
                "status": "non_evalue",
                "raison_non_evalue": "erreur_comparaison",
                "error": str(exc),
                "diff_pct": None,
                "overall_regression": None,
            })

    evaluated = [p for p in page_results if p.get("overall_regression") is not None]
    non_evaluated_count = len(page_results) - len(evaluated)
    overall = has_regression if evaluated else None

    return {
        "scan_id_baseline": req.scan_id_baseline,
        "scan_id_new": req.scan_id_new,
        "overall_regression": overall,
        "non_evalues_count": non_evaluated_count,
        "regression_threshold_pct": REGRESSION_THRESHOLD,
        "pages": page_results,
    }


@app.post("/ux-kpis")
async def ux_kpis(req: UXKPIsRequest):
    """
    Compute standalone UX KPIs for a given URL.
    Returns: visual_complexity, cta_prominence, first_impression_score
    """
    if not is_visual_regression_enabled():
        raise HTTPException(
            status_code=503,
            detail="Visual regression is disabled in this environment",
        )

    try:
        img_bytes = await capture_screenshot(req.url)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB") if isinstance(img_bytes, bytes) else img_bytes

        # Compute all UX KPIs
        visual_complexity = compute_visual_complexity(img)
        cta_prominence = compute_cta_prominence(img, cta_bbox=req.cta_bbox, viewport_height=req.viewport_height)
        first_impression = compute_first_impression_score(img, cta_bbox=req.cta_bbox, viewport_height=req.viewport_height)

        logger.info(
            "UX KPIs for %s: complexity=%d, cta=%d, impression=%d",
            req.url,
            visual_complexity["visual_complexity_score"],
            cta_prominence["cta_prominence_score"],
            first_impression["first_impression_score"],
        )

        return {
            "url": req.url,
            "status": "evaluated",
            "visual_complexity": visual_complexity,
            "cta_prominence": cta_prominence,
            "first_impression_score": first_impression,
        }

    except Exception as exc:
        logger.error("UX KPI computation failed for %s: %s", req.url, exc)
        raise HTTPException(
            status_code=500,
            detail=f"UX KPI computation failed: {str(exc)}",
        )


@app.post("/browser-compat")
async def browser_compat(req: BrowserCompatRequest):
    """Capture same URL with Chromium and WebKit and return pixel-diff compatibility."""
    if not is_visual_regression_enabled():
        raise HTTPException(
            status_code=503,
            detail="Visual regression is disabled in this environment",
        )

    threshold = req.threshold_pct if req.threshold_pct is not None else REGRESSION_THRESHOLD
    try:
        img_chromium = await capture_screenshot(req.url, browser_engine="chromium")
    except Exception as exc:
        return {
            "url": req.url,
            "status": "not_available",
            "reason": f"chromium_capture_failed: {exc}",
        }

    try:
        img_webkit = await capture_screenshot(req.url, browser_engine="webkit")
    except Exception as exc:
        return {
            "url": req.url,
            "status": "not_available",
            "reason": f"webkit_capture_failed: {exc}",
        }

    diff_result = compute_diff(img_chromium, img_webkit, coverage_mode="viewport_only")
    diff_pct = diff_result["diff_pct"]
    passed = diff_pct <= threshold
    browser_matrix = [
        {
            "browser": "chromium",
            "device": "desktop",
            "url": req.url,
            "status": "captured",
            "issue": "",
            "diff_pct": diff_pct,
        },
        {
            "browser": "webkit",
            "device": "desktop",
            "url": req.url,
            "status": "captured",
            "issue": "" if passed else "diff_above_threshold",
            "diff_pct": diff_pct,
        },
    ]
    return {
        "url": req.url,
        "status": "evaluated",
        "diff_pct": diff_pct,
        "threshold_pct": threshold,
        "passed": passed,
        "engines": ["chromium", "webkit"],
        "browser_matrix": browser_matrix,
        "rows": browser_matrix,
        # Structural / coverage metadata from the enhanced comparator.
        "layout_size_change": diff_result["layout_size_change"],
        "size_delta": diff_result["size_delta"],
        "structural_score": diff_result["structural_score"],
        "band_diff_pct": diff_result["band_diff_pct"],
        "coverage_mode": diff_result["coverage_mode"],
    }
