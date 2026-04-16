import unittest
import sys
from pathlib import Path
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classifier import build_recommendations, classify_report


def _fixture_report() -> dict:
    return {
        "scan_id": "scan_fixture",
        "domain": "https://example.com",
        "pages_scanned": 100,
        "domain_analysis": {
            "security": {"ssl": {"valid": False}},
            "cookie_kpi": {"missing_cookie_flag_count": 2, "passed": False},
            "exposed_path_kpi": {"exposed_paths": ["/.git/HEAD"], "passed": False},
            "cms_kpi": {"cms_version_eol": True, "cms_detected": "Drupal", "cms_version": "9.5"},
            "privacy_kpi": {
                "cookie_consent": {"has_banner": False},
                "has_privacy_policy": False,
                "has_legal_notice": False,
                "has_security_policy": False,
                "has_declared_purpose": False,
            },
        },
        "site_metrics": {
            "seo": {
                "pages_missing_meta_desc": 30,
                "node_style_url_count": 9,
                "duplicate_content_kpi": {"duplicate_content_rate_pct": 12.0, "duplicate_page_count": 12},
                "images_missing_alt": 18,
                "pages_without_lazy_loading": 40,
                "pages_with_bad_h1": 4,
                "homepage_h1_kpi": {"homepage_h1_missing": True},
                "pages_missing_title": 3,
                "broken_link_kpi": {
                    "broken_link_count": 7,
                    "broken_links": [
                        {"url": "https://example.com/bad", "found_on": "https://example.com/a"},
                        {"url": "https://example.com/bad2", "found_on": "https://example.com/b"},
                    ],
                },
            },
            "ux": {
                "pages_with_low_text_density": 6,
                "pages_missing_contextual_links": 10,
                "plain_email_kpi": {"pages_with_plain_emails": 2, "passed": False},
                "raw_ip_link_kpi": {"total_raw_ip_links": 3, "pages_with_raw_ip_links": 2, "passed": False},
            },
            "performance": {
                "gateway_timeout_count": 2,
                "console_error_kpi": {"homepage_console_error_count": 4},
                "button_kpi": {"pages_with_nonfunc_buttons": 5},
                "avg_fcp_ms": 3500,
                "mobile_kpi": {"lcp_ms": 5200, "cls": 0.31},
            },
            "content": {
                "pages_thin_content_nlp": 11,
                "pages_with_keyword_stuffing": 8,
                "cannibalized_keywords": [{"keyword_stem": "audit", "count": 6}],
                "rgpd_retention_signal_pages": 0,
                "rgpd_minimization_signal_pages": 0,
            },
        },
        "image_compression": {
            "sampled_images": 50,
            "unoptimised_count": 15,
        },
    }


class TestClassifier(unittest.TestCase):
    def test_structure_and_summary_consistency(self):
        rec = classify_report(_fixture_report())
        self.assertIn("bugs", rec)
        self.assertIn("recommendations", rec)
        self.assertIn("compliance", rec)
        self.assertIn("quick_wins", rec)
        self.assertIn("roadmap", rec)
        self.assertIn("audit_coverage", rec)
        self.assertTrue(isinstance(rec["audit_coverage"], list))
        self.assertGreater(len(rec["audit_coverage"]), 0)

        total_arrays = len(rec["bugs"]) + len(rec["recommendations"]) + len(rec["compliance"])
        self.assertEqual(rec["summary"]["total"], total_arrays)

        for bucket in ("bugs", "recommendations", "compliance"):
            for item in rec[bucket]:
                self.assertTrue(bool(item.get("source_kpi")))
                self.assertIn("evidence", item)
                self.assertTrue(isinstance(item["evidence"], list))
                self.assertGreater(len(item["evidence"]), 0)

    def test_quick_wins_rule(self):
        rec = classify_report(_fixture_report())
        self.assertLessEqual(len(rec["quick_wins"]), 5)
        for item in rec["quick_wins"]:
            self.assertNotEqual(item["type"], "COMPLIANCE")
            self.assertEqual(item["effort"], "LOW")
            self.assertIn(item["severity"], {"HIGH", "CRITICAL"})

    def test_roadmap_immediate_only_critical(self):
        rec = classify_report(_fixture_report())
        for item in rec["roadmap"]["immediate"]:
            self.assertEqual(item["severity"], "CRITICAL")

    def test_deterministic_for_same_scan_meta(self):
        def fake_builder(_scan_id: str):
            return _fixture_report()

        scan_meta = {"started_at": 1710000000.0}
        r1 = build_recommendations("scan_fixture", report_builder=fake_builder, scan_meta=scan_meta)
        r2 = build_recommendations("scan_fixture", report_builder=fake_builder, scan_meta=scan_meta)
        self.assertEqual(r1, r2)

    def test_perf_classification_under_500ms_on_large_fixture(self):
        base = _fixture_report()
        # Inflate list-like sections to approximate a heavy scan payload.
        base["site_metrics"]["seo"]["broken_link_kpi"]["broken_links"] = [
            {"url": f"https://example.com/broken-{i}", "found_on": f"https://example.com/page-{i % 150}"}
            for i in range(1500)
        ]
        base["site_metrics"]["content"]["cannibalized_keywords"] = [
            {"keyword_stem": f"kw{i}", "count": 5 + (i % 10)} for i in range(400)
        ]

        t0 = time.perf_counter()
        rec = classify_report(base)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        self.assertIn("summary", rec)
        self.assertLess(
            elapsed_ms,
            500.0,
            msg=f"Classification took {elapsed_ms:.2f}ms, expected < 500ms",
        )


if __name__ == "__main__":
    unittest.main()
