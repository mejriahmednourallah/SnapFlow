package formfuzzer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

type FormField struct {
	Name     string   `json:"name"`
	ID       string   `json:"id,omitempty"`
	Label    string   `json:"label,omitempty"`
	Type     string   `json:"type"`
	Required bool     `json:"required"`
	Options  []string `json:"options,omitempty"`
}

// SubmissionOutcome classifies form submission response behavior
type SubmissionOutcome string

const (
	OutcomeSuccess           SubmissionOutcome = "success_submitted"
	OutcomeSilentAcceptance  SubmissionOutcome = "silent_acceptance"       // [F-1] fuzz payload accepted without any validation feedback
	OutcomeServerCrash       SubmissionOutcome = "server_error_on_fuzz"    // [F-2] 5xx response to fuzz = potential injection/crash
	OutcomeValidationFailed  SubmissionOutcome = "validation_failed"
	OutcomeBlockedWAF        SubmissionOutcome = "blocked_csrf_or_waf"     // 403 only
	OutcomeAuthRequired      SubmissionOutcome = "auth_required"           // 401
	OutcomeNotFound          SubmissionOutcome = "form_endpoint_not_found" // 404 — broken form, not WAF
	OutcomeMethodNotAllowed  SubmissionOutcome = "method_not_allowed"      // 405 — wrong HTTP method
	OutcomeRateLimited       SubmissionOutcome = "rate_limited"            // 429 — too many requests
	OutcomeFalsePositive     SubmissionOutcome = "false_positive_no_reaction"
	OutcomeInconclusiveCap   SubmissionOutcome = "inconclusive_captcha"
	OutcomeRequestError      SubmissionOutcome = "request_error"
)

type DiscoveredForm struct {
	FormID    string      `json:"form_id"`
	PageURL   string      `json:"page_url"`
	ActionURL string      `json:"action_url"`
	Method    string      `json:"method"`
	Fields    []FormField `json:"fields"`
	IsModal   bool        `json:"is_modal,omitempty"` // Layer 5: Set to true if form discovered inside modal
}

type FormTestResult struct {
	PageURL       string            `json:"page_url"`
	ActionURL     string            `json:"action_url"`
	FormID        string            `json:"form_id"`
	TestType      string            `json:"test_type"`
	Payload       map[string]string `json:"payload"`
	ResponseType  string            `json:"response_type"`
	StatusCode    int               `json:"status_code"`
	DurationMS    int64             `json:"duration_ms"`
	ResponseHash  string            `json:"response_hash,omitempty"`
	Anomaly       bool              `json:"anomaly"`
	AnomalyReason string            `json:"anomaly_reason,omitempty"`
	Error         string            `json:"error,omitempty"`
	responseSig   string
	responseBody  string // normalized body retained for diff analysis (not serialized)
}

type Summary struct {
	Enabled          bool     `json:"enabled"`
	SkippedReason    string   `json:"skipped_reason,omitempty"`
	FormsDiscovered  int      `json:"forms_discovered"`
	FormsTested      int      `json:"forms_tested"`
	TestsRun         int      `json:"tests_run"`
	AnomaliesFound   int      `json:"anomalies_found"`
	AffectedPages    int      `json:"affected_pages"`
	AffectedPageURLs []string `json:"affected_page_urls,omitempty"`
	DurationMS       int64    `json:"duration_ms"`
}

type Config struct {
	AllowedDomains map[string]bool
	Concurrency    int
	MaxForms       int
	RequestTimeout time.Duration
	PayloadProfile string
}

type testJob struct {
	form    DiscoveredForm
	test    string
	payload map[string]string
}

var (
	formBlockRe  = regexp.MustCompile(`(?is)<form\b[^>]*>(.*?)</form>`)
	inputRe      = regexp.MustCompile(`(?is)<input\b[^>]*>`)
	textareaRe   = regexp.MustCompile(`(?is)<textarea\b[^>]*>(.*?)</textarea>`)
	selectRe     = regexp.MustCompile(`(?is)<select\b[^>]*>(.*?)</select>`)
	optionValRe  = regexp.MustCompile(`(?is)<option\b[^>]*value=["']([^"']*)["'][^>]*>`) // only explicit values
	attrKVRe     = regexp.MustCompile(`(?i)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*["']([^"']*)["']`)
	feedbackHint = regexp.MustCompile(`(?i)(required|invalid|obligatoire|erreur|merci de|please enter|please provide|champ)`)
)

func ExtractForms(pageURL, html string) []DiscoveredForm {
	matches := formBlockRe.FindAllString(html, -1)
	forms := make([]DiscoveredForm, 0, len(matches))

	for i, block := range matches {
		headEnd := strings.Index(strings.ToLower(block), ">")
		if headEnd < 0 {
			continue
		}
		head := block[:headEnd+1]
		attrs := parseAttrs(head)

		actionRaw := strings.TrimSpace(attrs["action"])
		actionURL := resolveActionURL(pageURL, actionRaw)
		if actionURL == "" {
			actionURL = pageURL
		}

		method := strings.ToUpper(strings.TrimSpace(attrs["method"]))
		if method == "" {
			method = http.MethodPost
		}
		if method != http.MethodPost && method != http.MethodGet {
			method = http.MethodPost
		}

		fields := extractFields(block)
		if len(fields) == 0 {
			continue
		}

		// Layer 1: Skip search/filter/sort forms classified as GET with search/filter/sort in action
		if method == http.MethodGet {
			actionLower := strings.ToLower(actionURL)
			if strings.Contains(actionLower, "search") || strings.Contains(actionLower, "filter") || strings.Contains(actionLower, "sort") {
				continue
			}
			// Skip single search input forms (e.g., search box)
			if len(fields) == 1 && strings.ToLower(fields[0].Type) == "search" {
				continue
			}
		}

		formID := strings.TrimSpace(attrs["id"])
		if formID == "" {
			formID = fmt.Sprintf("form_%d", i+1)
		}

		forms = append(forms, DiscoveredForm{
			FormID:    formID,
			PageURL:   pageURL,
			ActionURL: actionURL,
			Method:    method,
			Fields:    fields,
		})
	}

	return forms
}

func Run(ctx context.Context, forms []DiscoveredForm, cfg Config) ([]FormTestResult, Summary) {
	start := time.Now()
	summary := Summary{Enabled: true, FormsDiscovered: len(forms)}
	if len(forms) == 0 {
		summary.SkippedReason = "no_forms"
		summary.DurationMS = time.Since(start).Milliseconds()
		return nil, summary
	}

	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 4
	}
	if cfg.MaxForms <= 0 {
		cfg.MaxForms = 20
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 10 * time.Second
	}

	selected := selectFormsInScope(forms, cfg.MaxForms, cfg.AllowedDomains)
	summary.FormsTested = len(selected)
	if len(selected) == 0 {
		summary.SkippedReason = "no_in_scope_forms"
		summary.DurationMS = time.Since(start).Milliseconds()
		return nil, summary
	}

	jobs := make([]testJob, 0, len(selected)*2)
	for _, f := range selected {
		jobs = append(jobs, testJob{form: f, test: "realistic", payload: buildRealisticPayload(f)})
		jobs = append(jobs, testJob{form: f, test: "fuzz", payload: buildFuzzPayload(f, cfg.PayloadProfile)})
	}
	summary.TestsRun = len(jobs)

	jobCh := make(chan testJob, len(jobs))
	resCh := make(chan FormTestResult, len(jobs))
	client := &http.Client{Timeout: cfg.RequestTimeout}
	var wg sync.WaitGroup

	for i := 0; i < cfg.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobCh {
				resCh <- runSingleTest(ctx, client, j)
			}
		}()
	}

	for _, j := range jobs {
		jobCh <- j
	}
	close(jobCh)

	wg.Wait()
	close(resCh)

	results := make([]FormTestResult, 0, len(jobs))
	for r := range resCh {
		results = append(results, r)
	}

	// Post-process baseline-vs-fuzz comparisons to detect silent acceptance.
	applyResponseDiffing(results)
	affectedPages := map[string]struct{}{}
	for _, r := range results {
		if r.Anomaly {
			summary.AnomaliesFound++
			if page := strings.TrimSpace(r.PageURL); page != "" {
				affectedPages[page] = struct{}{}
			}
		}
	}
	if len(affectedPages) > 0 {
		affectedURLs := make([]string, 0, len(affectedPages))
		for u := range affectedPages {
			affectedURLs = append(affectedURLs, u)
		}
		sort.Strings(affectedURLs)
		summary.AffectedPages = len(affectedURLs)
		if len(affectedURLs) > 100 {
			summary.AffectedPageURLs = affectedURLs[:100]
		} else {
			summary.AffectedPageURLs = affectedURLs
		}
	}

	// Deterministic order in persisted output.
	sort.Slice(results, func(i, j int) bool {
		if results[i].PageURL != results[j].PageURL {
			return results[i].PageURL < results[j].PageURL
		}
		if results[i].FormID != results[j].FormID {
			return results[i].FormID < results[j].FormID
		}
		return results[i].TestType < results[j].TestType
	})

	summary.DurationMS = time.Since(start).Milliseconds()
	return results, summary
}

func runSingleTest(ctx context.Context, client *http.Client, j testJob) FormTestResult {
	start := time.Now()
	res := FormTestResult{
		PageURL:   j.form.PageURL,
		ActionURL: j.form.ActionURL,
		FormID:    j.form.FormID,
		TestType:  j.test,
		Payload:   j.payload,
	}

	statusCode, body, responseType, err := submitForm(ctx, client, j.form, j.payload)
	res.StatusCode = statusCode
	res.ResponseType = responseType
	res.DurationMS = time.Since(start).Milliseconds()
	res.responseSig = responseSignature(body)
	res.ResponseHash = res.responseSig
	res.responseBody = body

	if err != nil {
		res.Anomaly = true
		res.AnomalyReason = string(OutcomeRequestError)
		res.Error = err.Error()
		return res
	}

	// Layer 4: Classify submission outcome and detect anomalies
	outcome := classifySubmissionOutcome(j.form, j.test, j.payload, statusCode, body)
	res.AnomalyReason = string(outcome)

	// Only fuzz tests can be anomalies
	if j.test == "fuzz" {
		switch outcome {
		case OutcomeSilentAcceptance:
			// [F-1] Fuzz payload silently accepted — highest-severity finding.
			res.Anomaly = true
		case OutcomeServerCrash:
			// [F-2] Server crashed on fuzz payload — potential injection vector.
			res.Anomaly = true
		case OutcomeValidationFailed:
			// Positive signal: the form is properly validating input. NOT an anomaly.
			res.Anomaly = false
		case OutcomeBlockedWAF:
			// Positive/neutral signal: WAF is active and blocking malicious input. NOT an anomaly.
			res.Anomaly = false
		case OutcomeFalsePositive:
			res.Anomaly = false
		case OutcomeInconclusiveCap:
			// CAPTCHA: skip as inconclusive
			res.Anomaly = false
		default:
			// OutcomeSuccess (realistic test passed) or OutcomeRequestError
			res.Anomaly = false
		}
	}

	return res
}

// classifySubmissionOutcome implements Layer 4 logic to categorize form response behavior
func classifySubmissionOutcome(form DiscoveredForm, testType string, payload map[string]string, statusCode int, body string) SubmissionOutcome {
	// Check for request-level errors
	if statusCode == 0 {
		return OutcomeRequestError
	}

	// Check for defensive barriers (CAPTCHA)
	if strings.Contains(body, "recaptcha") || strings.Contains(body, "hcaptcha") {
		return OutcomeInconclusiveCap
	}

	// [F-2] 5xx on a fuzz test = potential server crash / injection hit.
	// Distinguish from a normal server error on a realistic test.
	if statusCode >= 500 {
		if testType == "fuzz" {
			return OutcomeServerCrash
		}
		return OutcomeValidationFailed
	}

	// Distinguish specific 4xx codes — only 403 means WAF/CSRF block.
	switch statusCode {
	case 404:
		return OutcomeNotFound // Broken endpoint — classify as bug, not security finding
	case 405:
		return OutcomeMethodNotAllowed // Wrong method — configuration issue, not WAF
	case 410:
		return OutcomeNotFound // [5.7] Permanently removed endpoint — not a WAF block
	case 422:
		return OutcomeValidationFailed // [5.7] Server understood but rejected data — validation working, not WAF
	case 429:
		return OutcomeRateLimited // Rate limiting — not a WAF block
	}
	// [#6] 401 = authentication required — NOT a WAF block.
	// Forms behind auth walls are expected to reject unauthenticated fuzz tests;
	// classifying as BlockedWAF creates false security anomalies.
	if statusCode == 401 {
		return OutcomeAuthRequired
	}
	if statusCode == 403 || (statusCode >= 400 && statusCode < 500) {
		return OutcomeBlockedWAF // 403 and remaining 4xx = actual WAF/CSRF/auth block
	}

	// Only check deeper patterns for fuzz tests
	if testType != "fuzz" {
		return OutcomeSuccess
	}

	// Check for validation rejection (payload validation failed)
	if hasReflectedPayload(body, payload) {
		return OutcomeValidationFailed
	}

	if requiredFieldsAccepted(form.Fields, payload, statusCode, body) {
		return OutcomeValidationFailed
	}

	if invalidEmailAccepted(form.Fields, payload, statusCode, body) {
		return OutcomeValidationFailed
	}

	// [F-1] 2xx/3xx on a fuzz test with no feedback = silent acceptance.
	// The server accepted the malicious payload without any validation rejection.
	if testType == "fuzz" {
		return OutcomeSilentAcceptance
	}
	return OutcomeSuccess
}

func applyResponseDiffing(results []FormTestResult) {
	type pair struct {
		realistic int
		fuzz      int
	}
	byForm := map[string]pair{}
	for i := range results {
		k := results[i].PageURL + "|" + results[i].FormID + "|" + results[i].ActionURL
		p := byForm[k]
		if results[i].TestType == "realistic" {
			p.realistic = i + 1
		}
		if results[i].TestType == "fuzz" {
			p.fuzz = i + 1
		}
		byForm[k] = p
	}

	for _, p := range byForm {
		if p.realistic == 0 || p.fuzz == 0 {
			continue
		}
		r := &results[p.realistic-1]
		f := &results[p.fuzz-1]
		if f.Anomaly {
			continue
		}
		if f.StatusCode >= 400 || r.StatusCode >= 400 {
			continue
		}
		// A fuzz response that matches the baseline hash means the form is stable/resilient — NOT an anomaly.
		// Only flag when the response significantly differs from baseline AND shows security-relevant patterns.
		if f.responseSig != "" && f.responseSig == r.responseSig {
			// Same hash as baseline: form is resilient, not an anomaly.
			continue
		}
		// Hashes differ: check whether the body difference is significant AND security-relevant.
		if responseBodyDiffSignificant(r.responseBody, f.responseBody) && responseBodyHasSuspiciousPatterns(f.responseBody) {
			f.Anomaly = true
			f.AnomalyReason = "fuzz_response_security_relevant_diff_from_baseline"
		}
	}
}

func submitForm(ctx context.Context, client *http.Client, form DiscoveredForm, payload map[string]string) (int, string, string, error) {
	if form.ActionURL == "" {
		return 0, "", "error", fmt.Errorf("missing form action URL")
	}

	values := url.Values{}
	for k, v := range payload {
		values.Set(k, v)
	}

	method := strings.ToUpper(form.Method)
	if method == "" {
		method = http.MethodPost
	}

	var req *http.Request
	var err error
	if method == http.MethodGet {
		u, parseErr := url.Parse(form.ActionURL)
		if parseErr != nil {
			return 0, "", "error", parseErr
		}
		q := u.Query()
		for k, vals := range values {
			for _, v := range vals {
				q.Add(k, v)
			}
		}
		u.RawQuery = q.Encode()
		req, err = http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	} else {
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, form.ActionURL, strings.NewReader(values.Encode()))
		if err == nil {
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
	}
	if err != nil {
		return 0, "", "error", err
	}
	req.Header.Set("User-Agent", "SnapFlow-FormFuzzer/1.0")

	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return 0, "", "error", ctx.Err()
		}
		return 0, "", "error", err
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, 256*1024)
	bodyBytes, _ := io.ReadAll(limited)
	body := strings.ToLower(string(bodyBytes))

	responseType := "success"
	switch {
	case resp.StatusCode >= 500:
		responseType = "crash"
	case resp.StatusCode >= 400:
		responseType = "error"
	case resp.StatusCode >= 300:
		responseType = "redirect"
	}

	return resp.StatusCode, body, responseType, nil
}

func requiredFieldsAccepted(fields []FormField, payload map[string]string, statusCode int, body string) bool {
	if statusCode >= 400 {
		return false
	}
	hadRequired := false
	allRequiredEmpty := true
	for _, f := range fields {
		if !f.Required || f.Name == "" {
			continue
		}
		hadRequired = true
		if strings.TrimSpace(payload[f.Name]) != "" {
			allRequiredEmpty = false
			break
		}
	}
	return hadRequired && allRequiredEmpty && !feedbackHint.MatchString(body)
}

func invalidEmailAccepted(fields []FormField, payload map[string]string, statusCode int, body string) bool {
	if statusCode >= 400 {
		return false
	}
	for _, f := range fields {
		if strings.ToLower(f.Type) != "email" || f.Name == "" {
			continue
		}
		if v := strings.TrimSpace(payload[f.Name]); v != "" && !strings.Contains(v, "@") {
			return !feedbackHint.MatchString(body)
		}
	}
	return false
}

func hasReflectedPayload(body string, payload map[string]string) bool {
	for _, v := range payload {
		v = strings.ToLower(strings.TrimSpace(v))
		if len(v) < 6 {
			continue
		}
		if strings.Contains(v, "<script") || strings.Contains(v, "' or '") || strings.Contains(v, "drop table") {
			if strings.Contains(body, v) {
				return true
			}
		}
	}
	return false
}

func buildRealisticPayload(form DiscoveredForm) map[string]string {
	payload := make(map[string]string)
	for _, f := range form.Fields {
		if f.Name == "" {
			continue
		}
		switch inferFieldSemantic(f) {
		case "email":
			payload[f.Name] = "contact@snapflow.tn"
		case "password":
			payload[f.Name] = "SnaPflow#2026"
		case "phone":
			payload[f.Name] = "+21620123456"
		case "first_name":
			payload[f.Name] = "Test"
		case "last_name":
			payload[f.Name] = "Utilisateur"
		case "full_name":
			payload[f.Name] = "Test Utilisateur"
		case "company":
			payload[f.Name] = "SnapFlow"
		case "city":
			payload[f.Name] = "Tunis"
		case "postal_code":
			payload[f.Name] = "1000"
		case "country":
			payload[f.Name] = "Tunisie"
		case "message":
			payload[f.Name] = "Bonjour, ceci est un message de test."
		case "url":
			payload[f.Name] = "https://snapflow.tn"
		case "number":
			payload[f.Name] = "12"
		case "date":
			payload[f.Name] = "2026-03-15"
		case "checkbox", "radio":
			payload[f.Name] = "on"
		case "select":
			if len(f.Options) > 0 {
				payload[f.Name] = f.Options[0]
			} else {
				payload[f.Name] = "default"
			}
		default:
			switch strings.ToLower(f.Type) {
			case "email":
				payload[f.Name] = "contact@snapflow.tn"
			case "password":
				payload[f.Name] = "SnaPflow#2026"
			case "number":
				payload[f.Name] = "12"
			case "tel":
				payload[f.Name] = "+21620123456"
			case "date":
				payload[f.Name] = "2026-03-15"
			case "checkbox", "radio":
				payload[f.Name] = "on"
			case "select":
				if len(f.Options) > 0 {
					payload[f.Name] = f.Options[0]
				} else {
					payload[f.Name] = "default"
				}
			default:
				payload[f.Name] = "Test utilisateur"
			}
		}
	}
	return payload
}

func buildFuzzPayload(form DiscoveredForm, profile string) map[string]string {
	payload := make(map[string]string)
	xss := `<script>alert(1)</script>`
	sqli := `' OR '1'='1`
	for _, f := range form.Fields {
		if f.Name == "" {
			continue
		}
		typeName := strings.ToLower(f.Type)
		semantic := inferFieldSemantic(f)
		if f.Required {
			// [F-5] Use a clearly invalid but non-empty sentinel so server-side
			// required-field validation fires. A blank/space string is often
			// interpreted as "not submitted" by frameworks and skips validation.
			if semantic == "email" {
				payload[f.Name] = "not-an-email"
			} else if semantic == "message" {
				payload[f.Name] = ""
			} else {
				payload[f.Name] = "."
			}
			continue
		}

		switch semantic {
		case "email":
			payload[f.Name] = "invalid-email"
		case "password":
			payload[f.Name] = sqli
		case "phone":
			payload[f.Name] = "+abc"
		case "full_name", "first_name", "last_name":
			payload[f.Name] = xss
		case "company", "message":
			payload[f.Name] = strings.Repeat("A", 512) + xss
		case "number":
			payload[f.Name] = "-1"
		case "date":
			payload[f.Name] = "0000-00-00"
		case "select":
			payload[f.Name] = "__invalid_option__"
		default:
			switch typeName {
			case "email":
				payload[f.Name] = "invalid-email"
			case "password":
				payload[f.Name] = sqli
			case "number":
				payload[f.Name] = "-1"
			case "tel":
				payload[f.Name] = "+abc"
			case "date":
				payload[f.Name] = "0000-00-00"
			case "textarea":
				payload[f.Name] = strings.Repeat("A", 512) + xss
			case "select":
				payload[f.Name] = "__invalid_option__"
			default:
				if profile == "light" {
					payload[f.Name] = " 	"
				} else {
					payload[f.Name] = xss
				}
			}
		}
	}
	return payload
}

func inferFieldSemantic(f FormField) string {
	blob := strings.ToLower(strings.TrimSpace(strings.Join([]string{f.Name, f.ID, f.Label, f.Type}, " ")))
	switch {
	case strings.Contains(blob, "email") || strings.Contains(blob, "e-mail"):
		return "email"
	case strings.Contains(blob, "password") || strings.Contains(blob, "mot de passe"):
		return "password"
	case strings.Contains(blob, "phone") || strings.Contains(blob, "tel") || strings.Contains(blob, "mobile"):
		return "phone"
	case strings.Contains(blob, "first") || strings.Contains(blob, "prenom"):
		return "first_name"
	case strings.Contains(blob, "last") || strings.Contains(blob, "nom"):
		return "last_name"
	case strings.Contains(blob, "name") || strings.Contains(blob, "fullname"):
		return "full_name"
	case strings.Contains(blob, "company") || strings.Contains(blob, "societe"):
		return "company"
	case strings.Contains(blob, "message") || strings.Contains(blob, "comment") || strings.Contains(blob, "details"):
		return "message"
	case strings.Contains(blob, "city") || strings.Contains(blob, "ville"):
		return "city"
	case strings.Contains(blob, "postal") || strings.Contains(blob, "zip") || strings.Contains(blob, "code postal"):
		return "postal_code"
	case strings.Contains(blob, "country") || strings.Contains(blob, "pays"):
		return "country"
	case strings.Contains(blob, "url") || strings.Contains(blob, "website") || strings.Contains(blob, "site web"):
		return "url"
	case strings.Contains(blob, "number") || strings.Contains(blob, "amount") || strings.Contains(blob, "montant"):
		return "number"
	case strings.Contains(blob, "date"):
		return "date"
	case strings.Contains(blob, "select"):
		return "select"
	case strings.Contains(blob, "checkbox"):
		return "checkbox"
	case strings.Contains(blob, "radio"):
		return "radio"
	default:
		return strings.ToLower(strings.TrimSpace(f.Type))
	}
}

// responseSignature produces a collision-resistant hash of a response body.
// Targeted normalization preserves HTTP status codes and error numbers so that
// "Error 404" and "Error 500" produce different hashes.
// Only UUIDs and Unix timestamps (10+ digit sequences) are replaced.
var (
	reUUID       = regexp.MustCompile(`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	reTimestamp  = regexp.MustCompile(`\b\d{10,}\b`) // Unix epoch and similar long numbers
	reWhitespace = regexp.MustCompile(`\s+`)
)

func responseSignature(body string) string {
	norm := strings.ToLower(body)
	// Truncate before expensive regex ops — 5KB is sufficient for anomaly detection
	if len(norm) > 5000 {
		norm = norm[:5000]
	}
	norm = reUUID.ReplaceAllString(norm, "UUID")
	norm = reTimestamp.ReplaceAllString(norm, "TIMESTAMP")
	norm = reWhitespace.ReplaceAllString(norm, " ")
	norm = strings.TrimSpace(norm)
	h := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(h[:])
}

func selectFormsInScope(forms []DiscoveredForm, max int, allowedDomains map[string]bool) []DiscoveredForm {
	selected := make([]DiscoveredForm, 0, len(forms))
	for _, f := range forms {
		if !isActionInScope(f.ActionURL, allowedDomains) {
			continue
		}
		selected = append(selected, f)
		if len(selected) >= max {
			break
		}
	}
	return selected
}

func isActionInScope(actionURL string, allowedDomains map[string]bool) bool {
	if actionURL == "" {
		return false
	}
	if len(allowedDomains) == 0 {
		return true
	}
	u, err := url.Parse(actionURL)
	if err != nil {
		return false
	}
	host := normalizeHost(u.Hostname())
	for allowed := range allowedDomains {
		a := normalizeHost(allowed)
		if host == a || strings.HasSuffix(host, "."+a) {
			return true
		}
	}
	return false
}

func extractFields(formHTML string) []FormField {
	fields := []FormField{}
	seen := map[string]bool{}

	for _, tag := range inputRe.FindAllString(formHTML, -1) {
		attrs := parseAttrs(tag)
		name := strings.TrimSpace(attrs["name"])
		id := strings.TrimSpace(attrs["id"])
		label := strings.TrimSpace(attrs["placeholder"])
		if label == "" {
			label = strings.TrimSpace(attrs["aria-label"])
		}
		if name == "" {
			name = id
		}
		if name == "" {
			continue
		}
		t := strings.ToLower(strings.TrimSpace(attrs["type"]))
		if t == "" {
			t = "text"
		}
		key := "input|" + name
		if seen[key] {
			continue
		}
		seen[key] = true
		fields = append(fields, FormField{Name: name, ID: id, Label: label, Type: t, Required: hasRequired(tag, attrs)})
	}

	for _, tag := range textareaRe.FindAllString(formHTML, -1) {
		head := tag
		if idx := strings.Index(strings.ToLower(tag), ">"); idx >= 0 {
			head = tag[:idx+1]
		}
		attrs := parseAttrs(head)
		name := strings.TrimSpace(attrs["name"])
		id := strings.TrimSpace(attrs["id"])
		label := strings.TrimSpace(attrs["placeholder"])
		if label == "" {
			label = strings.TrimSpace(attrs["aria-label"])
		}
		if name == "" {
			name = id
		}
		if name == "" {
			continue
		}
		key := "textarea|" + name
		if seen[key] {
			continue
		}
		seen[key] = true
		fields = append(fields, FormField{Name: name, ID: id, Label: label, Type: "textarea", Required: hasRequired(tag, attrs)})
	}

	for _, tag := range selectRe.FindAllString(formHTML, -1) {
		head := tag
		if idx := strings.Index(strings.ToLower(tag), ">"); idx >= 0 {
			head = tag[:idx+1]
		}
		attrs := parseAttrs(head)
		name := strings.TrimSpace(attrs["name"])
		id := strings.TrimSpace(attrs["id"])
		label := strings.TrimSpace(attrs["aria-label"])
		if name == "" {
			name = id
		}
		if name == "" {
			continue
		}
		key := "select|" + name
		if seen[key] {
			continue
		}
		seen[key] = true
		options := []string{}
		for _, m := range optionValRe.FindAllStringSubmatch(tag, -1) {
			if len(m) > 1 {
				v := strings.TrimSpace(m[1])
				if v != "" {
					options = append(options, v)
				}
			}
		}
		fields = append(fields, FormField{Name: name, ID: id, Label: label, Type: "select", Required: hasRequired(tag, attrs), Options: options})
	}

	return fields
}

func parseAttrs(tag string) map[string]string {
	attrs := map[string]string{}
	for _, m := range attrKVRe.FindAllStringSubmatch(tag, -1) {
		if len(m) > 2 {
			attrs[strings.ToLower(strings.TrimSpace(m[1]))] = strings.TrimSpace(m[2])
		}
	}
	return attrs
}

func hasRequired(tag string, attrs map[string]string) bool {
	if _, ok := attrs["required"]; ok {
		return true
	}
	return strings.Contains(strings.ToLower(tag), " required") || strings.Contains(strings.ToLower(tag), "required>")
}

// suspiciousBodyPatterns are patterns in a fuzz response body that indicate a
// security-relevant deviation: SQL errors, stack traces, or internal path leakage.
var suspiciousBodyPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(sql\s*(syntax|error|exception)|you have an error in your sql|sqlstate|ora-\d{4,}|pg::|sqlite3::|mysqli?_)`),
	regexp.MustCompile(`(?i)(traceback\s+\(most recent|at\s+[\w./\\]+\.php\s+line\s+\d|exception\s+in\s+thread|stack\s+trace:|\tat\s+[\w.]+\()`),
	regexp.MustCompile(`(?i)(/home/[a-z]|/var/(www|log|app)|/etc/(passwd|shadow)|c:\\\\(users|windows|inetpub))`),
	regexp.MustCompile(`(?i)(db_password|db_user|secret_key|private_key|api_key\s*=|password\s*=\s*["'][^"']{4,})`),
}

// responseBodyDiffSignificant returns true when the fuzz body differs from the
// baseline body by more than 30% (measured on normalized word count).
func responseBodyDiffSignificant(baseline, fuzz string) bool {
	baseWords := len(strings.Fields(baseline))
	fuzzWords := len(strings.Fields(fuzz))
	if baseWords == 0 && fuzzWords == 0 {
		return false
	}
	larger := baseWords
	if fuzzWords > larger {
		larger = fuzzWords
	}
	diff := baseWords - fuzzWords
	if diff < 0 {
		diff = -diff
	}
	return float64(diff)/float64(larger) > 0.30
}

// responseBodyHasSuspiciousPatterns returns true when the fuzz response body
// contains patterns that indicate a genuine security-relevant anomaly.
func responseBodyHasSuspiciousPatterns(body string) bool {
	for _, re := range suspiciousBodyPatterns {
		if re.MatchString(body) {
			return true
		}
	}
	return false
}

func resolveActionURL(pageURL, actionRaw string) string {
	if strings.TrimSpace(pageURL) == "" {
		return ""
	}
	base, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}
	if strings.TrimSpace(actionRaw) == "" {
		return base.String()
	}
	action, err := url.Parse(strings.TrimSpace(actionRaw))
	if err != nil {
		return ""
	}
	return base.ResolveReference(action).String()
}

func normalizeHost(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	h = strings.TrimPrefix(h, "www.")
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	return h
}
