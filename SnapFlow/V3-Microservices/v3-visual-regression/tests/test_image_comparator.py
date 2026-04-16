"""
Phase 1 Tests: SSIM Image Comparator
Run: python -m pytest tests/test_image_comparator.py -v
"""

import pytest
from PIL import Image
import numpy as np
from services.image_comparator import compare_images_ssim, compute_phash_distance


def make_solid_image(color: tuple, size=(800, 600)) -> Image.Image:
    """Create a solid-color test image."""
    img = Image.new("RGB", size, color)
    return img


class TestImageComparator:
    
    def test_identical_images_ssim_is_one(self):
        """Identical images must have SSIM=1.0"""
        img = make_solid_image((200, 100, 50))
        result = compare_images_ssim(img, img)
        assert result["ssim_score"] == 1.0, f"Identical images must have SSIM=1.0, got {result['ssim_score']}"
        assert result["phash_distance"] == 0, f"phash distance should be 0, got {result['phash_distance']}"
        assert result["regression_confidence"] == 0.0, f"confidence should be 0.0, got {result['regression_confidence']}"
        print(f"✓ PASS: identical images SSIM={result['ssim_score']}")

    def test_completely_different_images_low_ssim(self):
        """Structurally different images should have lower SSIM"""
        # Create a test pattern: one with vertical lines, one with horizontal lines
        img_a = Image.new("RGB", (800, 600), color=(255, 255, 255))
        pixels_a = img_a.load()
        # Vertical lines
        for x in range(0, 800, 20):
            for y in range(600):
                pixels_a[x, y] = (0, 0, 0)
        
        img_b = Image.new("RGB", (800, 600), color=(255, 255, 255))
        pixels_b = img_b.load()
        # Horizontal lines (different structure)
        for y in range(0, 600, 20):
            for x in range(800):
                pixels_b[x, y] = (0, 0, 0)
        
        result = compare_images_ssim(img_a, img_b)
        # Different patterns should have lower SSIM than identical
        assert result["ssim_score"] < 0.95, f"Different patterns should have SSIM<0.95, got {result['ssim_score']}"
        assert result["regression_confidence"] > 0.05, f"confidence should be > 0.05, got {result['regression_confidence']}"
        print(f"✓ PASS: different patterns SSIM={result['ssim_score']}, confidence={result['regression_confidence']}")

    def test_minor_color_shift_high_ssim(self):
        """Minor color shift should result in high SSIM"""
        img_a = make_solid_image((100, 150, 200))
        img_b = make_solid_image((102, 148, 198))   # 2-unit shift per channel
        result = compare_images_ssim(img_a, img_b)
        assert result["ssim_score"] > 0.95, f"Minor color shift should have SSIM>0.95, got {result['ssim_score']}"
        assert result["regression_confidence"] < 0.1, f"confidence should be low, got {result['regression_confidence']}"
        print(f"✓ PASS: minor shift SSIM={result['ssim_score']}, confidence={result['regression_confidence']}")

    def test_masking_excludes_dynamic_zone(self):
        """Masked regions should be excluded from comparison"""
        img_a = make_solid_image((200, 200, 200))
        # Create img_b with a red block at top-left (simulates timestamp/banner)
        img_b_arr = np.ones((600, 800, 3), dtype=np.uint8) * 200
        img_b_arr[0:50, 0:200, 0] = 255  # Red channel for top-left block
        img_b = Image.fromarray(img_b_arr, 'RGB')
        
        # Without mask: should detect regression
        result_no_mask = compare_images_ssim(img_a, img_b)
        
        # With mask covering the red zone
        masks = [{"x": 0, "y": 0, "w": 200, "h": 50, "label": "dynamic_zone"}]
        result_masked = compare_images_ssim(img_a, img_b, masks=masks)
        
        assert result_masked["ssim_score"] > result_no_mask["ssim_score"], \
            f"Masked comparison must have higher SSIM than unmasked. Masked={result_masked['ssim_score']}, Unmasked={result_no_mask['ssim_score']}"
        assert result_masked["masks_applied"] == 1, "Should record 1 mask applied"
        print(f"✓ PASS: masking works. Unmasked SSIM={result_no_mask['ssim_score']}, Masked={result_masked['ssim_score']}")

    def test_legacy_diff_pct_still_present(self):
        """Backward compatibility: diff_pct field must be present"""
        img_a = make_solid_image((255, 0, 0))
        img_b = make_solid_image((0, 0, 255))
        result = compare_images_ssim(img_a, img_b)
        assert "diff_pct" in result, "Legacy diff_pct field must be present for backward compat"
        assert 0 <= result["diff_pct"] <= 100, f"diff_pct must be 0-100, got {result['diff_pct']}"
        print(f"✓ PASS: legacy diff_pct={result['diff_pct']} present")

    def test_all_return_fields_present(self):
        """Verify all documented return fields are present"""
        img = make_solid_image((100, 100, 100))
        result = compare_images_ssim(img, img)
        required_keys = {"ssim_score", "phash_distance", "regression_confidence", "diff_pct", "diff_map", "masks_applied"}
        assert required_keys.issubset(result.keys()), \
            f"Missing keys. Expected {required_keys}, got {set(result.keys())}"
        print(f"✓ PASS: all required fields present: {required_keys}")

    def test_values_are_correct_types(self):
        """Verify return value types"""
        img = make_solid_image((100, 100, 100))
        result = compare_images_ssim(img, img)
        assert isinstance(result["ssim_score"], float), "ssim_score must be float"
        assert isinstance(result["phash_distance"], int), "phash_distance must be int"
        assert isinstance(result["regression_confidence"], float), "regression_confidence must be float"
        assert isinstance(result["diff_pct"], float), "diff_pct must be float"
        assert isinstance(result["diff_map"], np.ndarray), "diff_map must be ndarray"
        assert isinstance(result["masks_applied"], int), "masks_applied must be int"
        print(f"✓ PASS: all types correct")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
