package functional

import (
	"regexp"
	"strings"
)

type FormInfo struct {
	Type   string `json:"type"`   // "contact", "login", "search", "newsletter", "registration", "rdv", "other"
	Action string `json:"action"` // form action URL
	Method string `json:"method"` // GET or POST
}

type FunctionalResult struct {
	Forms         []FormInfo `json:"forms"`
	HasSearch     bool       `json:"has_search"`
	HasLogin      bool       `json:"has_login"`
	HasContact    bool       `json:"has_contact"`
	HasNewsletter bool       `json:"has_newsletter"`
	HasCart       bool       `json:"has_cart"`
	// Phase D: appointment / RDV form detection
	HasRDV      bool     `json:"has_rdv"`
	TotalForms  int      `json:"total_forms"`
	Passed      bool     `json:"passed"`
	Issues      []string `json:"issues"`
	ServiceName string   `json:"service_name"`
}

var (
	formRe        = regexp.MustCompile(`(?is)<form[^>]*>(.*?)</form>`)
	actionRe      = regexp.MustCompile(`(?i)action=["'](.*?)["']`)
	methodRe      = regexp.MustCompile(`(?i)method=["'](.*?)["']`)
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

func Analyze(html string) FunctionalResult {
	result := FunctionalResult{
		Forms:       []FormInfo{},
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

		result.Forms = append(result.Forms, FormInfo{
			Type:   formType,
			Action: action,
			Method: method,
		})

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

	var issues []string

	if !result.HasSearch {
		issues = append(issues, "No search form detected")
	}
	if !result.HasContact && !result.HasRDV && result.TotalForms == 0 {
		issues = append(issues, "No forms detected on page")
	}

	// Pass if at least one interaction form (contact or RDV) is present
	result.Passed = result.HasContact || result.HasRDV
	result.Issues = issues
	return result
}
