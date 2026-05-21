package functional

import (
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type FormInfo struct {
	Type       string `json:"type"`   // "contact", "login", "search", "newsletter", "registration", "rdv", "other"
	Action     string `json:"action"` // form action URL
	Method     string `json:"method"` // GET or POST
	QueryParam string `json:"query_param,omitempty"`
}

type SearchProbeResult struct {
	SearchURL      string `json:"search_url"`
	Query          string `json:"query"`
	Status         string `json:"status"`
	StatusCode     int    `json:"status_code,omitempty"`
	ResultBehavior string `json:"result_behavior,omitempty"`
	Details        string `json:"details,omitempty"`
	Executed       bool   `json:"executed"`
}

type FunctionalResult struct {
	Forms         []FormInfo `json:"forms"`
	HasSearch     bool       `json:"has_search"`
	HasLogin      bool       `json:"has_login"`
	HasContact    bool       `json:"has_contact"`
	HasNewsletter bool       `json:"has_newsletter"`
	HasCart       bool       `json:"has_cart"`
	// Phase D: appointment / RDV form detection
	HasRDV         bool                `json:"has_rdv"`
	TotalForms     int                 `json:"total_forms"`
	Passed         bool                `json:"passed"`
	Issues         []string            `json:"issues"`
	ServiceName    string              `json:"service_name"`
	SearchExecuted bool                `json:"search_executed"`
	SearchPassed   *bool               `json:"search_passed,omitempty"`
	SearchTests    []SearchProbeResult `json:"search_tests,omitempty"`
}

var (
	formRe       = regexp.MustCompile(`(?is)<form[^>]*>(.*?)</form>`)
	actionRe     = regexp.MustCompile(`(?i)action=["'](.*?)["']`)
	methodRe     = regexp.MustCompile(`(?i)method=["'](.*?)["']`)
	inputRe      = regexp.MustCompile(`(?is)<input[^>]*>`)
	nameRe       = regexp.MustCompile(`(?i)\bname=["']([^"']+)["']`)
	searchNameRe = regexp.MustCompile(`(?i)^(q|s|search|query|keyword|keywords|recherche|motcle|mot_cle|terme)$`)
	// [G5/#5/BL-03] Expanded patterns: added French patterns, wildcards, and external tools
	contactHrefRe = regexp.MustCompile(`(?i)href=["'][^"']*(` +
		`/cont[^"']*|` + // wildcards for /contactez-nous, /contact-support, etc.
		`/nous-contacter|/nous-joindre|/soutien|` +
		`/restons-en-contact|/joindre|/ecrire|` +
		`/reach-us|/get-in-touch|/support|/assistance|` +
		`[?&]form=contact|typeform\.com|calendly\.com|` +
		`crisp\.chat` +
		`)[^"']*["']`)
	contactTextRe   = regexp.MustCompile(`(?is)>\s*(contact.*|nous\s+contacter|contactez[-\s]?nous|restons\s+en\s+contact|joindre|ecrivez[-\s]?nous|get\s+in\s+touch|support|assistance)\s*<`)
	contactJsAttrRe = regexp.MustCompile(`(?i)(data-bs-target|data-target|aria-controls)=["'][^"']*(contact|modal|support|help)["']`)
	mailtoRe        = regexp.MustCompile(`(?i)mailto:`)
	phoneRe         = regexp.MustCompile(`(?i)(\+216|\b\d{2}[\s\.-]?\d{3}[\s\.-]?\d{3}\b)`)
)

func detectContactSignals(html string) bool {
	lower := strings.ToLower(html)
	score := 0

	if contactHrefRe.MatchString(html) {
		score += 2
	}
	if contactTextRe.MatchString(html) {
		score += 2
	}
	if contactJsAttrRe.MatchString(html) {
		score += 2
	}
	if mailtoRe.MatchString(html) {
		score += 1
	}
	if phoneRe.MatchString(html) {
		score += 1
	}
	if strings.Contains(lower, "<form") &&
		(strings.Contains(lower, "contact") || strings.Contains(lower, "message") || strings.Contains(lower, "textarea")) {
		score += 2
	}

	return score >= 2
}

func classifyForm(formHTML string) string {
	lower := strings.ToLower(formHTML)

	// Search form
	if strings.Contains(lower, `type="search"`) || strings.Contains(lower, `type='search'`) ||
		strings.Contains(lower, `name="q"`) || strings.Contains(lower, `name="search"`) ||
		strings.Contains(lower, `name="keyword"`) || strings.Contains(lower, `id="search"`) ||
		strings.Contains(lower, `class="search`) || strings.Contains(lower, `placeholder="recherche"`) || strings.Contains(lower, `placeholder="search"`) {
		return "search"
	}

	// Login form
	if strings.Contains(lower, `type="password"`) ||
		(strings.Contains(lower, "login") || strings.Contains(lower, "signin") ||
			strings.Contains(lower, "connexion") || strings.Contains(lower, "authentif") || strings.Contains(lower, `id="login"`)) {
		return "login"
	}

	// Registration form
	if strings.Contains(lower, `type="password"`) &&
		(strings.Contains(lower, "register") || strings.Contains(lower, "signup") ||
			strings.Contains(lower, "inscription") || strings.Contains(lower, "créer")) {
		return "registration"
	}

	// Newsletter form
	if strings.Contains(lower, "newsletter") || strings.Contains(lower, "subscribe") ||
		strings.Contains(lower, "abonnement") || strings.Contains(lower, "abonnez") || strings.Contains(lower, `id="newsletter"`) || strings.Contains(lower, `class="newsletter"`) {
		return "newsletter"
	}

	// RDV / appointment form — checked BEFORE contact (RDV forms contain <textarea>)
	if strings.Contains(lower, "rdv") || strings.Contains(lower, "rendez-vous") ||
		strings.Contains(lower, "rendez_vous") || strings.Contains(lower, "appointment") ||
		strings.Contains(lower, "prendre rendez") || strings.Contains(lower, "prise de rendez") ||
		strings.Contains(lower, "réservation") || strings.Contains(lower, "book appointment") {
		return "rdv"
	}

	// Contact form
	if strings.Contains(lower, "contact") || strings.Contains(lower, "message") ||
		strings.Contains(lower, `<textarea`) {
		return "contact"
	}
	if strings.Contains(lower, "cart") || strings.Contains(lower, "basket") ||
		strings.Contains(lower, "panier") || strings.Contains(lower, "ajouter au panier") {
		return "cart"
	}

	return "other"
}

func searchQueryParam(formHTML string) string {
	inputMatches := inputRe.FindAllString(formHTML, -1)
	fallback := ""
	for _, input := range inputMatches {
		m := nameRe.FindStringSubmatch(input)
		if len(m) <= 1 {
			continue
		}
		name := strings.TrimSpace(m[1])
		if name == "" {
			continue
		}
		if fallback == "" {
			fallback = name
		}
		if searchNameRe.MatchString(name) {
			return name
		}
	}
	return fallback
}

func resolveFormAction(baseURL, action string) (string, bool) {
	base, err := url.Parse(baseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", false
	}
	if strings.TrimSpace(action) == "" {
		return base.String(), true
	}
	ref, err := url.Parse(strings.TrimSpace(action))
	if err != nil {
		return "", false
	}
	resolved := base.ResolveReference(ref)
	return resolved.String(), strings.EqualFold(resolved.Host, base.Host)
}

func classifySearchResponse(statusCode int, body string) (bool, string) {
	switch {
	case statusCode >= 500:
		return false, "server_error"
	case statusCode == http.StatusTooManyRequests:
		return false, "rate_limited"
	case statusCode >= 400:
		return false, "client_error"
	case statusCode >= 300:
		return true, "redirect"
	case strings.TrimSpace(body) == "":
		return false, "empty_response"
	default:
		lower := strings.ToLower(body)
		if strings.Contains(lower, "search") || strings.Contains(lower, "recherche") || strings.Contains(lower, "result") || strings.Contains(lower, "resultat") {
			return true, "search_response"
		}
		return true, "http_ok"
	}
}

func executeSearchProbe(client *http.Client, baseURL string, form FormInfo) SearchProbeResult {
	const query = "snapflow-test"
	result := SearchProbeResult{
		Query:    query,
		Executed: false,
	}

	if form.Method != "" && !strings.EqualFold(form.Method, "GET") {
		result.Status = "not_executed"
		result.Details = "Search form method is not GET; safe backend probe skipped"
		return result
	}
	if form.QueryParam == "" {
		result.Status = "not_executed"
		result.Details = "Search input name could not be identified"
		return result
	}

	actionURL, internal := resolveFormAction(baseURL, form.Action)
	result.SearchURL = actionURL
	if actionURL == "" {
		result.Status = "not_executed"
		result.Details = "Search action URL could not be resolved"
		return result
	}
	if !internal {
		result.Status = "not_executed"
		result.Details = "Search action points outside the audited host"
		return result
	}

	parsed, err := url.Parse(actionURL)
	if err != nil {
		result.Status = "not_executed"
		result.Details = "Search action URL is invalid"
		return result
	}
	params := parsed.Query()
	params.Set(form.QueryParam, query)
	parsed.RawQuery = params.Encode()
	result.SearchURL = parsed.String()

	resp, err := client.Get(result.SearchURL)
	if err != nil {
		result.Status = "request_error"
		result.Details = err.Error()
		return result
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
	passed, behavior := classifySearchResponse(resp.StatusCode, string(bodyBytes))
	result.Executed = true
	result.StatusCode = resp.StatusCode
	result.ResultBehavior = behavior
	result.Status = "passed"
	if !passed {
		result.Status = "failed"
	}
	return result
}

func AnalyzeWithBaseURL(baseURL string, html string) FunctionalResult {
	result := FunctionalResult{
		Forms:       []FormInfo{},
		SearchTests: []SearchProbeResult{},
		ServiceName: "v3-functional-analyzer-go",
		HasContact:  detectContactSignals(html),
	}

	formMatches := formRe.FindAllStringSubmatch(html, -1)
	result.TotalForms = len(formMatches)

	for _, fm := range formMatches {
		fullForm := fm[0]
		formType := classifyForm(fullForm)

		action := ""
		if m := actionRe.FindStringSubmatch(fullForm); len(m) > 1 {
			action = m[1]
		}
		method := "GET"
		if m := methodRe.FindStringSubmatch(fullForm); len(m) > 1 {
			method = strings.ToUpper(m[1])
		}
		queryParam := ""
		if formType == "search" {
			queryParam = searchQueryParam(fullForm)
		}

		form := FormInfo{
			Type:       formType,
			Action:     action,
			Method:     method,
			QueryParam: queryParam,
		}
		result.Forms = append(result.Forms, form)

		switch formType {
		case "search":
			result.HasSearch = true
		case "login":
			result.HasLogin = true
		case "contact":
			result.HasContact = true
		case "newsletter":
			result.HasNewsletter = true
		case "cart":
			result.HasCart = true
		case "rdv":
			result.HasRDV = true
		}
	}

	if result.HasSearch && strings.TrimSpace(baseURL) != "" {
		client := &http.Client{Timeout: 8 * time.Second}
		for _, form := range result.Forms {
			if form.Type != "search" {
				continue
			}
			probe := executeSearchProbe(client, baseURL, form)
			result.SearchTests = append(result.SearchTests, probe)
			if probe.Executed {
				result.SearchExecuted = true
				passed := probe.Status == "passed"
				if result.SearchPassed == nil || !passed {
					result.SearchPassed = &passed
				}
			}
			if result.SearchExecuted {
				break
			}
		}
	}

	var issues []string

	if !result.HasSearch {
		issues = append(issues, "No search form detected")
	}
	if result.HasSearch && !result.SearchExecuted {
		issues = append(issues, "Search form detected but safe execution probe was not run")
	}
	if !result.HasContact && !result.HasRDV && result.TotalForms == 0 {
		issues = append(issues, "No forms detected on page")
	}

	// Pass if at least one interaction form (contact or RDV) is present
	result.Passed = result.HasContact || result.HasRDV
	result.Issues = issues
	return result
}

func Analyze(html string) FunctionalResult {
	return AnalyzeWithBaseURL("", html)
}
