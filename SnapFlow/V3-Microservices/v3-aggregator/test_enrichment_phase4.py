"""
Test Phase 4 KPI Enrichment Implementation
Validates: constat generation, French text only, 9-key strict schema, constat_global synthesis
"""
import json
from kpi_builder import (
    build_kpi_centric_report,
    _generate_constat,
    _normalize_kpi_object,
    _generate_constat_passing,
    _generate_constat_failing_bug,
    _generate_constat_failing_compliance,
)


class TestKPIEnrichment:
    """Test suite for Phase 4 implementation"""

    def test_constat_passing_evidence_grounded(self):
        """Validate _generate_constat_passing generates French text without hallucination"""
        kpi = {
            "info": "Certificat SSL: Valide",
            "data": {
                "valid": True,
                "expiry": "2026-12-31",
                "protocol": "TLS 1.3",
                "issuer": "Let's Encrypt",
                "headers_present": 6
            }
        }
        constat = _generate_constat_passing("SSL", kpi["data"], kpi["info"])
        
        # Assertions: French text, evidence from data
        assert "TLS 1.3" in constat, "Should reference actual protocol version"
        assert "6 en-têtes" in constat or "6 en-tetes" in constat, "Should mention header count"
        assert "Let's Encrypt" in constat, "Should reference issuer"
        assert "Aucune action" in constat or "aucune action" in constat.lower(), "Should indicate no action needed"
        assert "\n" not in constat, "Should be single line"
        print("✓ test_constat_passing_evidence_grounded PASSED")

    def test_constat_failing_bug_security_framing(self):
        """Validate _generate_constat_failing_bug generates threat-aware French summary"""
        kpi = {
            "info": "Vulnérabilités détectées",
            "data": {
                "critical": 2,
                "high": 3,
                "missing_headers": ["Content-Security-Policy", "X-Frame-Options"]
            }
        }
        constat = _generate_constat_failing_bug("CVE", kpi["data"], kpi["info"], pages_affected=25)
        
        # Assertions: Security-centric language
        assert "critique(s)" in constat or "critique" in constat, "Should mention critical severity"
        assert "2" in constat, "Should quantify critical CVEs"
        assert "CSP" in constat or "Content-Security-Policy" in constat, "Should list missing headers"
        assert "Exposition à attaques" in constat or "risque de sécurité" in constat.lower(), "Should warn of threat"
        assert "Correction immédiate" in constat or "correction immédiate" in constat.lower(), "Should recommend immediate fix"
        print("✓ test_constat_failing_bug_security_framing PASSED")

    def test_constat_failing_compliance_legal_risk(self):
        """Validate _generate_constat_failing_compliance generates RGPD-aware French legal language"""
        kpi = {
            "info": "Conformité RGPD",
            "data": {
                "has_privacy_policy": False,
                "pre_consent_violation_pages": 5
            }
        }
        constat = _generate_constat_failing_compliance("RGPD", kpi["data"], kpi["info"], pages_affected=5)
        
        # Assertions: Legal/regulatory risk language
        assert "Art.13/14" in constat or "Article 13" in constat, "Should reference RGPD articles"
        assert "sanctions" in constat or "Exposition" in constat, "Should mention regulatory sanctions"
        assert "prioritaire" in constat or "Correction" in constat, "Should indicate priority"
        assert "politique de confidentialité absente" in constat or "Politique" in constat, "Should identify missing policy"
        print("✓ test_constat_failing_compliance_legal_risk PASSED")

    def test_normalize_kpi_object_strict_schema(self):
        """Validate _normalize_kpi_object enforces 9-key strict order"""
        kpi = {
            "info": "Test KPI",
            "impact": "Test impact",
            "status": "failing",
            "type": "bug",
            "pages_affected": 5,
            "pages_affected_urls": [],
            "data": {"extra_field": "value"},
            "unknown_top_level": "should_migrate"  # Should move to data._raw
        }
        
        normalized = _normalize_kpi_object(kpi, "TEST_AXIS", "test-kpi")
        
        # Check exact key order
        keys_list = list(normalized.keys())
        assert keys_list[0] == "constat", f"First key must be 'constat', got {keys_list[0]}"
        assert keys_list[-1] == "data", f"Last key must be 'data', got {keys_list[-1]}"
        
        # Check all 9 keys present
        required_keys = {"constat", "info", "impact", "pages_affected", 
                        "pages_affected_urls", "status", "type", "severity", "data"}
        assert set(normalized.keys()) == required_keys, f"Normalized keys mismatch. Got {set(normalized.keys())}"
        
        # Check unknown key migration
        assert "unknown_top_level" not in normalized, "Should remove unknown top-level keys"
        assert normalized["data"].get("_raw", {}).get("unknown_top_level") == "should_migrate", "Should migrate to data._raw"
        
        # Check constat is not empty
        assert normalized["constat"] and len(normalized["constat"]) > 0, "Constat should be generated"
        
        print("✓ test_normalize_kpi_object_strict_schema PASSED")

    def test_constat_has_french_text_only(self):
        """Validate all constat generations use only French text (no English)"""
        kpi_passing = {
            "info": "SSL Certificate Valid",
            "status": "passing",
            "data": {"valid": True, "issuer": "Let's Encrypt"}
        }
        
        constat = _generate_constat(kpi_passing)
        
        # Check for French-only indicators
        prohibited_english = [
            "is", "has", "for", "the", "and", "of", "not", "missing",
            "certificate", "valid", "header", "policy"
        ]
        
        constat_lower = constat.lower()
        for word in prohibited_english:
            # Ignore if part of a French word (e.g., "certificate" in "certificat")
            # Check for word boundaries (space, punctuation)
            if f" {word} " in f" {constat_lower} ":
                raise AssertionError(f"Found English word '{word}' in constat: {constat}")
        
        # Verify has French indicators
        assert any(fr in constat_lower for fr in ["à", "de", "et", "le", "la", "des", "aucun", "aucune"]), \
            f"Constat should contain French articles/prepositions: {constat}"
        
        print("✓ test_constat_has_french_text_only PASSED")

    def test_failing_kpi_count_in_report(self):
        """Validate build_kpi_centric_report includes failing counts and constat_global"""
        # Create minimal valid report
        report = {
            "scan_id": "test-123",
            "domain": "example.com",
            "pages_scanned": 10,
            "generated_at": None,  # Force fallback to current timestamp
            "domain_analysis": {
                "security": {
                    "admin_sensitive_page_exposed": {"status": "fail"},
                    "version_disclosure_cms": {"status": "pass"},
                    "robots_txt_info_disclosure": {"status": "pass"},
                    "custom_error_page_info_leak": {"status": "pass"},
                    "bruteforced_protection_login": {"protected": True},
                    "file_upload_extension_control": {"restrictions_found": True},
                    "vulnerable_js_dependencies": {"status": "pass"}
                },
                "cms_kpi": {"issues": []},
                "privacy_kpi": {},
                "cookie_kpi": {}
            },
            "site_metrics": {
                "seo": {},
                "ux": {"button_kpi": {}},
                "performance": {},
                "content": {}
            }
        }
        
        result = build_kpi_centric_report(report)
        
        # Check root metadata
        assert "constat_global" in result, "Missing constat_global in result"
        assert "failing_kpis_count" in result, "Missing failing_kpis_count in result"
        assert "critical_count" in result, "Missing critical_count in result"
        assert "metadata" in result, "Missing metadata in result"
        
        # Validate constat_global French text
        constat_global = result["constat_global"]
        assert len(constat_global) > 0, "constat_global should not be empty"
        assert isinstance(constat_global, str), "constat_global should be string"
        
        # Check for French indicators
        assert any(fr in constat_global.lower() for fr in ["audit", "pages", "indicateurs", "anomal"]), \
            f"constat_global should have French content: {constat_global}"
        
        print(f"✓ test_failing_kpi_count_in_report PASSED")
        print(f"  - failing_kpis_count: {result['failing_kpis_count']}")
        print(f"  - constat_global preview: {result['constat_global'][:100]}...")

    def test_generated_at_fallback(self):
        """Validate generated_at fallback to current UTC timestamp when missing"""
        report = {
            "scan_id": "test-fallback",
            "domain": "test.com",
            "pages_scanned": 5,
            "generated_at": None,  # Missing — should fallback
            "domain_analysis": {},
            "site_metrics": {}
        }
        
        result = build_kpi_centric_report(report)
        
        # Check generated_at is not None and is ISO 8601 format
        assert result["generated_at"] is not None, "generated_at should have fallback value"
        assert "T" in result["generated_at"] and "Z" in result["generated_at"], \
            "generated_at should be ISO 8601 format"
        
        print("✓ test_generated_at_fallback PASSED")

    def run_all_tests(self):
        """Execute all test methods"""
        test_methods = [m for m in dir(self) if m.startswith("test_") and callable(getattr(self, m))]
        print(f"\n{'='*60}")
        print(f"PHASE 4 ENRICHMENT VALIDATION ({len(test_methods)} tests)")
        print(f"{'='*60}\n")
        
        passed = 0
        failed = 0
        
        for method_name in test_methods:
            try:
                getattr(self, method_name)()
                passed += 1
            except Exception as e:
                failed += 1
                print(f"✗ {method_name} FAILED: {str(e)}")
        
        print(f"\n{'='*60}")
        print(f"RESULTS: {passed} PASSED, {failed} FAILED")
        print(f"{'='*60}\n")
        
        return failed == 0


if __name__ == "__main__":
    tester = TestKPIEnrichment()
    success = tester.run_all_tests()
    exit(0 if success else 1)
