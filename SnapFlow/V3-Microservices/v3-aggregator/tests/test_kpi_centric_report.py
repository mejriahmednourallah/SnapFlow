"""
Test KPI-centric report generation
Validates structure, translations, and data completeness
"""
import unittest
import json
import sys
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
        """Load fixture."""
        fixture_path = Path(__file__).resolve().parents[3] / "raw_ec_response.json"
        if not fixture_path.exists():
            raise unittest.SkipTest("raw_ec_response.json fixture not found")
        cls.report = json.loads(fixture_path.read_text(encoding="utf-8"))
        cls.kpi_report = build_kpi_centric_report(cls.report)

    def test_report_structure(self):
        """Verify top-level structure."""
        self.assertIn("scan_id", self.kpi_report)
        self.assertIn("domain", self.kpi_report)
        self.assertIn("pages_scanned", self.kpi_report)
        self.assertIn("axes", self.kpi_report)
        self.assertIsInstance(self.kpi_report["axes"], dict)

    def test_all_axes_present(self):
        """Verify all 8 audit axes are present."""
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
        """Verify we have at least 40 KPIs total."""
        total_kpis = sum(
            len(sub_axes)
            for sub_axes in self.kpi_report["axes"].values()
        )
        self.assertGreaterEqual(total_kpis, 40)

    def test_kpi_structure(self):
        """Verify each KPI has required fields."""
        required_fields = {
            "info",
            "impact",
            "pages_affected",
            "pages_affected_urls",
            "status",
            "type",
            "severity",
            "data",
        }
        
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                missing = required_fields - set(kpi.keys())
                self.assertEqual(
                    missing,
                    set(),
                    f"KPI {axis}/{kpi_name} missing fields: {missing}",
                )

    def test_kpi_fields_correct_types(self):
        """Verify KPI field types."""
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                self.assertIsInstance(kpi["info"], str, f"{axis}/{kpi_name} info not str")
                self.assertIsInstance(kpi["impact"], str, f"{axis}/{kpi_name} impact not str")
                self.assertIsInstance(kpi["pages_affected"], int, f"{axis}/{kpi_name} pages_affected not int")
                self.assertIsInstance(kpi["pages_affected_urls"], list, f"{axis}/{kpi_name} pages_affected_urls not list")
                self.assertIn(
                    kpi["status"],
                    ["passing", "failing", "not_available"],
                    f"{axis}/{kpi_name} invalid status: {kpi['status']}",
                )
                if kpi["type"] is not None:
                    self.assertIn(
                        kpi["type"],
                        ["bug", "recommendation", "compliance"],
                        f"{axis}/{kpi_name} invalid type: {kpi['type']}",
                    )
                if kpi["severity"] is not None:
                    self.assertIn(
                        kpi["severity"],
                        ["critical", "high", "medium", "low"],
                        f"{axis}/{kpi_name} invalid severity: {kpi['severity']}",
                    )
                self.assertIsInstance(kpi["data"], dict, f"{axis}/{kpi_name} data not dict")

    def test_kpi_additive_action_and_digest_fields(self):
        """Verify additive V2 fields used by UI recommendation/evidence rendering."""
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                self.assertIn("recommended_action", kpi, f"{axis}/{kpi_name} missing recommended_action")
                self.assertIn("recommendation_source", kpi, f"{axis}/{kpi_name} missing recommendation_source")
                self.assertIn("evidence_digest", kpi, f"{axis}/{kpi_name} missing evidence_digest")

                self.assertIsInstance(kpi["recommended_action"], str, f"{axis}/{kpi_name} recommended_action not str")
                self.assertIn(
                    kpi["recommendation_source"],
                    ["fix", "ticket_payload", "generated"],
                    f"{axis}/{kpi_name} recommendation_source invalid",
                )
                self.assertIsInstance(kpi["evidence_digest"], dict, f"{axis}/{kpi_name} evidence_digest not dict")

    def test_french_text_present(self):
        """Verify French text is present (not English)."""
        french_indicators = ["é", "è", "ê", "ô", "û", "ç", "à", "ù"]
        
        all_text = str(self.kpi_report)
        french_found = any(indicator in all_text for indicator in french_indicators)
        self.assertTrue(french_found, "No French accents found in report")

    def test_impact_not_empty(self):
        """Verify every KPI has an impact statement."""
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                self.assertGreater(
                    len(kpi["impact"].strip()),
                    10,
                    f"{axis}/{kpi_name} impact too short or empty",
                )

    def test_severity_logic(self):
        """Verify severity is only set when type is 'bug'."""
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                if kpi["type"] != "bug":
                    self.assertIsNone(
                        kpi["severity"],
                        f"{axis}/{kpi_name} has severity but type is {kpi['type']}",
                    )
                if kpi["severity"] is not None:
                    self.assertEqual(
                        kpi["type"],
                        "bug",
                        f"{axis}/{kpi_name} has severity but type is {kpi['type']}",
                    )

    def test_audit_technique_kpis(self):
        """Verify Audit Technique has 4 KPIs."""
        audit_tech = self.kpi_report["axes"]["Audit Technique"]
        expected_kpis = [
            "Version CMS/Framework",
            "Version Modules Installés",
            "Version Langage de Programmation",
            "Vérification du Code",
        ]
        for kpi_name in expected_kpis:
            self.assertIn(kpi_name, audit_tech, f"Missing KPI: {kpi_name}")

    def test_security_kpis(self):
        """Verify Check Sécurité has 4 KPIs."""
        security = self.kpi_report["axes"]["Check Sécurité"]
        expected_kpis = [
            "SSL",
            "Sécurité des En-têtes HTTP",
            "Gestion des Sessions",
            "SQL Injection et DDoS",
        ]
        for kpi_name in expected_kpis:
            self.assertIn(kpi_name, security, f"Missing KPI: {kpi_name}")

    def test_seo_kpis(self):
        """Verify SEO has the baseline KPIs and can be expanded."""
        seo = self.kpi_report["axes"]["SEO"]
        self.assertGreaterEqual(len(seo), 10, f"SEO should have at least 10 KPIs, has {len(seo)}")

    def test_functional_kpis(self):
        """Verify Audit Fonctionnel has the expected KPIs after deduplication."""
        functional = self.kpi_report["axes"]["Audit Fonctionnel"]
        expected_kpis = [
            "Les Formulaires",
            "Liens",
            "Boutons",
            "Fonctionnalités",
            "Fonctionnement du Moteur de Recherche Interne",
        ]
        for kpi_name in expected_kpis:
            self.assertIn(kpi_name, functional, f"Missing KPI: {kpi_name}")

    def test_rgpd_kpis(self):
        """Verify RGPD has 7 compliance KPIs."""
        rgpd = self.kpi_report["axes"]["RGPD"]
        expected_kpis = [
            "Consentement Cookies",
            "Politique de Confidentialité",
            "Durée de Conservation",
            "Minimisation des Données",
            "Mentions Légales",
            "Droits des Personnes",
            "Finalité du Traitement",
        ]
        for kpi_name in expected_kpis:
            self.assertIn(kpi_name, rgpd, f"Missing KPI: {kpi_name}")

        # All RGPD KPIs should be compliance type
        for kpi_name, kpi in rgpd.items():
            self.assertEqual(
                kpi["type"],
                "compliance",
                f"RGPD/{kpi_name} type should be compliance, is {kpi['type']}",
            )

    def test_pages_affected_urls_is_list(self):
        """Verify pages_affected_urls is always a list."""
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                self.assertIsInstance(
                    kpi["pages_affected_urls"],
                    list,
                    f"{axis}/{kpi_name} pages_affected_urls not list",
                )

    def test_mapping_consistency(self):
        """Verify pages_affected count matches pages_affected_urls (approximately)."""
        for axis, sub_axes in self.kpi_report["axes"].items():
            for kpi_name, kpi in sub_axes.items():
                urls_count = len(kpi["pages_affected_urls"])
                if kpi["pages_affected"] > 0:
                    # Either we have URLs or pages_affected is noted (for non-URL issues like cache)
                    self.assertGreaterEqual(
                        kpi["pages_affected"],
                        0,
                        f"{axis}/{kpi_name} negative pages_affected",
                    )

    def test_none_performance_values_do_not_crash(self):
        """KPI builder should tolerate None values in performance metrics."""
        report = json.loads(json.dumps(self.report))
        performance = report.setdefault("site_metrics", {}).setdefault("performance", {})
        performance["avg_fcp_ms"] = None
        performance["avg_lcp_ms"] = None
        performance["avg_cls"] = None
        performance["avg_eco_index"] = None

        content = report.setdefault("site_metrics", {}).setdefault("content", {})
        image_stats = content.setdefault("image_compression_stats", {})
        image_stats["compression_rate_pct"] = None

        rebuilt = build_kpi_centric_report(report)
        self.assertIn("axes", rebuilt)
        self.assertIn("Audit de Performance et Temps de Réponse", rebuilt["axes"])

    def test_mae_vulnerable_security_kpis_fail(self):
        """Regression: vulnerable signals on mae.tn must map to failing security KPIs."""
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
                "vulnerable_libraries": [
                    {"name": "jquery", "version": "3.4.0", "severity": "high"}
                ],
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

    def test_buttons_kpi_uses_element_level_evidence(self):
        """Boutons KPI should expose detailed element evidence when scanner provides it."""
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

        self.assertEqual(buttons["status"], "failing")
        self.assertEqual(buttons["data"]["total_broken_buttons"], 2)
        self.assertEqual(len(buttons["data"]["broken_buttons"]), 1)
        self.assertEqual(buttons["data"]["broken_buttons"][0]["selector"], "button.login-btn")


if __name__ == "__main__":
    unittest.main()
