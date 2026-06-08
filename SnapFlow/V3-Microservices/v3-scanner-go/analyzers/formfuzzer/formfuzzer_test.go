package formfuzzer

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

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

func TestIsTransactionalFormSkipsViewsExposedFilterForms(t *testing.T) {
	fields := []FormField{
		{Name: "keyword", Type: "text"},
		{Name: "filter_theme", Type: "select"},
	}
	if isTransactionalForm("views-exposed-form-actualites-block-1", "https://example.com/actualites", "GET", fields) {
		t.Fatal("expected views exposed filter form to be classified as non-transactional")
	}
}

func TestFormIdentityKeyIncludesFieldSignatureAndMethod(t *testing.T) {
	formA := DiscoveredForm{
		FormID:    "contact",
		PageURL:   "https://example.com/contact",
		ActionURL: "https://example.com/contact",
		Method:    "POST",
		Fields:    []FormField{{Name: "email", Type: "email"}, {Name: "message", Type: "textarea"}},
	}
	formB := DiscoveredForm{
		FormID:    "contact",
		PageURL:   "https://example.com/contact?page=2",
		ActionURL: "https://example.com/contact",
		Method:    "POST",
		Fields:    []FormField{{Name: "message", Type: "textarea"}, {Name: "email", Type: "email"}},
	}
	if formIdentityKey(formA) != formIdentityKey(formB) {
		t.Fatal("expected equivalent forms to share the same canonical identity")
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

func TestClassifySubmissionOutcomeTreatsValidationMarkupAsRejected(t *testing.T) {
	form := DiscoveredForm{
		Fields: []FormField{{Name: "email", Type: "email", Required: true}},
	}
	payload := map[string]string{"email": "not-an-email"}

	outcome := classifySubmissionOutcome(form, "fuzz", payload, 200, `<div class="form-item--error">Adresse email invalide</div>`)
	if outcome != OutcomeValidationFailed {
		t.Fatalf("expected validation failure, got %q", outcome)
	}
}

func TestClassifySubmissionOutcomeRequiresExplicitSuccessForSilentAcceptance(t *testing.T) {
	form := DiscoveredForm{
		Fields: []FormField{{Name: "email", Type: "email", Required: true}},
	}
	payload := map[string]string{"email": "not-an-email"}

	outcome := classifySubmissionOutcome(form, "fuzz", payload, 200, `<form><input name="email" value="not-an-email"></form>`)
	if outcome != OutcomeSuccess {
		t.Fatalf("expected inconclusive 200 response without success markers to stay non-anomalous, got %q", outcome)
	}
}

func TestClassifySubmissionOutcomeFlagsConfirmedSilentAcceptance(t *testing.T) {
	form := DiscoveredForm{
		Fields: []FormField{{Name: "email", Type: "email", Required: true}},
	}
	payload := map[string]string{"email": "not-an-email"}

	outcome := classifySubmissionOutcome(form, "fuzz", payload, 200, `Merci, votre demande a bien été envoyée. Nous vous contacterons prochainement.`)
	if outcome != OutcomeSilentAcceptance {
		t.Fatalf("expected confirmed success response to be silent acceptance, got %q", outcome)
	}
}

func TestRunCountsValidResponsesWithoutAnomaliesAsUsable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`<div class="form-item--error">Adresse email invalide</div>`))
	}))
	defer server.Close()

	form := DiscoveredForm{
		FormID:          "contact",
		PageURL:         server.URL + "/contact",
		ActionURL:       server.URL + "/submit",
		Method:          http.MethodPost,
		IsTransactional: true,
		Fields: []FormField{
			{Name: "email", Type: "email", Required: true},
			{Name: "message", Type: "textarea"},
		},
	}
	results, summary := Run(context.Background(), []DiscoveredForm{form}, Config{
		Concurrency:    1,
		MaxForms:       1,
		RequestTimeout: time.Second,
	})

	if len(results) != 2 || summary.TestsRun != 2 {
		t.Fatalf("expected baseline and fuzz tests, got results=%d summary=%#v", len(results), summary)
	}
	if summary.ResponsesReceived != 2 || summary.ValidResponses != 2 {
		t.Fatalf("expected both HTTP responses to be usable, got %#v", summary)
	}
	if summary.TransportErrors != 0 || summary.Timeouts != 0 {
		t.Fatalf("expected no transport errors, got %#v", summary)
	}
}
