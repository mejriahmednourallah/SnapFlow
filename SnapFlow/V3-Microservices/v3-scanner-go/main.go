package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

	"snapflow/v3-scanner-go/analyzers/formbrowser"
	"snapflow/v3-scanner-go/analyzers/formfuzzer"
	"snapflow/v3-scanner-go/analyzers/functional"
	"snapflow/v3-scanner-go/analyzers/performance"
	"snapflow/v3-scanner-go/analyzers/privacy"
	"snapflow/v3-scanner-go/analyzers/security"
	"snapflow/v3-scanner-go/analyzers/seo"
	"snapflow/v3-scanner-go/analyzers/tech"
	"snapflow/v3-scanner-go/analyzers/ux"
	"snapflow/v3-scanner-go/browserpool"
	"snapflow/v3-scanner-go/db"

	"github.com/gocolly/colly/v2"
)

type ScannerConfig struct {
	ScanID              string
	StartURL            string
	AllowedDomains      []string
	MaxDepth            int
	MaxPages            int
	Parallelism         int
	HeadlessConcurrency int
}

type BrokenLink struct {
	URL        string `json:"url"`
	FoundOn    string `json:"found_on"`
	AnchorText string `json:"anchor_text,omitempty"`
	// Phase J: status code captured from HTTP response
	StatusCode int    `json:"status_code,omitempty"`
	Error      string `json:"error,omitempty"`
	IsExternal bool   `json:"is_external"`
}

type DuplicatePage struct {
	Hash  string   `json:"hash"`
	Pages []string `json:"pages"`
}

// ImageCompressionInfo holds the result of a HEAD-check on a single image URL.
type ImageCompressionInfo struct {
	URL                 string  `json:"url"`
	SizeKB              float64 `json:"size_kb"`
	ContentType         string  `json:"content_type"`
	IsLikelyUnoptimised bool    `json:"is_likely_unoptimised"`
}

// ImageCompressionStats aggregates the image compression check across the whole site.
type ImageCompressionStats struct {
	TotalImages        int                    `json:"total_images"`
	SampledImages      int                    `json:"sampled_images"`
	UnoptimisedImages  []ImageCompressionInfo `json:"unoptimised_images"`
	UnoptimisedCount   int                    `json:"unoptimised_count"`
	CompressionRatePct float64                `json:"compression_rate_pct"` // Gap #22
	Passed             bool                   `json:"passed"`
}

// Compact per-page entry: only pages WITH issues get listed
type PageIssueEntry struct {
	URL      string            `json:"url"`
	Score    int               `json:"score"`
	Issues   []string          `json:"issues"`
	Headings []seo.HeadingInfo `json:"headings"`
	Meta     seo.MetaInfo      `json:"meta"`
}

type UXPageIssue struct {
	URL    string   `json:"url"`
	Issues []string `json:"issues"`
}

// Aggregated SEO summary across all pages
type SEOSummary struct {
	TotalPages           int     `json:"total_pages"`
	AvgScore             float64 `json:"avg_score"`
	MinScore             int     `json:"min_score"`
	MaxScore             int     `json:"max_score"`
	PagesWithIssues      int     `json:"pages_with_issues"`
	TotalImages          int     `json:"total_images"`
	ImagesWithoutAlt     int     `json:"images_without_alt"`
	TotalInternalLinks   int     `json:"total_internal_links"`
	TotalExternalLinks   int     `json:"total_external_links"`
	PagesMissingMetaDesc int     `json:"pages_missing_meta_desc"`
	PagesMissingTitle    int     `json:"pages_missing_title"`
	PagesWithBadH1       int     `json:"pages_with_bad_h1"`
	PagesNotURLClean     int     `json:"pages_not_url_clean"`
	PagesWithoutLazy     int     `json:"pages_without_lazy_loading"`
	// Phase K: site-wide aggregations
	HomepageH1Missing       bool    `json:"homepage_h1_missing"`
	HomepageH1KPIPassed     bool    `json:"homepage_h1_kpi_passed"`
	DuplicateContentRatePct float64 `json:"duplicate_content_rate_pct"`
	DupContentKPIPassed     bool    `json:"dup_content_kpi_passed"`
	UniqueExternalDomains   int     `json:"unique_external_domains"`
	NodeStyleURLCount       int     `json:"node_style_url_count"`
	NodeURLKPIPassed        bool    `json:"node_url_kpi_passed"`
	PagesWithSocialSharing  int     `json:"pages_with_social_sharing"`
	AvgSocialSharingScore   float64 `json:"avg_social_sharing_score"`
	SocialSharingKPIPassed  bool    `json:"social_sharing_kpi_passed"`
}

type UXSummary struct {
	PagesWithMissingImages int `json:"pages_with_missing_images"`
	PagesWithLowTextRatio  int `json:"pages_with_low_text_ratio"`
	PagesWithMissingLinks  int `json:"pages_with_missing_links"`
	PagesWithMaps          int `json:"pages_with_maps"`
	PagesWithSimulators    int `json:"pages_with_simulators"`
	PagesWithFunnels       int `json:"pages_with_funnels"`
}

type PhaseTimings struct {
	PreFetchMS     int64 `json:"pre_fetch"`
	DomainAnalysis int64 `json:"domain_analysis"`
	CrawlMS        int64 `json:"crawl"`
	PostCrawlSync  int64 `json:"post_crawl_sync"`
	HeadlessMS     int64 `json:"headless"`
	DBWaitMS       int64 `json:"db_wait"`
}

type ScanTelemetry struct {
	StopReason        string             `json:"stop_reason"`
	PhaseTimingsMS    PhaseTimings       `json:"phase_timings_ms"`
	PagesAtStop       int                `json:"pages_at_stop"`
	BudgetRemainingMS int64              `json:"budget_remaining_ms"`
	FormFuzzer        formfuzzer.Summary `json:"form_fuzzer"`
	// Issue 5: headless coverage metadata
	HeadlessCoveragePct     float64 `json:"headless_coverage_pct"`
	PartialHeadlessCoverage bool    `json:"partial_headless_coverage,omitempty"`
}

type FinalReport struct {
	Domain           string                      `json:"domain"`
	Sitemap          bool                        `json:"has_sitemap"`
	RobotsTxt        bool                        `json:"has_robots_txt"`
	DomainSecurity   security.ScanResult         `json:"domain_security"`
	DomainTech       tech.TechResult             `json:"domain_tech"`
	DomainPrivacy    privacy.PrivacyResult       `json:"domain_privacy"`
	DomainFunctional functional.FunctionalResult `json:"domain_functional"`
	SEOSummary       SEOSummary                  `json:"seo_summary"`
	SEOIssues        []PageIssueEntry            `json:"seo_issues"`
	UXSummary        UXSummary                   `json:"ux_summary"`
	UXIssues         []UXPageIssue               `json:"ux_issues"`
	BrokenLinks      []BrokenLink                `json:"broken_links"`
	// Phase J: summary counts
	BrokenLinkCount    int                          `json:"broken_link_count"`
	BrokenLinksPassed  bool                         `json:"broken_links_passed"`
	DuplicatePages     []DuplicatePage              `json:"duplicate_pages"`
	HeadlessResults    []performance.HeadlessResult `json:"headless_results"`
	HeadlessSampleSize int                          `json:"headless_sample_size"`
	ImageCompression   ImageCompressionStats        `json:"image_compression"`
	FormFuzzer         formfuzzer.Summary           `json:"form_fuzzer"`
	PagesScanned       int                          `json:"pages_scanned"`
	ScanDuration       string                       `json:"scan_duration"`
	ScanTelemetry      ScanTelemetry                `json:"scan_telemetry"`
	// Issue 1: SPA detection flag for downstream KPI consumers
	IsSPA bool `json:"is_spa"`
}

type ScanRequestPayload struct {
	ScanID              string   `json:"scan_id"`
	URL                 string   `json:"url"`
	Domains             []string `json:"domains"`
	MaxPages            int      `json:"max_pages"`
	HeadlessConcurrency int      `json:"headless_concurrency"`
}

type FormFuzzerRuntimeConfig struct {
	Enabled              bool
	Concurrency          int
	TimeoutSec           int
	MaxForms             int
	PayloadProfile       string
	MinBudgetSec         int
	Env                  string
	ProductionBlock      bool
	EnableModalDetection bool // Layer 5: Modal form trigger detection
}

type FormBrowserRuntimeConfig struct {
	Enabled    bool
	TimeoutSec int
	MaxForms   int
	Headless   bool
}

func sanitizeInputText(s string) string {
	s = strings.TrimSpace(s)
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.In(r, unicode.Cf) {
			return -1
		}
		return r
	}, s)
}

func sanitizeDomains(domains []string) []string {
	clean := make([]string, 0, len(domains))
	seen := map[string]bool{}
	for _, d := range domains {
		d = sanitizeInputText(d)
		d = strings.TrimPrefix(strings.TrimPrefix(d, "https://"), "http://")
		d = strings.TrimSuffix(d, "/")
		if d == "" || seen[d] {
			continue
		}
		seen[d] = true
		clean = append(clean, d)
	}
	return clean
}

func envBool(key string, defaultValue bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return defaultValue
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return defaultValue
	}
}

// isSPASite returns true when the crawl reveals SPA framework fingerprints.
// It checks static HTML string signatures, script-src filenames, mount-div
// patterns, Angular attributes, SPA router tags, and a low anchor-link ratio.
func isSPASite(results []seo.SEOResult) bool {
	// Inline string signals present anywhere in the page HTML
	spaSignals := []string{
		"__NEXT_DATA__",
		"window.__nuxt__",
		"data-reactroot",
		"ng-version",
		"__vue_hmr_id",
		"window.angular",
		"ng-app",
	}

	// Framework filenames that appear in <script src="..."> paths
	frameworkScriptNames := []string{
		"react", "vue", "angular", "svelte", "ember", "backbone",
	}

	// Self-closing / standalone SPA router tags
	routerTags := []string{
		"<router-view", "<nuxt/", "<outlet",
	}

	for _, r := range results {
		if r.URL == "" {
			continue
		}
		h := r.RawHTML
		hLower := strings.ToLower(h)

		// 1. Classic inline signals
		for _, sig := range spaSignals {
			if strings.Contains(h, sig) {
				return true
			}
		}

		// 2. <div id="root"> or <div id="app"> with empty/minimal children
		for _, mountID := range []string{`id="root"`, `id='root'`, `id="app"`, `id='app'`} {
			if idx := strings.Index(hLower, mountID); idx >= 0 {
				// Look for the closing </div> within the next ~200 bytes — minimal children
				snippet := hLower[idx:]
				if len(snippet) > 200 {
					snippet = snippet[:200]
				}
				closeIdx := strings.Index(snippet, "</div>")
				if closeIdx >= 0 && closeIdx < 80 {
					return true
				}
			}
		}

		// 3. <script type="module"> referencing a large JS bundle (src present)
		if strings.Contains(hLower, `type="module"`) || strings.Contains(hLower, `type='module'`) {
			if strings.Contains(hLower, "<script") && strings.Contains(hLower, "src=") {
				return true
			}
		}

		// 4. Framework JS file names in <script src="...">
		for _, fw := range frameworkScriptNames {
			// e.g. src="/static/js/react.production.min.js"
			needle := "src=\""
			remaining := hLower
			for {
				i := strings.Index(remaining, needle)
				if i < 0 {
					break
				}
				remaining = remaining[i+len(needle):]
				end := strings.IndexByte(remaining, '"')
				if end < 0 {
					break
				}
				srcVal := remaining[:end]
				remaining = remaining[end+1:]
				if strings.Contains(srcVal, fw) && strings.HasSuffix(srcVal, ".js") {
					return true
				}
			}
		}

		// 5. SPA router component tags
		for _, tag := range routerTags {
			if strings.Contains(hLower, tag) {
				return true
			}
		}

		// 6. Very low <a href> to total DOM element ratio → JS-routed navigation
		// Count anchor links and total element open-tags
		aCount := strings.Count(hLower, "<a ")
		totalTags := strings.Count(hLower, "<")
		if totalTags > 50 && aCount*20 < totalTags {
			// Fewer than 1 anchor per 20 elements — suspicious for JS routing
			return true
		}
	}
	return false
}

func envInt(key string, defaultValue int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return defaultValue
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultValue
	}
	return n
}

func envFloat64(key string, defaultValue float64) float64 {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return defaultValue
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return defaultValue
	}
	return n
}

func loadHeadlessSampleRatio() float64 {
	// Default to 80% coverage. Minimum enforced at 0.80 so KPI accuracy is
	// maintained. SPA detection overrides to 1.0 regardless of this value.
	ratio := envFloat64("HEADLESS_SAMPLE_RATIO", 0.80)
	if ratio < 0.80 {
		ratio = 0.80
	}
	if ratio > 1.0 {
		ratio = 1.0
	}
	return ratio
}

// headlessPageCap is the maximum number of pages sent to the headless pool
// regardless of crawl size or sample ratio. Keeps scan time predictable on
// large sites while still hitting the 80% target on sites ≤ 125 pages.
const headlessPageCap = 100

// minReliableContentHashConfidence is the minimum confidence accepted when
// computing site-wide duplication rates. Lower-quality hashes are excluded to
// avoid false 100% duplication when extraction falls back to weak text blocks.
const minReliableContentHashConfidence = 0.45

func evidenceProvenanceFromHeadless(hr performance.HeadlessResult) string {
	if strings.TrimSpace(hr.RenderedHTML) != "" {
		return "mixed"
	}
	if strings.TrimSpace(hr.Error) == "" {
		return "runtime"
	}
	return "static"
}

func getAppEnv() string {
	for _, key := range []string{"APP_ENV", "SNAPFLOW_ENV", "ENV"} {
		if v := strings.TrimSpace(strings.ToLower(os.Getenv(key))); v != "" {
			return v
		}
	}
	return "dev"
}

func isProdEnv(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "prod", "production", "live":
		return true
	default:
		return false
	}
}

func loadFormFuzzerRuntimeConfig() FormFuzzerRuntimeConfig {
	env := getAppEnv()
	cfg := FormFuzzerRuntimeConfig{
		Enabled:              envBool("ENABLE_FORM_FUZZER", true),
		Concurrency:          envInt("FORM_FUZZ_CONCURRENCY", 4),
		TimeoutSec:           envInt("FORM_FUZZ_TIMEOUT_SEC", 20),
		MaxForms:             envInt("FORM_FUZZ_MAX_FORMS", 25),
		PayloadProfile:       strings.TrimSpace(strings.ToLower(os.Getenv("FORM_FUZZ_PAYLOAD_PROFILE"))),
		MinBudgetSec:         envInt("FORM_FUZZ_MIN_BUDGET_SEC", 60),
		Env:                  env,
		ProductionBlock:      true,
		EnableModalDetection: envBool("ENABLE_MODAL_FORM_DETECTION", true), // Layer 5
	}
	if cfg.PayloadProfile == "" {
		cfg.PayloadProfile = "standard"
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 4
	}
	if cfg.TimeoutSec <= 0 {
		cfg.TimeoutSec = 20
	}
	if cfg.MaxForms <= 0 {
		cfg.MaxForms = 25
	}
	if cfg.MinBudgetSec <= 0 {
		cfg.MinBudgetSec = 60
	}
	if envBool("ALLOW_FORM_FUZZER_PROD", false) {
		cfg.ProductionBlock = false
	}
	return cfg
}

func loadFormBrowserRuntimeConfig() FormBrowserRuntimeConfig {
	cfg := FormBrowserRuntimeConfig{
		Enabled:    envBool("ENABLE_FORM_BROWSER", true),
		TimeoutSec: envInt("FORM_BROWSER_TIMEOUT_SEC", 60),
		MaxForms:   envInt("FORM_BROWSER_MAX_FORMS", 25),
		Headless:   envBool("FORM_BROWSER_HEADLESS", true),
	}
	if cfg.TimeoutSec <= 0 {
		cfg.TimeoutSec = 60
	}
	if cfg.MaxForms <= 0 {
		cfg.MaxForms = 25
	}
	return cfg
}

func isCloudflareChallenge(body string, headers *http.Header) bool {
	lower := strings.ToLower(body)
	if strings.Contains(lower, "one moment, please") ||
		strings.Contains(lower, "attention required") ||
		strings.Contains(lower, "/cdn-cgi/challenge-platform/") ||
		strings.Contains(lower, "cf-challenge") {
		return true
	}

	if headers == nil {
		return false
	}

	server := strings.ToLower(strings.TrimSpace(headers.Get("Server")))
	if strings.Contains(server, "cloudflare") {
		return true
	}
	if headers.Get("CF-RAY") != "" || headers.Get("cf-ray") != "" {
		return true
	}

	return false
}

func main() {
	log.Printf("KPI mode: new (legacy path removed)")

	// Connect to DB once at startup
	if os.Getenv("DB_HOST") != "" {
		if err := db.Connect(); err != nil {
			log.Printf("⚠ DB not available, running without persistence: %v", err)
		} else {
			defer db.Close()
		}
	}

	http.HandleFunc("/scan", handleScan)
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("🚀 Go Scanner Service listening on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleScan(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var payload ScanRequestPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
		return
	}
	payload.URL = sanitizeInputText(payload.URL)
	payload.Domains = sanitizeDomains(payload.Domains)
	if payload.URL == "" {
		http.Error(w, "URL is required", http.StatusBadRequest)
		return
	}
	if payload.MaxPages <= 0 {
		payload.MaxPages = 100
	}
	if payload.HeadlessConcurrency <= 0 {
		payload.HeadlessConcurrency = 4
	}
	if len(payload.Domains) == 0 {
		if u, err := url.Parse(payload.URL); err == nil && u.Host != "" {
			payload.Domains = []string{u.Host}
		}
	}

	log.Printf("Received scan request for URL: %s (max_pages=%d, allowed_domains=%v)", payload.URL, payload.MaxPages, payload.Domains)

	// Keep the scan alive for its own timeout budget instead of inheriting the
	// caller's HTTP request lifetime. Upstream clients/proxies can cancel long
	// requests early, which otherwise aborts the crawl before pages are fetched.
	//
	// Section 2.1: configurable scan timeout (default 600s = 10 min)
	timeoutSec := 600
	if v := os.Getenv("SCANNER_TIMEOUT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			timeoutSec = n
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	// Section 2.3: configurable parallelism (default 150)
	parallelism := 150
	if v := os.Getenv("SCANNER_PARALLELISM"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			parallelism = n
		}
	}

	config := ScannerConfig{
		ScanID:              payload.ScanID,
		StartURL:            payload.URL,
		AllowedDomains:      payload.Domains,
		MaxDepth:            0, // 0 means infinite depth
		MaxPages:            payload.MaxPages,
		Parallelism:         parallelism,
		HeadlessConcurrency: payload.HeadlessConcurrency,
	}

	// Start scan synchronously (blocks until crawl is fully complete)
	startScan(ctx, config)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"message": "Scan complete"}`))
}

func startScan(ctx context.Context, config ScannerConfig) {
	log.Printf("Starting Scan for %s [ID: %s]", config.StartURL, config.ScanID)
	scanDone := make(chan struct{})
	defer close(scanDone)
	startTime := time.Now()
	formFuzzerCfg := loadFormFuzzerRuntimeConfig()
	formBrowserCfg := loadFormBrowserRuntimeConfig()
	effectiveMaxPages := config.MaxPages
	if effectiveMaxPages <= 0 {
		effectiveMaxPages = 100
	}
	log.Printf(
		"Form-fuzzer runtime: enabled=%v env=%s concurrency=%d timeout_sec=%d max_forms=%d profile=%s",
		formFuzzerCfg.Enabled,
		formFuzzerCfg.Env,
		formFuzzerCfg.Concurrency,
		formFuzzerCfg.TimeoutSec,
		formFuzzerCfg.MaxForms,
		formFuzzerCfg.PayloadProfile,
	)
	log.Printf(
		"Form-browser runtime: enabled=%v timeout_sec=%d max_forms=%d headless=%v",
		formBrowserCfg.Enabled,
		formBrowserCfg.TimeoutSec,
		formBrowserCfg.MaxForms,
		formBrowserCfg.Headless,
	)
	var stopReason string
	var stopReasonSet uint32
	setStopReason := func(reason string) {
		if reason == "" {
			return
		}
		if atomic.CompareAndSwapUint32(&stopReasonSet, 0, 1) {
			stopReason = reason
		}
	}

	u, err := url.Parse(config.StartURL)
	if err != nil {
		log.Printf("Invalid start URL: %v", err)
		return
	}
	baseURL := u.Scheme + "://" + u.Host
	scanID := config.ScanID

	// ALL PRE-FETCH CHECKS RUN CONCURRENTLY
	var sslInfo security.SSLInfo
	var hasSitemap, hasRobots bool
	var robotsProbe seo.HTTPProbeResult
	var sitemapProbe seo.HTTPProbeResult
	var robotsTxtContent string
	var htmlBody string
	var domainHeaders *http.Header
	var domainSecRes security.ScanResult
	var domainTechRes tech.TechResult
	var domainPrivacyRes privacy.PrivacyResult
	var domainFuncRes functional.FunctionalResult

	var preWg sync.WaitGroup
	preFetchStart := time.Now()
	preWg.Add(4)
	robotsReady := make(chan struct{})

	go func() {
		defer preWg.Done()
		sslInfo = security.CheckSSL(baseURL)
	}()
	go func() {
		defer preWg.Done()
		<-robotsReady
		sitemapProbe = seo.ProbeSitemap(baseURL, &robotsProbe)
		hasSitemap = sitemapProbe.Present
	}()
	go func() {
		defer preWg.Done()
		robotsProbe = seo.ProbeRobotsTxt(baseURL)
		hasRobots = robotsProbe.Present
		robotsTxtContent = robotsProbe.Body
		close(robotsReady)
	}()
	go func() {
		defer preWg.Done()
		prefetchClient := &http.Client{Timeout: 10 * time.Second} // [NEW-1] Bounded timeout.
		resp, err := prefetchClient.Get(baseURL)
		if err != nil {
			return
		}
		defer resp.Body.Close()
		bodyBytes, _ := io.ReadAll(resp.Body)
		htmlBody = string(bodyBytes)
		domainHeaders = &resp.Header
	}()

	preWg.Wait()
	preFetchMS := time.Since(preFetchStart).Milliseconds()
	sslErrLower := strings.ToLower(strings.TrimSpace(sslInfo.Error))
	tlsUnknownAuthority := strings.Contains(sslErrLower, "unknown authority")
	allowInsecureTLS := envBool("SCANNER_ALLOW_INSECURE_TLS", tlsUnknownAuthority)
	if allowInsecureTLS && tlsUnknownAuthority {
		log.Printf("⚠ TLS trust failure detected (%s) — enabling insecure TLS fallback for crawl/prefetch", sslInfo.Error)
	}
	if allowInsecureTLS && htmlBody == "" {
		insecureClient := &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
			},
		}
		if resp, err := insecureClient.Get(baseURL); err == nil {
			defer resp.Body.Close()
			if bodyBytes, readErr := io.ReadAll(resp.Body); readErr == nil {
				htmlBody = string(bodyBytes)
				domainHeaders = &resp.Header
			}
		}
		if robotsTxtContent == "" {
			if resp, err := insecureClient.Get(baseURL + "/robots.txt"); err == nil {
				defer resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					hasRobots = true
					if bodyBytes, readErr := io.ReadAll(resp.Body); readErr == nil {
						robotsTxtContent = string(bodyBytes)
					}
				}
			}
		}
	}

	if domainHeaders == nil {
		domainHeaders = &http.Header{}
	}

	var analyzeWg sync.WaitGroup
	domainAnalyzeStart := time.Now()

	// Tech analysis runs first to provide cms_name for security analysis
	domainTechRes = tech.Analyze(baseURL, htmlBody, domainHeaders)

	// Security, Privacy, and Functional analyses run in parallel with cms_name available
	analyzeWg.Add(3)
	go func() {
		defer analyzeWg.Done()
		// Convert tech results to TechInfo for CVE matching
		var detectedTechs []security.TechInfo
		for _, tech := range domainTechRes.ModuleVersions {
			detectedTechs = append(detectedTechs, security.TechInfo{
				Name:    tech.Name,
				Version: tech.Version,
			})
		}
		domainSecRes = security.Analyze(baseURL, domainTechRes.CMS, robotsTxtContent, htmlBody, domainHeaders, sslInfo, detectedTechs)
	}()
	go func() {
		defer analyzeWg.Done()
		domainPrivacyRes = privacy.AnalyzeWithBaseURL(baseURL, htmlBody)
	}()
	go func() {
		defer analyzeWg.Done()
		domainFuncRes = functional.AnalyzeWithBaseURL(baseURL, htmlBody)
	}()
	analyzeWg.Wait()
	domainAnalysisMS := time.Since(domainAnalyzeStart).Milliseconds()

	if !hasRobots && strings.TrimSpace(robotsTxtContent) != "" {
		hasRobots = true
		if !robotsProbe.Present {
			robotsProbe = seo.HTTPProbeResult{
				Present:     true,
				FinalURL:    strings.TrimRight(baseURL, "/") + "/robots.txt",
				DetectedVia: "content_reuse",
				Body:        robotsTxtContent,
			}
		}
	}
	if !hasRobots && len(domainSecRes.RobotsTxtInfoDisclosure.DisclosedPaths) > 0 {
		hasRobots = true
		if !robotsProbe.Present {
			robotsProbe = seo.HTTPProbeResult{
				Present:     true,
				FinalURL:    strings.TrimRight(baseURL, "/") + "/robots.txt",
				DetectedVia: "security_reuse",
			}
		}
	}
	if !hasSitemap && hasRobots && strings.TrimSpace(robotsTxtContent) != "" {
		sitemapProbe = seo.ProbeSitemap(baseURL, &robotsProbe)
		hasSitemap = sitemapProbe.Present
	}

	// Persist domain-level summary to database
	if err := db.InsertSummary(scanID, baseURL, domainSecRes, domainTechRes, domainPrivacyRes, domainFuncRes); err != nil {
		log.Printf("⚠ Failed to save domain summary: %v", err)
	}

	fmt.Println("Domain-level analysis complete. Starting crawler...")

	report := FinalReport{
		Domain:           baseURL,
		Sitemap:          hasSitemap,
		RobotsTxt:        hasRobots,
		DomainSecurity:   domainSecRes,
		DomainTech:       domainTechRes,
		DomainPrivacy:    domainPrivacyRes,
		DomainFunctional: domainFuncRes,
		SEOIssues:        []PageIssueEntry{},
		UXIssues:         []UXPageIssue{},
		BrokenLinks:      []BrokenLink{},
		DuplicatePages:   []DuplicatePage{},
	}

	c := colly.NewCollector(
		colly.Async(true),
		colly.MaxDepth(config.MaxDepth),
		colly.AllowedDomains(config.AllowedDomains...),
		colly.UserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
	)

	c.Limit(&colly.LimitRule{
		DomainGlob:  "*",
		Parallelism: config.Parallelism,
		RandomDelay: 50 * time.Millisecond,
	})

	// Section 2.2: per-request HTTP transport with connection + response timeouts
	c.WithTransport(&http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: allowInsecureTLS},
		ResponseHeaderTimeout: 15 * time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConnsPerHost:   config.Parallelism,
	})

	log.Printf("Scanner initialized with %d concurrent goroutines", config.Parallelism)

	var mu sync.Mutex
	var dbWg sync.WaitGroup
	var pageCount int32
	var crawlStopped int32 // Section 2.1: set to 1 when ctx deadline fires
	contentHashes := map[string][]string{}

	// Accumulators for summary aggregation
	var allSEOResults []seo.SEOResult
	var allUXResults []ux.UXResult
	var discoveredForms []formfuzzer.DiscoveredForm
	seenDiscoveredForms := map[string]bool{}
	brokenURLSet := map[string]bool{}       // track 404 URLs to exclude from headless sampling
	allImageURLs := map[string]bool{}       // Phase I: unique image URLs seen during crawl
	allExternalDomains := map[string]bool{} // Phase K: unique external link hostnames
	reliableContentHashPages := 0
	lowQualityContentHashPages := 0
	var totalResourceBytes int64  // Phase R: aggregate downloaded bytes across crawled pages
	var gatewayTimeoutCount int32 // Phase R: count HTTP 504 occurrences
	var cloudflareChallengeDetected uint32
	crawlDebug := envBool("SCANNER_VERBOSE_CRAWL_LOGS", true)
	var discoveredURLCount int32
	var enqueueSuccessCount int32
	var enqueueErrorCount int32
	var skippedEmptyCount int32
	var skippedSchemeCount int32
	var skippedEmailLikeCount int32
	var skippedBinaryCount int32
	var skippedFragmentOnlyCount int32
	var skippedForbiddenDomainCount int32
	var skippedInvalidAbsCount int32
	var onErrorAlreadyVisitedCount int32
	var onErrorDeadlineCount int32
	var onErrorUnsupportedSchemeCount int32
	logCrawlDebug := func(format string, args ...interface{}) {
		if crawlDebug {
			log.Printf(format, args...)
		}
	}
	if isCloudflareChallenge(htmlBody, domainHeaders) {
		atomic.StoreUint32(&cloudflareChallengeDetected, 1)
	}

	c.OnRequest(func(r *colly.Request) {
		// Section 2.1: abort all pending requests when scan timeout fires
		if atomic.LoadInt32(&crawlStopped) == 1 {
			r.Abort()
			return
		}
		count := atomic.LoadInt32(&pageCount)
		if count > 0 && count%10 == 0 {
			log.Printf("Progress: %d pages processed...", count)
		}
	})

	c.OnError(func(r *colly.Response, e error) {
		mu.Lock()
		defer mu.Unlock()
		parent := r.Ctx.Get("parent")
		anchor := r.Ctx.Get("anchor")
		urlStr := r.Request.URL.String()

		errStr := e.Error()

		if strings.Contains(errStr, "already visited") {
			atomic.AddInt32(&onErrorAlreadyVisitedCount, 1)
			return
		}
		if strings.Contains(errStr, "context deadline exceeded") {
			atomic.AddInt32(&onErrorDeadlineCount, 1)
			return
		}
		if strings.Contains(errStr, "unsupported protocol scheme") {
			atomic.AddInt32(&onErrorUnsupportedSchemeCount, 1)
			return
		}

		// Phase J: skip redirects (3xx) — only flag 4xx/5xx or network errors
		sc := r.StatusCode
		if sc > 0 && sc < 400 {
			return
		}
		if sc == http.StatusTooManyRequests || sc == http.StatusServiceUnavailable {
			return
		}
		if sc == http.StatusGatewayTimeout {
			atomic.AddInt32(&gatewayTimeoutCount, 1)
		}
		logCrawlDebug("⚠ crawl error: url=%s status=%d parent=%s source=%s err=%v", urlStr, sc, parent, r.Ctx.Get("source"), e)

		if strings.HasPrefix(urlStr, "http") {
			isExt := !strings.Contains(urlStr, u.Host)
			report.BrokenLinks = append(report.BrokenLinks, BrokenLink{
				URL:        urlStr,
				FoundOn:    parent,
				AnchorText: anchor,
				StatusCode: sc,
				Error:      e.Error(),
				IsExternal: isExt,
			})
			brokenURLSet[urlStr] = true
		}
	})

	// enqueueCrawlURL is a helper used by all link-discovery handlers below.
	// It normalises, validates and enqueues a URL for crawling.
	// source is a short label (e.g. "a_href", "js_inferred") stored in the
	// colly context so downstream code can distinguish discovery origin.
	enqueueCrawlURL := func(rawLink, parentURL, anchorText, source string) {
		if int(atomic.LoadInt32(&pageCount)) >= effectiveMaxPages {
			return
		}
		atomic.AddInt32(&discoveredURLCount, 1)
		rawLink = strings.TrimSpace(rawLink)
		if rawLink == "" {
			atomic.AddInt32(&skippedEmptyCount, 1)
			return
		}
		if strings.HasPrefix(rawLink, "#") {
			atomic.AddInt32(&skippedFragmentOnlyCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=fragment_only", source, parentURL, rawLink)
			return
		}
		linkLower := strings.ToLower(rawLink)
		if strings.HasPrefix(linkLower, "tel:") || strings.HasPrefix(linkLower, "javascript:") || strings.HasPrefix(linkLower, "mailto:") {
			atomic.AddInt32(&skippedSchemeCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=scheme", source, parentURL, rawLink)
			return
		}
		if strings.Contains(rawLink, "@") && !strings.HasPrefix(linkLower, "mailto:") && !strings.HasPrefix(linkLower, "http") {
			atomic.AddInt32(&skippedEmailLikeCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=email_like", source, parentURL, rawLink)
			return
		}
		if strings.HasSuffix(linkLower, ".pdf") || strings.HasSuffix(linkLower, ".doc") ||
			strings.HasSuffix(linkLower, ".docx") || strings.HasSuffix(linkLower, ".xls") ||
			strings.HasSuffix(linkLower, ".xlsx") || strings.HasSuffix(linkLower, ".zip") ||
			strings.HasSuffix(linkLower, ".rar") {
			atomic.AddInt32(&skippedBinaryCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=binary", source, parentURL, rawLink)
			return
		}
		absLink := e2abs(parentURL, rawLink, baseURL)
		if absLink == "" {
			atomic.AddInt32(&skippedInvalidAbsCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=invalid_absolute", source, parentURL, rawLink)
			return
		}
		absParsed, err := url.Parse(absLink)
		if err != nil || absParsed.Hostname() == "" {
			atomic.AddInt32(&skippedInvalidAbsCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=invalid_host", source, parentURL, rawLink)
			return
		}
		if !isHostAllowedForCrawl(absParsed.Hostname(), config.AllowedDomains) {
			atomic.AddInt32(&skippedForbiddenDomainCount, 1)
			logCrawlDebug("↷ skip link: source=%s parent=%s raw=%s reason=forbidden_domain", source, parentURL, rawLink)
			return
		}
		ctx := colly.NewContext()
		ctx.Put("parent", parentURL)
		ctx.Put("anchor", strings.TrimSpace(anchorText))
		ctx.Put("source", source)
		if err := c.Request("GET", absLink, nil, ctx, nil); err != nil {
			atomic.AddInt32(&enqueueErrorCount, 1)
			logCrawlDebug("⚠ enqueue failed: source=%s parent=%s url=%s err=%v", source, parentURL, absLink, err)
			return
		}
		queued := atomic.AddInt32(&enqueueSuccessCount, 1)
		if crawlDebug && (queued <= 25 || queued%25 == 0) {
			log.Printf("→ enqueued crawl url #%d: source=%s parent=%s url=%s", queued, source, parentURL, absLink)
		}
	}

	c.OnHTML("a[href]", func(e *colly.HTMLElement) {
		link := e.Attr("href")
		enqueueCrawlURL(link, e.Request.URL.String(), e.Text, "a_href")
	})

	// Issue 2: additional link-discovery handlers -------------------------

	// button[data-href], button[data-url], [data-link], [data-route], [data-target]
	c.OnHTML("[data-href],[data-url],[data-link],[data-route],[data-target]", func(e *colly.HTMLElement) {
		for _, attr := range []string{"data-href", "data-url", "data-link", "data-route", "data-target"} {
			if v := e.Attr(attr); v != "" && (strings.HasPrefix(v, "/") || strings.HasPrefix(strings.ToLower(v), "http")) {
				enqueueCrawlURL(v, e.Request.URL.String(), "", "js_inferred")
			}
		}
	})

	// [onclick*="location"] — extract bare path string from onclick attributes
	c.OnHTML("[onclick]", func(e *colly.HTMLElement) {
		onclick := e.Attr("onclick")
		if !strings.Contains(onclick, "location") {
			return
		}
		// Extract string literals that look like absolute paths: "/something"
		remaining := onclick
		for {
			i := strings.IndexByte(remaining, '\'')
			if i < 0 {
				i = strings.IndexByte(remaining, '"')
			}
			if i < 0 {
				break
			}
			q := remaining[i]
			remaining = remaining[i+1:]
			end := strings.IndexByte(remaining, q)
			if end < 0 {
				break
			}
			candidate := remaining[:end]
			remaining = remaining[end+1:]
			if strings.HasPrefix(candidate, "/") && !strings.Contains(candidate, " ") {
				enqueueCrawlURL(candidate, e.Request.URL.String(), "", "js_inferred")
			}
		}
	})

	// <meta http-equiv="refresh" content="5; url=/new-page">
	c.OnHTML(`meta[http-equiv="refresh"],meta[http-equiv='refresh']`, func(e *colly.HTMLElement) {
		content := e.Attr("content")
		lower := strings.ToLower(content)
		idx := strings.Index(lower, "url=")
		if idx < 0 {
			return
		}
		refreshURL := strings.TrimSpace(content[idx+4:])
		refreshURL = strings.Trim(refreshURL, `'"`)
		enqueueCrawlURL(refreshURL, e.Request.URL.String(), "", "meta_refresh")
	})

	// <link rel="alternate"> and <link rel="canonical">
	c.OnHTML(`link[rel="alternate"],link[rel='alternate'],link[rel="canonical"],link[rel='canonical']`, func(e *colly.HTMLElement) {
		href := e.Attr("href")
		enqueueCrawlURL(href, e.Request.URL.String(), "", "link_rel")
	})

	// Inline <script> blocks: extract string literals that look like URL paths
	// from window.location, router.push, history.pushState patterns.
	c.OnHTML("script:not([src])", func(e *colly.HTMLElement) {
		body := e.Text
		lower := strings.ToLower(body)
		// Only process scripts that reference routing APIs
		if !strings.Contains(lower, "location") &&
			!strings.Contains(lower, "router.push") &&
			!strings.Contains(lower, "history.pushstate") {
			return
		}
		// Extract all single/double-quoted string literals starting with "/"
		for _, q := range []byte{'"', '\''} {
			remaining := body
			for {
				i := strings.IndexByte(remaining, q)
				if i < 0 {
					break
				}
				remaining = remaining[i+1:]
				end := strings.IndexByte(remaining, q)
				if end < 0 {
					break
				}
				candidate := remaining[:end]
				remaining = remaining[end+1:]
				// Must look like a URL path: starts with "/" and no whitespace
				if strings.HasPrefix(candidate, "/") &&
					!strings.Contains(candidate, " ") &&
					len(candidate) > 1 &&
					len(candidate) < 200 {
					enqueueCrawlURL(candidate, e.Request.URL.String(), "", "js_inferred")
				}
			}
		}
	})

	c.OnResponse(func(r *colly.Response) {
		newCount := atomic.AddInt32(&pageCount, 1)
		if int(newCount) >= effectiveMaxPages {
			setStopReason("max_pages")
			atomic.StoreInt32(&crawlStopped, 1)
		}
		if int(newCount) > effectiveMaxPages {
			return
		}
		atomic.AddInt64(&totalResourceBytes, int64(len(r.Body)))
		if r.StatusCode == http.StatusGatewayTimeout {
			atomic.AddInt32(&gatewayTimeoutCount, 1)
		}
		targetURL := strings.TrimSpace(r.Request.URL.String())

		if strings.HasSuffix(targetURL, "/") && strings.Count(targetURL, "/") > 3 {
			targetURL = strings.TrimSuffix(targetURL, "/")
		}

		html := string(r.Body)
		if isCloudflareChallenge(html, r.Headers) {
			atomic.StoreUint32(&cloudflareChallengeDetected, 1)
		}

		var seoRes seo.SEOResult
		var uxRes ux.UXResult
		var pWg sync.WaitGroup
		pWg.Add(2)
		go func() {
			defer pWg.Done()
			seoRes = seo.Analyze(targetURL, html, hasSitemap, hasRobots)
		}()
		go func() {
			defer pWg.Done()
			uxRes = ux.Analyze(targetURL, html, baseURL)
		}()
		pWg.Wait()

		extractedForms := formfuzzer.ExtractForms(targetURL, html)

		mu.Lock()
		for _, f := range extractedForms {
			formKey := f.PageURL + "|" + f.FormID + "|" + f.ActionURL
			if seenDiscoveredForms[formKey] {
				continue
			}
			seenDiscoveredForms[formKey] = true
			discoveredForms = append(discoveredForms, f)
		}
		allSEOResults = append(allSEOResults, seoRes)
		allUXResults = append(allUXResults, uxRes)
		for _, d := range seoRes.Links.ExternalDomains {
			allExternalDomains[d] = true
		}

		// Track only reliable content hashes for duplicate detection.
		hashValue := strings.TrimSpace(seoRes.ContentHash)
		if hashValue == "" || seoRes.ContentHashConfidence < minReliableContentHashConfidence {
			lowQualityContentHashPages++
		} else {
			reliableContentHashPages++
			found := false
			for _, p := range contentHashes[hashValue] {
				if p == targetURL {
					found = true
					break
				}
			}
			if !found {
				contentHashes[hashValue] = append(contentHashes[hashValue], targetURL)
			}
		}
		mu.Unlock()

		// Pack both metrics into a single map for the DB JSON field.
		// Issue 4: mark html_source="static" explicitly so NLP worker knows
		// this page was NOT hydrated by headless — RenderedHTML is empty here.
		// Headless processing later calls MergePageMetrics which will overwrite
		// evidence_provenance and html_source for sampled pages.
		pageMetrics := map[string]interface{}{
			"seo":                 seoRes,
			"ux":                  uxRes,
			"evidence_provenance": "static",
			"html_source":         "static",
		}

		// Push to database (async, non-blocking)
		dbWg.Add(1)
		go func(u, h string, m interface{}) {
			defer dbWg.Done()
			if err := db.InsertPage(scanID, baseURL, u, h, m); err != nil {
				log.Printf("⚠ DB insert failed for %s: %v", u, err)
			}
		}(targetURL, html, pageMetrics)
	})

	// Phase I: collect unique absolute image src URLs during crawl
	c.OnHTML("img[src]", func(e *colly.HTMLElement) {
		src := e.Request.AbsoluteURL(e.Attr("src"))
		if src != "" && strings.HasPrefix(src, "http") {
			mu.Lock()
			allImageURLs[src] = true
			mu.Unlock()
		}
	})

	// Section 2.1: stop the crawler gracefully when the context deadline fires
	go func() {
		select {
		case <-scanDone:
			return
		case <-ctx.Done():
			// Ignore the normal cancellation that happens when the scan is already complete.
			if ctx.Err() == context.Canceled {
				select {
				case <-scanDone:
					return
				default:
				}
			}
			atomic.StoreInt32(&crawlStopped, 1)
			if ctx.Err() == context.DeadlineExceeded {
				log.Printf("⏱ Scanner timeout reached — aborting new requests after %d pages",
					atomic.LoadInt32(&pageCount))
			} else {
				log.Printf("⚠ Scanner request canceled by upstream (%v) — aborting new requests after %d pages",
					ctx.Err(), atomic.LoadInt32(&pageCount))
			}
		}
	}()

	crawlStart := time.Now()
	if err := c.Visit(config.StartURL); err != nil {
		log.Printf("⚠ Initial visit failed for %s: %v", config.StartURL, err)
	}
	c.Wait()
	crawlMS := time.Since(crawlStart).Milliseconds()
	log.Printf(
		"Crawl diagnostics: discovered=%d enqueued=%d enqueue_errors=%d skipped_empty=%d skipped_scheme=%d skipped_email_like=%d skipped_binary=%d skipped_fragment_only=%d skipped_forbidden_domain=%d skipped_invalid_abs=%d already_visited=%d request_deadline=%d unsupported_scheme=%d gateway_timeouts=%d",
		atomic.LoadInt32(&discoveredURLCount),
		atomic.LoadInt32(&enqueueSuccessCount),
		atomic.LoadInt32(&enqueueErrorCount),
		atomic.LoadInt32(&skippedEmptyCount),
		atomic.LoadInt32(&skippedSchemeCount),
		atomic.LoadInt32(&skippedEmailLikeCount),
		atomic.LoadInt32(&skippedBinaryCount),
		atomic.LoadInt32(&skippedFragmentOnlyCount),
		atomic.LoadInt32(&skippedForbiddenDomainCount),
		atomic.LoadInt32(&skippedInvalidAbsCount),
		atomic.LoadInt32(&onErrorAlreadyVisitedCount),
		atomic.LoadInt32(&onErrorDeadlineCount),
		atomic.LoadInt32(&onErrorUnsupportedSchemeCount),
		atomic.LoadInt32(&gatewayTimeoutCount),
	)

	// Wait for all database inserts to complete before moving to analysis
	log.Printf("Crawl complete. Waiting for database sync...")
	dbWaitStart := time.Now()
	dbWaitDone := make(chan struct{})
	go func() {
		dbWg.Wait()
		close(dbWaitDone)
	}()
	select {
	case <-dbWaitDone:
		// All good.
	case <-time.After(120 * time.Second):
		setStopReason("db_backpressure")
		log.Printf("⚠ dbWg timeout after 120s, continuing with partial persisted data")
	}
	dbWaitMS := time.Since(dbWaitStart).Milliseconds()

	fmt.Printf("Database sync complete. %d pages scanned. Aggregating...\n", len(allSEOResults))
	if len(allSEOResults) == 0 {
		log.Printf("⚠ Crawl produced 0 static pages before fallback checks")
	}
	postCrawlSyncStart := time.Now()

	// ============================================================
	// CF FALLBACK — PHASE 1: Seed homepage when Colly got 0 pages
	// ============================================================
	// When the target is behind Cloudflare, Colly's plain HTTP client is
	// blocked (usually 403) while the pre-fetch already captured the CF
	// challenge page as a valid 200 response. We seed allSEOResults with
	// that HTML so the headless pool always has at least 1 URL to process.
	cfFallbackMode := atomic.LoadInt32(&pageCount) == 0 && htmlBody != ""
	if cfFallbackMode {
		log.Printf("⚠ Colly crawl blocked (0 pages) — seeding from pre-fetch HTML")
		prefetchSEO := seo.Analyze(baseURL, htmlBody, hasSitemap, hasRobots)
		prefetchUX := ux.Analyze(baseURL, htmlBody, baseURL)
		mu.Lock()
		allSEOResults = append(allSEOResults, prefetchSEO)
		allUXResults = append(allUXResults, prefetchUX)
		mu.Unlock()
		pageMetrics := map[string]interface{}{
			"seo":                 prefetchSEO,
			"ux":                  prefetchUX,
			"evidence_provenance": "static_prefetch",
			"html_source":         "static_prefetch",
		}
		if err := db.InsertPage(scanID, baseURL, baseURL, htmlBody, pageMetrics); err != nil {
			log.Printf("⚠ CF fallback: homepage DB insert failed: %v", err)
		}
	}
	formFuzzerSummary := formfuzzer.Summary{
		Enabled:         formFuzzerCfg.Enabled,
		FormsDiscovered: len(discoveredForms),
	}

	if len(discoveredForms) == 0 && formBrowserCfg.Enabled && atomic.LoadUint32(&cloudflareChallengeDetected) == 1 {
		browserTimeout := time.Duration(formBrowserCfg.TimeoutSec) * time.Second
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline) - 5*time.Second
			if remaining > 0 && remaining < browserTimeout {
				browserTimeout = remaining
			}
		}

		if browserTimeout > 0 {
			if browserpool.IsEnabled() {
				log.Printf("No HTTP forms found with Cloudflare challenge markers, trying browser-pool render fallback...")
				timeoutMS := int(browserTimeout.Milliseconds())
				renderResult, renderErr := browserpool.Render(ctx, config.StartURL, timeoutMS, "networkidle")
				if renderErr != nil {
					log.Printf("⚠ Browser-pool render fallback failed: %v", renderErr)
				} else if renderResult.Error != "" {
					log.Printf("⚠ Browser-pool render returned error: %s", renderResult.Error)
				} else {
					finalURL := renderResult.FinalURL
					if finalURL == "" {
						finalURL = config.StartURL
					}
					fallbackForms, parseErr := formbrowser.AnalyzeFromHTML(ctx, finalURL, renderResult.RenderedHTML, formbrowser.Config{
						MaxForms: formBrowserCfg.MaxForms,
					})
					if parseErr != nil {
						log.Printf("⚠ Browser-pool form parse failed: %v", parseErr)
					} else if len(fallbackForms) > 0 {
						discoveredForms = fallbackForms
						formFuzzerSummary.FormsDiscovered = len(discoveredForms)
						log.Printf("✓ Browser-pool fallback recovered %d forms", len(fallbackForms))
					}
				}
			} else {
				log.Printf("No HTTP forms found with Cloudflare challenge markers, trying Rod fallback...")
				fallbackForms, err := formbrowser.AnalyzeWithBrowser(ctx, config.StartURL, formbrowser.Config{
					Timeout:  browserTimeout,
					MaxForms: formBrowserCfg.MaxForms,
					Headless: formBrowserCfg.Headless,
				})
				if err != nil {
					log.Printf("⚠ Rod fallback failed: %v", err)
				} else if len(fallbackForms) > 0 {
					discoveredForms = fallbackForms
					formFuzzerSummary.FormsDiscovered = len(discoveredForms)
					log.Printf("✓ Rod fallback recovered %d forms", len(discoveredForms))
				}
			}
		}
	}

	// ============================================================
	// PHASE J: BROKEN LINK SUMMARY
	// ============================================================
	report.BrokenLinkCount = len(report.BrokenLinks)
	report.BrokenLinksPassed = report.BrokenLinkCount == 0
	fmt.Printf("Broken links: %d found, passed=%v\n", report.BrokenLinkCount, report.BrokenLinksPassed)
	brokenSummary := map[string]interface{}{
		"broken_link_count":   report.BrokenLinkCount,
		"broken_links_passed": report.BrokenLinksPassed,
		"broken_links":        report.BrokenLinks,
		"pages_checked":       int(atomic.LoadInt32(&pageCount)),
		"urls_discovered":     int(atomic.LoadInt32(&discoveredURLCount)),
		"urls_enqueued":       int(atomic.LoadInt32(&enqueueSuccessCount)),
	}
	if err := db.UpdateBrokenLinks(scanID, brokenSummary); err != nil {
		log.Printf("⚠ UpdateBrokenLinks failed: %v", err)
	}

	// ============================================================
	// PHASE I: IMAGE COMPRESSION CHECK
	// ============================================================
	imgStats := checkImageCompression(allImageURLs)
	report.ImageCompression = imgStats
	fmt.Printf("Image compression check: %d sampled, %d unoptimised, passed=%v\n",
		imgStats.SampledImages, imgStats.UnoptimisedCount, imgStats.Passed)
	if err := db.UpdateImageCompression(scanID, imgStats); err != nil {
		log.Printf("⚠ UpdateImageCompression failed: %v", err)
	}

	// ============================================================
	// AGGREGATE SEO DATA
	// ============================================================
	summary := SEOSummary{
		TotalPages: len(allSEOResults),
		MinScore:   100,
		MaxScore:   0,
	}
	totalScore := 0
	totalSocialSharingScore := 0

	for _, res := range allSEOResults {
		totalScore += res.Score
		if res.Score < summary.MinScore {
			summary.MinScore = res.Score
		}
		if res.Score > summary.MaxScore {
			summary.MaxScore = res.Score
		}
		summary.TotalImages += res.TotalImages
		summary.ImagesWithoutAlt += res.ImagesNoAlt
		summary.TotalInternalLinks += res.Links.InternalLinks
		summary.TotalExternalLinks += res.Links.ExternalLinks

		if !res.Meta.HasMetaDesc {
			summary.PagesMissingMetaDesc++
		}
		if res.Meta.Title == "" {
			summary.PagesMissingTitle++
		}
		if !res.HeadingValid {
			summary.PagesWithBadH1++
		}
		if !res.URLClean {
			summary.PagesNotURLClean++
		}
		if !res.HasLazyImages {
			summary.PagesWithoutLazy++
		}
		summary.NodeStyleURLCount += res.NodeStyleURLCount // Phase K-4: site-wide total
		totalSocialSharingScore += res.SocialSharingScore
		if res.HasOGType || res.HasTwitterCard || len(res.SocialShareButtons) > 0 {
			summary.PagesWithSocialSharing++
		}

		// Only store full detail for pages WITH issues
		if len(res.Issues) > 0 {
			summary.PagesWithIssues++
			report.SEOIssues = append(report.SEOIssues, PageIssueEntry{
				URL:      res.URL,
				Score:    res.Score,
				Issues:   res.Issues,
				Headings: res.Headings,
				Meta:     res.Meta,
			})
		}
	}

	if summary.TotalPages > 0 {
		summary.AvgScore = float64(totalScore) / float64(summary.TotalPages)
		summary.AvgSocialSharingScore = float64(totalSocialSharingScore) / float64(summary.TotalPages)
	}

	// ============================================================
	// PHASE K: SITE-WIDE SEO AGGREGATIONS
	// ============================================================
	// K-1: Homepage missing H1
	homepageURL := strings.TrimSuffix(config.StartURL, "/")
	for _, res := range allSEOResults {
		if strings.TrimSuffix(res.URL, "/") == homepageURL {
			hasH1 := false
			for _, h := range res.Headings {
				if strings.EqualFold(h.Tag, "h1") {
					hasH1 = true
					break
				}
			}
			summary.HomepageH1Missing = !hasH1
			break
		}
	}
	summary.HomepageH1KPIPassed = !summary.HomepageH1Missing

	// K-2: Duplicate content rate (reliable hashes only)
	dupPages := 0
	for _, pages := range contentHashes {
		if len(pages) > 1 {
			dupPages += len(pages)
		}
	}
	if reliableContentHashPages > 0 {
		summary.DuplicateContentRatePct = float64(dupPages) / float64(reliableContentHashPages) * 100
	}
	summary.DupContentKPIPassed = summary.DuplicateContentRatePct <= 10.0
	duplicationReliability := "reliable"
	if lowQualityContentHashPages > 0 {
		duplicationReliability = "partial"
	}
	if summary.DuplicateContentRatePct >= 80.0 && lowQualityContentHashPages > 0 {
		duplicationReliability = "pipeline_suspect"
	}

	// K-3: Unique external domains
	summary.UniqueExternalDomains = len(allExternalDomains)

	// K-4: NodeStyleURLCount already summed in loop; set KPI passed
	summary.NodeURLKPIPassed = summary.NodeStyleURLCount == 0
	if summary.TotalPages > 0 {
		summary.SocialSharingKPIPassed = (float64(summary.PagesWithSocialSharing) / float64(summary.TotalPages)) >= 0.70
	}

	fmt.Printf("Phase K — H1 missing: %v, dup rate: %.1f%%, ext domains: %d, node URLs: %d\n",
		summary.HomepageH1Missing, summary.DuplicateContentRatePct,
		summary.UniqueExternalDomains, summary.NodeStyleURLCount)

	seoKPIExtended := map[string]interface{}{
		"has_sitemap":                    hasSitemap,
		"has_robots_txt":                 hasRobots,
		"sitemap_url":                    sitemapProbe.FinalURL,
		"sitemap_detected_via":           sitemapProbe.DetectedVia,
		"robots_url":                     robotsProbe.FinalURL,
		"robots_detected_via":            robotsProbe.DetectedVia,
		"total_internal_links":           summary.TotalInternalLinks,
		"total_external_links":           summary.TotalExternalLinks,
		"total_resource_size_kb":         math.Round((float64(atomic.LoadInt64(&totalResourceBytes))/1024.0)*10) / 10,
		"gateway_timeout_count":          int(atomic.LoadInt32(&gatewayTimeoutCount)),
		"homepage_h1_missing":            summary.HomepageH1Missing,
		"homepage_h1_kpi_passed":         summary.HomepageH1KPIPassed,
		"duplicate_content_rate_pct":     summary.DuplicateContentRatePct,
		"dup_content_kpi_passed":         summary.DupContentKPIPassed,
		"content_hash_eligible_pages":    reliableContentHashPages,
		"content_hash_low_quality_pages": lowQualityContentHashPages,
		"duplication_reliability":        duplicationReliability,
		"unique_external_domains":        summary.UniqueExternalDomains,
		"node_style_url_count":           summary.NodeStyleURLCount,
		"node_url_kpi_passed":            summary.NodeURLKPIPassed,
		"pages_with_social_sharing":      summary.PagesWithSocialSharing,
		"avg_social_sharing_score":       summary.AvgSocialSharingScore,
		"social_sharing_kpi_passed":      summary.SocialSharingKPIPassed,
	}
	if err := db.UpdateSEOKPIExtended(scanID, seoKPIExtended); err != nil {
		log.Printf("⚠ UpdateSEOKPIExtended failed: %v", err)
	}

	report.SEOSummary = summary
	report.PagesScanned = summary.TotalPages

	// ============================================================
	// AGGREGATE UX DATA
	// ============================================================
	uxSummary := UXSummary{}
	for i, res := range allUXResults {
		if len(res.ProductCardsMissingImages) > 0 {
			uxSummary.PagesWithMissingImages++
		}
		if !res.IsReadable {
			uxSummary.PagesWithLowTextRatio++
		}
		if res.ContextualInternalLinks == 0 && res.TextContentRatio > 0 {
			// This is a rough proxy, the strict logic is in ux.go producing Issues
		}
		// Accurate counts based on issues
		hadLinksIssue := false
		for _, iss := range res.Issues {
			if strings.Contains(iss, "Maillage default") {
				hadLinksIssue = true
			}
		}
		if hadLinksIssue {
			uxSummary.PagesWithMissingLinks++
		}

		if res.HasMap {
			uxSummary.PagesWithMaps++
		}
		if res.SimulatorCount > 0 {
			uxSummary.PagesWithSimulators++
		}
		if res.IsFunnelStep {
			uxSummary.PagesWithFunnels++
		}

		if len(res.Issues) > 0 {
			report.UXIssues = append(report.UXIssues, UXPageIssue{
				URL:    allSEOResults[i].URL, // 1:1 index alignment
				Issues: res.Issues,
			})
		}
	}
	report.UXSummary = uxSummary

	// ============================================================
	// FORM FUZZER (Phase A+B+C): run after crawl sync, before headless
	// ============================================================
	formFuzzerStart := time.Now()

	// Layer 5: Modal Form Discovery (before main fuzzer run)
	// Detect CTA buttons that trigger modals and extract forms from them
	if formFuzzerCfg.EnableModalDetection && len(discoveredForms) < formFuzzerCfg.MaxForms {
		if atomic.LoadInt32(&pageCount) == 0 && len(discoveredForms) == 0 {
			log.Printf("ℹ Modal discovery skipped: crawl produced 0 pages/forms")
		} else {
			log.Printf("🔍 Scanning for modal forms triggered by CTA buttons...")
			browserTimeout := time.Duration(formFuzzerCfg.TimeoutSec) * time.Second
			if deadline, ok := ctx.Deadline(); ok {
				remaining := time.Until(deadline) - 10*time.Second
				if remaining > 0 && remaining < browserTimeout {
					browserTimeout = remaining
				}
			}

			if browserTimeout > 0 && ctx.Err() == nil {
				var modalForms []formfuzzer.DiscoveredForm

				if browserpool.IsEnabled() {
					// Pool path: render the page with networkidle and parse any forms
					// that are visible after JS execution (auto-open modals, lazy content).
					// Click-triggered modals require a future /render-with-clicks pool
					// endpoint; until then they are discovered by the NLP/visual worker.
					log.Printf("🔍 Browser-pool modal/JS form discovery (networkidle render)...")
					timeoutMS := int(browserTimeout.Milliseconds())
					renderResult, renderErr := browserpool.Render(ctx, config.StartURL, timeoutMS, "networkidle")
					if renderErr != nil {
						log.Printf("⚠ Browser-pool modal render failed: %v", renderErr)
					} else if renderResult.Error != "" {
						log.Printf("⚠ Browser-pool modal render returned error: %s", renderResult.Error)
					} else {
						finalURL := renderResult.FinalURL
						if finalURL == "" {
							finalURL = config.StartURL
						}
						cap := formFuzzerCfg.MaxForms - len(discoveredForms)
						parsed, parseErr := formbrowser.AnalyzeFromHTML(ctx, finalURL, renderResult.RenderedHTML, formbrowser.Config{
							MaxForms: cap,
						})
						if parseErr != nil {
							log.Printf("⚠ Browser-pool modal form parse failed: %v", parseErr)
						} else {
							modalForms = parsed
						}
					}
				} else {
					// Local rod path: launch Chromium, click CTA buttons, extract modal forms.
					var localErr error
					modalForms, localErr = formfuzzer.DiscoverModalsWithLocalBrowser(ctx, config.StartURL)
					if localErr != nil {
						log.Printf("⚠ Modal discovery failed: %v", localErr)
					}
				}

				if len(modalForms) > 0 {
					seenForms := map[string]bool{}
					for _, f := range discoveredForms {
						key := f.PageURL + "|" + f.FormID + "|" + f.ActionURL
						seenForms[key] = true
					}
					addedCount := 0
					for _, mf := range modalForms {
						if addedCount >= formFuzzerCfg.MaxForms-len(discoveredForms) {
							break
						}
						key := mf.PageURL + "|" + mf.FormID + "|" + mf.ActionURL
						if !seenForms[key] {
							discoveredForms = append(discoveredForms, mf)
							addedCount++
						}
					}
					if addedCount > 0 {
						log.Printf("✓ Modal/JS form discovery added %d new forms (total: %d)", addedCount, len(discoveredForms))
						formFuzzerSummary.FormsDiscovered = len(discoveredForms)
					}
				}
			}
		}
	}

	switch {
	case !formFuzzerCfg.Enabled:
		formFuzzerSummary.SkippedReason = "disabled"
	case formFuzzerCfg.ProductionBlock && isProdEnv(formFuzzerCfg.Env):
		formFuzzerSummary.SkippedReason = "blocked_in_production"
	case len(discoveredForms) == 0:
		if atomic.LoadUint32(&cloudflareChallengeDetected) == 1 {
			formFuzzerSummary.SkippedReason = "no_forms_cloudflare"
		} else {
			formFuzzerSummary.SkippedReason = "no_forms"
		}
	default:
		remainingMS := int64(0)
		if deadline, ok := ctx.Deadline(); ok {
			remainingMS = time.Until(deadline).Milliseconds()
		}
		if remainingMS > 0 && remainingMS < int64(formFuzzerCfg.MinBudgetSec)*1000 {
			formFuzzerSummary.SkippedReason = "insufficient_budget"
			break
		}

		allowed := map[string]bool{}
		for _, d := range config.AllowedDomains {
			d = strings.ToLower(strings.TrimSpace(d))
			d = strings.TrimPrefix(d, "www.")
			if i := strings.IndexByte(d, ':'); i >= 0 {
				d = d[:i]
			}
			if d != "" {
				allowed[d] = true
			}
		}

		timeout := time.Duration(formFuzzerCfg.TimeoutSec) * time.Second
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline) - 5*time.Second
			if remaining <= 0 {
				formFuzzerSummary.SkippedReason = "deadline_near"
				break
			}
			if remaining < timeout {
				timeout = remaining
			}
		}

		fuzzCtx, cancelFuzz := context.WithTimeout(ctx, timeout)
		fuzzResults, runSummary := formfuzzer.Run(fuzzCtx, discoveredForms, formfuzzer.Config{
			AllowedDomains: allowed,
			Concurrency:    formFuzzerCfg.Concurrency,
			MaxForms:       formFuzzerCfg.MaxForms,
			RequestTimeout: 10 * time.Second,
			PayloadProfile: formFuzzerCfg.PayloadProfile,
		})
		cancelFuzz()

		formFuzzerSummary = runSummary
		formFuzzerSummary.Enabled = formFuzzerCfg.Enabled

		records := make([]db.FormFuzzResultRecord, 0, len(fuzzResults))
		for _, r := range fuzzResults {
			records = append(records, db.FormFuzzResultRecord{
				ScanID:        scanID,
				PageURL:       r.PageURL,
				ActionURL:     r.ActionURL,
				FormID:        r.FormID,
				TestType:      r.TestType,
				Payload:       r.Payload,
				ResponseType:  r.ResponseType,
				StatusCode:    r.StatusCode,
				Anomaly:       r.Anomaly,
				AnomalyReason: r.AnomalyReason,
				DurationMS:    r.DurationMS,
				Error:         r.Error,
			})
		}
		if err := db.InsertFormFuzzResults(records); err != nil {
			log.Printf("⚠ InsertFormFuzzResults failed: %v", err)
		}
	}
	if formFuzzerSummary.DurationMS == 0 {
		formFuzzerSummary.DurationMS = time.Since(formFuzzerStart).Milliseconds()
	}
	report.FormFuzzer = formFuzzerSummary
	if err := db.UpdateFormFuzzerSummary(scanID, formFuzzerSummary); err != nil {
		log.Printf("⚠ UpdateFormFuzzerSummary failed: %v", err)
	}

	// Build duplicate pages report
	for hash, pages := range contentHashes {
		if len(pages) > 1 {
			report.DuplicatePages = append(report.DuplicatePages, DuplicatePage{
				Hash:  hash,
				Pages: pages,
			})
		}
	}

	// ============================================================
	// BUILD HEADLESS SAMPLE LIST (default 35%, configurable)
	// ============================================================
	headlessSampleRatio := loadHeadlessSampleRatio()
	// Issue 1: detect SPA and expose flag in report metadata
	report.IsSPA = isSPASite(allSEOResults)
	if report.IsSPA {
		headlessSampleRatio = 1.0
		log.Printf("🔍 SPA framework detected — overriding headless sample ratio to 100%%")
	}
	sampleURLs := buildHeadlessSample(allSEOResults, brokenURLSet, config.StartURL, headlessSampleRatio)
	homepageInHeadlessSample := false
	for _, u := range sampleURLs {
		if strings.TrimRight(u, "/") == strings.TrimRight(config.StartURL, "/") {
			homepageInHeadlessSample = true
			break
		}
	}
	if !homepageInHeadlessSample {
		sampleURLs = append([]string{config.StartURL}, sampleURLs...)
	}
	fmt.Printf("Selected %d pages for headless analysis (%.0f%% sample).\n", len(sampleURLs), headlessSampleRatio*100)
	postCrawlSyncMS := time.Since(postCrawlSyncStart).Milliseconds()

	// Run headless browser analysis on sampled pages
	headlessStart := time.Now()
	headlessCtxExpiredBefore := ctx.Err() != nil
	headlessResults := performance.RunHeadlessPool(sampleURLs, config.HeadlessConcurrency)
	headlessMS := time.Since(headlessStart).Milliseconds()
	if !headlessCtxExpiredBefore && ctx.Err() != nil {
		setStopReason("headless_overrun")
	}

	// Phase H (Issue 3): Mobile performance trace on up to 3 representative pages.
	// 1. Homepage  2. Most-linked internal page  3. A leaf page (no outgoing internal links)
	mobileTestURLs := selectMobileTestPages(allSEOResults, config.StartURL)
	fmt.Printf("Running mobile performance trace on %d representative page(s)…\n", len(mobileTestURLs))

	type mobileEntry struct {
		url    string
		result performance.MobilePerformanceResult
	}
	mobileRawResults := performance.RunMobileTraces(mobileTestURLs)
	mobileEntries := make([]mobileEntry, 0, len(mobileTestURLs))
	for i, mURL := range mobileTestURLs {
		mobileEntries = append(mobileEntries, mobileEntry{url: mURL, result: mobileRawResults[i]})
	}

	// Attach individual mobile results to matching headless results; also
	// build the average score across successfully measured pages only.
	var mobileFCPSum, mobileLCPSum, mobileCLSSum float64
	mobileMeasuredCount := 0
	mobileIndividualScores := make(map[string]interface{}, len(mobileEntries))
	for _, me := range mobileEntries {
		me := me // capture
		mobileIndividualScores[me.url] = map[string]interface{}{
			"fcp_ms":             me.result.FCPMS,
			"lcp_ms":             me.result.LCPMS,
			"cls":                me.result.CLS,
			"speed_index_ms":     me.result.SpeedIndexMS,
			"available":          me.result.Available,
			"measurement_status": me.result.MeasurementStatus,
			"data_quality":       me.result.DataQuality,
			"passed":             me.result.Passed,
			"issues":             me.result.Issues,
			"error":              me.result.Error,
		}
		if me.result.Available && me.result.FCPMS > 0 && me.result.LCPMS > 0 {
			mobileMeasuredCount++
			mobileFCPSum += me.result.FCPMS
			mobileLCPSum += me.result.LCPMS
			mobileCLSSum += me.result.CLS
		}

		// Attach to headless result entry if present
		attached := false
		for i := range headlessResults {
			if strings.TrimRight(headlessResults[i].URL, "/") == strings.TrimRight(me.url, "/") {
				mr := me.result
				headlessResults[i].MobileMetrics = &mr
				attached = true
				break
			}
		}
		if !attached {
			mr := me.result
			headlessResults = append(headlessResults, performance.HeadlessResult{
				URL:           me.url,
				MobileMetrics: &mr,
			})
		}
	}

	// Compute averages (guard against failed captures). Failed captures are
	// represented as null, not 0ms, so downstream KPIs can stay non_evalue.
	var mobileAvgFCP, mobileAvgLCP, mobileAvgCLS interface{}
	if mobileMeasuredCount > 0 {
		mobilePagesCount := float64(mobileMeasuredCount)
		mobileAvgFCP = mobileFCPSum / mobilePagesCount
		mobileAvgLCP = mobileLCPSum / mobilePagesCount
		mobileAvgCLS = mobileCLSSum / mobilePagesCount
	}
	mobileSummaryMeta := map[string]interface{}{
		"avg_fcp_ms":       nil,
		"avg_lcp_ms":       nil,
		"avg_cls":          nil,
		"pages_attempted":  len(mobileEntries),
		"pages_tested":     mobileMeasuredCount,
		"pages_measured":   mobileMeasuredCount,
		"individual_pages": mobileIndividualScores,
	}
	if mobileMeasuredCount > 0 {
		mobileSummaryMeta["avg_fcp_ms"] = math.Round(mobileAvgFCP.(float64)*10) / 10
		mobileSummaryMeta["avg_lcp_ms"] = math.Round(mobileAvgLCP.(float64)*10) / 10
		mobileSummaryMeta["avg_cls"] = math.Round(mobileAvgCLS.(float64)*1000) / 1000
	}
	if err := db.UpdateSEOKPIExtended(scanID, map[string]interface{}{"mobile_summary": mobileSummaryMeta}); err != nil {
		log.Printf("⚠ mobile_summary update failed: %v", err)
	}

	report.HeadlessResults = headlessResults
	report.HeadlessSampleSize = len(sampleURLs)
	homepageRenderedHTML := ""

	for _, hr := range headlessResults {
		if hr.Error != "" {
			fmt.Printf("  ⚠ Headless error on %s: %s\n", hr.URL, hr.Error)
		} else {
			fmt.Printf("  ✅ %s → FCP:%.0fms LCP:%.0fms CLS:%.3f Eco:%s\n", hr.URL, hr.FCPMS, hr.LCPMS, hr.CLS, hr.EcoScore)
			// BL-09: Pass the hydrated Playwright HTML directly into scan_pages so v3-nlp-worker gets it
			if hr.RenderedHTML != "" {
				if strings.TrimRight(hr.URL, "/") == strings.TrimRight(config.StartURL, "/") {
					homepageRenderedHTML = hr.RenderedHTML
				}
				if err := db.UpdatePageHTML(scanID, hr.URL, hr.RenderedHTML); err != nil {
					log.Printf("⚠ UpdatePageHTML failed for %s: %v", hr.URL, err)
				}
			}
		}
		// Persist headless metrics (including mobile_metrics for homepage) back into per-page DB record.
		// Issue 4: set html_source="headless" when RenderedHTML was captured so NLP worker
		// knows this page received hydrated HTML. Pages where RenderedHTML is empty (headless
		// ran but produced no HTML) retain html_source="static" set during the crawl phase.
		htmlSource := "static"
		if strings.TrimSpace(hr.RenderedHTML) != "" {
			htmlSource = "headless"
		}
		if err := db.MergePageMetrics(scanID, hr.URL, map[string]interface{}{
			"headless":            hr,
			"evidence_provenance": evidenceProvenanceFromHeadless(hr),
			"html_source":         htmlSource,
		}); err != nil {
			log.Printf("⚠ MergePageMetrics failed for %s: %v", hr.URL, err)
		}
	}

	// ============================================================
	// CF FALLBACK — PHASE 2: Backfill seeded homepage with Rod-rendered HTML
	// ============================================================
	if cfFallbackMode && homepageRenderedHTML != "" && len(allSEOResults) == 1 {
		homepageURL := strings.TrimRight(config.StartURL, "/")
		if strings.TrimRight(allSEOResults[0].URL, "/") == homepageURL {
			backfilledSEO := seo.Analyze(config.StartURL, homepageRenderedHTML, hasSitemap, hasRobots)
			backfilledUX := ux.Analyze(config.StartURL, homepageRenderedHTML, baseURL)
			allSEOResults[0] = backfilledSEO
			if len(allUXResults) == 0 {
				allUXResults = append(allUXResults, backfilledUX)
			} else {
				allUXResults[0] = backfilledUX
			}
			if err := db.MergePageMetrics(scanID, config.StartURL, map[string]interface{}{
				"seo":                 backfilledSEO,
				"ux":                  backfilledUX,
				"evidence_provenance": "mixed",
				"html_source":         "headless",
			}); err != nil {
				log.Printf("⚠ CF fallback: failed to backfill homepage SEO/UX metrics: %v", err)
			}
			log.Printf("✅ Rod-rendered HTML backfilled SEO data for homepage")
		}
	}

	if homepageRenderedHTML != "" {
		runtimePrivacyRes := privacy.AnalyzeWithBaseURL(baseURL, homepageRenderedHTML)
		domainPrivacyRes = runtimePrivacyRes
		report.DomainPrivacy = domainPrivacyRes
		if err := db.InsertSummary(scanID, baseURL, domainSecRes, domainTechRes, domainPrivacyRes, domainFuncRes); err != nil {
			log.Printf("⚠ Failed to refresh domain summary with runtime privacy analysis: %v", err)
		}
	}

	report.ScanDuration = time.Since(startTime).String()
	if stopReason == "" && ctx.Err() != nil {
		setStopReason("timeout")
	}
	budgetRemainingMS := int64(0)
	if deadline, hasDeadline := ctx.Deadline(); hasDeadline {
		budgetRemainingMS = time.Until(deadline).Milliseconds()
		if budgetRemainingMS < 0 {
			budgetRemainingMS = 0
		}
	}

	// Issue 5: compute headless coverage percentage and set warning flag if < 80%.
	var headlessCoveragePct float64
	totalPages := summary.TotalPages
	headlessPageCount := len(sampleURLs)
	if totalPages > 0 {
		headlessCoveragePct = math.Round(float64(headlessPageCount)/float64(totalPages)*100*10) / 10
	}
	partialHeadlessCoverage := headlessCoveragePct < 80.0 && totalPages > 0
	if partialHeadlessCoverage {
		log.Printf("⚠ Partial headless coverage: %.1f%% (%d/%d pages, cap=%d) — KPI site-wide claims are approximate",
			headlessCoveragePct, headlessPageCount, totalPages, headlessPageCap)
	}

	report.ScanTelemetry = ScanTelemetry{
		StopReason: stopReason,
		PhaseTimingsMS: PhaseTimings{
			PreFetchMS:     preFetchMS,
			DomainAnalysis: domainAnalysisMS,
			CrawlMS:        crawlMS,
			PostCrawlSync:  postCrawlSyncMS,
			HeadlessMS:     headlessMS,
			DBWaitMS:       dbWaitMS,
		},
		PagesAtStop:             int(atomic.LoadInt32(&pageCount)),
		BudgetRemainingMS:       budgetRemainingMS,
		FormFuzzer:              formFuzzerSummary,
		HeadlessCoveragePct:     headlessCoveragePct,
		PartialHeadlessCoverage: partialHeadlessCoverage,
	}
	if err := db.UpdateTelemetry(scanID, report.ScanTelemetry); err != nil {
		log.Printf("⚠ UpdateTelemetry failed: %v", err)
	}

	jsonData, _ := json.MarshalIndent(report, "", "  ")
	err = os.WriteFile("scan_report.json", jsonData, 0644)
	if err != nil {
		fmt.Printf("\nError writing report to file: %v\n", err)
	} else {
		fmt.Println("\n--- FINAL SCAN AGGREGATION SAVED TO scan_report.json ---")
	}
}

// checkImageCompression performs HTTP HEAD requests on unique image URLs found
// during the crawl and flags images that appear unoptimised:
//   - Content-Type is image/bmp or image/tiff (inherently uncompressed)
//   - Content-Type is image/jpeg or image/png AND Content-Length > 500 KB
//
// To keep scan time bounded, at most 200 images are sampled.
// Passed = UnoptimisedCount == 0.
func checkImageCompression(imageURLs map[string]bool) ImageCompressionStats {
	const maxSample = 200
	const bigThreshold = 500 * 1024 // 500 KB in bytes

	// Collect URLs into a slice (deterministic order via sort)
	urls := make([]string, 0, len(imageURLs))
	for u := range imageURLs {
		urls = append(urls, u)
	}
	sort.Strings(urls)
	if len(urls) > maxSample {
		urls = urls[:maxSample]
	}

	stats := ImageCompressionStats{
		TotalImages:       len(imageURLs),
		SampledImages:     len(urls),
		UnoptimisedImages: []ImageCompressionInfo{},
	}

	if len(urls) == 0 {
		stats.Passed = true
		return stats
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	type result struct {
		info ImageCompressionInfo
		flag bool
	}

	sem := make(chan struct{}, 20) // max 20 concurrent HEAD requests
	resCh := make(chan result, len(urls))
	var wg sync.WaitGroup

	for _, rawURL := range urls {
		wg.Add(1)
		go func(u string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			req, err := http.NewRequest(http.MethodHead, u, nil)
			if err != nil {
				return
			}
			req.Header.Set("User-Agent", "Mozilla/5.0 SnapFlow-Scanner/1.0")
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			resp.Body.Close()

			ct := strings.ToLower(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
			ct = strings.TrimSpace(ct)
			cl := resp.ContentLength // -1 if unknown

			info := ImageCompressionInfo{
				URL:         u,
				ContentType: ct,
			}
			if cl > 0 {
				info.SizeKB = float64(cl) / 1024
			}

			unoptimised := false
			switch {
			case ct == "image/bmp" || ct == "image/tiff":
				// Inherently uncompressed formats
				unoptimised = true
			case (ct == "image/jpeg" || ct == "image/png") && cl > bigThreshold:
				// Too large for a typical web image
				unoptimised = true
			}
			info.IsLikelyUnoptimised = unoptimised
			resCh <- result{info: info, flag: unoptimised}
		}(rawURL)
	}

	wg.Wait()
	close(resCh)

	for r := range resCh {
		if r.flag {
			stats.UnoptimisedImages = append(stats.UnoptimisedImages, r.info)
		}
	}
	stats.UnoptimisedCount = len(stats.UnoptimisedImages)
	stats.Passed = stats.UnoptimisedCount == 0
	// Gap #22: compute compression rate as % of sampled images that are optimised
	if stats.SampledImages > 0 {
		optimisedCount := stats.SampledImages - stats.UnoptimisedCount
		stats.CompressionRatePct = math.Round(float64(optimisedCount)/float64(stats.SampledImages)*100*10) / 10
	}
	return stats
}

// selectMobileTestPages picks up to 3 representative URLs for mobile testing:
//  1. The homepage (always first).
//  2. The page with the most internal links pointing to it (most-linked page).
//  3. A "leaf" page — one with zero outgoing internal links (randomly the first
//     such page found in result order, which is deterministic per crawl).
//
// Duplicates are suppressed; the slice length is always between 1 and 3.
func selectMobileTestPages(results []seo.SEOResult, homepageURL string) []string {
	if len(results) == 0 {
		return []string{homepageURL}
	}

	homepageNorm := strings.TrimRight(homepageURL, "/")
	selected := make([]string, 0, 3)
	seen := map[string]bool{}

	addPage := func(u string) {
		u = strings.TrimRight(u, "/")
		if u == "" || seen[u] {
			return
		}
		seen[u] = true
		selected = append(selected, u)
	}

	// 1. Homepage
	addPage(homepageNorm)

	// 2. Most-linked internal page: count how many SEO results contain a link
	// to each URL (using InternalLinks as a proxy — the page that is linked to
	// most is the one other pages name as their referrer via crawl order; since
	// we don't track per-page back-links, we instead pick the page whose URL
	// appears most frequently as the parent in the result set, approximated by
	// choosing the page with the highest InternalLinks count among non-homepage
	// pages — this is the page that itself links out most, correlating with hub
	// pages that are also heavily linked-to).
	var mostLinkedURL string
	maxLinks := -1
	for _, r := range results {
		if strings.TrimRight(r.URL, "/") == homepageNorm {
			continue
		}
		if r.Links.InternalLinks > maxLinks {
			maxLinks = r.Links.InternalLinks
			mostLinkedURL = r.URL
		}
	}
	if mostLinkedURL != "" {
		addPage(mostLinkedURL)
	}

	// 3. Leaf page: first page with zero outgoing internal links
	for _, r := range results {
		if strings.TrimRight(r.URL, "/") == homepageNorm {
			continue
		}
		if r.Links.InternalLinks == 0 {
			addPage(r.URL)
			break
		}
	}

	return selected
}

func normalizeCrawlHost(host string) string {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return ""
	}
	if strings.Contains(h, "://") {
		if parsed, err := url.Parse(h); err == nil {
			h = parsed.Host
		}
	}
	if parsed, err := url.Parse("//" + h); err == nil && parsed.Hostname() != "" {
		h = parsed.Hostname()
	}
	h = strings.TrimPrefix(h, "www.")
	return h
}

func isHostAllowedForCrawl(host string, allowedDomains []string) bool {
	if len(allowedDomains) == 0 {
		return true
	}
	normalizedHost := normalizeCrawlHost(host)
	if normalizedHost == "" {
		return false
	}
	for _, domain := range allowedDomains {
		normalizedAllowed := normalizeCrawlHost(domain)
		if normalizedAllowed == "" {
			continue
		}
		if normalizedHost == normalizedAllowed || strings.HasSuffix(normalizedHost, "."+normalizedAllowed) {
			return true
		}
	}
	return false
}

// e2abs resolves rawLink to an absolute URL string.
// It first tries url.Parse on rawLink; if that yields a relative reference it
// resolves against parentURL, falling back to baseURL when parentURL is empty.
func e2abs(parentURL, rawLink, baseURL string) string {
	parsed, err := url.Parse(rawLink)
	if err != nil {
		return ""
	}
	if parsed.IsAbs() {
		parsed.Fragment = ""
		return parsed.String()
	}
	base := parentURL
	if base == "" {
		base = baseURL
	}
	baseParsed, err := url.Parse(base)
	if err != nil {
		return ""
	}
	resolved := baseParsed.ResolveReference(parsed)
	resolved.Fragment = ""
	return resolved.String()
}

// extractExternalDomains scans HTML for href attributes pointing to external
// hostnames (different from baseURL) and returns a deduplicated slice of those
// hostnames (stripped of leading "www."). No regex required — pure string scan.
func extractExternalDomains(html, baseURL string) []string {
	baseParsed, err := url.Parse(baseURL)
	if err != nil {
		return nil
	}
	baseHost := strings.ToLower(strings.TrimPrefix(baseParsed.Hostname(), "www."))

	seen := map[string]bool{}
	var result []string
	remaining := html
	for {
		idx := strings.Index(remaining, "href=")
		if idx < 0 {
			break
		}
		remaining = remaining[idx+5:]
		if len(remaining) == 0 {
			break
		}
		q := remaining[0]
		if q != '"' && q != '\'' {
			continue
		}
		remaining = remaining[1:]
		end := strings.IndexByte(remaining, q)
		if end < 0 {
			break
		}
		href := remaining[:end]
		remaining = remaining[end+1:]
		if !strings.HasPrefix(href, "http") {
			continue
		}
		parsed, err := url.Parse(href)
		if err != nil {
			continue
		}
		host := strings.ToLower(strings.TrimPrefix(parsed.Hostname(), "www."))
		if host == "" || host == baseHost {
			continue
		}
		if seen[host] {
			continue
		}
		seen[host] = true
		result = append(result, host)
	}
	return result
}

// buildHeadlessSample selects a post-crawl hybrid sample.
// Rules:
//   - budget = max(1, floor(valid_pages * ratio))
//   - include homepage first
//   - allocate floor(budget/2) to worst-SEO pages
//   - allocate the remainder to deterministic stride picks
//   - final size never exceeds budget
func buildHeadlessSample(results []seo.SEOResult, brokenURLs map[string]bool, landingPage string, ratio float64) []string {
	// Filter out broken URLs
	var valid []seo.SEOResult
	for _, r := range results {
		if !brokenURLs[r.URL] {
			valid = append(valid, r)
		}
	}

	if len(valid) == 0 {
		return nil
	}

	budget := int(math.Floor(float64(len(valid)) * ratio))
	if budget < 1 {
		budget = 1
	}
	if budget > len(valid) {
		budget = len(valid)
	}
	// Hard cap: never send more than headlessPageCap pages to the pool.
	if budget > headlessPageCap {
		budget = headlessPageCap
	}

	selected := make(map[string]bool, budget)
	urls := make([]string, 0, budget)
	addURL := func(u string) {
		if u == "" || selected[u] || len(urls) >= budget {
			return
		}
		selected[u] = true
		urls = append(urls, u)
	}

	landingNorm := strings.TrimSuffix(landingPage, "/")
	landingURL := ""
	for _, r := range valid {
		if strings.TrimSuffix(r.URL, "/") == landingNorm {
			landingURL = r.URL
			break
		}
	}
	if landingURL == "" {
		landingURL = valid[0].URL
	}
	addURL(landingURL)

	worstBudget := budget / 2
	if worstBudget > 0 {
		worstCandidates := make([]seo.SEOResult, 0, len(valid))
		for _, r := range valid {
			if strings.TrimSuffix(r.URL, "/") != strings.TrimSuffix(landingURL, "/") {
				worstCandidates = append(worstCandidates, r)
			}
		}
		sort.Slice(worstCandidates, func(i, j int) bool {
			return worstCandidates[i].Score < worstCandidates[j].Score
		})
		for _, r := range worstCandidates {
			if len(urls) >= 1+worstBudget {
				break
			}
			addURL(r.URL)
		}
	}

	deterministicBudget := budget - len(urls)
	if deterministicBudget > 0 {
		stride := len(valid) / deterministicBudget
		if stride < 1 {
			stride = 1
		}
		for i := 0; i < len(valid) && len(urls) < budget; i += stride {
			addURL(valid[i].URL)
		}
		for i := 0; i < len(valid) && len(urls) < budget; i++ {
			addURL(valid[i].URL)
		}
	}

	return urls
}

// extractInternalLinksFromHTML parses anchor href attributes out of an HTML
// string and returns deduplicated absolute URLs that belong to the same host
// as baseURL. It reuses the existing e2abs() helper for resolution and skips
// non-page targets (tel:, mailto:, #, file downloads).
// Used by the CF fallback path to discover pages from the Rod-rendered homepage.
func extractInternalLinksFromHTML(html, baseURL string) []string {
	baseParsed, err := url.Parse(baseURL)
	if err != nil {
		return nil
	}
	baseHost := strings.ToLower(baseParsed.Host)
	baseNorm := strings.TrimRight(baseURL, "/")

	seen := map[string]bool{baseNorm: true}
	var links []string

	remaining := html
	for {
		idx := strings.Index(remaining, "href=")
		if idx < 0 {
			break
		}
		remaining = remaining[idx+5:]
		if len(remaining) == 0 {
			break
		}
		q := remaining[0]
		if q != '"' && q != '\'' {
			continue
		}
		remaining = remaining[1:]
		end := strings.IndexByte(remaining, q)
		if end < 0 {
			break
		}
		href := strings.TrimSpace(remaining[:end])
		remaining = remaining[end+1:]

		if href == "" || href == "#" {
			continue
		}
		lower := strings.ToLower(href)
		if strings.HasPrefix(lower, "javascript:") ||
			strings.HasPrefix(lower, "mailto:") ||
			strings.HasPrefix(lower, "tel:") {
			continue
		}
		if strings.HasSuffix(lower, ".pdf") || strings.HasSuffix(lower, ".zip") ||
			strings.HasSuffix(lower, ".doc") || strings.HasSuffix(lower, ".docx") ||
			strings.HasSuffix(lower, ".xls") || strings.HasSuffix(lower, ".xlsx") {
			continue
		}

		abs := e2abs("", href, baseURL)
		if abs == "" {
			continue
		}
		absParsed, err := url.Parse(abs)
		if err != nil || strings.ToLower(absParsed.Host) != baseHost {
			continue
		}

		abs = strings.TrimRight(abs, "/")
		if seen[abs] {
			continue
		}
		seen[abs] = true
		links = append(links, abs)
	}
	return links
}
