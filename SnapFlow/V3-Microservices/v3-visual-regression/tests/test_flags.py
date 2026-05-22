import os
import unittest
import asyncio
from unittest.mock import patch
from fastapi import HTTPException

import main as visual_main
from comparator import SCREENSHOT_IGNORE_HTTPS_ERRORS, SCREENSHOT_WAIT_UNTIL, _normalize_wait_until, get_browser_args
from main import compare, browser_compat, CompareRequest, BrowserCompatRequest


class FlagBehaviorTests(unittest.TestCase):
    def setUp(self):
        self._orig_no_sandbox = os.getenv("CHROME_NO_SANDBOX")
        self._orig_visual_enabled = os.getenv("VISUAL_REGRESSION_ENABLED")

    def tearDown(self):
        if self._orig_no_sandbox is None:
            os.environ.pop("CHROME_NO_SANDBOX", None)
        else:
            os.environ["CHROME_NO_SANDBOX"] = self._orig_no_sandbox

        if self._orig_visual_enabled is None:
            os.environ.pop("VISUAL_REGRESSION_ENABLED", None)
        else:
            os.environ["VISUAL_REGRESSION_ENABLED"] = self._orig_visual_enabled

    def test_get_browser_args_no_sandbox_enabled(self):
        os.environ["CHROME_NO_SANDBOX"] = "true"
        args = get_browser_args()
        self.assertIn("--no-sandbox", args)
        self.assertIn("--disable-dev-shm-usage", args)
        self.assertIn("--disable-gpu", args)

    def test_get_browser_args_no_sandbox_disabled(self):
        os.environ["CHROME_NO_SANDBOX"] = "false"
        args = get_browser_args()
        self.assertNotIn("--no-sandbox", args)
        self.assertIn("--disable-dev-shm-usage", args)

    def test_screenshot_wait_defaults_to_domcontentloaded(self):
        self.assertEqual(SCREENSHOT_WAIT_UNTIL, "domcontentloaded")
        self.assertEqual(_normalize_wait_until(None), "domcontentloaded")
        self.assertEqual(_normalize_wait_until("not-real"), "domcontentloaded")
        self.assertEqual(_normalize_wait_until("networkidle"), "networkidle")

    def test_screenshot_ignore_https_errors_flag_is_boolean(self):
        self.assertIsInstance(SCREENSHOT_IGNORE_HTTPS_ERRORS, bool)

    def test_compare_disabled_returns_503(self):
        os.environ["VISUAL_REGRESSION_ENABLED"] = "false"
        async def _run():
            await compare(
                CompareRequest(
                    scan_id_baseline="s1",
                    scan_id_new="s2",
                    urls=["https://example.com"],
                )
            )

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_run())
        self.assertEqual(ctx.exception.status_code, 503)

    def test_browser_compat_disabled_returns_503(self):
        os.environ["VISUAL_REGRESSION_ENABLED"] = "false"
        async def _run():
            await browser_compat(BrowserCompatRequest(url="https://example.com"))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_run())
        self.assertEqual(ctx.exception.status_code, 503)

    def test_browser_compat_returns_evidence_rows(self):
        os.environ["VISUAL_REGRESSION_ENABLED"] = "true"

        async def _fake_capture(*args, **kwargs):
            return b"image-bytes"

        def _fake_diff(*args, **kwargs):
            return {
                "diff_pct": 1.5,
                "layout_size_change": False,
                "size_delta": {"width": 0, "height": 0},
                "structural_score": "no_change",
                "band_diff_pct": {},
                "coverage_mode": "viewport_only",
            }

        async def _run():
            with patch.object(visual_main, "capture_screenshot", side_effect=_fake_capture), \
                 patch.object(visual_main, "compute_diff", side_effect=_fake_diff):
                return await browser_compat(BrowserCompatRequest(url="https://example.com", threshold_pct=5.0))

        result = asyncio.run(_run())
        self.assertEqual(result["status"], "evaluated")
        self.assertTrue(result["passed"])
        self.assertIn("browser_matrix", result)
        self.assertEqual(len(result["browser_matrix"]), 2)
        self.assertEqual(result["browser_matrix"][0]["browser"], "chromium")
        self.assertEqual(result["browser_matrix"][1]["browser"], "webkit")
        self.assertEqual(result["rows"], result["browser_matrix"])


if __name__ == "__main__":
    unittest.main()
