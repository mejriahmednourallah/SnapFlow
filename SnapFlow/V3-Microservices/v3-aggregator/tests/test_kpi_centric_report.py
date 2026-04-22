"""
Test KPI-centric report generation
Validates the evidence-driven KPI contract used by the aggregator.
"""
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType

# Stub psycopg2
psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
psycopg2_extras_stub.RealDictCursor = object
psycopg2_stub.extras = psycopg2_extras_stub
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", psycopg2_extras_stub)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kpi_builder import build_kpi_centric_report


class TestKPICentricReport(unittest.TestCase):
    """Test KPI-centric report generation."""

    @classmethod
    def setUpClass(cls):
        fixture_path = Path(__file__).resolve().parents[3] / "raw_ec_response.json"
        if not fixture_path.exists():
            raise unittest.SkipTest("raw_ec_response.json fixture not found")
        cls.report = json.loads(fixture_path.read_text(encoding="utf-8"))
        cls.kpi_report = build_kpi_centric_report(cls.report)

    def test_report_structure(self):
        self.assertIn("scan_id", self.kpi_report)
        self.assertIn("domain", self.kpi_report)
        self.assertIn("pages_scanned", self.kpi_report)
        self.assertIn("summary", self.kpi_report)
        self.assertIn("axes", self.kpi_report)
        self.assertIsInstance(self.kpi_report["axes"], dict)

    def test_all_axes_present(self):
        expected_axes = [
            "Audit Technique",
            "Check Sécurité",
            "Audit Fonctionnel",
            "Audit de Performance et Temps de Réponse",
            "SEO",
            "Audit UX/UI",
            "Eco Index",
            "RGPD",
        ]
        actual_axes = list(self.kpi_report["axes"].keys())
        for axis in expected_axes:
            self.assertIn(axis, actual_axes, f"Missing axis: {axis}")

    def test_kpi_minimum_count(self):
        total_kpis = sum(len(axis_kpis) for axis_kpis in self.kpi_report["axes"].values())
        self.assertGreaterEqual(total_kpis, 40)

    def test_kpi_contract_shape(self):
        required_fields = {
            "kpi_id",
            "name",
            "axis",
            "type",
            "status",
            "severity",
            "confidence",
            "constat",
            "score",
            "impact",
            "evidence",
            "fix",
        }
        legacy_fields = {
            "client_summary",
            "technical_summary",
            "business_impact",
            "recommended_action",
            "recommendation_source",
            "evidence_digest",
            "ticket_payload",
            "metrics",
            "scope",
            "evidence_quality",
        }

        for axis, axis_kpis in self.kpi_report["axes"].items():
            for kpi_name, kpi in axis_kpis.items():
                missing = required_fields - set(kpi.keys())
                self.assertEqual(missing, set(), f"{axis}/{kpi_name} missing fields: {missing}")
                self.assertTrue(legacy_fields.isdisjoint(set(kpi.keys())), f"{axis}/{kpi_name} still exposes legacy fields")

    def test_kpi_field_types_and_values(self):
        for axis, axis_kpis in self.kpi_report["axes"].items():
            for kpi_name, kpi in axis_kpis.items():
                self.assertIsInstance(kpi["kpi_id"], str, f"{axis}/{kpi_name} kpi_id not str")
                self.assertIsInstance(kpi["name"], str, f"{axis}/{kpi_name} name not str")
                self.assertEqual(kpi["axis"], axis, f"{axis}/{kpi_name} axis mismatch")
                self.assertIn(kpi["type"], ["bug", "recommendation", "compliance"], f"{axis}/{kpi_name} invalid type")
                self.assertIn(kpi["status"], ["passing", "failing", "warning", "not_evaluated"], f"{axis}/{kpi_name} invalid status")
                self.assertIn(kpi["confidence"], ["high", "medium", "low"], f"{axis}/{kpi_name} invalid confidence")
                self.assertIsInstance(kpi["constat"], str, f"{axis}/{kpi_name} constat not str")
                self.assertIsInstance(kpi["evidence"], dict, f"{axis}/{kpi_name} evidence not dict")

                if kpi["severity"] is not None:
                    self.assertIn(kpi["severity"], ["critical", "high", "medium", "low"], f"{axis}/{kpi_name} invalid severity")

                if kpi["status"] == "passing":
                    self.assertIsNone(kpi["severity"], f"{axis}/{kpi_name} passing severity should be null")
                    self.assertIsNone(kpi["impact"], f"{axis}/{kpi_name} passing impact should be null")
                    self.assertIsNone(kpi["fix"], f"{axis}/{kpi_name} passing fix should be null")
                    self.assertIsInstance(kpi["score"], int, f"{axis}/{kpi_name} passing score should be int")
                    self.assertGreaterEqual(kpi["score"], 70, f"{axis}/{kpi_name} passing score too low")
                elif kpi["status"] == "warning":
                    self.assertIsNotNone(kpi["severity"], f"{axis}/{kpi_name} warning severity should be set")
                    self.assertIsNotNone(kpi["impact"], f"{axis}/{kpi_name} warning impact missing")
                    self.assertIsNotNone(kpi["fix"], f"{axis}/{kpi_name} warning fix missing")
                    self.assertIsInstance(kpi["score"], int, f"{axis}/{kpi_name} warning score should be int")
                    self.assertGreaterEqual(kpi["score"], 40, f"{axis}/{kpi_name} warning score too low")
                    self.assertLessEqual(kpi["score"], 65, f"{axis}/{kpi_name} warning score too high")
                elif kpi["status"] == "failing":
                    self.assertIsNotNone(kpi["severity"], f"{axis}/{kpi_name} failing severity should be set")
                    self.assertIsNotNone(kpi["impact"], f"{axis}/{kpi_name} failing impact missing")
                    self.assertIsNotNone(kpi["fix"], f"{axis}/{kpi_name} failing fix missing")
                    self.assertIsInstance(kpi["score"], int, f"{axis}/{kpi_name} failing score should be int")
                    self.assertLessEqual(kpi["score"], 50, f"{axis}/{kpi_name} failing score too high")
                else:
                    self.assertIsNone(kpi["severity"], f"{axis}/{kpi_name} not_evaluated severity should be null")
                    self.assertIsNone(kpi["score"], f"{axis}/{kpi_name} not_evaluated score should be null")
                    self.assertIsNotNone(kpi["impact"], f"{axis}/{kpi_name} not_evaluated impact missing")
                    self.assertIsNotNone(kpi["fix"], f"{axis}/{kpi_name} not_evaluated fix missing")

    def test_common_evidence_fields(self):
        for axis, axis_kpis in self.kpi_report["axes"].items():
            for kpi_name, kpi in axis_kpis.items():
                evidence = kpi["evidence"]
                self.assertIn("data_quality", evidence, f"{axis}/{kpi_name} missing evidence.data_quality")
                self.assertIn("detection_source", evidence, f"{axis}/{kpi_name} missing evidence.detection_source")
                self.assertIn("pages_checked", evidence, f"{axis}/{kpi_name} missing evidence.pages_checked")
                self.assertIn("affected_pages", evidence, f"{axis}/{kpi_name} missing evidence.affected_pages")
                self.assertIn(evidence["data_quality"], ["VALID", "PARTIAL", "MISSING"], f"{axis}/{kpi_name} invalid evidence.data_quality")
                self.assertIsInstance(evidence["detection_source"], list, f"{axis}/{kpi_name} detection_source not list")
                self.assertIsInstance(evidence["pages_checked"], int, f"{axis}/{kpi_name} pages_checked not int")
                self.assertIsInstance(evidence["affected_pages"], int, f"{axis}/{kpi_name} affected_pages not int")

    def test_french_text_present(self):
        all_text = json.dumps(self.kpi_report, ensure_ascii=False)
        self.assertTrue(any(ch in all_text for ch in "éèêàçùôï"), "No French accents found in report")

    def test_rgpd_kpis_keep_compliance_type(self):
        for kpi_name, kpi in self.kpi_report["axes"]["RGPD"].items():
            self.assertEqual(kpi["type"], "compliance", f"RGPD/{kpi_name} type should be compliance")

    def test_none_performance_values_do_not_crash(self):
        report = json.loads(json.dumps(self.report))
        performance = report.setdefault("site_metrics", {}).setdefault("performance", {})
        performance["avg_fcp_ms"] = None
        performance["avg_lcp_ms"] = None
        performance["avg_cls"] = None
        performance["avg_eco_index"] = None
        content = report.setdefault("site_metrics", {}).setdefault("content", {})
        content.setdefault("image_compression_stats", {})["compression_rate_pct"] = None

        rebuilt = build_kpi_centric_report(report)
        self.assertIn("axes", rebuilt)
        self.assertIn("Audit de Performance et Temps de Réponse", rebuilt["axes"])

    def test_mae_vulnerable_security_kpis_fail(self):
        report = json.loads(json.dumps(self.report))
        report["domain"] = "https://www.mae.tn/"

        da = report.setdefault("domain_analysis", {})
        da["cms_kpi"] = {
            "server_tech": "Apache",
            "server_version": "2.4.49",
            "passed": False,
            "issues": ["Outdated Apache version detected"],
            "cve_severity": {"critical": 0, "high": 2, "medium": 1, "low": 0},
        }
        da["security"] = {
            "admin_sensitive_page_exposed": {
                "exposed": [],
                "forbidden": ["/admin", "/phpmyadmin"],
                "server_errors": [],
                "status": "warning",
            },
            "version_disclosure_cms": {
                "disclosed": ["/readme.txt"],
                "forbidden": [],
                "server_errors": [],
                "status": "warning",
            },
            "robots_txt_info_disclosure": {
                "disclosed_paths": ["/admin", "/backup"],
                "status": "warning",
            },
            "custom_error_page_info_leak": {
                "leak_indicators": ["Stack trace", "File path"],
                "status": "fail",
            },
            "bruteforced_protection_login": {
                "protected": False,
                "status": "fail",
                "details": "No brute force protection detected",
            },
            "file_upload_extension_control": {
                "restrictions_found": False,
                "issues": [],
                "status": "fail",
            },
            "vulnerable_js_dependencies": {
                "vulnerable_libraries": [{"name": "jquery", "version": "3.4.0", "severity": "high"}],
                "status": "fail",
            },
        }

        rebuilt = build_kpi_centric_report(report)
        security = rebuilt["axes"]["Check Sécurité"]
        audit_tech = rebuilt["axes"]["Audit Technique"]

        self.assertEqual(security["Pages Admin Exposées"]["status"], "passing")
        self.assertEqual(security["Protection Brute Force Login"]["status"], "failing")
        self.assertEqual(audit_tech["Version Langage de Programmation"]["status"], "failing")
        self.assertEqual(security["Divulgation de Version CMS"]["status"], "failing")
        self.assertEqual(security["Fuite d'Information Page d'Erreur"]["status"], "failing")
        self.assertEqual(security["Divulgation d'Information via robots.txt"]["status"], "failing")
        self.assertEqual(security["Contrôle d'Extension Upload Fichier"]["status"], "failing")
        self.assertEqual(security["Dépendances JS Vulnérables (CVE)"]["status"], "failing")

    def test_buttons_kpi_exposes_concrete_button_evidence(self):
        report = json.loads(json.dumps(self.report))
        perf = report.setdefault("site_metrics", {}).setdefault("performance", {})
        perf["button_kpi"] = {
            "pages_with_nonfunc_buttons": 1,
            "total_nonfunc_buttons": 2,
            "broken_buttons": [
                {
                    "url": "https://example.com/login",
                    "label": "Se connecter",
                    "selector": "button.login-btn",
                    "tag": "button",
                    "issue_type": "button_without_action",
                    "href": None,
                    "onclick": "",
                    "form_action": "/login",
                }
            ],
            "passed": False,
        }

        rebuilt = build_kpi_centric_report(report)
        buttons = rebuilt["axes"]["Audit Fonctionnel"]["Boutons"]
        evidence = buttons["evidence"]

        self.assertEqual(buttons["status"], "failing")
        self.assertEqual(evidence["total_broken_buttons"], 2)
        self.assertEqual(len(evidence["broken_buttons_all"]), 1)
        self.assertEqual(evidence["broken_buttons_all"][0]["selector"], "button.login-btn")
        self.assertEqual(evidence["broken_buttons_all"][0]["label_or_text"], "Se connecter")
        self.assertEqual(evidence["broken_buttons_all"][0]["page_url"], "https://example.com/login")
        self.assertIsInstance(evidence["broken_buttons_all"][0]["href"], dict)

    def test_forms_kpi_keeps_full_fuzz_payload_and_status_rules(self):
        report = json.loads(json.dumps(self.report))
        da = report.setdefault("domain_analysis", {})
        da["functional_kpi"] = {"total_forms": 3}
        da["functional_fuzzer_kpi"] = {
            "status": "failing",
            "total_forms_tested": 2,
            "tests_run": 4,
            "anomalies_count": 2,
            "affected_pages": 2,
            "affected_page_urls": [
                "https://example.com/contact",
                "https://example.com/devis",
            ],
            "anomalies_by_type": {"server_error": 1, "validation_bypass": 1},
            "anomalous_tests_all": [
                {
                    "page_url": "https://example.com/contact",
                    "action_url": "https://example.com/api/contact",
                    "form_id": "contact-form",
                    "test_type": "xss_payload",
                    "payload": {"message": "<script>alert(1)</script>"},
                    "response_type": "html",
                    "status_code": 500,
                    "anomaly": "server_error",
                    "anomaly_reason": "500 returned after payload submission",
                    "duration_ms": 421,
                    "error": "",
                }
            ],
        }

        rebuilt = build_kpi_centric_report(report)
        forms = rebuilt["axes"]["Audit Fonctionnel"]["Les Formulaires"]
        evidence = forms["evidence"]

        self.assertEqual(forms["status"], "failing")
        self.assertEqual(evidence["data_quality"], "PARTIAL")
        self.assertEqual(evidence["forms_detected"], 3)
        self.assertEqual(evidence["forms_tested"], 2)
        self.assertEqual(evidence["tests_run"], 4)
        self.assertEqual(evidence["anomalies_count"], 2)
        self.assertEqual(len(evidence["affected_page_urls_all"]), 2)
        self.assertEqual(evidence["anomalous_tests_all"][0]["payload"], {"message": "<script>alert(1)</script>"})

    def test_meta_kpi_returns_full_affected_url_lists(self):
        report = json.loads(json.dumps(self.report))
        seo = report.setdefault("site_metrics", {}).setdefault("seo", {})
        seo["pages_missing_meta_desc"] = 3
        seo["pages_missing_title"] = 2
        report["kpis"] = [
            {
                "kpi_name": "Missing Meta Descriptions",
                "evidence": {
                    "affected_pages": [
                        "https://example.com/a",
                        "https://example.com/b",
                        "https://example.com/c",
                    ]
                },
            },
            {
                "kpi_name": "Missing Page Titles",
                "evidence": {
                    "affected_pages": [
                        "https://example.com/a",
                        "https://example.com/d",
                    ]
                },
            },
        ]

        rebuilt = build_kpi_centric_report(report)
        meta = rebuilt["axes"]["SEO"]["Balises META"]
        evidence = meta["evidence"]

        self.assertEqual(evidence["meta_missing_count"], 3)
        self.assertEqual(evidence["title_missing_count"], 2)
        self.assertEqual(len(evidence["meta_missing_urls_all"]), 3)
        self.assertEqual(len(evidence["title_missing_urls_all"]), 2)
        self.assertEqual(evidence["meta_missing_urls_all"][-1], "https://example.com/c")

    def test_version_kpi_exposes_latest_version_fields(self):
        report = json.loads(json.dumps(self.report))
        da = report.setdefault("domain_analysis", {})
        da["cms_kpi"] = {
            "cms_detected": "WordPress",
            "cms_version": "5.8.0",
            "cms_version_eol": True,
            "module_versions": [],
            "cve_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        }

        rebuilt = build_kpi_centric_report(report)
        cms = rebuilt["axes"]["Audit Technique"]["Version CMS/Framework"]
        evidence = cms["evidence"]

        self.assertEqual(cms["status"], "failing")
        self.assertEqual(evidence["detected_product"], "WordPress")
        self.assertEqual(evidence["detected_version"], "5.8.0")
        self.assertEqual(evidence["support_status"], "end_of_life")
        self.assertEqual(evidence["latest_known_version"], "6.8.1")
        self.assertEqual(evidence["latest_version_source"], "local_catalog_2026_04")
        self.assertEqual(evidence["comparison_result"], "behind_latest")


if __name__ == "__main__":
    unittest.main()
