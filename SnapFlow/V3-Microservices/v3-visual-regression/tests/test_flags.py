import os
import unittest
import asyncio
from fastapi import HTTPException

from comparator import get_browser_args
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

    def test_compare_disabled_returns_503(self):
        os.environ["VISUAL_REGRESSION_ENABLED"] = "false"
        with self.assertRaises(HTTPException) as ctx:
            compare(
                CompareRequest(
                    scan_id_baseline="s1",
                    scan_id_new="s2",
                    urls=["https://example.com"],
                )
            )
        self.assertEqual(ctx.exception.status_code, 503)

    def test_browser_compat_disabled_returns_503(self):
        os.environ["VISUAL_REGRESSION_ENABLED"] = "false"
        async def _run():
            await browser_compat(BrowserCompatRequest(url="https://example.com"))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(_run())
        self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
