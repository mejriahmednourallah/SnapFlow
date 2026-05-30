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


class TestHeadlessConcurrencyDefaults(unittest.TestCase):
    def test_scan_request_defaults_to_aggressive_headless_concurrency(self):
        req = main.ScanRequest(url="https://example.com")
        self.assertEqual(req.headless_concurrency, 24)

    def test_headless_concurrency_is_clamped(self):
        self.assertEqual(main._clamp_headless_concurrency(None), 24)
        self.assertEqual(main._clamp_headless_concurrency(0), 1)
        self.assertEqual(main._clamp_headless_concurrency(96), 48)


class TestKPINewModeEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.old_build_report = main.build_report
        self.old_build_kpi = main.build_kpi_centric_report
        self.old_count_pages = main.count_pages
        self.old_persist = main._persist_kpi_payload
        self.old_load_persisted = main._load_persisted_kpi_payload
        self.old_build_and_persist = main._build_and_persist_kpi_payload
        self.old_prev_quality = main._load_previous_quality_drift_artifact
        self.old_get_db = main.get_db

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
        main._build_and_persist_kpi_payload = self.old_build_and_persist
        main._load_previous_quality_drift_artifact = self.old_prev_quality
        main.get_db = self.old_get_db
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
        main.build_report = lambda scan_id, **kwargs: report
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

    def test_kpis_endpoint_returns_persisted_payload_without_rebuild(self):
        cached = {
            "kpi_mode": "new",
            "axes": {},
            "summary": {},
            "top_level_kpis": {"health_status": "cached"},
        }
        main._load_persisted_kpi_payload = lambda scan_id: dict(cached)

        def fail_build(_scan_id, **kwargs):
            raise AssertionError("KPI endpoint should use persisted payload before rebuilding")

        main.build_report = fail_build

        resp = self.client.get("/scan/scan_kpi_mode/kpis")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["top_level_kpis"]["health_status"], "cached")

    def test_kpis_endpoint_waits_while_payload_is_finalizing(self):
        main.scans["scan_kpi_mode"]["status"] = main.ScanStatus.FINALIZING
        main._load_persisted_kpi_payload = lambda scan_id: None

        resp = self.client.get("/scan/scan_kpi_mode/kpis")
        self.assertEqual(resp.status_code, 202)
        self.assertIn("finalized", resp.json()["detail"])

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

    def test_previous_quality_loader_ignores_unparseable_jsonb_object(self):
        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                pass

            def fetchone(self):
                return {"scan_id": "scan_previous", "quality_drift_artifact": dict}

            def close(self):
                pass

        class FakeConn:
            def cursor(self, *_args, **_kwargs):
                return FakeCursor()

            def close(self):
                pass

        main.get_db = lambda: FakeConn()

        scan_id, artifact = main._load_previous_quality_drift_artifact("https://example.com", "scan_current")

        self.assertEqual(scan_id, "scan_previous")
        self.assertIsNone(artifact)

    def test_previous_quality_loader_accepts_bytes_jsonb(self):
        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                pass

            def fetchone(self):
                return {
                    "scan_id": "scan_previous",
                    "quality_drift_artifact": b'{"quality": {"quality_score": 91.5}}',
                }

            def close(self):
                pass

        class FakeConn:
            def cursor(self, *_args, **_kwargs):
                return FakeCursor()

            def close(self):
                pass

        main.get_db = lambda: FakeConn()

        scan_id, artifact = main._load_previous_quality_drift_artifact("https://example.com", "scan_current")

        self.assertEqual(scan_id, "scan_previous")
        self.assertEqual(artifact["quality"]["quality_score"], 91.5)

    def test_persisted_kpi_loader_ignores_type_jsonb_values_without_throwing(self):
        class FakeCursor:
            def execute(self, *_args, **_kwargs):
                pass

            def fetchone(self):
                return {
                    "kpi_json": dict,
                    "top_level_kpis": dict,
                    "quality_drift_artifact": dict,
                }

            def close(self):
                pass

        class FakeConn:
            def cursor(self, *_args, **_kwargs):
                return FakeCursor()

            def close(self):
                pass

        main.get_db = lambda: FakeConn()

        payload = main._load_persisted_kpi_payload("scan_bad_jsonb")

        self.assertIsNone(payload)


if __name__ == "__main__":
    unittest.main()
