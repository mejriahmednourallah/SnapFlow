import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

try:
    import main
except ModuleNotFoundError as exc:
    main = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


class TestRecommendationsEndpoint(unittest.TestCase):
    def setUp(self):
        if main is None:
            self.skipTest(f"Endpoint test skipped: missing dependency ({_IMPORT_ERROR})")
        self.client = TestClient(main.app)

    def test_recommendations_complete_scan(self):
        main.scans["scan_demo"] = {
            "scan_id": "scan_demo",
            "url": "https://example.com",
            "status": main.ScanStatus.COMPLETE,
            "started_at": 1710000000.0,
            "error": None,
        }

        def fake_build_recommendations(scan_id: str):
            return {
                "scan_id": scan_id,
                "domain": "example.com",
                "generated_at": "2026-03-13T10:00:00Z",
                "summary": {
                    "total": 3,
                    "bugs": 1,
                    "recommendations": 1,
                    "compliance": 1,
                    "critical": 1,
                    "high": 1,
                    "medium": 1,
                    "low": 0,
                },
                "quick_wins": [],
                "bugs": [{"id": "broken_links", "source_kpi": "site_metrics.seo.broken_link_kpi"}],
                "recommendations": [{"id": "missing_meta_description", "source_kpi": "site_metrics.seo.pages_missing_meta_desc"}],
                "compliance": [{"id": "missing_privacy_policy", "source_kpi": "domain_analysis.privacy_kpi.has_privacy_policy"}],
                "roadmap": {
                    "immediate": [{"id": "missing_privacy_policy", "title": "", "type": "COMPLIANCE", "severity": "CRITICAL", "effort": "LOW"}],
                    "this_sprint": [{"id": "broken_links", "title": "", "type": "BUG", "severity": "HIGH", "effort": "MEDIUM"}],
                    "this_quarter": [{"id": "missing_meta_description", "title": "", "type": "RECOMMENDATION", "severity": "MEDIUM", "effort": "MEDIUM"}],
                    "backlog": [],
                },
            }

        old_fn = main.build_recommendations
        main.build_recommendations = fake_build_recommendations
        try:
            resp = self.client.get("/scan/scan_demo/recommendations")
        finally:
            main.build_recommendations = old_fn

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIn("bugs", body)
        self.assertIn("recommendations", body)
        self.assertIn("compliance", body)
        self.assertEqual(body["summary"]["total"], len(body["bugs"]) + len(body["recommendations"]) + len(body["compliance"]))

    def test_recommendations_requires_complete(self):
        main.scans["scan_pending"] = {
            "scan_id": "scan_pending",
            "url": "https://example.com",
            "status": main.ScanStatus.NLP_PROCESSING,
            "started_at": 1710000000.0,
            "error": None,
        }
        resp = self.client.get("/scan/scan_pending/recommendations")
        self.assertEqual(resp.status_code, 202)


if __name__ == "__main__":
    unittest.main()
