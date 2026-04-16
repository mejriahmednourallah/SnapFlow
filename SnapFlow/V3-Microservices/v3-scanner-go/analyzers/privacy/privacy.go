package privacy

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"rsc.io/pdf"
)

type CookieConsent struct {
	Detected bool   `json:"detected"`
	Provider string `json:"provider,omitempty"`
}

type PrivacyLink struct {
	URL   string `json:"url"`
	Type  string `json:"type"` // "privacy_policy", "legal_notice", "cookie_policy", "data_charter", "security_policy"
	IsPDF bool   `json:"is_pdf"`
}

type RGPDKeyword struct {
	Keyword string `json:"keyword"`
	Found   bool   `json:"found"`
}

type PrivacyResult struct {
	CookieConsent CookieConsent       `json:"cookie_consent"`
	PrivacyLinks  []PrivacyLink       `json:"privacy_links"`
	RGPDKeywords  []RGPDKeyword       `json:"rgpd_keywords"`
	PDFBreakdown  []PDFBreakdownEntry `json:"pdf_breakdown"`
	PDFSummary    PDFBreakdownSummary `json:"pdf_summary"`

	HasPrivacyPolicy bool `json:"has_privacy_policy"`
	HasLegalNotice   bool `json:"has_legal_notice"`
	HasCookiePolicy  bool `json:"has_cookie_policy"`

	// Gap #38: data charter link
	HasDataCharter bool   `json:"has_data_charter"`
	DataCharterURL string `json:"data_charter_url"`

	// ── Phase C: new RGPD fields ─────────────────────────────────────────────
	HasSecurityPolicy    bool `json:"has_security_policy"`    // C-1: security policy link present
	HasInformationRights bool `json:"has_information_rights"` // C-2: data subject rights mentioned
	HasConsentCheckbox   bool `json:"has_consent_checkbox"`   // C-3: checkbox near RGPD keyword
	HasDeclaredPurpose   bool `json:"has_declared_purpose"`   // D6: processing purpose/finality explicitly declared

	// Issue 7: multi-signal CMP confidence score (0.0–1.0).
	CMPConfidence float64 `json:"cmp_confidence"`

	// Issue 8: structured RGPD gap list explaining each failed criterion.
	RGPDGaps []string `json:"rgpd_gaps,omitempty"`

	Passed      bool     `json:"passed"`
	Issues      []string `json:"issues"`
	ServiceName string   `json:"service_name"`
}

type PDFBreakdownSummary struct {
	TotalPDFLinks     int    `json:"total_pdf_links"`
	AnalyzedPDFs      int    `json:"analyzed_pdfs"`
	OCRTimeoutSeconds int    `json:"ocr_timeout_seconds"`
	StrongSignalRule  string `json:"strong_signal_rule"`
}

type PDFBreakdownEntry struct {
	URL             string   `json:"url"`
	Type            string   `json:"type"`
	FetchStatus     string   `json:"fetch_status"`
	HTTPStatus      int      `json:"http_status,omitempty"`
	ContentType     string   `json:"content_type,omitempty"`
	ExtractStatus   string   `json:"extract_status"`
	ExtractMethod   string   `json:"extract_method,omitempty"`
	OCRStatus       string   `json:"ocr_status"`
	OCRTimeoutMs    int      `json:"ocr_timeout_ms"`
	StrongSignal    bool     `json:"strong_signal"`
	MaxWindowHits   int      `json:"max_window_keyword_hits"`
	KeywordsFound   []string `json:"keywords_found"`
	KeywordHitTotal int      `json:"keyword_hit_total"`
	Excerpts        []string `json:"excerpts"`
	Errors          []string `json:"errors"`
}

// Cookie consent / CMP providers to detect
var cmpSignatures = map[string][]string{
	"OneTrust":       {"onetrust", "optanon", "ot-sdk"},
	"Didomi":         {"didomi", "didomi.io"},
	"TarteAuCitron":  {"tarteaucitron", "tac_"},
	"CookieBot":      {"cookiebot", "CookieConsent"},
	"CookieYes":      {"cookieyes", "cky-consent"},
	"Axeptio":        {"axeptio"},
	"GDPR Cookie":    {"gdpr-cookie", "cookie-law-info", "cli-modal"},
	"Osano":          {"osano", "cookieconsent"},
	"Quantcast":      {"quantcast", "__cmpLocator"},
	"Generic Banner": {"cookie-banner", "cookie-notice", "cookie-popup", "cc-banner", "js-cookie-consent"},
}

// Privacy-related link patterns (French + English + Arabic + PDF)
var privacyLinkPatterns = map[string]*regexp.Regexp{
	// [P-2] Arabic slugs added: سياسة-الخصوصية, الخصوصية, حماية-البيانات
	"privacy_policy": regexp.MustCompile(`(?i)(privacy[\s_-]?policy|politique[\s_-]?(de[\s_-]?)?confidentialit(?:e|é)?|protection[\s_-]?(des[\s_-]?)?donn(?:e|é)es?|data[\s_-]?protection|personal[\s_-]?data|vie[\s_-]?priv(?:e|é)e?|سياسة[\s_-]?الخصوصية|الخصوصية|حماية[\s_-]?البيانات)`),
	"legal_notice":   regexp.MustCompile(`(?i)(legal[\s_-]?notice|mentions[\s_-]?l[eé]gales|imprint|impressum|cgu|cgv|conditions[\s_-]?g[eé]n[eé]rales|الشروط|الأحكام|شروط)`),
	"cookie_policy":  regexp.MustCompile(`(?i)(cookie[\s_-]?polic|politique[\s_-]?(des?[\s_-]?)?cookies|gestion[\s_-]?(des?[\s_-]?)?cookies|cookie[\s_-]?settings|سياسة[\s_-]?الكوكيز|الكوكيز|ملفات[\s_-]?الارتباط)`),
	"data_charter":   regexp.MustCompile(`(?i)(charte[\s_-]?(de[\s_-]?)?protection|data[\s_-]?charter|charte[\s_-]?donn|ميثاق[\s_-]?البيانات|حماية[\s_-]?البيانات)`),
	// Phase C-1: security policy link
	"security_policy": regexp.MustCompile(`(?i)(s[eé]curit[eé][\s_-]?informatique|politique[\s_-]?de[\s_-]?s[eé]curit[eé]|security[\s_-]?policy|charte[\s_-]?s[eé]curit[eé])`),
}

// Phase C-2: information rights keywords (data subject rights under RGPD Art.13-22)
var informationRightsRe = regexp.MustCompile(
	`(?i)(droit\s+d['']acc[eè]s|droit\s+de\s+rectification|droit\s+(à\s+l['']|a\s+l[''])?effacement|` +
		`droit\s+de\s+suppression|droit\s+à\s+la\s+portabilit|droit\s+d['']opposition|` +
		`droits\s+des\s+personnes|vos\s+droits|right\s+to\s+access|right\s+to\s+erasure|` +
		`right\s+to\s+rectification|right\s+to\s+data\s+portability|data\s+subject\s+rights)`,
)

var declaredPurposeRe = regexp.MustCompile(
	`(?i)(finalit[eé]\s+du\s+traitement|purpose\s+of\s+processing|why\s+we\s+process|` +
		`pourquoi\s+nous\s+traitons|objectifs?\s+du\s+traitement)`,
)

// Phase C-3: checkbox element regex — matches <input type="checkbox"> or <input type='checkbox'>
var checkboxRe = regexp.MustCompile(`(?i)<input[^>]+type=["']checkbox["']`)

// rgpdProximityKeywords: if a checkbox is within 500 chars of any of these, HasConsentCheckbox = true
var rgpdProximityKeywords = []string{
	"rgpd", "gdpr", "consentement", "consent", "données personnelles", "personal data",
	"politique de confidentialité", "privacy policy", "accepte", "j'accepte", "i agree",
}

// RGPD keywords to search for (French + English)
var rgpdKeywords = []string{
	// French
	"droit d'accès", "droit de rectification", "droit d'opposition",
	"droit à l'effacement", "droit à la portabilité", "droit de suppression",
	"droit au retrait du consentement", "droit d'introduire une réclamation",
	"autorité de contrôle", "base légale",
	"délégué à la protection", "DPO", "RGPD", "CNIL",
	"consentement", "données personnelles", "traitement des données",
	"durée de conservation", "finalité du traitement",
	// English
	"right of access", "right to rectification", "right to erasure",
	"right to data portability", "data protection officer", "GDPR",
	"right to withdraw consent", "right to lodge a complaint",
	"supervisory authority", "lawful basis",
	"personal data", "data processing", "data retention",
	"purpose of processing", "consent",
}

// Arabic keywords are evaluated only when Arabic script is present in HTML.
var rgpdKeywordsArabic = []string{
	"البيانات الشخصية", "حماية البيانات", "الخصوصية", "سياسة الخصوصية",
	"الموافقة", "الغرض من المعالجة", "مدة الاحتفاظ", "حق الوصول",
	"حق التصحيح", "حق المحو", "قابلية نقل البيانات", "مسؤول حماية البيانات",
}

var arabicScriptRe = regexp.MustCompile(`[\x{0600}-\x{06FF}]`)
var arabicDiacriticsRe = regexp.MustCompile(`[\x{064B}-\x{0652}\x{0670}]`)

var linkHrefRe = regexp.MustCompile(`(?is)<a[^>]+href=["'](.*?)["'][^>]*>(.*?)</a>`)

const (
	pdfOCRTimeout       = 5 * time.Second
	pdfFetchTimeout     = 10 * time.Second
	pdfStrongSignalSpan = 200
	pdfStrongSignalHits = 2
)

var sentenceSplitRe = regexp.MustCompile(`[\.!\?\n؟]+`)

var pdfSignalKeywords = append(append([]string{}, rgpdKeywords...), rgpdKeywordsArabic...)

func normalizeForKeywordMatch(text string) string {
	if text == "" {
		return ""
	}
	n := strings.ToLower(text)
	// Normalize apostrophes first so French contractions are consistent.
	n = strings.NewReplacer("’", "'", "`", "'", "´", "'").Replace(n)
	// Normalize Arabic variants and remove diacritics to reduce missed matches.
	n = strings.NewReplacer(
		"أ", "ا", "إ", "ا", "آ", "ا", "ٱ", "ا",
		"ى", "ي", "ؤ", "و", "ئ", "ي", "ة", "ه",
	).Replace(n)
	n = arabicDiacriticsRe.ReplaceAllString(n, "")
	// Normalize common French/Latin accents to avoid Unicode mismatch misses.
	n = strings.NewReplacer(
		"à", "a", "â", "a", "ä", "a",
		"ç", "c",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"î", "i", "ï", "i",
		"ô", "o", "ö", "o",
		"ù", "u", "û", "u", "ü", "u",
		"ÿ", "y",
	).Replace(n)
	return n
}

func containsKeywordWithBoundary(normalizedText, keyword string) bool {
	if normalizedText == "" || keyword == "" {
		return false
	}
	normKeyword := normalizeForKeywordMatch(keyword)
	pattern := `(^|[^\p{L}\p{N}])` + regexp.QuoteMeta(normKeyword) + `([^\p{L}\p{N}]|$)`
	re, err := regexp.Compile(pattern)
	if err != nil {
		return strings.Contains(normalizedText, normKeyword)
	}
	return re.MatchString(normalizedText)
}

func countKeywordWithBoundary(normalizedText, keyword string) int {
	if normalizedText == "" || keyword == "" {
		return 0
	}
	normKeyword := normalizeForKeywordMatch(keyword)
	pattern := `(^|[^\p{L}\p{N}])` + regexp.QuoteMeta(normKeyword) + `([^\p{L}\p{N}]|$)`
	re, err := regexp.Compile(pattern)
	if err != nil {
		if strings.Contains(normalizedText, normKeyword) {
			return 1
		}
		return 0
	}
	return len(re.FindAllStringIndex(normalizedText, -1))
}

func hasStrongSignal(text string, windowWords int, minHits int) (bool, int) {
	norm := normalizeForKeywordMatch(text)
	words := strings.Fields(norm)
	if len(words) == 0 {
		return false, 0
	}
	step := windowWords / 2
	if step < 1 {
		step = 1
	}
	maxHits := 0
	for start := 0; start < len(words); start += step {
		end := start + windowWords
		if end > len(words) {
			end = len(words)
		}
		window := strings.Join(words[start:end], " ")
		hits := 0
		for _, kw := range pdfSignalKeywords {
			if containsKeywordWithBoundary(window, kw) {
				hits++
			}
		}
		if hits > maxHits {
			maxHits = hits
		}
		if hits >= minHits {
			return true, maxHits
		}
	}
	return false, maxHits
}

func resolveLink(baseURL string, href string) string {
	href = strings.TrimSpace(href)
	if href == "" {
		return ""
	}
	u, err := url.Parse(href)
	if err == nil && u.IsAbs() {
		return href
	}
	b, err := url.Parse(baseURL)
	if err != nil {
		return href
	}
	r, err := b.Parse(href)
	if err != nil {
		return href
	}
	return r.String()
}

func extractPDFTextNative(data []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", err
	}
	var b strings.Builder
	n := r.NumPage()
	for i := 1; i <= n; i++ {
		p := r.Page(i)
		if p.V.IsNull() {
			continue
		}
		content := p.Content()
		for _, t := range content.Text {
			if strings.TrimSpace(t.S) != "" {
				b.WriteString(t.S)
				b.WriteString(" ")
			}
		}
	}
	return strings.TrimSpace(b.String()), nil
}

func extractPDFTextOCR(data []byte, timeout time.Duration) (string, string, error) {
	_, err := exec.LookPath("pdftoppm")
	if err != nil {
		return "", "not_available", fmt.Errorf("pdftoppm not found")
	}
	_, err = exec.LookPath("tesseract")
	if err != nil {
		return "", "not_available", fmt.Errorf("tesseract not found")
	}

	dir, err := os.MkdirTemp("", "snapflow-pdf-ocr-*")
	if err != nil {
		return "", "failed", err
	}
	defer os.RemoveAll(dir)

	pdfPath := filepath.Join(dir, "input.pdf")
	imgPrefix := filepath.Join(dir, "page")
	imgPath := filepath.Join(dir, "page.png")
	if err := os.WriteFile(pdfPath, data, 0o600); err != nil {
		return "", "failed", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	pdfToImg := exec.CommandContext(ctx, "pdftoppm", "-f", "1", "-singlefile", "-png", pdfPath, imgPrefix)
	if out, err := pdfToImg.CombinedOutput(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", "timeout", fmt.Errorf("ocr timeout during pdftoppm")
		}
		return "", "failed", fmt.Errorf("pdftoppm failed: %s", strings.TrimSpace(string(out)))
	}

	tess := exec.CommandContext(ctx, "tesseract", imgPath, "stdout", "-l", "eng+fra+ara", "--psm", "6")
	out, err := tess.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "", "timeout", fmt.Errorf("ocr timeout during tesseract")
		}
		return "", "failed", fmt.Errorf("tesseract failed: %s", strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), "ok", nil
}

func findKeywordEvidence(text string) ([]string, int) {
	norm := normalizeForKeywordMatch(text)
	type hit struct {
		keyword string
		count   int
	}
	hits := make([]hit, 0)
	total := 0
	for _, kw := range pdfSignalKeywords {
		count := countKeywordWithBoundary(norm, kw)
		if count > 0 {
			hits = append(hits, hit{keyword: kw, count: count})
			total += count
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].count == hits[j].count {
			return hits[i].keyword < hits[j].keyword
		}
		return hits[i].count > hits[j].count
	})
	limit := 10
	if len(hits) < limit {
		limit = len(hits)
	}
	keywords := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		keywords = append(keywords, hits[i].keyword)
	}
	return keywords, total
}

func findKeywordExcerpts(text string, maxExcerpts int) []string {
	if strings.TrimSpace(text) == "" {
		return []string{}
	}
	parts := sentenceSplitRe.Split(text, -1)
	excerpts := make([]string, 0, maxExcerpts)
	seen := map[string]bool{}
	for _, part := range parts {
		s := strings.TrimSpace(part)
		if len([]rune(s)) < 25 {
			continue
		}
		normSentence := normalizeForKeywordMatch(s)
		found := false
		for _, kw := range pdfSignalKeywords {
			if containsKeywordWithBoundary(normSentence, kw) {
				found = true
				break
			}
		}
		if !found {
			continue
		}
		if len([]rune(s)) > 260 {
			r := []rune(s)
			s = string(r[:260]) + "..."
		}
		if !seen[s] {
			seen[s] = true
			excerpts = append(excerpts, s)
			if len(excerpts) >= maxExcerpts {
				break
			}
		}
	}
	return excerpts
}

func buildPDFBreakdownEntry(baseURL string, link PrivacyLink, client *http.Client) PDFBreakdownEntry {
	entry := PDFBreakdownEntry{
		URL:           resolveLink(baseURL, link.URL),
		Type:          link.Type,
		FetchStatus:   "not_fetched",
		ExtractStatus: "not_available",
		OCRStatus:     "not_attempted",
		OCRTimeoutMs:  int(pdfOCRTimeout.Milliseconds()),
		KeywordsFound: []string{},
		Excerpts:      []string{},
		Errors:        []string{},
	}
	if entry.URL == "" {
		entry.FetchStatus = "failed"
		entry.Errors = append(entry.Errors, "empty PDF URL")
		return entry
	}

	req, err := http.NewRequest(http.MethodGet, entry.URL, nil)
	if err != nil {
		entry.FetchStatus = "failed"
		entry.Errors = append(entry.Errors, "request build failed: "+err.Error())
		return entry
	}
	resp, err := client.Do(req)
	if err != nil {
		entry.FetchStatus = "failed"
		entry.Errors = append(entry.Errors, "fetch failed: "+err.Error())
		return entry
	}
	defer resp.Body.Close()

	entry.HTTPStatus = resp.StatusCode
	entry.ContentType = resp.Header.Get("Content-Type")
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		entry.FetchStatus = "failed"
		entry.Errors = append(entry.Errors, fmt.Sprintf("unexpected HTTP status: %d", resp.StatusCode))
		return entry
	}
	entry.FetchStatus = "ok"

	pdfBytes, err := io.ReadAll(io.LimitReader(resp.Body, 15*1024*1024))
	if err != nil {
		entry.ExtractStatus = "failed"
		entry.Errors = append(entry.Errors, "read failed: "+err.Error())
		return entry
	}

	text, err := extractPDFTextNative(pdfBytes)
	if err != nil {
		entry.Errors = append(entry.Errors, "native extract failed: "+err.Error())
	}

	if strings.TrimSpace(text) == "" {
		txtOCR, ocrStatus, ocrErr := extractPDFTextOCR(pdfBytes, pdfOCRTimeout)
		entry.OCRStatus = ocrStatus
		if ocrErr != nil {
			entry.Errors = append(entry.Errors, "ocr: "+ocrErr.Error())
		}
		if strings.TrimSpace(txtOCR) != "" {
			text = txtOCR
			entry.ExtractMethod = "ocr"
			entry.ExtractStatus = "ok"
		} else {
			if ocrStatus == "timeout" {
				entry.ExtractStatus = "timeout"
			} else {
				entry.ExtractStatus = "not_available"
			}
		}
	} else {
		entry.ExtractMethod = "native"
		entry.ExtractStatus = "ok"
		entry.OCRStatus = "not_needed"
	}

	if strings.TrimSpace(text) == "" {
		return entry
	}

	entry.KeywordsFound, entry.KeywordHitTotal = findKeywordEvidence(text)
	entry.Excerpts = findKeywordExcerpts(text, 3)
	entry.StrongSignal, entry.MaxWindowHits = hasStrongSignal(text, pdfStrongSignalSpan, pdfStrongSignalHits)
	return entry
}

// ── Issue 7: multi-signal CMP detection ──────────────────────────────────────

// cmpScriptDomains lists script src / preconnect URL fragments that reliably
// identify a CMP even when the HTML-text signature is absent or obfuscated.
// Weight: 0.9 per match.
var cmpScriptDomains = []string{
	"axeptio.eu", "cookiebot.com", "onetrust.com", "didomi.io",
	"usercentrics.eu", "trustarc.com", "cookiepro.com",
}

// cmpScriptDomainsPreconnect weight 0.7 — <link rel="preconnect|prefetch"> to a CMP domain.
// (reuses cmpScriptDomains list, different weight)

// cmpCookiePatterns are cookie-name prefixes/exact matches that indicate a CMP
// dropped its consent cookie. Weight: 0.8.
var cmpCookiePatterns = []string{
	"CookieConsent", "OptanonConsent", "axeptio_", "didomi_", "euconsent",
}

// cmpMetaGeneratorRe matches <meta name="generator" content="…cookiebot…"> etc.
var cmpMetaGeneratorRe = regexp.MustCompile(`(?i)<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*(cookiebot|onetrust|axeptio|didomi|trustarc|usercentrics)[^"']*["']`)

// scriptSrcRe extracts src attribute values from <script> tags.
var scriptSrcRe = regexp.MustCompile(`(?i)<script[^>]+src=["']([^"']+)["']`)

// linkHrefTagRe extracts href from <link> tags (for preconnect/prefetch).
var linkHrefTagRe = regexp.MustCompile(`(?i)<link[^>]+href=["']([^"']+)["']`)

// setCookieNameRe extracts the cookie name (everything before the first '=').
// Used to match against response Set-Cookie headers passed in via the rawHeaders string.
var setCookieNameRe = regexp.MustCompile(`(?m)^Set-Cookie:\s*([^=\s;]+)`)

// detectCMP runs multi-signal CMP detection and returns (detected, provider, confidence).
// The caller passes the raw HTML; response headers are not available at this layer so
// cookie-name matching is done on Set-Cookie values embedded in the html string when
// the caller injects them (they are ignored otherwise).
func detectCMP(htmlLower, html string) (bool, string, float64) {
	var totalScore float64
	bestProvider := ""

	// Signal 1: HTML source signatures (existing) — weight 0.6.
	for provider, sigs := range cmpSignatures {
		for _, sig := range sigs {
			if strings.Contains(htmlLower, strings.ToLower(sig)) {
				totalScore += 0.6
				if bestProvider == "" {
					bestProvider = provider
				}
				break
			}
		}
	}

	// Signal 2: <script src="…cmp-domain…"> — weight 0.9.
	for _, m := range scriptSrcRe.FindAllStringSubmatch(html, -1) {
		src := strings.ToLower(m[1])
		for _, domain := range cmpScriptDomains {
			if strings.Contains(src, domain) {
				totalScore += 0.9
				if bestProvider == "" {
					bestProvider = domain
				}
				break
			}
		}
	}

	// Signal 3: <link> preconnect/prefetch to CMP domain — weight 0.7.
	for _, m := range linkHrefTagRe.FindAllStringSubmatch(html, -1) {
		href := strings.ToLower(m[1])
		for _, domain := range cmpScriptDomains {
			if strings.Contains(href, domain) {
				totalScore += 0.7
				if bestProvider == "" {
					bestProvider = domain
				}
				break
			}
		}
	}

	// Signal 4: Set-Cookie names matching CMP patterns — weight 0.8.
	// Matches when raw Set-Cookie lines are present in the input string.
	for _, m := range setCookieNameRe.FindAllStringSubmatch(html, -1) {
		cookieName := m[1]
		for _, pat := range cmpCookiePatterns {
			if strings.HasPrefix(cookieName, pat) || strings.EqualFold(cookieName, pat) {
				totalScore += 0.8
				break
			}
		}
	}

	// Signal 5: <meta name="generator" content="…cookiebot…"> — weight 0.7.
	if cmpMetaGeneratorRe.MatchString(html) {
		totalScore += 0.7
		if bestProvider == "" {
			bestProvider = "meta_generator"
		}
	}

	// Cap at 1.0 and apply detection threshold of 0.7.
	if totalScore > 1.0 {
		totalScore = 1.0
	}
	detected := totalScore >= 0.7
	return detected, bestProvider, totalScore
}

func Analyze(html string) PrivacyResult {
	return AnalyzeWithBaseURL("", html)
}

func AnalyzeWithBaseURL(baseURL string, html string) PrivacyResult {
	htmlLower := strings.ToLower(html)
	htmlNorm := normalizeForKeywordMatch(html)
	result := PrivacyResult{
		PrivacyLinks: []PrivacyLink{},
		RGPDKeywords: []RGPDKeyword{},
		PDFBreakdown: []PDFBreakdownEntry{},
		PDFSummary: PDFBreakdownSummary{
			OCRTimeoutSeconds: int(pdfOCRTimeout.Seconds()),
			StrongSignalRule:  ">= 2 RGPD keywords in the same 200-word window",
		},
		ServiceName: "v3-privacy-analyzer-go",
	}

	// 1. Detect Cookie Consent / CMP
	for provider, sigs := range cmpSignatures {
		for _, sig := range sigs {
			if strings.Contains(htmlLower, strings.ToLower(sig)) {
				result.CookieConsent = CookieConsent{Detected: true, Provider: provider}
				break
			}
		}
		if result.CookieConsent.Detected {
			break
		}
	}

	// 2. Detect privacy-related links (including .pdf links)
	stripTagsRe := regexp.MustCompile(`<[^>]*>`)
	linkMatches := linkHrefRe.FindAllStringSubmatch(html, -1)
	for _, m := range linkMatches {
		href := strings.TrimSpace(m[1])
		anchorText := strings.TrimSpace(m[2])
		anchorText = stripTagsRe.ReplaceAllString(anchorText, "")
		combined := strings.ToLower(href + " " + anchorText)

		for linkType, pattern := range privacyLinkPatterns {
			if pattern.MatchString(combined) {
				lowerHref := strings.ToLower(href)
				isPDF := strings.HasSuffix(lowerHref, ".pdf") || strings.Contains(lowerHref, ".pdf?")
				result.PrivacyLinks = append(result.PrivacyLinks, PrivacyLink{
					URL:   href,
					Type:  linkType,
					IsPDF: isPDF,
				})
				switch linkType {
				case "privacy_policy":
					result.HasPrivacyPolicy = true
				case "legal_notice":
					result.HasLegalNotice = true
				case "cookie_policy":
					result.HasCookiePolicy = true
				case "security_policy":
					result.HasSecurityPolicy = true // Phase C-1
				case "data_charter": // Gap #38
					result.HasDataCharter = true
					if result.DataCharterURL == "" {
						result.DataCharterURL = href
					}
				}
				break
			}
		}
	}

	// PR2: deep PDF privacy breakdown (additive, backward-compatible).
	pdfLinks := make([]PrivacyLink, 0)
	seenPDF := map[string]bool{}
	for _, link := range result.PrivacyLinks {
		if !link.IsPDF {
			continue
		}
		resolved := resolveLink(baseURL, link.URL)
		if resolved == "" || seenPDF[resolved] {
			continue
		}
		seenPDF[resolved] = true
		link.URL = resolved
		pdfLinks = append(pdfLinks, link)
	}
	result.PDFSummary.TotalPDFLinks = len(pdfLinks)
	if len(pdfLinks) > 0 {
		client := &http.Client{Timeout: pdfFetchTimeout}
		for _, pdfLink := range pdfLinks {
			entry := buildPDFBreakdownEntry(baseURL, pdfLink, client)
			result.PDFBreakdown = append(result.PDFBreakdown, entry)
			if entry.FetchStatus == "ok" {
				result.PDFSummary.AnalyzedPDFs++
			}
		}
	}

	// 3. Scan for RGPD keywords in page content
	for _, kw := range rgpdKeywords {
		found := containsKeywordWithBoundary(htmlNorm, kw)
		result.RGPDKeywords = append(result.RGPDKeywords, RGPDKeyword{
			Keyword: kw,
			Found:   found,
		})
	}

	if arabicScriptRe.MatchString(html) {
		for _, kw := range rgpdKeywordsArabic {
			found := containsKeywordWithBoundary(htmlNorm, kw)
			result.RGPDKeywords = append(result.RGPDKeywords, RGPDKeyword{
				Keyword: kw,
				Found:   found,
			})
		}
	}

	// Phase C-2: detect information rights text anywhere in the page
	result.HasInformationRights = informationRightsRe.MatchString(html)
	result.HasDeclaredPurpose = declaredPurposeRe.MatchString(html)

	// Phase C-3: detect consent checkbox near RGPD proximity keywords.
	// Strategy: find every checkbox position in the raw HTML, then check
	// whether any RGPD keyword appears within ±500 chars of that position.
	checkboxPositions := checkboxRe.FindAllStringIndex(html, -1)
	if len(checkboxPositions) > 0 {
	outer:
		for _, pos := range checkboxPositions {
			start := pos[0] - 500
			if start < 0 {
				start = 0
			}
			end := pos[1] + 500
			if end > len(html) {
				end = len(html)
			}
			window := strings.ToLower(html[start:end])
			for _, kw := range rgpdProximityKeywords {
				if strings.Contains(window, kw) {
					result.HasConsentCheckbox = true
					break outer
				}
			}
		}
	}

	// 4. Pass/fail — no numeric score
	var issues []string

	if !result.CookieConsent.Detected {
		issues = append(issues, "No cookie consent banner/CMP detected")
	}
	if !result.HasPrivacyPolicy {
		issues = append(issues, "No privacy policy link found")
	}
	if !result.HasLegalNotice {
		issues = append(issues, "No legal notice / mentions légales found")
	}
	if !result.HasCookiePolicy {
		issues = append(issues, "No cookie policy page found")
	}
	if !result.HasSecurityPolicy {
		issues = append(issues, "No security policy link found")
	}
	if !result.HasInformationRights {
		issues = append(issues, "Page does not mention data subject information rights")
	}
	if !result.HasDeclaredPurpose {
		issues = append(issues, "No explicit processing purpose/finality found")
	}
	if !result.HasConsentCheckbox {
		issues = append(issues, "No consent checkbox found near RGPD keywords")
	}

	// 5. Multi-criteria RGPD pass/fail (Issue 8).
	//
	// A site passes only when ALL five criteria are met:
	//   1. CMP detected with confidence >= 0.7
	//   2. Privacy policy page found
	//   3. Data subject rights mentioned
	//   4. Legal notice / mentions légales present (French law)
	//   5. No third-party trackers detected without a consent signal
	//
	// RGPDGaps lists every failed criterion so the result is defensible in
	// compliance audits.
	//
	// Run multi-signal CMP detection to get the confidence score.
	cmpDetected, cmpProvider, cmpConfidence := detectCMP(htmlLower, html)
	result.CMPConfidence = cmpConfidence
	// Back-fill CookieConsent from multi-signal detection if stronger than the
	// legacy signature-only path that already ran above.
	if cmpDetected && !result.CookieConsent.Detected {
		result.CookieConsent = CookieConsent{Detected: true, Provider: cmpProvider}
	}

	// Third-party tracker detection: look for known analytics/ad script domains
	// loaded without an active CMP consent signal.
	hasThirdPartyTrackers := detectThirdPartyTrackers(html, cmpDetected)

	var rgpdGaps []string
	if !cmpDetected || cmpConfidence < 0.7 {
		rgpdGaps = append(rgpdGaps, "Consent mechanism absent or low-confidence (CMP confidence < 0.7)")
	}
	if !result.HasPrivacyPolicy {
		rgpdGaps = append(rgpdGaps, "Privacy policy page not found")
	}
	if !result.HasInformationRights {
		rgpdGaps = append(rgpdGaps, "Data subject rights (Art.13-22 RGPD) not mentioned")
	}
	if !result.HasLegalNotice {
		rgpdGaps = append(rgpdGaps, "Legal notice / mentions légales absent (required by French law)")
	}
	if hasThirdPartyTrackers {
		rgpdGaps = append(rgpdGaps, "Third-party trackers detected without confirmed consent signal")
	}

	result.RGPDGaps = rgpdGaps
	result.Passed = len(rgpdGaps) == 0
	result.Issues = issues
	return result
}

// knownTrackerDomains lists analytics/advertising script domains whose presence
// without a CMP consent signal constitutes an RGPD gap.
var knownTrackerDomains = []string{
	"google-analytics.com", "googletagmanager.com", "googlesyndication.com",
	"doubleclick.net", "facebook.net", "connect.facebook.net",
	"hotjar.com", "segment.com", "mixpanel.com", "amplitude.com",
	"heap.io", "fullstory.com", "clarity.ms", "mouseflow.com",
	"linkedin.com/insightTag", "snap.licdn.com", "static.ads-twitter.com",
	"bat.bing.com", "analytics.tiktok.com",
}

// detectThirdPartyTrackers returns true when the page loads scripts from known
// tracker domains AND no consent mechanism has been confirmed (cmpActive=false).
// When a CMP is active we assume consent may have been obtained — the tracker
// presence is then acceptable from a detection standpoint.
func detectThirdPartyTrackers(html string, cmpActive bool) bool {
	if cmpActive {
		return false
	}
	htmlLower := strings.ToLower(html)
	for _, domain := range knownTrackerDomains {
		if strings.Contains(htmlLower, strings.ToLower(domain)) {
			return true
		}
	}
	return false
}
