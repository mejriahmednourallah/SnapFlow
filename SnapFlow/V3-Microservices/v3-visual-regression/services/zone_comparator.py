"""
SnapFlow V3 — Zone-Based Regression Scoring
Computes semantic zone regression with weighted aggregation.
5 zones (header, hero, content, footer, CTA) with configurable thresholds.
"""

import logging
import os
from typing import Optional, Tuple
import numpy as np
import cv2
from PIL import Image
from skimage.metrics import structural_similarity as ssim

logger = logging.getLogger("visual-regression.zone_comparator")

# A weighted delta of 0.10 maps to a score of 50.
REFERENCE_REGRESSION_DELTA = 0.10

# [#17] CTA inference minimum score — extracted to env-configurable constant.
# Default 1.15 was hardcoded; now tunable without code changes.
CTA_INFER_MIN_SCORE = float(os.getenv("CTA_INFER_MIN_SCORE", "1.15"))

# [V4] Pages shorter than this (px) produce meaningless zone crops — skip zone analysis.
MIN_PAGE_HEIGHT_FOR_ZONE_ANALYSIS = int(os.getenv("MIN_PAGE_HEIGHT_PX", "400"))

# Zone configuration with weights and thresholds
ZONE_CONFIG = {
    "header": {
        "y_start_pct": 0.0,
        "y_end_pct": 0.12,
        "weight": 0.30,
        "severity_threshold": 0.20,
    },
    "hero": {
        "y_start_pct": 0.12,
        "y_end_pct": 0.35,
        "weight": 0.25,
        "severity_threshold": 0.20,
    },
    "content": {
        "y_start_pct": 0.35,
        "y_end_pct": 0.80,
        "weight": 0.15,
        "severity_threshold": 0.30,
    },
    "footer": {
        "y_start_pct": 0.80,
        "y_end_pct": 1.0,
        "weight": 0.05,
        "severity_threshold": 0.40,
    },
    "cta": {
        "weight": 0.25,
        "severity_threshold": 0.10,
    },
}

# Validate weights sum to 1.0
ZONE_WEIGHTS = sum(ZONE_CONFIG[z].get("weight", 0) for z in ["header", "hero", "content", "footer", "cta"])
if abs(ZONE_WEIGHTS - 1.0) > 0.001:
    logger.warning(f"Zone weights do not sum to 1.0: {ZONE_WEIGHTS}")


def crop_zone(img: Image.Image, y_start_pct: float, y_end_pct: float) -> Image.Image:
    """
    Crop image to a zone defined by y-percentages.
    
    Args:
        img: PIL Image
        y_start_pct: Start y as percentage of image height (0.0-1.0)
        y_end_pct: End y as percentage of image height (0.0-1.0)
    
    Returns:
        PIL Image cropped to zone
    """
    w, h = img.size
    y_start = int(h * y_start_pct)
    y_end = int(h * y_end_pct)
    return img.crop((0, y_start, w, y_end))


def _adaptive_vertical_bounds(img: Image.Image) -> dict:
    """Compute adaptive vertical bands to reduce layout-driven false regressions.
    
    Returns a dict with zone name -> (y_start_pct, y_end_pct) pairs.
    Also includes 'short_page' key (bool) when height < MIN_PAGE_HEIGHT_FOR_ZONE_ANALYSIS.
    """
    h = img.height
    # [V4] Pages shorter than minimum threshold produce ~30px zones with no regression signal.
    if h < MIN_PAGE_HEIGHT_FOR_ZONE_ANALYSIS:
        return {"short_page": True}

    # Keep bounds conservative while adapting to viewport height.
    header_end = min(0.18, max(0.10, 110.0 / max(h, 1)))
    hero_end = min(0.46, max(0.30, 420.0 / max(h, 1)))
    footer_start = min(0.90, max(0.72, 1.0 - (170.0 / max(h, 1))))

    if hero_end <= header_end + 0.05:
        hero_end = min(0.5, header_end + 0.08)
    if footer_start <= hero_end + 0.2:
        footer_start = min(0.92, hero_end + 0.25)

    return {
        "short_page": False,
        "header": (0.0, header_end),
        "hero": (header_end, hero_end),
        "content": (hero_end, footer_start),
        "footer": (footer_start, 1.0),
    }


def _infer_cta_bbox(img: Image.Image, viewport_height: int = 768) -> Optional[dict]:
    """Infer a CTA-like region from saturation/luminance contrast for fallback scoring."""
    arr = np.array(img.convert("RGB"))
    h, w = arr.shape[0], arr.shape[1]
    fold_h = min(max(220, viewport_height), h)
    fold = arr[:fold_h]

    hsv = cv2.cvtColor(fold, cv2.COLOR_RGB2HSV)
    sat = hsv[:, :, 1].astype(np.float32)
    gray = cv2.cvtColor(fold, cv2.COLOR_RGB2GRAY).astype(np.float32)
    global_sat = float(sat.mean()) + 1e-6
    global_lum = float(gray.mean()) + 1e-6

    best = None
    for kh, kw in [(36, 120), (50, 180), (70, 260)]:
        if fold.shape[0] <= kh or fold.shape[1] <= kw:
            continue
        y_step = max(6, kh // 5)
        x_step = max(6, kw // 5)
        for y in range(0, fold.shape[0] - kh, y_step):
            for x in range(0, fold.shape[1] - kw, x_step):
                sat_region = sat[y:y + kh, x:x + kw]
                lum_region = gray[y:y + kh, x:x + kw]
                sat_ratio = float(sat_region.mean()) / global_sat
                lum_contrast = abs(float(lum_region.mean()) - global_lum) / global_lum
                score = sat_ratio + 0.5 * lum_contrast
                if best is None or score > best["score"]:
                    best = {"score": score, "x": x, "y": y, "w": kw, "h": kh}

    if best is None:
        return None
    # [#17] Use env-configurable threshold constant instead of magic 1.15.
    if best["score"] < CTA_INFER_MIN_SCORE:
        return None
    return {"x": int(best["x"]), "y": int(best["y"]), "w": int(best["w"]), "h": int(best["h"]), "inferred": True}


def compute_zone_ssim(
    img_baseline: Image.Image,
    img_current: Image.Image,
    zone_config: dict,
) -> Tuple[float, np.ndarray]:
    """
    Compute SSIM for a specific zone.
    
    Args:
        img_baseline: Baseline PIL Image
        img_current: Current PIL Image
        zone_config: Zone configuration dict with y_start_pct, y_end_pct
    
    Returns:
        Tuple of (ssim_score, diff_map) where ssim_score is 0.0-1.0
    """
    # V1: Crop images at the same explicit pixel bounds to avoid layout misalignment
    # when pages differ in height. Use the shorter image as the reference height.
    h = min(img_baseline.height, img_current.height)
    pixel_y_start = int(h * zone_config["y_start_pct"])
    pixel_y_end = int(h * zone_config["y_end_pct"])
    
    baseline_zone = img_baseline.crop((0, pixel_y_start, img_baseline.width, pixel_y_end))
    current_zone = img_current.crop((0, pixel_y_start, img_current.width, pixel_y_end))

    # Ensure same size (crop width to minimum to avoid resizing distortion)
    if baseline_zone.size != current_zone.size:
        w_min = min(baseline_zone.width, current_zone.width)
        h_min = min(baseline_zone.height, current_zone.height)
        baseline_zone = baseline_zone.crop((0, 0, w_min, h_min))
        current_zone = current_zone.crop((0, 0, w_min, h_min))

    baseline_arr = np.array(baseline_zone.convert("RGB")).astype(float) / 255.0
    current_arr = np.array(current_zone.convert("RGB")).astype(float) / 255.0

    # Compute SSIM with multichannel=True for RGB
    ssim_score, diff_map = ssim(
        baseline_arr,
        current_arr,
        channel_axis=2,
        full=True,
        data_range=1.0,
    )
    ssim_score = float(max(0.0, min(1.0, ssim_score)))
    return ssim_score, diff_map


def _clamp_bbox(bbox: dict, width: int, height: int) -> Optional[Tuple[int, int, int, int]]:
    try:
        x = int(bbox.get("x", 0))
        y = int(bbox.get("y", 0))
        w = int(bbox.get("w", 0))
        h = int(bbox.get("h", 0))
    except Exception:
        return None

    if w <= 0 or h <= 0:
        return None

    x1 = max(0, min(x, width - 1))
    y1 = max(0, min(y, height - 1))
    x2 = max(x1 + 1, min(x + w, width))
    y2 = max(y1 + 1, min(y + h, height))
    return x1, y1, x2, y2


def _compute_bbox_ssim(
    img_baseline: Image.Image,
    img_current: Image.Image,
    baseline_bbox: dict,
    new_bbox: dict,
) -> Optional[float]:
    bb1 = _clamp_bbox(baseline_bbox, img_baseline.width, img_baseline.height)
    bb2 = _clamp_bbox(new_bbox, img_current.width, img_current.height)
    if bb1 is None or bb2 is None:
        return None

    base_crop = img_baseline.crop(bb1)
    new_crop = img_current.crop(bb2)
    if base_crop.size[0] <= 1 or base_crop.size[1] <= 1:
        return None
    if new_crop.size[0] <= 1 or new_crop.size[1] <= 1:
        return None

    if base_crop.size != new_crop.size:
        new_crop = new_crop.resize(base_crop.size, Image.Resampling.LANCZOS)

    base_arr = np.array(base_crop.convert("RGB")).astype(float) / 255.0
    new_arr = np.array(new_crop.convert("RGB")).astype(float) / 255.0
    score, _ = ssim(base_arr, new_arr, channel_axis=2, full=True, data_range=1.0)
    return float(max(0.0, min(1.0, score)))


def compute_zone_regression(
    img_baseline: Image.Image,
    img_current: Image.Image,
    masks: Optional[dict] = None,
    cta_bbox: Optional[dict] = None,
    baseline_cta_bbox: Optional[dict] = None,
    new_cta_bbox: Optional[dict] = None,
) -> dict:
    """
    Compute zone-based regression scoring.
    
    Args:
        img_baseline: Baseline PIL Image
        img_current: Current PIL Image
        masks: Optional dict of zone masks {zone_name: PIL Image mask}
        cta_bbox: Optional CTA bounding box {x, y, w, h}
    
    Returns:
        dict with zones (per-zone metrics), weighted_regression_score (0-100),
        severity (critical/high/medium/low), passing (bool), critical_zones (list)
    """
    zones = {}
    weighted_deltas = []
    adaptive_bounds = _adaptive_vertical_bounds(img_current)

    # [V4] Short pages produce meaningless zone crops — return non_evalue instead of a misleading score.
    if adaptive_bounds.get("short_page"):
        logger.info(
            f"Zone regression skipped: image height {img_current.height}px "
            f"< MIN_PAGE_HEIGHT_FOR_ZONE_ANALYSIS ({MIN_PAGE_HEIGHT_FOR_ZONE_ANALYSIS}px)"
        )
        return {
            "zones": {},
            "weighted_regression_score": None,
            "severity": "non_evalue",
            "passing": None,
            "critical_zones": [],
            "status": "non_evalue",
            "reason": "page_too_short_for_zone_analysis",
        }

    # Iterate through standard zones
    for zone_name, zone_cfg in list(ZONE_CONFIG.items())[:-1]:  # Exclude 'cta' from loop
        if zone_name in adaptive_bounds:
            y_start, y_end = adaptive_bounds[zone_name]
            dynamic_cfg = {**zone_cfg, "y_start_pct": y_start, "y_end_pct": y_end}
        else:
            dynamic_cfg = zone_cfg

        ssim_score, _ = compute_zone_ssim(img_baseline, img_current, dynamic_cfg)
        delta = float(1.0 - ssim_score)
        weighted_delta = delta * zone_cfg["weight"]
        weighted_deltas.append(weighted_delta)

        is_regressed = delta > zone_cfg["severity_threshold"]

        zones[zone_name] = {
            "ssim_score": round(ssim_score, 4),
            "ssim_delta": round(delta, 4),
            "regression": is_regressed,
            "weight": zone_cfg["weight"],
        }

        logger.debug(
            f"Zone {zone_name}: SSIM={ssim_score:.4f}, delta={delta:.4f}, "
            f"regressed={is_regressed}, weight={zone_cfg['weight']}"
        )

    # Backward compatibility: a single cta_bbox means same ROI on both screenshots.
    if baseline_cta_bbox is None and new_cta_bbox is None and cta_bbox is not None:
        baseline_cta_bbox = cta_bbox
        new_cta_bbox = cta_bbox

    # Fallback CTA estimation to avoid dropping CTA influence when bbox is missing.
    if baseline_cta_bbox is None and new_cta_bbox is None:
        inferred_baseline = _infer_cta_bbox(img_baseline)
        inferred_new = _infer_cta_bbox(img_current)
        if inferred_baseline is not None and inferred_new is not None:
            baseline_cta_bbox = inferred_baseline
            new_cta_bbox = inferred_new

    # CTA zone (optional)
    if baseline_cta_bbox is not None and new_cta_bbox is not None:
        cta_weight = ZONE_CONFIG["cta"]["weight"]
        cta_threshold = ZONE_CONFIG["cta"]["severity_threshold"]
        cta_ssim = _compute_bbox_ssim(img_baseline, img_current, baseline_cta_bbox, new_cta_bbox)
        # [#18] When _compute_bbox_ssim returns None (crop too small or invalid),
        # treat it as a data-quality gap and skip the CTA zone entirely.
        # Previously: cta_ssim = 0.0 → false critical regression every time a bbox was bad.
        if cta_ssim is None:
            logger.warning("CTA SSIM computation returned None — CTA zone skipped (weight=0).")
            zones["cta"] = {
                "ssim_score": None,
                "ssim_delta": None,
                "regression": False,
                "weight": 0.0,
                "note": "cta_ssim_computation_failed_skipped",
            }
        else:
            cta_delta = float(1.0 - cta_ssim)
            weighted_deltas.append(cta_delta * cta_weight)

            zones["cta"] = {
                "ssim_score": round(cta_ssim, 4),
                "ssim_delta": round(cta_delta, 4),
                "regression": cta_delta > cta_threshold,
                "weight": cta_weight,
                "inferred": bool(baseline_cta_bbox.get("inferred") or new_cta_bbox.get("inferred")),
            }
            logger.debug(f"Zone cta: SSIM={cta_ssim:.4f}, delta={cta_delta:.4f}, weight={cta_weight}")

    elif baseline_cta_bbox is None and new_cta_bbox is not None:
        cta_weight = ZONE_CONFIG["cta"]["weight"]
        weighted_deltas.append(1.0 * cta_weight)
        zones["cta"] = {
            "ssim_score": 0.0,
            "ssim_delta": 1.0,
            "regression": True,
            "weight": cta_weight,
            "note": "cta_appeared_since_baseline",
        }
    elif baseline_cta_bbox is not None and new_cta_bbox is None:
        cta_weight = ZONE_CONFIG["cta"]["weight"]
        weighted_deltas.append(1.0 * cta_weight)
        zones["cta"] = {
            "ssim_score": 0.0,
            "ssim_delta": 1.0,
            "regression": True,
            "weight": cta_weight,
            "note": "cta_removed_since_baseline",
        }
    else:
        zones["cta"] = {
            "ssim_score": 1.0,
            "ssim_delta": 0.0,
            "regression": False,
            "weight": 0.0,  # No CTA = no weight
        }

    # Weighted regression score anchored by REFERENCE_REGRESSION_DELTA.
    total_weighted_delta = sum(weighted_deltas)
    if REFERENCE_REGRESSION_DELTA <= 0:
        weighted_regression_score = int(min(total_weighted_delta * 200, 100))
    else:
        weighted_regression_score = int(min((total_weighted_delta / REFERENCE_REGRESSION_DELTA) * 50, 100))

    # Determine severity
    critical_zones = []
    for zone_name in ["header", "hero", "cta"]:
        if zone_name in zones and zones[zone_name].get("regression"):
            critical_zones.append(zone_name)

    if critical_zones:
        severity = "critical"
    elif weighted_regression_score > 30:
        severity = "high"
    elif weighted_regression_score > 15:
        severity = "medium"
    else:
        severity = "low"

    passing = weighted_regression_score <= 15 and len(critical_zones) == 0

    logger.info(
        f"Zone regression: score={weighted_regression_score}, severity={severity}, "
        f"passing={passing}, critical_zones={critical_zones}"
    )

    return {
        "zones": zones,
        "weighted_regression_score": weighted_regression_score,
        "severity": severity,
        "passing": passing,
        "critical_zones": critical_zones,
    }
