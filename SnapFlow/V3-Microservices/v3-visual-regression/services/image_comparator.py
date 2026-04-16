"""
SnapFlow V3 — SSIM-based image comparator
Replaces PIL ImageChops. Author: SnapFlow agent.

Computes structural similarity (SSIM) and perceptual hashing for accurate 
visual regression detection.
"""

import io
import os
import cv2
import numpy as np
import imagehash
from PIL import Image
from skimage.metrics import structural_similarity as ssim
from typing import Optional
import logging

try:
    import torch
    import lpips
except Exception:  # pragma: no cover - optional dependency
    torch = None
    lpips = None

logger = logging.getLogger("visual-regression.image_comparator")

LPIPS_ENABLED = os.getenv("VISUAL_LPIPS_ENABLED", "1").strip().lower() in {"1", "true", "yes", "on"}
_LPIPS_MODEL = None


def _to_pil_image(image_source) -> Image.Image:
    """Normalize supported image source types to PIL Image in RGB mode."""
    if isinstance(image_source, Image.Image):
        return image_source.convert("RGB")
    if isinstance(image_source, (bytes, bytearray, memoryview)):
        return Image.open(io.BytesIO(bytes(image_source))).convert("RGB")
    if isinstance(image_source, str):
        return Image.open(image_source).convert("RGB")
    raise ValueError(f"Unsupported image source type: {type(image_source)}")


def load_image_rgb(image_source) -> np.ndarray:
    """Load image from PIL Image, bytes, or file path. Returns RGB numpy array."""
    return np.array(_to_pil_image(image_source))


def apply_masks(img: np.ndarray, masks: list[dict]) -> np.ndarray:
    """
    Zero out dynamic content zones before comparison.
    masks = [{"x": int, "y": int, "w": int, "h": int, "label": str}, ...]
    """
    result = img.copy()
    for mask in masks:
        x, y, w, h = mask["x"], mask["y"], mask["w"], mask["h"]
        # Clamp to image bounds
        x = max(0, min(x, result.shape[1]))
        y = max(0, min(y, result.shape[0]))
        w = max(0, min(w, result.shape[1] - x))
        h = max(0, min(h, result.shape[0] - y))
        result[y:y+h, x:x+w] = 0
    return result


def compute_ssim(img_a: np.ndarray, img_b: np.ndarray) -> tuple[float, np.ndarray]:
    """
    Compute SSIM score and difference map between two RGB images.
    Returns (ssim_score: float 0-1, diff_map: ndarray float32).
    """
    assert img_a.ndim == 3 and img_a.shape[2] == 3, "img_a must be RGB"
    assert img_b.ndim == 3 and img_b.shape[2] == 3, "img_b must be RGB"
    
    gray_a = cv2.cvtColor(img_a, cv2.COLOR_RGB2GRAY)
    gray_b = cv2.cvtColor(img_b, cv2.COLOR_RGB2GRAY)

    # Resize to same dimensions if needed (defensive)
    if gray_a.shape != gray_b.shape:
        h = min(gray_a.shape[0], gray_b.shape[0])
        w = min(gray_a.shape[1], gray_b.shape[1])
        gray_a = cv2.resize(gray_a, (w, h))
        gray_b = cv2.resize(gray_b, (w, h))

    score, diff_map = ssim(gray_a, gray_b, full=True)
    return float(score), diff_map.astype(np.float32)


def compute_phash_distance(pil_a: Image.Image, pil_b: Image.Image) -> int:
    """Perceptual hash Hamming distance. 0 = identical, > 10 = significant change."""
    hash_a = imagehash.phash(pil_a)
    hash_b = imagehash.phash(pil_b)
    distance = hash_a - hash_b
    return int(distance)


def compute_regression_confidence(ssim_score: float, phash_dist: int) -> float:
    """
    Composite confidence that a detected change is a real regression (not noise).
    Returns float 0-1. > 0.5 = likely real regression.
    """
    ssim_delta = 1.0 - ssim_score
    phash_weight = min(phash_dist / 20.0, 1.0)
    confidence = ssim_delta * 0.7 + phash_weight * 0.3
    return round(float(confidence), 4)


def _get_lpips_model():
    global _LPIPS_MODEL
    if _LPIPS_MODEL is not None:
        return _LPIPS_MODEL
    if not LPIPS_ENABLED or torch is None or lpips is None:
        return None
    try:
        _LPIPS_MODEL = lpips.LPIPS(net="alex")
        _LPIPS_MODEL.eval()
        return _LPIPS_MODEL
    except Exception as exc:
        logger.warning("LPIPS initialization failed, continuing without model: %s", exc)
        return None


def compute_lpips_distance(pil_a: Image.Image, pil_b: Image.Image) -> Optional[float]:
    """Compute LPIPS distance in [0, 1+] range. Returns None if unavailable."""
    model = _get_lpips_model()
    if model is None or torch is None:
        return None
    try:
        arr_a = np.array(pil_a.resize((256, 256), Image.Resampling.BILINEAR)).astype(np.float32) / 255.0
        arr_b = np.array(pil_b.resize((256, 256), Image.Resampling.BILINEAR)).astype(np.float32) / 255.0
        ten_a = torch.from_numpy(arr_a).permute(2, 0, 1).unsqueeze(0) * 2.0 - 1.0
        ten_b = torch.from_numpy(arr_b).permute(2, 0, 1).unsqueeze(0) * 2.0 - 1.0
        with torch.no_grad():
            score = model(ten_a, ten_b)
        return float(score.item())
    except Exception as exc:
        logger.warning("LPIPS computation failed, ignoring LPIPS signal: %s", exc)
        return None


def compare_images_ssim(
    img_a_source,
    img_b_source,
    masks: Optional[list[dict]] = None
) -> dict:
    """
    Full SSIM comparison between two images.
    Returns dict compatible with existing API response schema.
    
    Args:
        img_a_source: PIL Image, bytes, or file path
        img_b_source: PIL Image, bytes, or file path
        masks: Optional list of dicts with x, y, w, h, label to mask out dynamic zones
    
    Returns:
        dict with ssim_score, phash_distance, regression_confidence, diff_pct (legacy)
    """
    # Load images
    pil_a = _to_pil_image(img_a_source)
    pil_b = _to_pil_image(img_b_source)

    arr_a = np.array(pil_a)
    arr_b = np.array(pil_b)

    # Apply masks if provided
    if masks:
        arr_a = apply_masks(arr_a, masks)
        arr_b = apply_masks(arr_b, masks)

    # Ensure same dimensions
    if arr_a.shape != arr_b.shape:
        h = min(arr_a.shape[0], arr_b.shape[0])
        w = min(arr_a.shape[1], arr_b.shape[1])
        arr_a = arr_a[:h, :w]
        arr_b = arr_b[:h, :w]

    ssim_score, diff_map = compute_ssim(arr_a, arr_b)
    phash_dist = compute_phash_distance(pil_a, pil_b)
    lpips_distance = compute_lpips_distance(pil_a, pil_b)
    confidence = compute_regression_confidence(ssim_score, phash_dist)
    if lpips_distance is not None:
        # LPIPS is an additive perceptual signal, lightly weighted to keep continuity.
        confidence = round(min(confidence * 0.8 + min(lpips_distance, 1.0) * 0.2, 1.0), 4)

    # Legacy compatibility: convert SSIM to approximate diff_pct
    diff_pct_legacy = round((1.0 - ssim_score) * 100, 2)

    logger.info(
        "SSIM comparison: ssim=%.4f, phash_dist=%d, lpips=%s, confidence=%.4f, diff_pct=%.2f",
        ssim_score,
        phash_dist,
        f"{lpips_distance:.4f}" if lpips_distance is not None else "disabled",
        confidence,
        diff_pct_legacy,
    )

    lpips_available = bool(LPIPS_ENABLED and _get_lpips_model() is not None)

    return {
        "ssim_score": round(ssim_score, 4),
        "phash_distance": int(phash_dist),
        "lpips_distance": round(lpips_distance, 4) if lpips_distance is not None else None,
        "lpips_available": lpips_available,
        "lpips_enabled": lpips_available,
        "regression_confidence": confidence,
        "diff_pct": diff_pct_legacy,              # kept for backward compat
        "diff_map": diff_map,                      # numpy array, not serialized
        "masks_applied": len(masks) if masks else 0,
    }
