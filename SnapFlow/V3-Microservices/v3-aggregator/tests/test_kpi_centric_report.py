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

from kpi_builder import _build_curated_evidence_digest, build_kpi_centric_report


class TestKPICentricReport(unittest.TestCase):
    """Test KPI-centric report generation."""

    @classmethod
    def setUpClass(cls):
        fixture_path = Path(__file__).resolve().parents[3] / "raw_ec_response.json"
        if not fixture_path.exists():
            raise unittest.SkipTest("raw_ec_response.json fixture not found")
        cls.report = json.loads(fixture_path.read_text(encoding="utf-8"))
        cls.kpi_report = build_kpi_centric_report(cls.report)

    def _find_kpi(self, kpi_report: dict, kpi_id: str) -> dict:
        for axis_kpis in kpi_report.get("axes", {}).values():
            for kpi in axis_kpis.values():
                if isinstance(kpi, dict) and kpi.get("kpi_id") == kpi_id:
                    return kpi
        self.fail(f"KPI not found: {kpi_id}")

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
            "evidence_digest",
            "fix",
        }
        legacy_fields = {
            "client_summary",
            "technical_summary",
            "business_impact",
            "recommended_action",
            "recommendation_source",
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
                self.assertIsInstance(kpi["evidence_digest"], dict, f"{axis}/{kpi_name} evidence_digest not dict")

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

    def test_curated_evidence_digest_contract(self):
        for axis, axis_kpis in self.kpi_report["axes"].items():
            for kpi_name, kpi in axis_kpis.items():
                digest = kpi["evidence_digest"]
                self.assertIn("quality", digest, f"{axis}/{kpi_name} missing digest.quality")
                self.assertIn("proof_lines", digest, f"{axis}/{kpi_name} missing digest.proof_lines")
                self.assertIn("rows", digest, f"{axis}/{kpi_name} missing digest.rows")
                self.assertIn("urls", digest, f"{axis}/{kpi_name} missing digest.urls")
                self.assertIn("csv_columns", digest, f"{axis}/{kpi_name} missing digest.csv_columns")
                self.assertIn("csv_rows", digest, f"{axis}/{kpi_name} missing digest.csv_rows")
                self.assertIn(digest["quality"], ["VALID", "PARTIAL", "MISSING"], f"{axis}/{kpi_name} invalid digest.quality")
                self.assertIsInstance(digest["proof_lines"], list, f"{axis}/{kpi_name} proof_lines not list")
                self.assertIsInstance(digest["rows"], list, f"{axis}/{kpi_name} rows not list")
                self.assertIsInstance(digest["urls"], list, f"{axis}/{kpi_name} urls not list")
                self.assertIsInstance(digest["csv_columns"], list, f"{axis}/{kpi_name} csv_columns not list")
                self.assertIsInstance(digest["csv_rows"], list, f"{axis}/{kpi_name} csv_rows not list")
                rendered = json.dumps(digest, ensure_ascii=False)
                self.assertNotIn("<script>alert(1)</script>", rendered, f"{axis}/{kpi_name} exposes dangerous payload")
                if digest["quality"] == "MISSING":
                    self.assertEqual(kpi["status"], "not_evaluated", f"{axis}/{kpi_name} missing evidence should be not_evaluated")
                    self.assertIn("missing_reason", digest, f"{axis}/{kpi_name} missing digest.missing_reason")

    def test_performance_digest_counts_only_valid_measurements(self):
        rows = [
            {"url": "https://example.test/ok-1", "available": True, "fcp_ms": 1200, "lcp_ms": 1800},
            {"url": "https://example.test/ok-2", "available": "oui", "fcp_ms": 1300, "lcp_ms": 1900},
        ]
        rows.extend(
            {"url": f"https://example.test/fail-{idx}", "available": "non", "fcp_ms": None, "lcp_ms": None, "measurement_status": "zero_metrics"}
            for idx in range(98)
        )

        digest = _build_curated_evidence_digest(
            "perf_desktop_speed",
            "Temps de Chargement Desktop",
            "failing",
            {"data_quality": "PARTIAL", "pages_checked": 2},
            {"data": {"rows": rows}},
            "https://example.test",
        )

        self.assertIn("Pages testees: 2, mesures valides: 2", digest["proof_lines"])
        self.assertEqual(len(digest["rows"]), 2)

    def test_seo_meta_nlp_does_not_reown_missing_meta_descriptions(self):
        report = json.loads(json.dumps(self.report))
        seo = report.setdefault("site_metrics", {}).setdefault("seo", {})
        seo["nlp_seo_meta_kpi"] = {
            "meta_missing_pages": 51,
            "meta_missing_owned_by": "seo_meta_tags",
            "meta_quality_issue_pages": 0,
            "title_too_long_pages": 0,
            "rows": [
                {"page_url": "https://example.test/a", "issue": "meta_missing"},
            ],
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = self._find_kpi(rebuilt, "seo_meta_nlp")

        self.assertEqual(kpi["status"], "passing")
        self.assertEqual(kpi["evidence"]["meta_missing_owned_by"], "seo_meta_tags")
        self.assertEqual(kpi["evidence_digest"]["rows"], [])

    def test_row_required_issue_without_rows_becomes_not_evaluated(self):
        report = json.loads(json.dumps(self.report))
        report.setdefault("domain_analysis", {}).setdefault("security", {})["vulnerable_js_dependencies"] = {
            "status": "fail",
            "vulnerable_count": 1,
            "vulnerable_libraries": [],
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = self._find_kpi(rebuilt, "sec_js_deps")

        self.assertEqual(kpi["status"], "not_evaluated")
        self.assertEqual(kpi["evidence_digest"]["quality"], "MISSING")
        self.assertIn("missing_reason", kpi["evidence_digest"])

    def test_search_detection_without_execution_is_not_evaluated(self):
        report = json.loads(json.dumps(self.report))
        report.setdefault("domain_analysis", {}).setdefault("functional_kpi", {})["has_search"] = True

        rebuilt = build_kpi_centric_report(report)
        kpi = self._find_kpi(rebuilt, "func_search")

        self.assertEqual(kpi["status"], "not_evaluated")
        self.assertEqual(kpi["evidence_digest"]["quality"], "MISSING")

    def test_search_non_executed_row_is_not_treated_as_execution(self):
        report = json.loads(json.dumps(self.report))
        functional = report.setdefault("domain_analysis", {}).setdefault("functional_kpi", {})
        functional["has_search"] = True
        functional["search_executed"] = False
        functional["search_tests"] = [{
            "search_url": "https://example.com/search?q=snapflow-test",
            "query": "snapflow-test",
            "status": "not_executed",
            "result_behavior": "",
            "details": "Search form method is not GET; safe backend probe skipped",
            "executed": False,
        }]

        rebuilt = build_kpi_centric_report(report)
        kpi = self._find_kpi(rebuilt, "func_search")

        self.assertEqual(kpi["status"], "not_evaluated")
        self.assertEqual(kpi["evidence_digest"]["quality"], "MISSING")

    def test_search_executed_probe_can_pass_with_rows(self):
        report = json.loads(json.dumps(self.report))
        functional = report.setdefault("domain_analysis", {}).setdefault("functional_kpi", {})
        functional["has_search"] = True
        functional["search_executed"] = True
        functional["search_passed"] = True
        functional["search_tests"] = [{
            "search_url": "https://example.com/search?q=snapflow-test",
            "query": "snapflow-test",
            "status": "passed",
            "status_code": 200,
            "result_behavior": "search_response",
            "executed": True,
        }]

        rebuilt = build_kpi_centric_report(report)
        kpi = self._find_kpi(rebuilt, "func_search")

        self.assertEqual(kpi["status"], "passing")
        self.assertEqual(kpi["evidence_digest"]["quality"], "VALID")
        self.assertTrue(kpi["evidence_digest"]["rows"])

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

    def test_internal_linking_sitewide_zero_contextual_is_downgraded_to_warning(self):
        report = json.loads(json.dumps(self.report))
        metrics = report.setdefault("site_metrics", {})
        metrics.setdefault("seo", {}).update({
            "total_internal_links": 6105,
            "total_contextual_internal_links": 0,
            "internal_linking_source": "seo_summary",
            "contextual_link_measurement": {
                "pages_checked": 112,
                "reliable_coverage_pct": 100.0,
            },
        })
        metrics.setdefault("ux", {}).update({
            "pages_missing_contextual_links": 112,
        })

        rebuilt = build_kpi_centric_report(report)
        linking = rebuilt["axes"]["SEO"]["Linking Interne"]

        self.assertEqual(linking["status"], "warning")
        self.assertEqual(linking["evidence"]["data_quality"], "PARTIAL")
        self.assertIn("qualité de données", linking["constat"])

    def test_mobile_status_ignores_zero_fcp_when_other_metrics_are_good(self):
        report = json.loads(json.dumps(self.report))
        perf = report.setdefault("site_metrics", {}).setdefault("performance", {})
        perf["mobile_kpi"] = {
            "available": True,
            "passed": None,
            "fcp_ms": 0,
            "lcp_ms": 1400,
            "cls": 0.01,
            "issues": [],
        }

        rebuilt = build_kpi_centric_report(report)
        mobile = rebuilt["axes"]["Audit de Performance et Temps de Réponse"]["Temps de Chargement Mobile"]

        self.assertEqual(mobile["status"], "passing")

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

    def test_service_exposure_kpi_disabled_maps_to_not_evaluated(self):
        report = json.loads(json.dumps(self.report))
        sec = report.setdefault("domain_analysis", {}).setdefault("security", {})
        sec["service_exposure"] = {
            "enabled": False,
            "status": "non_evalue",
            "severity": "info",
            "impact": "Port scan disabled by policy.",
            "warning": "Set ENABLE_PORT_SCAN=true to enable TCP reachability checks on monitored ports.",
            "open_services": [],
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = rebuilt["axes"]["Check Sécurité"]["Exposition Services Reseau"]
        evidence = kpi["evidence"]

        self.assertEqual(kpi["kpi_id"], "sec_service_exposure")
        self.assertEqual(kpi["status"], "not_evaluated")
        self.assertIsNone(kpi["severity"])
        self.assertFalse(evidence["enabled"])
        self.assertIn("tcp_probe", evidence["detection_source"])

    def test_service_exposure_kpi_critical_open_ports_fails(self):
        report = json.loads(json.dumps(self.report))
        sec = report.setdefault("domain_analysis", {}).setdefault("security", {})
        sec["service_exposure"] = {
            "enabled": True,
            "host": "example.com",
            "timeout_ms": 900,
            "ports_scanned": [22, 3306],
            "status": "fail",
            "severity": "critical",
            "impact": "Critical service exposure detected.",
            "open_services": [
                {"port": 22, "service": "SSH", "state": "open", "risk": "high"},
                {"port": 3306, "service": "MySQL", "state": "open", "risk": "critical"},
            ],
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = rebuilt["axes"]["Check Sécurité"]["Exposition Services Reseau"]
        evidence = kpi["evidence"]

        self.assertEqual(kpi["status"], "failing")
        self.assertEqual(kpi["severity"], "critical")
        self.assertEqual(evidence["open_service_count"], 2)
        self.assertEqual(evidence["critical_open_service_count"], 1)
        self.assertEqual(evidence["high_open_service_count"], 1)
        self.assertIsNotNone(kpi["fix"])

    def test_service_exposure_kpi_pass_with_no_open_services(self):
        report = json.loads(json.dumps(self.report))
        sec = report.setdefault("domain_analysis", {}).setdefault("security", {})
        sec["service_exposure"] = {
            "enabled": True,
            "host": "example.com",
            "timeout_ms": 900,
            "ports_scanned": [22, 443, 3306],
            "status": "pass",
            "severity": "low",
            "impact": "No monitored risky ports were reachable.",
            "open_services": [],
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = rebuilt["axes"]["Check Sécurité"]["Exposition Services Reseau"]
        evidence = kpi["evidence"]

        self.assertEqual(kpi["status"], "passing")
        self.assertIsNone(kpi["severity"])
        self.assertEqual(evidence["open_service_count"], 0)
        self.assertEqual(evidence["host"], "example.com")

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

    def test_module_versions_detected_but_unverified_are_not_passing(self):
        report = json.loads(json.dumps(self.report))
        da = report.setdefault("domain_analysis", {})
        da["cms_kpi"] = {
            "cms_detected": "Drupal",
            "cms_version": "10",
            "cms_version_eol": False,
            "module_versions": [
                {"name": "UnknownModule", "version": "1.2.3", "source": "script_src"},
            ],
            "cve_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = rebuilt["axes"]["Audit Technique"]["Version Modules Installés"]
        evidence = kpi["evidence"]

        self.assertEqual(kpi["status"], "not_evaluated")
        self.assertIsNone(kpi["severity"])
        self.assertEqual(evidence["module_count"], 1)
        self.assertEqual(evidence["uncertain_module_count"], 1)
        self.assertEqual(evidence["module_version_rows"][0]["verification_result"], "non_verifie")

    def test_risky_module_version_fails_with_proof_rows(self):
        report = json.loads(json.dumps(self.report))
        da = report.setdefault("domain_analysis", {})
        da["cms_kpi"] = {
            "cms_detected": "Drupal",
            "cms_version": "10",
            "cms_version_eol": False,
            "module_versions": [
                {"name": "jQuery", "version": "1.12.4", "source": "script_src"},
            ],
            "cve_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0},
        }

        rebuilt = build_kpi_centric_report(report)
        kpi = rebuilt["axes"]["Audit Technique"]["Version Modules Installés"]

        self.assertEqual(kpi["status"], "failing")
        self.assertEqual(kpi["severity"], "high")
        self.assertEqual(kpi["evidence"]["risky_module_count"], 1)
        self.assertEqual(kpi["evidence"]["module_version_rows"][0]["verification_result"], "risque_confirme")


if __name__ == "__main__":
    unittest.main()
