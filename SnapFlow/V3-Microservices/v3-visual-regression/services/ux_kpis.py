"""
SnapFlow V3 — Standalone UX KPI Extractors
Computes: Visual Complexity, CTA Prominence, First Impression Score.
No baseline required — each metric is self-contained.
"""

import cv2
import numpy as np
from PIL import Image
from typing import Optional
import logging

logger = logging.getLogger("visual-regression.ux_kpis")


# ─────────────────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ─────────────────────────────────────────────────────────────────────────────

def pil_to_cv2_rgb(img: Image.Image) -> np.ndarray:
    """Convert PIL Image to OpenCV (BGR) format."""
    return cv2.cvtColor(np.array(img.convert("RGB")), cv2.COLOR_RGB2BGR)


def pil_to_gray(img: Image.Image) -> np.ndarray:
    """Convert PIL Image to grayscale numpy array."""
    return np.array(img.convert("L"))


# ─────────────────────────────────────────────────────────────────────────────
# KPI 1: VISUAL COMPLEXITY SCORE
# ─────────────────────────────────────────────────────────────────────────────

def compute_visual_complexity(img: Image.Image) -> dict:
    """
    Measures cognitive load via Canny edge density.
    edge_density = edge_pixels / total_pixels
    Score 0–100 (higher = more complex).
    Thresholds: < 0.12 = simple, 0.12–0.22 = moderate, > 0.22 = complex
    
    Args:
        img: PIL Image
    
    Returns:
        dict with visual_complexity_score (0-100), edge_density, complexity_label, passed, status
    """
    gray = pil_to_gray(img)
    
    # Resize to standard width to normalize across different viewport captures
    target_w = 1440
    scale = target_w / gray.shape[1]
    resized = cv2.resize(gray, (target_w, int(gray.shape[0] * scale)))

    # Apply Gaussian blur to remove JPEG noise before edge detection
    blurred = cv2.GaussianBlur(resized, (5, 5), 0)
    edges = cv2.Canny(blurred, threshold1=50, threshold2=150)

    total_pixels = edges.shape[0] * edges.shape[1]
    edge_pixels = int(np.sum(edges > 0))
    edge_density = edge_pixels / total_pixels

    # Map to 0–100 score (density 0.30+ = 100)
    score = int(min(edge_density / 0.30, 1.0) * 100)

    if edge_density < 0.12:
        label = "simple"
    elif edge_density < 0.22:
        label = "modéré"
    else:
        label = "complexe"

    passed = score <= 55
    status = "passing" if score <= 40 else ("warning" if score <= 55 else "failing")

    logger.debug(f"Visual complexity: score={score}, density={edge_density:.4f}, label={label}")

    return {
        "visual_complexity_score": score,
        "edge_density": round(edge_density, 4),
        "complexity_label": label,
        "passed": passed,
        "status": status,
    }


# ─────────────────────────────────────────────────────────────────────────────
# KPI 2: ABOVE-FOLD DENSITY SCORE
# ─────────────────────────────────────────────────────────────────────────────

def compute_above_fold_density(
    img: Image.Image,
    fold_height_px: int = 768
) -> float:
    """
    Measures content density in the first viewport (above the fold).
    Returns float 0–1 where 1 = ideal above-fold content density.
    """
    # Crop to fold height
    w, h = img.size
    fold_crop = img.crop((0, 0, w, min(fold_height_px, h)))
    complexity = compute_visual_complexity(fold_crop)
    # For above-fold, moderate complexity is optimal (edge_density ~0.18)
    raw = complexity["edge_density"]
    # Score peaks at edge_density ~0.18 (rich but not cluttered)
    # Maps to 0.12–0.24 range as optimal (< 30% penalty on edges)
    score = 1.0 - abs(raw - 0.18) / 0.18
    return round(max(0.0, min(1.0, score)), 4)


# ─────────────────────────────────────────────────────────────────────────────
# KPI 3: CTA PROMINENCE SCORE
# ─────────────────────────────────────────────────────────────────────────────

def compute_wcag_contrast_ratio(color_a: tuple, color_b: tuple) -> float:
    """
    Compute WCAG 2.1 contrast ratio between two RGB tuples.
    Returns ratio (1–21). AA minimum = 4.5 for normal text, 3.0 for large.
    """
    def relative_luminance(rgb):
        normalized = [c / 255.0 for c in rgb]
        linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in normalized]
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]

    l1 = relative_luminance(color_a)
    l2 = relative_luminance(color_b)
    lighter = max(l1, l2)
    darker  = min(l1, l2)
    return round((lighter + 0.05) / (darker + 0.05), 2)


def compute_cta_prominence(
    img: Image.Image,
    cta_bbox: Optional[dict] = None,
    viewport_height: int = 768
) -> dict:
    """
    Score CTA visibility: above-fold position, contrast, and relative visual weight.
    
    cta_bbox = {
        "x": int, "y": int, "w": int, "h": int,
        "bg_color": (r,g,b), "fg_color": (r,g,b)
    }
    
    Returns:
        dict with cta_prominence_score (0-100), above_fold, contrast, saliency, passed, status
    """
    w, h = img.size
    arr = np.array(img.convert("RGB"))

    if cta_bbox is None:
        # Naive CTA detection: multi-scale search using saturation + luminance contrast.
        try:
            fold_arr = arr[:viewport_height] if viewport_height < h else arr
            hsv = cv2.cvtColor(fold_arr, cv2.COLOR_RGB2HSV)
            sat_map = hsv[:, :, 1].astype(float)
            gray_map = cv2.cvtColor(fold_arr, cv2.COLOR_RGB2GRAY).astype(float)

            kernels = [(36, 120), (50, 200), (80, 320)]
            best = None
            global_sat = float(sat_map.mean()) + 1e-6
            global_lum = float(gray_map.mean()) + 1e-6

            for kernel_h, kernel_w in kernels:
                if sat_map.shape[0] <= kernel_h or sat_map.shape[1] <= kernel_w:
                    continue
                # V3: Aspect ratio constraint — avoid vertical lines and full-width banners
                ar = kernel_w / max(1, kernel_h)
                if ar < 1.0 or ar > 8.0:
                    continue
                # V3: Area constraint — UI button should not consume more than 15% of viewport
                if (kernel_w * kernel_h) > (arr.shape[0] * arr.shape[1] * 0.15):
                    continue

                y_step = max(6, kernel_h // 5)
                x_step = max(6, kernel_w // 5)
                for y in range(0, sat_map.shape[0] - kernel_h, y_step):
                    for x in range(0, sat_map.shape[1] - kernel_w, x_step):
                        sat_region = sat_map[y:y + kernel_h, x:x + kernel_w]
                        lum_region = gray_map[y:y + kernel_h, x:x + kernel_w]
                        region_sat = float(sat_region.mean())
                        region_lum = float(lum_region.mean())
                        lum_contrast = abs(region_lum - global_lum) / global_lum
                        score = (region_sat / global_sat) + (lum_contrast * 0.5)
                        if best is None or score > best["score"]:
                            best = {
                                "score": score,
                                "x": x,
                                "y": y,
                                "w": kernel_w,
                                "h": kernel_h,
                            }

            if best is not None:
                x_cta, y_cta = best["x"], best["y"]
                w_cta, h_cta = best["w"], best["h"]
                region = arr[y_cta:y_cta + h_cta, x_cta:x_cta + w_cta]
                if region.size > 0:
                    fg_color = tuple(np.round(region.mean(axis=(0, 1))).astype(int))
                    cta_bbox = {
                        "x": int(x_cta),
                        "y": int(y_cta),
                        "w": int(w_cta),
                        "h": int(h_cta),
                        "fg_color": fg_color,
                        "bg_color": (255, 255, 255),
                    }
        except Exception as e:
            logger.warning(f"CTA naive detection failed: {e}")
            cta_bbox = None

        if cta_bbox is None:
            return {
                "cta_prominence_score": 0,
                "cta_detected": None,
                "cta_above_fold": False,
                "wcag_contrast_ratio": 0.0,
                "cta_saliency_percentile": 0.0,
                "passed": None,
                "status": "non_evalue",
            }

    cta_detected = True
    cta_above_fold = cta_bbox["y"] + cta_bbox["h"] < viewport_height

    # Contrast ratio
    fg = cta_bbox.get("fg_color", (255, 255, 255))
    bg = cta_bbox.get("bg_color", (0, 0, 0))
    contrast = compute_wcag_contrast_ratio(fg, bg)

    # Saliency: relative saturation of CTA vs rest of above-fold
    fold_region = arr[:viewport_height] if viewport_height < h else arr
    hsv_fold = cv2.cvtColor(fold_region, cv2.COLOR_RGB2HSV)
    cta_y1 = max(0, min(cta_bbox["y"], fold_region.shape[0] - 1))
    cta_y2 = min(fold_region.shape[0], cta_bbox["y"] + cta_bbox["h"])
    cta_x1 = max(0, min(cta_bbox["x"], fold_region.shape[1] - 1))
    cta_x2 = min(fold_region.shape[1], cta_bbox["x"] + cta_bbox["w"])
    
    if cta_y2 > cta_y1 and cta_x2 > cta_x1:
        cta_sat = float(hsv_fold[cta_y1:cta_y2, cta_x1:cta_x2, 1].mean())
    else:
        cta_sat = 0.0
    
    global_sat = float(hsv_fold[:, :, 1].mean()) + 1e-6
    saliency_percentile = round(min(cta_sat / global_sat, 2.0) / 2.0, 4)

    # Composite score
    score_above_fold = 1.0 if cta_above_fold else 0.0
    score_contrast   = min(contrast / 7.0, 1.0)
    score_saliency   = saliency_percentile
    cta_score = int((score_above_fold * 0.40 + score_contrast * 0.35 + score_saliency * 0.25) * 100)

    passing = cta_score >= 60 and contrast >= 4.5
    status = "passing" if passing else ("warning" if cta_score >= 50 else "failing")

    logger.debug(f"CTA prominence: score={cta_score}, above_fold={cta_above_fold}, contrast={contrast:.2f}, saliency={saliency_percentile:.4f}")

    return {
        "cta_prominence_score": cta_score,
        "cta_detected": cta_detected,
        "cta_above_fold": cta_above_fold,
        "wcag_contrast_ratio": contrast,
        "cta_saliency_percentile": saliency_percentile,
        "passed": passing,
        "status": status,
    }


# ─────────────────────────────────────────────────────────────────────────────
# KPI 4: FIRST IMPRESSION SCORE (COMPOSITE)
# ─────────────────────────────────────────────────────────────────────────────

def compute_first_impression_score(
    img: Image.Image,
    cta_bbox: Optional[dict] = None,
    viewport_height: int = 768
) -> dict:
    """
    Composite headline KPI: 0–100.
    Weights: above_fold_density×0.30 + cta_prominence×0.35 + visual_hierarchy×0.20 + complexity_inverted×0.15
    
    Args:
        img: PIL Image
        cta_bbox: Optional CTA bounding box dict
        viewport_height: Viewport height in pixels (default 768)
    
    Returns:
        dict with first_impression_score, status, severity, passed, breakdown, sub_scores
    """
    w, h = img.size
    
    # Sub-score 1: above-fold content density (0–1)
    above_fold_score = compute_above_fold_density(img, viewport_height)

    # Sub-score 2: CTA prominence (0–100 → normalize to 0–1)
    cta_result = compute_cta_prominence(img, cta_bbox, viewport_height)
    cta_score_norm = cta_result["cta_prominence_score"] / 100.0

    # Sub-score 3: visual hierarchy (proxy: above-fold saliency concentration)
    # Compute edge concentration in top 40% of above-fold vs total above-fold
    fold_crop = img.crop((0, 0, w, min(viewport_height, h)))
    top_crop  = img.crop((0, 0, w, min(int(viewport_height * 0.4), h)))
    fold_complexity = compute_visual_complexity(fold_crop)["edge_density"]
    top_complexity  = compute_visual_complexity(top_crop)["edge_density"]
    hierarchy_score = round(min(top_complexity / (fold_complexity + 1e-6), 1.5) / 1.5, 4)

    # Sub-score 4: visual complexity inverted (simpler = better first impression)
    complexity_result = compute_visual_complexity(fold_crop)
    complexity_inverted = round(1.0 - (complexity_result["visual_complexity_score"] / 100.0), 4)

    # Weighted composite
    raw_score = (
        above_fold_score    * 0.30 +
        cta_score_norm      * 0.35 +
        hierarchy_score     * 0.20 +
        complexity_inverted * 0.15
    )
    first_impression_score = int(raw_score * 100)

    if first_impression_score >= 73:
        status = "passing"
        severity = None
    elif first_impression_score >= 60:
        status = "warning"
        severity = "medium"
    else:
        status = "failing"
        if first_impression_score < 40:
            severity = "critical"
        else:
            severity = "high"

    logger.info(f"First impression score: {first_impression_score}, status={status}, severity={severity}")

    return {
        "first_impression_score": first_impression_score,
        "status": status,
        "severity": severity,
        "passed": status == "passing",
        "breakdown": {
            "above_fold":   round(above_fold_score * 0.30 * 100, 1),
            "cta":          round(cta_score_norm   * 0.35 * 100, 1),
            "hierarchy":    round(hierarchy_score  * 0.20 * 100, 1),
            "complexity":   round(complexity_inverted * 0.15 * 100, 1),
        },
        "sub_scores": {
            "above_fold_density":    above_fold_score,
            "cta_prominence":        cta_result["cta_prominence_score"],
            "visual_hierarchy":      float(hierarchy_score),
            "visual_complexity":     complexity_result["visual_complexity_score"],
            "visual_complexity_inv": float(complexity_inverted),
        },
    }
