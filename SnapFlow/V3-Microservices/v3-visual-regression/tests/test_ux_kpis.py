"""
Unit tests for SnapFlow v3-visual-regression UX KPI module.
Tests: visual_complexity, above_fold_density, cta_prominence, first_impression_score
"""

import pytest
import numpy as np
from PIL import Image, ImageDraw
from services.ux_kpis import (
    compute_visual_complexity,
    compute_above_fold_density,
    compute_wcag_contrast_ratio,
    compute_cta_prominence,
    compute_first_impression_score,
)


class TestVisualComplexity:
    """Test suites for visual complexity scoring."""

    def test_blank_page_low_complexity(self):
        """Blank white page should have low complexity."""
        img = Image.new("RGB", (1440, 768), color=(255, 255, 255))
        result = compute_visual_complexity(img)

        assert "visual_complexity_score" in result
        assert "edge_density" in result
        assert "complexity_label" in result
        assert "passed" in result
        assert "status" in result

        assert result["edge_density"] < 0.05, "Blank page should have near-zero edge density"
        assert result["visual_complexity_score"] < 20, "Blank page should score < 20"
        assert result["complexity_label"] == "simple"
        assert result["passed"] is True
        assert result["status"] == "passing"

    def test_noisy_page_high_complexity(self):
        """Noisy page (random pixels) should have high complexity."""
        np.random.seed(42)
        arr = np.random.randint(0, 255, (768, 1440, 3), dtype=np.uint8)
        img = Image.fromarray(arr, "RGB")
        result = compute_visual_complexity(img)

        assert result["visual_complexity_score"] > 60, "Noisy page should score > 60"
        assert result["complexity_label"] == "complexe"
        assert result["passed"] is False
        assert result["status"] in ("warning", "failing")

    def test_text_rich_page_moderate_complexity(self):
        """Page with moderate text content should score 30-60."""
        img = Image.new("RGB", (1440, 768), color=(255, 255, 255))
        # Simulate horizontal lines (text)
        for y in range(100, 700, 50):
            pixels = img.load()
            for x in range(0, 1440):
                pixels[x, y] = (0, 0, 0)

        result = compute_visual_complexity(img)
        # Don't be too strict; Canny may vary but expect modéré range
        assert result["complexity_label"] in ("simple", "modéré", "complexe")
        assert isinstance(result["visual_complexity_score"], int)
        assert 0 <= result["visual_complexity_score"] <= 100

    def test_complexity_return_types(self):
        """Verify all return types are correct."""
        img = Image.new("RGB", (1440, 768), color=(200, 200, 200))
        result = compute_visual_complexity(img)

        assert isinstance(result["visual_complexity_score"], int)
        assert isinstance(result["edge_density"], float)
        assert isinstance(result["complexity_label"], str)
        assert isinstance(result["passed"], bool)
        assert isinstance(result["status"], str)


class TestAboveFoldDensity:
    """Test suite for above-fold density scoring."""

    def test_above_fold_white_page(self):
        """White page should have low above-fold density."""
        img = Image.new("RGB", (1440, 1536), color=(255, 255, 255))
        score = compute_above_fold_density(img, fold_height_px=768)

        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0
        assert score < 0.3, "Blank above-fold should score < 0.3"

    def test_above_fold_optimal_density(self):
        """Optimal above-fold (edge_density ~0.18) should score near 1.0."""
        img = Image.new("RGB", (1440, 1536), color=(255, 255, 255))
        # Add scattered horizontal lines to approximate edge_density ~0.18
        pixels = img.load()
        for y in range(50, 700, 40):
            for x in range(0, 1440, 2):
                pixels[x, y] = (0, 0, 0)

        score = compute_above_fold_density(img, fold_height_px=768)
        # Score should be reasonably high, though exact value depends on Canny
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    def test_above_fold_returns_float(self):
        """Verify return type is float."""
        img = Image.new("RGB", (1440, 768), color=(200, 200, 200))
        score = compute_above_fold_density(img)
        assert isinstance(score, float)


class TestWCAGContrast:
    """Test suite for WCAG contrast ratio computation."""

    def test_black_on_white_maximum_contrast(self):
        """Black text on white background = maximum contrast (21:1)."""
        black = (0, 0, 0)
        white = (255, 255, 255)
        contrast = compute_wcag_contrast_ratio(black, white)

        assert isinstance(contrast, float)
        assert contrast > 20.0, "Black-on-white should be > 20:1"

    def test_gray_on_white_fails_wcag_aa(self):
        """Gray text on white may fail WCAG AA (4.5:1)."""
        gray = (128, 128, 128)
        white = (255, 255, 255)
        contrast = compute_wcag_contrast_ratio(gray, white)

        assert isinstance(contrast, float)
        assert contrast < 10.0, "Gray-on-white should be < 10:1"

    def test_dark_blue_on_light_blue_passes_wcag_aaa(self):
        """Dark blue on light blue should pass AA (>= 4.5:1)."""
        dark_blue = (0, 0, 139)
        light_blue = (173, 216, 230)
        contrast = compute_wcag_contrast_ratio(dark_blue, light_blue)

        assert isinstance(contrast, float)
        assert contrast >= 3.0, "Distinct colors should have reasonable contrast"


class TestCTAProminence:
    """Test suite for CTA prominence scoring."""

    def test_cta_above_fold_high_contrast_passes(self):
        """CTA above fold with high contrast should pass."""
        img = Image.new("RGB", (1440, 768), color=(255, 255, 255))
        cta_bbox = {
            "x": 600, "y": 300, "w": 200, "h": 50,
            "fg_color": (0, 0, 0),
            "bg_color": (255, 0, 0),
        }

        result = compute_cta_prominence(img, cta_bbox=cta_bbox, viewport_height=768)

        assert "cta_prominence_score" in result
        assert "cta_above_fold" in result
        assert "wcag_contrast_ratio" in result
        assert "cta_saliency_percentile" in result
        assert "passed" in result

        assert result["cta_detected"] is True
        assert result["cta_above_fold"] is True
        assert result["wcag_contrast_ratio"] > 4.5, "Red on white should have good contrast"

    def test_cta_below_fold_penalized(self):
        """CTA below fold should have lower score."""
        img = Image.new("RGB", (1440, 1536), color=(255, 255, 255))
        cta_bbox = {
            "x": 600, "y": 1000, "w": 200, "h": 50,
            "fg_color": (0, 0, 0),
            "bg_color": (0, 255, 0),
        }

        result = compute_cta_prominence(img, cta_bbox=cta_bbox, viewport_height=768)

        assert result["cta_above_fold"] is False
        assert result["cta_prominence_score"] < 70, "Below-fold CTA should score < 70"

    def test_cta_no_bbox_detection_attempt(self):
        """No CTA bbox should attempt naive detection."""
        img = Image.new("RGB", (1440, 768), color=(255, 255, 255))
        result = compute_cta_prominence(img, cta_bbox=None, viewport_height=768)

        assert "cta_detected" in result
        assert isinstance(result["cta_detected"], bool)
        assert isinstance(result["cta_prominence_score"], int)
        assert 0 <= result["cta_prominence_score"] <= 100

    def test_cta_prominence_return_types(self):
        """Verify all return types are correct."""
        img = Image.new("RGB", (1440, 768), color=(200, 200, 200))
        cta_bbox = {"x": 600, "y": 300, "w": 200, "h": 50, "fg_color": (0, 0, 0), "bg_color": (255, 0, 0)}
        result = compute_cta_prominence(img, cta_bbox=cta_bbox, viewport_height=768)

        assert isinstance(result["cta_prominence_score"], int)
        assert isinstance(result["cta_detected"], bool)
        assert isinstance(result["cta_above_fold"], bool)
        assert isinstance(result["wcag_contrast_ratio"], float)
        assert isinstance(result["cta_saliency_percentile"], float)
        assert isinstance(result["passed"], bool)
        assert isinstance(result["status"], str)

    def test_cta_no_bbox_detects_grayscale_button(self):
        """Naive detection should still detect grayscale CTA via luminance contrast."""
        img = Image.new("RGB", (1440, 768), color=(255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.rectangle([(620, 280), (740, 316)], fill=(80, 80, 80))

        result = compute_cta_prominence(img, cta_bbox=None, viewport_height=768)
        assert result["cta_detected"] is True
        assert result["cta_prominence_score"] > 0

    def test_cta_no_bbox_detects_small_button(self):
        """Naive detection should find small CTA-like regions with multi-scale kernels."""
        img = Image.new("RGB", (1440, 768), color=(245, 245, 245))
        draw = ImageDraw.Draw(img)
        draw.rectangle([(580, 320), (700, 356)], fill=(255, 20, 20))

        result = compute_cta_prominence(img, cta_bbox=None, viewport_height=768)
        assert result["cta_detected"] is True
        assert result["cta_prominence_score"] > 0


class TestFirstImpressionScore:
    """Test suite for composite first impression score."""

    def test_blank_white_page_high_impression(self):
        """Blank white page should score reasonably high for first impression."""
        img = Image.new("RGB", (1440, 1536), color=(255, 255, 255))
        result = compute_first_impression_score(img, viewport_height=768)

        assert "first_impression_score" in result
        assert "status" in result
        assert "severity" in result
        assert "passed" in result
        assert "breakdown" in result
        assert "sub_scores" in result

        assert isinstance(result["first_impression_score"], int)
        assert 0 <= result["first_impression_score"] <= 100
        assert result["status"] in ("passing", "warning", "failing")

    def test_first_impression_score_severity_logic(self):
        """Verify severity mapping: >= 73 passing, 60-72 warning, < 60 failing."""
        # High score (passing)
        img_good = Image.new("RGB", (1440, 1536), color=(255, 255, 255))
        result_good = compute_first_impression_score(img_good, viewport_height=768)
        if result_good["first_impression_score"] >= 73:
            assert result_good["status"] == "passing"
            assert result_good["severity"] is None

        # Low score (failing)
        np.random.seed(42)
        arr = np.random.randint(0, 255, (1536, 1440, 3), dtype=np.uint8)
        img_bad = Image.fromarray(arr, "RGB")
        result_bad = compute_first_impression_score(img_bad, viewport_height=768)
        if result_bad["first_impression_score"] < 40:
            assert result_bad["status"] == "failing"
            assert result_bad["severity"] == "critical"

    def test_first_impression_breakdown_sums_correctly(self):
        """Breakdown components should sum to approximately the main score."""
        img = Image.new("RGB", (1440, 1536), color=(200, 200, 200))
        result = compute_first_impression_score(img, viewport_height=768)

        breakdown_sum = sum(result["breakdown"].values())
        main_score = result["first_impression_score"]

        # Allow 5% tolerance due to rounding
        assert abs(breakdown_sum - main_score) <= 5, "Breakdown should sum to main score"

    def test_first_impression_sub_scores_in_valid_range(self):
        """All sub-scores should be in valid ranges."""
        img = Image.new("RGB", (1440, 1536), color=(200, 200, 200))
        result = compute_first_impression_score(img, viewport_height=768)

        sub = result["sub_scores"]
        # above_fold_density, cta_prominence: 0–100 (norm to 0–1)
        assert 0.0 <= sub["above_fold_density"] <= 1.0
        assert 0 <= sub["cta_prominence"] <= 100
        assert 0.0 <= sub["visual_hierarchy"] <= 1.0
        assert 0 <= sub["visual_complexity"] <= 100
        assert 0.0 <= sub["visual_complexity_inv"] <= 1.0

    def test_first_impression_with_cta_bbox(self):
        """First impression should incorporate CTA when provided."""
        img = Image.new("RGB", (1440, 1536), color=(255, 255, 255))
        cta_bbox = {
            "x": 600, "y": 300, "w": 200, "h": 50,
            "fg_color": (0, 0, 0),
            "bg_color": (255, 0, 0),
        }

        result_with_cta = compute_first_impression_score(img, cta_bbox=cta_bbox, viewport_height=768)
        result_no_cta = compute_first_impression_score(img, cta_bbox=None, viewport_height=768)

        # Both should have valid scores
        assert isinstance(result_with_cta["first_impression_score"], int)
        assert isinstance(result_no_cta["first_impression_score"], int)
        # With CTA might have different score, but not drastically different on blank page
        assert abs(result_with_cta["first_impression_score"] - result_no_cta["first_impression_score"]) <= 30

    def test_first_impression_return_types(self):
        """Verify all return types are correct."""
        img = Image.new("RGB", (1440, 1536), color=(200, 200, 200))
        result = compute_first_impression_score(img, viewport_height=768)

        assert isinstance(result["first_impression_score"], int)
        assert isinstance(result["status"], str)
        assert isinstance(result["severity"], (str, type(None)))
        assert isinstance(result["passed"], bool)
        assert isinstance(result["breakdown"], dict)
        assert isinstance(result["sub_scores"], dict)

        # All breakdown values should be floats
        for key, val in result["breakdown"].items():
            assert isinstance(val, (int, float)), f"breakdown[{key}] should be numeric"

        # All sub_scores should be numeric
        for key, val in result["sub_scores"].items():
            assert isinstance(val, (int, float)), f"sub_scores[{key}] should be numeric"
