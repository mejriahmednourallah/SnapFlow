import unittest
import sys
from pathlib import Path
from types import ModuleType

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
psycopg2_extras_stub.RealDictCursor = object
psycopg2_stub.extras = psycopg2_extras_stub
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", psycopg2_extras_stub)

from classifier import classify_report
from main import _build_normalized_kpis


class TestRealScanFixtureRecommendations(unittest.TestCase):
    def test_real_scan_fixture_payload_shape(self):
        root = Path(__file__).resolve().parents[3]
        fixture_path = root / "raw_ec_response.json"
        if not fixture_path.exists():
            self.skipTest("raw_ec_response.json fixture not found")

        import json
        report = json.loads(fixture_path.read_text(encoding="utf-8"))

        rec = classify_report(report)

        self.assertIn("summary", rec)
        self.assertIn("bugs", rec)
        self.assertIn("recommendations", rec)
        self.assertIn("compliance", rec)
        self.assertIn("quick_wins", rec)
        self.assertIn("roadmap", rec)
        self.assertIn("audit_coverage", rec)

        total_arrays = len(rec["bugs"]) + len(rec["recommendations"]) + len(rec["compliance"])
        self.assertEqual(rec["summary"]["total"], total_arrays)

        for bucket in ("bugs", "recommendations", "compliance"):
            for item in rec[bucket]:
                self.assertIn("evidence", item)
                self.assertTrue(isinstance(item["evidence"], list))
                self.assertGreater(len(item["evidence"]), 0)

    def test_real_scan_fixture_normalized_kpis_contract(self):
        root = Path(__file__).resolve().parents[3]
        fixture_path = root / "raw_ec_response.json"
        if not fixture_path.exists():
            self.skipTest("raw_ec_response.json fixture not found")

        import json
        report = json.loads(fixture_path.read_text(encoding="utf-8"))

        kpis = _build_normalized_kpis(report, {})

        self.assertEqual(len(kpis), 55)

        fuzzer_kpi = next((k for k in kpis if k.get("kpi_name") == "Form Fuzzer Robustness"), None)
        self.assertIsNotNone(fuzzer_kpi)

        required = {"kpi_name", "status", "evidence", "type", "axis", "client_impact"}
        valid_statuses = {"passing", "failing", "not_available"}

        for kpi in kpis:
            self.assertTrue(required.issubset(kpi.keys()), kpi.get("kpi_name"))
            self.assertIn(kpi["status"], valid_statuses, kpi.get("kpi_name"))
            self.assertIsInstance(kpi["evidence"], dict, kpi.get("kpi_name"))
            self.assertIn("summary", kpi["evidence"], kpi.get("kpi_name"))

        thin_failures = [
            kpi["kpi_name"]
            for kpi in kpis
            if kpi["status"] == "failing" and set(kpi["evidence"].keys()) <= {"summary", "note"}
        ]
        self.assertEqual(thin_failures, [])


if __name__ == "__main__":
    unittest.main()
