"""
Phase M+N tests — aggregator report assembly + UX / RGPD checklists
Completely self-contained (stdlib only). The two checklist builder functions
are duplicated inline so no psycopg2 / DB connection is required.
Run:  python V3-Microservices/v3-aggregator/tests/test_phase_mn.py
"""
import sys
import unittest

# ── Inline build_ux_checklist (Phase N-1) ────────────────────────────────────

def build_ux_checklist(site_metrics: dict, pages_count: int) -> list:
    ux   = site_metrics.get("ux", {})
    perf = site_metrics.get("performance", {})

    missing_product_imgs = ux.get("pages_with_missing_product_images", 0)
    low_text_pages       = ux.get("pages_with_low_text_density", 0)
    raw_ip_kpi           = ux.get("raw_ip_link_kpi", {})
    email_kpi            = ux.get("plain_email_kpi", {})
    missing_links        = ux.get("pages_missing_contextual_links", 0)
    maps                 = ux.get("pages_with_maps", 0)
    simulators           = ux.get("simulator_count", 0)
    funnels              = ux.get("pages_with_conversion_funnels", 0)
    button_kpi           = perf.get("button_kpi", {})
    console_kpi          = perf.get("console_error_kpi", {})

    return [
        {"item": "Product cards all have images",
         "passed": missing_product_imgs == 0,
         "evidence": f"{missing_product_imgs} page(s) have product cards missing images"
                     if missing_product_imgs else "All product card images present"},
        {"item": "No low-content pages",
         "passed": low_text_pages == 0,
         "evidence": f"{low_text_pages} page(s) have insufficient text density"
                     if low_text_pages else "All pages have adequate text density"},
        {"item": "No raw IP address links",
         "passed": raw_ip_kpi.get("passed", True),
         "evidence": f"{raw_ip_kpi.get('total_raw_ip_links', 0)} raw IP link(s) found"
                     if not raw_ip_kpi.get("passed", True) else "No raw IP address links found"},
        {"item": "No plain email addresses exposed",
         "passed": email_kpi.get("passed", True),
         "evidence": f"Plain emails found: {email_kpi.get('plain_emails_found', [])}"
                     if not email_kpi.get("passed", True) else "No plain email addresses found"},
        {"item": "Contextual internal links present",
         "passed": missing_links < max(pages_count, 1),
         "evidence": f"{missing_links} page(s) lack contextual internal links"
                     if missing_links > 0 else "Contextual internal links found on all pages"},
        {"item": "Map / location widget present",
         "passed": maps > 0,
         "evidence": f"Map widget found on {maps} page(s)" if maps > 0 else "No map widget detected"},
        {"item": "Simulator / calculator present",
         "passed": simulators > 0,
         "evidence": f"Simulator found on {simulators} page(s)" if simulators > 0 else "No simulator detected"},
        {"item": "Conversion funnel page present",
         "passed": funnels > 0,
         "evidence": f"Funnel page found on {funnels} page(s)" if funnels > 0 else "No conversion funnel detected"},
        {"item": "Text / content ratio adequate across pages",
         "passed": low_text_pages == 0,
         "evidence": f"{low_text_pages} page(s) have low text-to-HTML ratio"
                     if low_text_pages else "All pages have adequate content ratio"},
        {"item": "No non-functional buttons",
         "passed": button_kpi.get("passed", True),
         "evidence": f"{button_kpi.get('pages_with_nonfunc_buttons', 0)} page(s) have non-functional buttons"
                     if not button_kpi.get("passed", True) else "All detected buttons appear functional"},
        {"item": "No JavaScript console errors on homepage",
         "passed": console_kpi.get("homepage_console_error_count", 0) == 0,
         "evidence": f"{console_kpi.get('homepage_console_error_count', 0)} console error(s)"
                     if console_kpi.get("homepage_console_error_count", 0) > 0
                     else "Homepage has no console errors"},
    ]


# ── Inline build_rgpd_checklist (Phase N-2) ──────────────────────────────────

def build_rgpd_checklist(domain_analysis: dict) -> list:
    priv_kpi   = domain_analysis.get("privacy_kpi", {})
    priv_raw   = domain_analysis.get("privacy", {})
    cookie_kpi = domain_analysis.get("cookie_kpi", {})
    exp_kpi    = domain_analysis.get("exposed_path_kpi", {})

    consent_raw = priv_kpi.get("cookie_consent", {})
    if isinstance(consent_raw, dict):
        has_consent_banner = consent_raw.get("has_banner", consent_raw.get("present", False))
    else:
        has_consent_banner = bool(consent_raw)

    rgpd_keywords_raw = priv_raw.get("rgpd_keywords", []) or []
    rgpd_keywords_found = [k for k in rgpd_keywords_raw if isinstance(k, dict) and k.get("found", False)]
    rgpd_keywords_found_names = [k.get("keyword", "") for k in rgpd_keywords_found]

    return [
        {"item": "Cookie consent banner present",
         "passed": bool(has_consent_banner),
         "evidence": "Cookie consent banner detected" if has_consent_banner
                     else "No cookie consent banner found"},
        {"item": "Privacy policy link present",
         "passed": bool(priv_kpi.get("has_privacy_policy")),
         "evidence": "Privacy policy link found" if priv_kpi.get("has_privacy_policy")
                     else "No privacy policy link detected"},
        {"item": "Legal notice link present",
         "passed": bool(priv_kpi.get("has_legal_notice")),
         "evidence": "Legal notice link found" if priv_kpi.get("has_legal_notice")
                     else "No legal notice link detected"},
        {"item": "Cookie policy link present",
         "passed": bool(priv_kpi.get("has_cookie_policy")),
         "evidence": "Cookie policy link found" if priv_kpi.get("has_cookie_policy")
                     else "No cookie policy link detected"},
        {"item": "Security policy (PSSI) link present",
         "passed": bool(priv_kpi.get("has_security_policy")),
         "evidence": "Security policy link found" if priv_kpi.get("has_security_policy")
                     else "No security policy link detected"},
        {"item": "Data subject rights (information rights) mentioned",
         "passed": bool(priv_kpi.get("has_information_rights")),
         "evidence": "Information rights language found" if priv_kpi.get("has_information_rights")
                     else "No information rights language detected"},
        {"item": "Consent checkbox present on forms",
         "passed": bool(priv_kpi.get("has_consent_checkbox")),
         "evidence": "Consent checkbox detected on form(s)" if priv_kpi.get("has_consent_checkbox")
                     else "No consent checkbox detected"},
        {"item": "RGPD / GDPR keywords present on privacy page",
         "passed": len(rgpd_keywords_found) > 3,
         "evidence": (
             f"RGPD rights keywords confirmed: {rgpd_keywords_found_names[:5]}"
             if len(rgpd_keywords_found) > 3
             else f"Only {len(rgpd_keywords_found)} RGPD rights keyword(s) confirmed present "
                  f"(need > 3). Checked: {[k.get('keyword') for k in rgpd_keywords_raw[:5]]}"
         )},
        {"item": "No tracking scripts without explicit consent",
         "passed": not bool(priv_raw.get("tracking_without_consent", False)),
         "evidence": "No tracking scripts without consent detected"
                     if not priv_raw.get("tracking_without_consent", False)
                     else "Tracking scripts without consent detected"},
        {"item": "All cookies have HttpOnly + Secure flags",
         "passed": bool(cookie_kpi.get("passed", True)),
         "evidence": f"{cookie_kpi.get('missing_cookie_flag_count', 0)} cookie(s) missing flags"
                     if not cookie_kpi.get("passed", True) else "All cookies have required security flags"},
        {"item": "No exposed sensitive paths (Google Dorks)",
         "passed": bool(exp_kpi.get("passed", True)),
         "evidence": f"{exp_kpi.get('google_dorks_vuln_count', 0)} exposed path(s)"
                     if not exp_kpi.get("passed", True) else "No sensitive paths exposed"},
    ]


# ── Fixture factories ─────────────────────────────────────────────────────────

def _clean_site_metrics(pages=5):
    """All UX/perf fields indicate a healthy site."""
    return {
        "ux": {
            "pages_with_missing_product_images": 0,
            "pages_with_low_text_density": 0,
            "raw_ip_link_kpi": {"passed": True, "total_raw_ip_links": 0, "pages_with_raw_ip_links": 0},
            "plain_email_kpi": {"passed": True, "plain_emails_found": [], "pages_with_plain_emails": 0},
            "pages_missing_contextual_links": 0,
            "pages_with_maps": 1,
            "simulator_count": 1,
            "pages_with_conversion_funnels": 1,
        },
        "performance": {
            "button_kpi": {"passed": True, "pages_with_nonfunc_buttons": 0},
            "console_error_kpi": {
                "passed": True,
                "pages_with_console_errors": 0,
                "homepage_console_error_count": 0,
                "homepage_console_errors": [],
            },
        },
    }


def _clean_domain_analysis():
    """All RGPD / cookie fields indicate a compliant site."""
    return {
        "privacy_kpi": {
            "has_privacy_policy": True,
            "has_legal_notice": True,
            "has_cookie_policy": True,
            "has_security_policy": True,
            "has_information_rights": True,
            "has_consent_checkbox": True,
            "cookie_consent": {"has_banner": True},
            "passed": True,
        },
        "privacy": {
            "rgpd_keywords": [
                {"keyword": "droit d'accès", "found": True},
                {"keyword": "droit de rectification", "found": True},
                {"keyword": "droit à l'effacement", "found": True},
                {"keyword": "consentement", "found": True},
                {"keyword": "RGPD", "found": True},
                {"keyword": "données personnelles", "found": False},  # not found, should not count
            ],
            "tracking_without_consent": False,
        },
        "cookie_kpi": {
            "passed": True,
            "missing_cookie_flag_count": 0,
            "cookies_with_missing_flags": [],
        },
        "exposed_path_kpi": {
            "passed": True,
            "google_dorks_vuln_count": 0,
            "exposed_paths": [],
        },
    }


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestUXChecklistStructure(unittest.TestCase):
    """Shape and contract of the UX checklist output."""

    def setUp(self):
        self.checklist = build_ux_checklist(_clean_site_metrics(), pages_count=5)

    def test_returns_11_items(self):
        self.assertEqual(len(self.checklist), 11)

    def test_each_item_has_required_keys(self):
        for item in self.checklist:
            with self.subTest(item=item["item"]):
                self.assertIn("item", item)
                self.assertIn("passed", item)
                self.assertIn("evidence", item)

    def test_passed_is_bool(self):
        for item in self.checklist:
            self.assertIsInstance(item["passed"], bool)

    def test_evidence_is_str(self):
        for item in self.checklist:
            self.assertIsInstance(item["evidence"], str)

    def test_all_pass_on_clean_site(self):
        failing = [i["item"] for i in self.checklist if not i["passed"]]
        self.assertEqual(failing, [], msg=f"Unexpected failures: {failing}")


class TestUXChecklistFails(unittest.TestCase):
    """Individual UX checklist items detect failures correctly."""

    def _metrics(self, **overrides):
        sm = _clean_site_metrics()
        for k, v in overrides.items():
            # allow nested ux/perf overrides via "ux__key" notation
            if "__" in k:
                section, key = k.split("__", 1)
                sm[section][key] = v
            else:
                sm[k] = v
        return sm

    def test_product_images_fail(self):
        sm = self._metrics()
        sm["ux"]["pages_with_missing_product_images"] = 3
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "Product cards" in i["item"])
        self.assertFalse(item["passed"])
        self.assertIn("3", item["evidence"])

    def test_low_content_fail(self):
        sm = self._metrics()
        sm["ux"]["pages_with_low_text_density"] = 2
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "low-content" in i["item"])
        self.assertFalse(item["passed"])

    def test_raw_ip_fail(self):
        sm = self._metrics()
        sm["ux"]["raw_ip_link_kpi"] = {"passed": False, "total_raw_ip_links": 4, "pages_with_raw_ip_links": 2}
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "raw IP" in i["item"])
        self.assertFalse(item["passed"])

    def test_plain_email_fail(self):
        sm = self._metrics()
        sm["ux"]["plain_email_kpi"] = {"passed": False, "plain_emails_found": ["a@b.com"], "pages_with_plain_emails": 1}
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "plain email" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_map_fail(self):
        sm = self._metrics()
        sm["ux"]["pages_with_maps"] = 0
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "Map" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_simulator_fail(self):
        sm = self._metrics()
        sm["ux"]["simulator_count"] = 0
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "Simulator" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_funnel_fail(self):
        sm = self._metrics()
        sm["ux"]["pages_with_conversion_funnels"] = 0
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "funnel" in i["item"].lower())
        self.assertFalse(item["passed"])

    def test_nonfunc_button_fail(self):
        sm = self._metrics()
        sm["performance"]["button_kpi"] = {"passed": False, "pages_with_nonfunc_buttons": 1}
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "non-functional buttons" in i["item"])
        self.assertFalse(item["passed"])

    def test_console_errors_fail(self):
        sm = self._metrics()
        sm["performance"]["console_error_kpi"] = {
            "passed": False,
            "pages_with_console_errors": 1,
            "homepage_console_error_count": 2,
            "homepage_console_errors": ["TypeError: foo", "ReferenceError: bar"],
        }
        cl = build_ux_checklist(sm, 5)
        item = next(i for i in cl if "console errors" in i["item"].lower())
        self.assertFalse(item["passed"])
        self.assertIn("2", item["evidence"])


class TestRGPDChecklistStructure(unittest.TestCase):
    """Shape and contract of the RGPD checklist output."""

    def setUp(self):
        self.checklist = build_rgpd_checklist(_clean_domain_analysis())

    def test_returns_11_items(self):
        self.assertEqual(len(self.checklist), 11)

    def test_each_item_has_required_keys(self):
        for item in self.checklist:
            with self.subTest(item=item["item"]):
                self.assertIn("item", item)
                self.assertIn("passed", item)
                self.assertIn("evidence", item)

    def test_passed_is_bool(self):
        for item in self.checklist:
            self.assertIsInstance(item["passed"], bool)

    def test_all_pass_on_compliant_site(self):
        failing = [i["item"] for i in self.checklist if not i["passed"]]
        self.assertEqual(failing, [], msg=f"Unexpected failures: {failing}")


class TestRGPDChecklistFails(unittest.TestCase):
    """Individual RGPD checklist items detect failures correctly."""

    def _da(self, **priv_kpi_overrides):
        """Clone clean domain_analysis and override privacy_kpi fields."""
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy_kpi"].update(priv_kpi_overrides)
        return da

    def test_no_consent_banner_fail(self):
        da = self._da(cookie_consent={"has_banner": False})
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "consent banner" in i["item"].lower())
        self.assertFalse(item["passed"])

    def test_no_privacy_policy_fail(self):
        da = self._da(has_privacy_policy=False)
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "Privacy policy" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_legal_notice_fail(self):
        da = self._da(has_legal_notice=False)
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "Legal notice" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_cookie_policy_fail(self):
        da = self._da(has_cookie_policy=False)
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "Cookie policy" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_security_policy_fail(self):
        da = self._da(has_security_policy=False)
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "PSSI" in i["item"])
        self.assertFalse(item["passed"])

    def test_no_information_rights_fail(self):
        da = self._da(has_information_rights=False)
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "information rights" in i["item"].lower())
        self.assertFalse(item["passed"])

    def test_no_consent_checkbox_fail(self):
        da = self._da(has_consent_checkbox=False)
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "Consent checkbox" in i["item"])
        self.assertFalse(item["passed"])

    def test_too_few_rgpd_keywords_fail(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy"]["rgpd_keywords"] = [
            {"keyword": "données personnelles", "found": True},
            {"keyword": "traitement des données", "found": True},
            # remaining vocabulary items with found=False (simulate real Go output)
            {"keyword": "droit d'accès", "found": False},
            {"keyword": "consentement", "found": False},
        ]  # only 2 found=True → should fail
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "RGPD / GDPR keywords" in i["item"])
        self.assertFalse(item["passed"])
        self.assertIn("2", item["evidence"])

    def test_tracking_without_consent_fail(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy"]["tracking_without_consent"] = True
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "tracking scripts" in i["item"].lower())
        self.assertFalse(item["passed"])

    def test_missing_cookie_flags_fail(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["cookie_kpi"] = {"passed": False, "missing_cookie_flag_count": 2, "cookies_with_missing_flags": ["sess"]}
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "cookies have HttpOnly" in i["item"])
        self.assertFalse(item["passed"])

    def test_exposed_paths_fail(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["exposed_path_kpi"] = {"passed": False, "google_dorks_vuln_count": 3, "exposed_paths": ["/admin"]}
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "Google Dorks" in i["item"])
        self.assertFalse(item["passed"])


class TestConsentBannerVariants(unittest.TestCase):
    """Cookie consent banner parser handles bool and dict forms."""

    def test_bool_true(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy_kpi"]["cookie_consent"] = True
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "consent banner" in i["item"].lower())
        self.assertTrue(item["passed"])

    def test_bool_false(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy_kpi"]["cookie_consent"] = False
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "consent banner" in i["item"].lower())
        self.assertFalse(item["passed"])

    def test_dict_present_key(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy_kpi"]["cookie_consent"] = {"present": True}
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "consent banner" in i["item"].lower())
        self.assertTrue(item["passed"])

    def test_empty_dict_fails(self):
        import copy
        da = copy.deepcopy(_clean_domain_analysis())
        da["privacy_kpi"]["cookie_consent"] = {}
        cl = build_rgpd_checklist(da)
        item = next(i for i in cl if "consent banner" in i["item"].lower())
        self.assertFalse(item["passed"])


class TestMSiteMetricsFields(unittest.TestCase):
    """Phase M: validate that required fields exist in well-formed site_metrics."""

    def setUp(self):
        self.sm = _clean_site_metrics()

    # M-4
    def test_performance_has_homepage_console_fields(self):
        ck = self.sm["performance"]["console_error_kpi"]
        self.assertIn("homepage_console_error_count", ck)
        self.assertIn("homepage_console_errors", ck)

    # M-6
    def test_ux_has_simulator_count(self):
        self.assertIn("simulator_count", self.sm["ux"])

    # M-5 (structural check via fixture helpers)
    def test_broken_link_kpi_shape(self):
        """_build_broken_link_kpi must return broken_link_count + broken_links."""
        # Simulate empty summary_row
        def _j(val):
            import json
            if val is None:
                return {}
            return val if isinstance(val, dict) else json.loads(val)

        def _build_broken_link_kpi(summary_row):
            if not summary_row:
                return {"broken_link_count": 0, "broken_links": [], "passed": True}
            raw = _j(summary_row.get("broken_links_summary"))
            return {
                "broken_link_count": raw.get("broken_link_count", 0),
                "broken_links":      raw.get("broken_links", []),
                "passed":            raw.get("broken_links_passed", True),
            }

        result = _build_broken_link_kpi(None)
        self.assertIn("broken_link_count", result)
        self.assertIn("broken_links", result)
        self.assertIn("passed", result)

        result2 = _build_broken_link_kpi({"broken_links_summary": {"broken_link_count": 3, "broken_links": ["/a", "/b", "/c"], "broken_links_passed": False}})
        self.assertEqual(result2["broken_link_count"], 3)
        self.assertFalse(result2["passed"])


# ── Runner ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in (
        TestUXChecklistStructure,
        TestUXChecklistFails,
        TestRGPDChecklistStructure,
        TestRGPDChecklistFails,
        TestConsentBannerVariants,
        TestMSiteMetricsFields,
    ):
        suite.addTests(loader.loadTestsFromTestCase(cls))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
