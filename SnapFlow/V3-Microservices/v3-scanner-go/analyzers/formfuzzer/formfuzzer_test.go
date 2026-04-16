package formfuzzer

import "testing"

func TestInferFieldSemanticUsesIdAndLabel(t *testing.T) {
	field := FormField{Name: "", ID: "contact_email", Label: "Your email", Type: "text"}
	got := inferFieldSemantic(field)
	if got != "email" {
		t.Fatalf("expected email semantic, got %q", got)
	}
}

func TestExtractFieldsFallsBackToIdWhenNameMissing(t *testing.T) {
	html := `<form><input id="contact_email" type="email" required></form>`
	fields := extractFields(html)
	if len(fields) != 1 {
		t.Fatalf("expected 1 field, got %d", len(fields))
	}
	if fields[0].Name != "contact_email" {
		t.Fatalf("expected fallback field name from id, got %q", fields[0].Name)
	}
}

// TestApplyResponseDiffingMatchingBaselineIsNotAnomaly verifies that a fuzz
// response whose signature matches the baseline is treated as a stability signal
// (resilient form), NOT flagged as an anomaly. The old behaviour was inverted:
// identical responses were incorrectly flagged as "fuzz_response_matches_baseline".
func TestApplyResponseDiffingMatchingBaselineIsNotAnomaly(t *testing.T) {
	results := []FormTestResult{
		{
			PageURL:      "https://example.com/contact",
			ActionURL:    "https://example.com/contact",
			FormID:       "contact",
			TestType:     "realistic",
			StatusCode:   200,
			responseSig:  "same-signature",
			ResponseHash: "same-signature",
		},
		{
			PageURL:      "https://example.com/contact",
			ActionURL:    "https://example.com/contact",
			FormID:       "contact",
			TestType:     "fuzz",
			StatusCode:   200,
			responseSig:  "same-signature",
			ResponseHash: "same-signature",
		},
	}

	applyResponseDiffing(results)
	if results[1].Anomaly {
		t.Fatal("fuzz response matching baseline should NOT be an anomaly (form is resilient)")
	}
}

// TestApplyResponseDiffingFlagsDiffWithSuspiciousContent verifies that a fuzz
// response is flagged as an anomaly only when the body significantly differs from
// baseline AND contains a security-relevant pattern (e.g. a SQL error keyword).
func TestApplyResponseDiffingFlagsDiffWithSuspiciousContent(t *testing.T) {
	baselineBody := "Thank you for your submission. We will get back to you shortly."
	// Fuzz response body is completely different in size and contains a SQL error.
	fuzzBody := "You have an error in your SQL syntax; check the manual that corresponds to " +
		"your MySQL server version for the right syntax to use near '\\'' at line 1. " +
		"Additional unrelated padding to push the word-count difference well past the 30% threshold " +
		"so the significance check triggers correctly in this unit test scenario."

	results := []FormTestResult{
		{
			PageURL:      "https://example.com/contact",
			ActionURL:    "https://example.com/contact",
			FormID:       "contact",
			TestType:     "realistic",
			StatusCode:   200,
			responseSig:  "baseline-sig",
			ResponseHash: "baseline-sig",
			responseBody: baselineBody,
		},
		{
			PageURL:      "https://example.com/contact",
			ActionURL:    "https://example.com/contact",
			FormID:       "contact",
			TestType:     "fuzz",
			StatusCode:   200,
			responseSig:  "different-sig",
			ResponseHash: "different-sig",
			responseBody: fuzzBody,
		},
	}

	applyResponseDiffing(results)
	if !results[1].Anomaly {
		t.Fatal("fuzz response with significant diff and SQL error pattern should be flagged as anomaly")
	}
	if results[1].AnomalyReason != "fuzz_response_security_relevant_diff_from_baseline" {
		t.Fatalf("unexpected anomaly reason: %q", results[1].AnomalyReason)
	}
}
