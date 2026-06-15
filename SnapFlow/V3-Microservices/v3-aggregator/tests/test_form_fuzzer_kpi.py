import sys
import unittest
from pathlib import Path
from types import ModuleType

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Allow importing aggregator main without a real psycopg2 install.
psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
psycopg2_extras_stub.RealDictCursor = object
psycopg2_stub.extras = psycopg2_extras_stub
sys.modules.setdefault("psycopg2", psycopg2_stub)
sys.modules.setdefault("psycopg2.extras", psycopg2_extras_stub)

import main


class _FakeCursor:
    def __init__(self, page_rows, summary_row):
        self._page_rows = page_rows
        self._summary_row = summary_row
        self._phase = 0

    def execute(self, query, params=None):
        self._phase += 1

    def fetchall(self):
        if self._phase == 1:
            return self._page_rows
        return []

    def fetchone(self):
        if self._phase == 2:
            return self._summary_row
        return None

    def close(self):
        return None


class _FakeConn:
    def __init__(self, page_rows, summary_row):
        self._page_rows = page_rows
        self._summary_row = summary_row

    def cursor(self, cursor_factory=None):
        return _FakeCursor(self._page_rows, self._summary_row)

    def close(self):
        return None


class TestFormFuzzerKPIInBuildReport(unittest.TestCase):
    def setUp(self):
        self.old_get_db = main.get_db
        self.old_footer = main.evaluate_footer_rgpd_alignment
        self.old_browser = main.evaluate_multi_browser_compatibility
        self.old_table_stats = main._load_form_fuzzer_table_stats

        main.evaluate_footer_rgpd_alignment = lambda *args, **kwargs: {
            "status": "not_evaluated",
            "reason": "disabled_in_test",
        }
        main.evaluate_multi_browser_compatibility = lambda *args, **kwargs: {
            "status": "not_available",
            "reason": "disabled_in_test",
        }

        main.scans["scan_form_fuzzer"] = {
            "scan_id": "scan_form_fuzzer",
            "url": "https://example.com",
            "status": main.ScanStatus.COMPLETE,
            "started_at": 1710000000.0,
            "error": None,
        }

    def tearDown(self):
        main.get_db = self.old_get_db
        main.evaluate_footer_rgpd_alignment = self.old_footer
        main.evaluate_multi_browser_compatibility = self.old_browser
        main._load_form_fuzzer_table_stats = self.old_table_stats
        main.scans.pop("scan_form_fuzzer", None)

    def _minimal_page_row(self):
        return {
            "url": "https://example.com",
            "metrics": {
                "seo": {
                    "score": 90,
                    "meta": {"has_meta_description": True, "title": "Home"},
                    "images_no_alt": 0,
                    "heading_valid": True,
                    "url_clean": True,
                    "has_lazy_images": True,
                    "headings": [{"tag": "h1"}],
                },
                "ux": {
                    "is_readable": True,
                    "issues": [],
                    "has_map": False,
                    "simulator_count": 0,
                    "is_funnel_step": False,
                },
            },
            "nlp_results": {},
        }

    def _page_row_with_null_numeric_metrics(self):
        row = self._minimal_page_row()
        row["metrics"]["seo"].update({
            "images_no_alt": None,
            "node_style_url_count": None,
        })
        row["metrics"]["ux"].update({
            "simulator_count": None,
            "raw_ip_link_count": None,
        })
        row["metrics"]["headless"] = {
            "available": False,
            "fcp_ms": None,
            "lcp_ms": None,
            "invisible_links": None,
            "console_error_count": None,
            "non_functional_button_count": None,
        }
        return row

    def _minimal_summary_row(self, form_fuzzer_summary):
        return {
            "domain": "https://example.com",
            "domain_security": {},
            "domain_tech": {"passed": True, "issues": [], "stack": []},
            "domain_privacy": {},
            "domain_functional": {},
            "image_compression": {},
            "broken_links_summary": {},
            "seo_kpi_extended": {},
            "scan_telemetry": {},
            "form_fuzzer_summary": form_fuzzer_summary,
        }

    def test_uses_summary_when_available(self):
        page_rows = [self._minimal_page_row()]
        summary_row = self._minimal_summary_row({
            "enabled": True,
            "forms_discovered": 6,
            "forms_tested": 4,
            "tests_run": 8,
            "anomalies_found": 2,
            "duration_ms": 321,
            "skipped_reason": "",
        })

        main.get_db = lambda: _FakeConn(page_rows, summary_row)
        main._load_form_fuzzer_table_stats = lambda cur, scan_id: {
            "forms_tested": 99,
            "tests_run": 199,
            "anomalies_count": 88,
            "anomalies_by_type": {"validation_failed": 1},
            "top_findings": [{"type": "validation_failed", "count": 1}],
            "top_affected": [
                {
                    "page_url": "https://example.com/contact",
                    "anomalies": 5,
                }
            ],
        }

        report = main.build_report("scan_form_fuzzer")
        kpi = report["domain_analysis"]["functional_fuzzer_kpi"]
        normalized = next((x for x in report.get("kpis", []) if x.get("kpi_name") == "Form Fuzzer Robustness"), None)

        self.assertEqual(kpi["forms_discovered"], 6)
        self.assertEqual(kpi["total_forms_tested"], 4)
        self.assertEqual(kpi["tests_run"], 8)
        self.assertEqual(kpi["anomalies_count"], 2)
        self.assertEqual(kpi["source"], "summary")
        self.assertFalse(kpi["passed"])
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["status"], "failing")
        self.assertEqual(normalized["evidence"]["detail"]["tests_run"], 8)
        self.assertEqual(kpi["top_affected"][0]["page_url"], "https://example.com/contact")

    def test_null_numeric_page_metrics_do_not_abort_report_build(self):
        page_rows = [self._page_row_with_null_numeric_metrics()]
        summary_row = self._minimal_summary_row({
            "enabled": True,
            "forms_discovered": 0,
            "forms_tested": 0,
            "tests_run": 0,
            "anomalies_found": 0,
            "duration_ms": 0,
            "skipped_reason": "",
        })

        main.get_db = lambda: _FakeConn(page_rows, summary_row)
        main._load_form_fuzzer_table_stats = lambda cur, scan_id: {
            "forms_tested": 0,
            "tests_run": 0,
            "anomalies_count": 0,
            "anomalies_by_type": {},
            "top_findings": [],
            "top_affected": [],
        }

        report = main.build_report("scan_form_fuzzer")

        self.assertEqual(report["site_metrics"]["ux"]["total_invisible_links"], 0)
        self.assertEqual(
            report["site_metrics"]["performance"]["console_error_kpi"]["pages_with_console_errors"],
            0,
        )
        self.assertEqual(
            report["site_metrics"]["performance"]["button_kpi"]["pages_with_nonfunc_buttons"],
            0,
        )

    def test_fallbacks_to_table_when_summary_missing(self):
        page_rows = [self._minimal_page_row()]
        summary_row = self._minimal_summary_row(None)

        main.get_db = lambda: _FakeConn(page_rows, summary_row)
        main._load_form_fuzzer_table_stats = lambda cur, scan_id: {
            "forms_tested": 3,
            "tests_run": 6,
            "anomalies_count": 1,
            "anomalies_by_type": {"validation_failed": 1},
            "top_findings": [{"type": "validation_failed", "count": 1}],
            "top_affected": [
                {
                    "page_url": "https://example.com/contact",
                    "anomalies": 3,
                }
            ],
        }

        report = main.build_report("scan_form_fuzzer")
        kpi = report["domain_analysis"]["functional_fuzzer_kpi"]
        normalized = next((x for x in report.get("kpis", []) if x.get("kpi_name") == "Form Fuzzer Robustness"), None)

        self.assertEqual(kpi["forms_discovered"], 3)
        self.assertEqual(kpi["total_forms_tested"], 3)
        self.assertEqual(kpi["tests_run"], 6)
        self.assertEqual(kpi["anomalies_count"], 1)
        self.assertEqual(kpi["anomalies_by_type"], {"validation_failed": 1})
        self.assertEqual(kpi["source"], "table")
        self.assertFalse(kpi["passed"])
        self.assertIsNotNone(normalized)
        self.assertEqual(normalized["status"], "failing")
        self.assertEqual(normalized["evidence"]["detail"]["source"], "table")
        self.assertEqual(normalized["evidence"]["detail"]["top_affected"][0]["page_url"], "https://example.com/contact")

    def test_valid_responses_without_anomalies_are_exploitable(self):
        summary = {
            "enabled": True,
            "forms_discovered": 5,
            "forms_tested": 2,
            "unique_transactional_forms_detected": 5,
            "unique_transactional_forms_tested": 2,
            "tests_run": 4,
            "responses_received": 4,
            "valid_responses": 4,
            "transport_errors": 0,
            "timeouts": 0,
            "anomalies_found": 0,
        }

        kpi = main._build_functional_fuzzer_kpi({"form_fuzzer_summary": summary}, {})

        self.assertTrue(kpi["passed"])
        self.assertEqual(kpi["status"], "passing")
        self.assertEqual(kpi["valid_responses"], 4)
        self.assertEqual(kpi["data_quality"], "PARTIAL")

    def test_transport_errors_only_are_not_evaluated_with_breakdown(self):
        summary = {
            "enabled": True,
            "forms_discovered": 5,
            "forms_tested": 2,
            "unique_transactional_forms_detected": 5,
            "unique_transactional_forms_tested": 2,
            "tests_run": 4,
            "responses_received": 0,
            "valid_responses": 0,
            "transport_errors": 4,
            "timeouts": 2,
            "anomalies_found": 0,
        }

        kpi = main._build_functional_fuzzer_kpi({"form_fuzzer_summary": summary}, {})

        self.assertIsNone(kpi["passed"])
        self.assertEqual(kpi["status"], "non_evalue")
        self.assertEqual(kpi["failure_reason"], "form_fuzzer_no_usable_responses")
        self.assertEqual(kpi["transport_errors"], 4)
        self.assertEqual(kpi["timeouts"], 2)

    def test_handles_none_headings_without_crash(self):
        row = self._minimal_page_row()
        row["metrics"]["seo"]["headings"] = None
        page_rows = [row]
        summary_row = self._minimal_summary_row(None)

        main.get_db = lambda: _FakeConn(page_rows, summary_row)
        main._load_form_fuzzer_table_stats = lambda cur, scan_id: {
            "forms_tested": 0,
            "tests_run": 0,
            "anomalies_count": 0,
            "anomalies_by_type": {},
            "top_findings": [],
            "top_affected": [],
        }

        report = main.build_report("scan_form_fuzzer")
        self.assertIn("domain_analysis", report)

    def test_nlp_not_evaluated_excluded_from_thin_content(self):
        evaluated_row = self._minimal_page_row()
        evaluated_row["url"] = "https://example.com/evaluated"
        evaluated_row["nlp_results"] = {
            "status": "evaluated",
            "word_count": 120,
            "content_type_hint": "thin",
        }

        not_evaluated_row = self._minimal_page_row()
        not_evaluated_row["url"] = "https://example.com/spa-shell"
        not_evaluated_row["nlp_results"] = {
            "status": "not_evaluated",
            "reason": "spa_shell_not_hydrated",
            "word_count": 0,
            "content_type_hint": "not_evaluated",
        }

        page_rows = [evaluated_row, not_evaluated_row]
        summary_row = self._minimal_summary_row(None)

        main.get_db = lambda: _FakeConn(page_rows, summary_row)
        main._load_form_fuzzer_table_stats = lambda cur, scan_id: {
            "forms_tested": 0,
            "tests_run": 0,
            "anomalies_count": 0,
            "anomalies_by_type": {},
            "top_findings": [],
            "top_affected": [],
        }

        report = main.build_report("scan_form_fuzzer")
        content_metrics = report["site_metrics"]["content"]

        self.assertEqual(content_metrics["pages_thin_content_nlp"], 1)
        self.assertEqual(content_metrics["nlp_not_evaluated_pages"], 1)

    def test_cookie_consent_prechecked_toggles_are_normalized(self):
        row = self._minimal_page_row()
        row["metrics"]["rendered_discovery"] = {
            "consent_banner": {
                "selector": "#cookie-banner",
                "visible": True,
                "text": "Cookie consent banner",
                "has_accept": True,
                "has_reject": True,
                "has_manage": True,
                "reject_symmetry": True,
                "prechecked_toggles": "2",
                "source": "rendered_discovery",
            },
            "network_requests": [],
        }

        page_rows = [row]
        summary_row = self._minimal_summary_row(None)

        main.get_db = lambda: _FakeConn(page_rows, summary_row)
        main._load_form_fuzzer_table_stats = lambda cur, scan_id: {
            "forms_tested": 0,
            "tests_run": 0,
            "anomalies_count": 0,
            "anomalies_by_type": {},
            "top_findings": [],
            "top_affected": [],
        }

        report = main.build_report("scan_form_fuzzer")
        consent = report["domain_analysis"]["privacy"]["cookie_consent"]

        self.assertEqual(consent["prechecked_toggles"], 2)
        self.assertEqual(consent["rows"][0]["prechecked_toggles"], 2)


class TestMultiBrowserFallback(unittest.TestCase):
    def test_http_user_agent_fallback_when_browser_service_fails(self):
        old_post = main.requests.post
        old_get = main.requests.get

        class _FakeGetResponse:
            def __init__(self, url, title):
                self.status_code = 200
                self.url = url
                self.text = f"<html><head><title>{title}</title></head><body></body></html>"

        try:
            def _fake_post(*args, **kwargs):
                raise RuntimeError("chromium_capture_failed: missing dependencies")

            ua_calls = []

            def _fake_get(url, headers=None, timeout=None, allow_redirects=True):
                ua_calls.append((url, headers or {}))
                return _FakeGetResponse(url, "Example Home")

            main.requests.post = _fake_post
            main.requests.get = _fake_get

            result = main.evaluate_multi_browser_compatibility("https://example.com")

            self.assertEqual(result["status"], "not_available")
            self.assertEqual(result.get("fallback"), "http_user_agent")
            self.assertIn("snapshots", result)
            self.assertGreaterEqual(len(ua_calls), 2)
        finally:
            main.requests.post = old_post
            main.requests.get = old_get


if __name__ == "__main__":
    unittest.main()
