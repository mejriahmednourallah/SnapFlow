"""
Phase 2 Tests: Zone-Level Regression Comparator
Run: python -m pytest tests/test_zone_comparator.py -v
"""

import pytest
from PIL import Image, ImageDraw
import services.zone_comparator as zone_module
from services.zone_comparator import compute_zone_regression, crop_zone


def make_page(height=1200, width=1440, base_color=(240, 240, 240)):
    """Create a blank page template."""
    return Image.new("RGB", (width, height), base_color)


def damage_zone(img: Image.Image, y_start_pct: float, y_end_pct: float, color=(255, 0, 0)) -> Image.Image:
    """Paint a solid color block in a zone — simulates a visual regression."""
    result = img.copy()
    draw = ImageDraw.Draw(result)
    h = img.height
    draw.rectangle([(0, int(h * y_start_pct)), (img.width, int(h * y_end_pct))], fill=color)
    return result


class TestZoneComparator:
    
    def test_identical_pages_score_zero(self):
        """Identical pages must score 0"""
        page = make_page()
        result = compute_zone_regression(page, page)
        assert result["weighted_regression_score"] == 0, \
            f"Identical pages must score 0, got {result['weighted_regression_score']}"
        assert result["passing"] is True, "Should pass when identical"
        assert result["severity"] == "low", f"Should be low severity, got {result['severity']}"
        print(f"✓ PASS: identical pages score={result['weighted_regression_score']}, severity={result['severity']}")

    def test_header_damage_triggers_critical(self):
        """Header damage should trigger critical severity"""
        baseline = make_page()
        current = damage_zone(baseline, 0.00, 0.12, color=(255, 50, 50))
        result = compute_zone_regression(baseline, current)
        assert result["zones"]["header"]["regression"] is True, "Header damage must flag regression"
        assert result["severity"] == "critical", f"Header damage must be critical, got {result['severity']}"
        assert result["passing"] is False, "Should not pass with critical regression"
        assert "header" in result["critical_zones"], "Header should be in critical zones"
        print(f"✓ PASS: header regression → severity={result['severity']}, score={result['weighted_regression_score']}, critical_zones={result['critical_zones']}")

    def test_footer_damage_does_not_trigger_critical(self):
        """Footer damage alone should not be critical"""
        baseline = make_page()
        current = damage_zone(baseline, 0.80, 1.00, color=(255, 50, 50))
        result = compute_zone_regression(baseline, current)
        assert result["zones"]["footer"]["regression"] is True, "Footer should regress"
        assert "footer" not in result["critical_zones"], "Footer should NOT be in critical_zones (weight too low)"
        assert result["severity"] != "critical", f"Footer damage alone should not be critical, got {result['severity']}"
        print(f"✓ PASS: footer regression → severity={result['severity']}, critical_zones={result['critical_zones']}, score={result['weighted_regression_score']}")

    def test_content_zone_crop_correct(self):
        """Verify content zone crop dimensions"""
        page = make_page(height=1200)
        zone = crop_zone(page, 0.35, 0.80)
        expected_h = int(1200 * 0.80) - int(1200 * 0.35)
        assert zone.height == expected_h, f"Zone crop height wrong: expected {expected_h}, got {zone.height}"
        assert zone.width == page.width, "Zone width should match page width"
        print(f"✓ PASS: content zone crop height={zone.height} (expected {expected_h})")

    def test_weighted_scoring_header_vs_footer(self):
        """Header damage should score higher than footer damage due to weighting"""
        baseline = make_page()
        footer_damaged = damage_zone(baseline, 0.80, 1.00)
        header_damaged = damage_zone(baseline, 0.00, 0.12)
        
        footer_result = compute_zone_regression(baseline, footer_damaged)
        header_result = compute_zone_regression(baseline, header_damaged)
        
        footer_score = footer_result["weighted_regression_score"]
        header_score = header_result["weighted_regression_score"]
        
        assert header_score > footer_score, \
            f"Header damage ({header_score}) should score higher than footer ({footer_score})"
        print(f"✓ PASS: header score={header_score} > footer score={footer_score}")

    def test_all_zones_present_in_result(self):
        """Verify all expected zones are in the result"""
        page = make_page()
        result = compute_zone_regression(page, page)
        expected_zones = {"header", "hero", "content", "footer", "cta"}
        assert set(result["zones"].keys()) == expected_zones, \
            f"Expected zones {expected_zones}, got {set(result['zones'].keys())}"
        print(f"✓ PASS: all zones present: {expected_zones}")

    def test_zone_weights_sum_to_one(self):
        """Zone weights should sum to 0.75 without CTA, 1.0 with CTA bbox"""
        page = make_page()
        
        # Without CTA bbox: header (0.30) + hero (0.25) + content (0.15) + footer (0.05) = 0.75
        result_no_cta = compute_zone_regression(page, page, cta_bbox=None)
        total_weight_no_cta = sum(z["weight"] for z in result_no_cta["zones"].values())
        assert abs(total_weight_no_cta - 0.75) < 0.01, f"Weights without CTA should sum to 0.75, got {total_weight_no_cta}"
        
        # With CTA bbox: add CTA weight (0.25), total = 1.0
        result_with_cta = compute_zone_regression(page, page, cta_bbox={"x": 600, "y": 300, "w": 200, "h": 50})
        total_weight_with_cta = sum(z["weight"] for z in result_with_cta["zones"].values())
        assert abs(total_weight_with_cta - 1.0) < 0.01, f"Weights with CTA should sum to 1.0, got {total_weight_with_cta}"
        
        print(f"✓ PASS: weights without CTA = {total_weight_no_cta:.4f}, with CTA = {total_weight_with_cta:.4f}")

    def test_cta_bbox_optional(self):
        """CTA zone should be optional"""
        page = make_page()
        result_no_cta = compute_zone_regression(page, page, cta_bbox=None)
        assert result_no_cta["zones"]["cta"]["weight"] == 0, "CTA weight should be 0 when no bbox"
        assert result_no_cta["zones"]["cta"]["ssim_score"] == 1.0, "CTA SSIM should be 1.0 when no bbox (perfect match, not evaluated)"
        
        result_with_cta = compute_zone_regression(page, page, cta_bbox={"x": 600, "y": 300, "w": 200, "h": 50})
        assert result_with_cta["zones"]["cta"]["weight"] == 0.25, "CTA weight should be 0.25 when bbox provided"
        print(f"✓ PASS: CTA zone correctly optional")

    def test_reference_delta_scaling(self, monkeypatch):
        """A weighted delta of 0.10 should map to score around 50."""
        baseline = make_page()
        current = make_page()

        # Non-CTA weights sum to 0.75; set fixed delta so weighted total is ~0.10.
        forced_delta = 0.10 / 0.75
        forced_ssim = 1.0 - forced_delta

        def fake_zone_ssim(_img_baseline, _img_current, _zone_cfg):
            return forced_ssim, None

        monkeypatch.setattr(zone_module, "compute_zone_ssim", fake_zone_ssim)
        result = compute_zone_regression(baseline, current, cta_bbox=None)

        assert 48 <= result["weighted_regression_score"] <= 52, \
            f"Expected score near 50 for weighted delta 0.10, got {result['weighted_regression_score']}"

    def test_cta_appearance_detected_as_regression(self):
        """CTA appearing in new page must be flagged as regression."""
        baseline = make_page()
        current = make_page()
        result = compute_zone_regression(
            baseline,
            current,
            baseline_cta_bbox=None,
            new_cta_bbox={"x": 600, "y": 300, "w": 200, "h": 50},
        )

        cta_zone = result["zones"]["cta"]
        assert cta_zone["regression"] is True, "CTA appearance should be considered regression"
        assert cta_zone["ssim_delta"] == 1.0
        assert cta_zone.get("note") == "cta_appeared_since_baseline"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
