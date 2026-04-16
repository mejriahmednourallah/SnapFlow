import sys
import unittest
from pathlib import Path
from types import ModuleType

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Allow importing aggregator main without a real psycopg2 install.
psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
psycopg2_extras_stub.RealDictCursor = object
psycopg2_stub.extras = psycopg2_extras_stub
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", psycopg2_extras_stub)

import main


class TestKPINewModeEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.old_build_report = main.build_report
        self.old_build_kpi = main.build_kpi_centric_report
        self.old_count_pages = main.count_pages
        self.old_persist = main._persist_kpi_payload
        self.old_load_persisted = main._load_persisted_kpi_payload
        self.old_prev_quality = main._load_previous_quality_drift_artifact

        main.scans["scan_kpi_mode"] = {
            "scan_id": "scan_kpi_mode",
            "url": "https://example.com",
            "status": main.ScanStatus.COMPLETE,
            "started_at": 1710000000.0,
            "error": None,
        }

    def tearDown(self):
        main.build_report = self.old_build_report
        main.build_kpi_centric_report = self.old_build_kpi
        main.count_pages = self.old_count_pages
        main._persist_kpi_payload = self.old_persist
        main._load_persisted_kpi_payload = self.old_load_persisted
        main._load_previous_quality_drift_artifact = self.old_prev_quality
        main.scans.pop("scan_kpi_mode", None)

    def _stub_builders(self):
        report = {"scan_id": "scan_kpi_mode", "domain_analysis": {}, "site_metrics": {}}
        response = {
            "report_version": "v2",
            "axes": {"SEO": {}},
            "summary": {
                "client_overview": {
                    "health_status": "needs_attention",
                    "headline": "Headless summary",
                    "key_points": ["Point A", "Point B"],
                },
                "risk_breakdown": {
                    "seo": {"failed": 1, "high_confidence_failed": 1},
                },
                "delivery_overview": {
                    "pages_scanned": 12,
                    "total_kpis": 48,
                    "passed_kpis": 40,
                    "warning_kpis": 2,
                    "failed_kpis": 6,
                    "not_evaluated_kpis": 0,
                    "critical_kpis": 1,
                    "high_kpis": 2,
                    "medium_kpis": 2,
                    "low_kpis": 1,
                },
            },
        }
        main.build_report = lambda scan_id: report
        main.build_kpi_centric_report = lambda payload: dict(response)
        main._persist_kpi_payload = lambda scan_id, payload, scan_url=None: None
        main._load_persisted_kpi_payload = lambda scan_id: None
        main._load_previous_quality_drift_artifact = lambda scan_url, exclude_scan_id: (None, None)

    def test_status_exposes_new_kpi_mode(self):
        main.count_pages = lambda scan_id: (1, 1)

        resp = self.client.get("/scan/scan_kpi_mode/status")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["kpi_mode"], "new")

    def test_kpis_payload_includes_top_level_kpis(self):
        self._stub_builders()

        resp = self.client.get("/scan/scan_kpi_mode/kpis")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["kpi_mode"], "new")
        self.assertIn("axes", body)
        self.assertIn("top_level_kpis", body)
        self.assertIn("quality_drift_artifact", body)
        self.assertEqual(body["top_level_kpis"]["total_kpis"], 48)
        self.assertEqual(body["top_level_kpis"]["failed_kpis"], 6)
        self.assertEqual(body["top_level_kpis"]["health_status"], "needs_attention")
        self.assertEqual(body["quality_drift_artifact"]["scan_id"], "scan_kpi_mode")
        self.assertEqual(body["quality_drift_artifact"]["kpi_mode"], "new")

    def test_kpis_top_endpoint_returns_canonical_block(self):
        self._stub_builders()
        resp = self.client.get("/scan/scan_kpi_mode/kpis/top")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["scan_id"], "scan_kpi_mode")
        self.assertEqual(body["kpi_mode"], "new")
        self.assertIn("top_level_kpis", body)
        self.assertEqual(body["top_level_kpis"]["pages_scanned"], 12)
        self.assertEqual(body["top_level_kpis"]["critical_kpis"], 1)

    def test_kpis_quality_endpoint_returns_artifact(self):
        self._stub_builders()
        resp = self.client.get("/scan/scan_kpi_mode/kpis/quality")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["scan_id"], "scan_kpi_mode")
        self.assertEqual(body["kpi_mode"], "new")
        self.assertIn("quality_drift_artifact", body)
        artifact = body["quality_drift_artifact"]
        self.assertEqual(artifact["scan_id"], "scan_kpi_mode")
        self.assertIn("quality", artifact)
        self.assertIn("drift", artifact)


if __name__ == "__main__":
    unittest.main()