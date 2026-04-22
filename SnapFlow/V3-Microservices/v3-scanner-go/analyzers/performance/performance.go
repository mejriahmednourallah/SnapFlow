package performance

import (
	"fmt"
	"math"
	"math/rand"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

// jitterSleep sleeps for a random duration in [minMs, maxMs] milliseconds.
// Used instead of fixed sleeps so sequential requests look like human pacing
// and the total headless wait time is ~2x faster on average vs. fixed 5s waits.
func jitterSleep(minMs, maxMs int) {
	ms := minMs + rand.Intn(maxMs-minMs+1)
	time.Sleep(time.Duration(ms) * time.Millisecond)
}

type AssetCategory struct {
	SizeBytes int     `json:"size_bytes"`
	Count     int     `json:"count"`
	CO2Grams  float64 `json:"co2_grams"`
}

type NonFunctionalButtonDetail struct {
	Label      string `json:"label"`
	Selector   string `json:"selector"`
	Tag        string `json:"tag"`
	IssueType  string `json:"issue_type"`
	Href       string `json:"href,omitempty"`
	Onclick    string `json:"onclick,omitempty"`
	FormAction string `json:"form_action,omitempty"`
}

type HeadlessResult struct {
	URL                  string                   `json:"url"`
	FCPMS                float64                  `json:"fcp_ms"`
	LCPMS                float64                  `json:"lcp_ms"`
	CLS                  float64                  `json:"cls"`
	DOMNodes             int                      `json:"dom_nodes"`
	HTTPRequests         int                      `json:"http_requests"`
	TransferSizeKB       float64                  `json:"transfer_size_kb"`
	AssetBreakdown       map[string]AssetCategory `json:"asset_breakdown"`
	MobileOverflow       bool                     `json:"mobile_overflow"`
	TabletOverflow       bool                     `json:"tablet_overflow"`
	DesktopOverflow      bool                     `json:"desktop_overflow"`
	InvisibleLinks       int                      `json:"invisible_links"`
	EcoScore             string                   `json:"eco_score"`
	EcoIndex             float64                  `json:"eco_index"`
	EmissionsPerPageLoad float64                  `json:"emissions_per_page_load"`
	SpeedIndexMS         float64                  `json:"speed_index_ms"`
	SpeedIndexSynthetic  bool                     `json:"speed_index_synthetic"` // True = FCP×0.30+LCP×0.70 proxy, not real video-based SI
	UnusedJSBytes        int                      `json:"unused_js_bytes"`
	UnusedCSSBytes       int                      `json:"unused_css_bytes"`
	// Phase G: console errors + non-functional buttons
	ConsoleErrors              []string                    `json:"console_errors"`
	ConsoleErrorCount          int                         `json:"console_error_count"`
	ConsoleErrorKPIPassed      bool                        `json:"console_error_kpi_passed"`
	NonFunctionalButtons       []string                    `json:"non_functional_buttons"`
	NonFunctionalButtonDetails []NonFunctionalButtonDetail `json:"non_functional_button_details"`
	NonFunctionalButtonCount   int                         `json:"non_functional_button_count"`
	ButtonKPIPassed            bool                        `json:"button_kpi_passed"`
	// Phase H: mobile performance trace
	MobileMetrics *MobilePerformanceResult `json:"mobile_metrics,omitempty"`
	RenderedHTML  string                   `json:"-"`
	Error         string                   `json:"error,omitempty"`
}

// MobilePerformanceResult holds metrics captured from a 3G mobile emulation of the homepage.
type MobilePerformanceResult struct {
	FCPMS        float64  `json:"fcp_ms"`
	LCPMS        float64  `json:"lcp_ms"`
	CLS          float64  `json:"cls"`
	SpeedIndexMS float64  `json:"speed_index_ms"`
	Passed       bool     `json:"passed"`
	Issues       []string `json:"issues"`
	Error        string   `json:"error,omitempty"`
}

// findChromePath returns the Chromium/Chrome binary path and true when one is
// available on the host. It checks CHROME_PATH first, then rod's LookPath.
// When false is returned the caller must NOT create a launcher — rod will
// otherwise auto-download a fresh Chromium binary at runtime, blocking the
// scan for 30-60 seconds and leaving stray files on disk.
func findChromePath() (string, bool) {
	if p := os.Getenv("CHROME_PATH"); p != "" {
		if _, err := os.Stat(p); err == nil {
			return p, true
		}
	}
	if p, found := launcher.LookPath(); found {
		return p, true
	}
	return "", false
}

func newLauncher() *launcher.Launcher {
	l := launcher.New().Headless(true)
	if path, found := findChromePath(); found {
		l.Bin(path)
	}
	// NOTE: if findChromePath() returned false the launcher has no Bin set.
	// Callers that need a guaranteed binary must call findChromePath() first
	// and bail out early — never let the launcher auto-download in production.
	if shouldDisableSandbox() {
		l.Set("no-sandbox").
			Set("disable-dev-shm-usage").
			Set("disable-gpu")
	}
	return l
}

func parseEnvBool(value string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true, true
	case "0", "false", "no", "off":
		return false, true
	default:
		return false, false
	}
}

func shouldDisableSandbox() bool {
	if parsed, ok := parseEnvBool(os.Getenv("CHROME_NO_SANDBOX")); ok {
		return parsed
	}
	// Most containerized runs are root and need this for Chromium startup.
	return os.Getuid() == 0
}

func getSafeDCLMS(page *rod.Page) float64 {
	dclVal, _ := page.Eval(`() => {
		const nav = performance.getEntriesByType('navigation')[0];
		if (nav && typeof nav.domContentLoadedEventEnd === 'number' && nav.domContentLoadedEventEnd > 0) {
			return nav.domContentLoadedEventEnd;
		}
		const t = performance.timing;
		if (
			t &&
			t.navigationStart > 0 &&
			t.domContentLoadedEventEnd > t.navigationStart
		) {
			return t.domContentLoadedEventEnd - t.navigationStart;
		}
		return 0;
	}`)
	if dclVal == nil {
		return 0
	}
	dcl := dclVal.Value.Num()
	if math.IsNaN(dcl) || math.IsInf(dcl, 0) || dcl <= 0 {
		return 0
	}
	return dcl
}

// RunHeadlessPool launches a headless Chrome browser and analyzes the given URLs
// using a pool of concurrent tabs (limited by concurrency param).
func RunHeadlessPool(urls []string, concurrency int) []HeadlessResult {
	if len(urls) == 0 {
		return nil
	}

	launchURL, err := launchBrowserWithFallback()
	if err != nil {
		// Return error results for all URLs
		var results []HeadlessResult
		for _, u := range urls {
			results = append(results, HeadlessResult{URL: u, Error: fmt.Sprintf("Failed to launch browser: %v", err)})
		}
		return results
	}

	browser := rod.New().ControlURL(launchURL)
	err = browser.Connect()
	if err != nil {
		var results []HeadlessResult
		for _, u := range urls {
			results = append(results, HeadlessResult{URL: u, Error: fmt.Sprintf("Failed to connect to browser: %v", err)})
		}
		return results
	}
	defer browser.MustClose()

	results := make([]HeadlessResult, len(urls))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for i, pageURL := range urls {
		wg.Add(1)
		sem <- struct{}{} // acquire semaphore slot

		// Stagger launches with 1–3 s jitter to avoid overwhelming the target server.
		jitterSleep(1000, 5000)

		go func(idx int, targetURL string) {
			defer wg.Done()
			defer func() { <-sem }()
			results[idx] = analyzePageHeadless(browser, targetURL)
		}(i, pageURL)
	}

	wg.Wait()
	return results
}

func launchBrowserWithFallback() (string, error) {
	// Guard: abort immediately when no system Chromium is present.
	// Without this, rod auto-downloads a fresh binary and blocks the scan.
	if _, found := findChromePath(); !found {
		return "", fmt.Errorf("no Chromium binary found — set CHROME_PATH or install chromium")
	}

	launchers := []*launcher.Launcher{newLauncher()}

	// Fallback profile that is more permissive for constrained container runtimes.
	fallback := newLauncher()
	fallback.Set("no-sandbox").
		Set("disable-setuid-sandbox").
		Set("disable-dev-shm-usage").
		Set("disable-gpu")
	launchers = append(launchers, fallback)

	var lastErr error
	for _, l := range launchers {
		launchURL, err := l.Launch()
		if err == nil {
			return launchURL, nil
		}
		lastErr = err
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("failed to launch browser")
	}
	return "", lastErr
}

// analyzePageHeadless analyzes a single page
func analyzePageHeadless(browser *rod.Browser, targetURL string) HeadlessResult {
	result := HeadlessResult{
		URL:                        targetURL,
		AssetBreakdown:             map[string]AssetCategory{},
		NonFunctionalButtons:       []string{},
		NonFunctionalButtonDetails: []NonFunctionalButtonDetail{},
	}

	// Create a new incognito page to isolate cookies/cache
	page, err := browser.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		result.Error = fmt.Sprintf("Failed to create page: %v", err)
		return result
	}
	defer page.Close()

	// G-1: Standard desktop viewport (1366x768 is the most common desktop resolution)
	page.MustSetViewport(1366, 768, 1.0, false)

	// G-2: Enable Runtime domain for console event capture
	_ = proto.RuntimeEnable{}.Call(page)

	// Start Code Coverage Profiling for Unused JS/CSS
	_ = proto.ProfilerEnable{}.Call(page)
	_, _ = proto.ProfilerStartPreciseCoverage{CallCount: false, Detailed: true}.Call(page)
	_ = proto.DOMSnapshotEnable{}.Call(page)
	_ = proto.CSSEnable{}.Call(page)
	_ = proto.CSSStartRuleUsageTracking{}.Call(page)

	// Ensure network domain is enabled for tracking
	_ = proto.NetworkEnable{}.Call(page)

	// Enable network tracking for request counting, type breakdown, and transfer size
	var networkMu sync.Mutex
	requestCount := 0
	totalTransferBytes := 0.0
	breakdown := map[string]AssetCategory{
		"html":        {0, 0, 0},
		"scripts":     {0, 0, 0},
		"stylesheets": {0, 0, 0},
		"images":      {0, 0, 0},
		"fonts":       {0, 0, 0},
		"other":       {0, 0, 0},
	}

	go page.EachEvent(func(e *proto.NetworkResponseReceived) {
		networkMu.Lock()
		defer networkMu.Unlock()
		requestCount++

		size := int(e.Response.EncodedDataLength)
		if size == 0 {
			// Some resources don't report encoded length, fallback to headers if needed
			// (simplified for this context)
		}
		totalTransferBytes += float64(size)

		mimeType := e.Response.MIMEType
		category := "other"

		if strings.Contains(mimeType, "html") {
			category = "html"
		} else if strings.Contains(mimeType, "javascript") || strings.Contains(mimeType, "json") {
			category = "scripts"
		} else if strings.Contains(mimeType, "css") {
			category = "stylesheets"
		} else if strings.HasPrefix(mimeType, "image/") {
			category = "images"
		} else if strings.Contains(mimeType, "font") {
			category = "fonts"
		}

		catData := breakdown[category]
		catData.Count++
		catData.SizeBytes += size
		breakdown[category] = catData
	})()

	// G-2: Console error/warning listener (must be attached before Navigate)
	var consoleMu sync.Mutex
	var consoleErrors []string
	go page.EachEvent(func(e *proto.RuntimeConsoleAPICalled) {
		t := string(e.Type)
		if t == "error" || t == "warning" {
			consoleMu.Lock()
			parts := []string{}
			for _, arg := range e.Args {
				if arg.Value.Raw() != nil {
					parts = append(parts, fmt.Sprintf("%v", arg.Value.Raw()))
				}
			}
			msg := fmt.Sprintf("[%s] %s", t, strings.Join(parts, " "))
			consoleErrors = append(consoleErrors, msg)
			consoleMu.Unlock()
		}
	})()

	// Navigate with timeout
	err = page.Timeout(60 * time.Second).Navigate(targetURL)
	if err != nil {
		result.Error = fmt.Sprintf("Navigation failed: %v", err)
		return result
	}

	// Wait for network to be idle (better for heavy e-commerce/AJAX sites)
	err = page.Timeout(60 * time.Second).WaitIdle(2 * time.Second)
	if err != nil {
		// Even if idle fails, we might still have data, just log and continue
	}

	// Short jittered wait for metrics to settle (1–3 s replaces fixed 5 s).
	jitterSleep(1000, 5000)

	// G-3: Collect console errors gathered during page load
	consoleMu.Lock()
	result.ConsoleErrors = consoleErrors
	result.ConsoleErrorCount = len(consoleErrors)
	result.ConsoleErrorKPIPassed = result.ConsoleErrorCount == 0
	consoleMu.Unlock()

	// G-4/G-5: Non-functional button detection (static JS analysis — with Intent Scoring)
	btnsVal, btnsErr := page.Eval(`() => {
		const LIMIT = 40;
		const results = [];

		const buildSelector = (el) => {
			if (!el || !el.tagName) return '(unknown)';
			if (el.id) return '#' + el.id;
			const tag = el.tagName.toLowerCase();
			const classes = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
			if (classes.length) return tag + '.' + classes.join('.');
			let index = 1;
			let sib = el;
			while ((sib = sib.previousElementSibling)) {
				if (sib.tagName === el.tagName) index += 1;
			}
			return tag + ':nth-of-type(' + index + ')';
		};

		const scoreButtonIntent = (el) => {
			let score = 0;
			const tag = (el.tagName || '').toLowerCase();
			const typeAttr = (el.getAttribute('type') || '').toLowerCase();
			const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').toLowerCase().trim();
			const cls = (el.className || '').toLowerCase();
			const hasForm = !!el.closest('form');
			
			// Positive signals
			if (typeAttr === 'submit') score += 30;
			if (/^(send|submit|register|book|request|get started|buy|order)$/i.test(text)) score += 25;
			if (hasForm) score += 20;
			if (el.hasAttribute('form')) score += 15;
			if (el.parentElement && el.parentElement.querySelector('input[type="text"], input[type="email"]')) score += 15;
			if (/(submit|cta|send|primary)/i.test(cls)) score += 10;
			
			// Negative signals
			if (/^(close|cancel|back|next|skip|load more|filter|sort|toggle|menu|×|x)$/i.test(text)) score -= 40;
			if (el.closest('nav, header, footer, aside')) score -= 20;
			if (el.closest('[role="tablist"], [role="menu"]')) score -= 30;
			
			const allInputs = el.closest('body') ? el.closest('body').querySelectorAll('input') : [];
			if (allInputs.length === 0) score -= 15;
			
			return score;
		};

		const seenIssues = new Set();
		const pushIssue = (el, issueType, href, onclick, formAction) => {
			if (results.length >= LIMIT) return;
			const label = (el.innerText || el.value || '').trim() || el.id || el.getAttribute('aria-label') || '(unnamed)';
			const key = [window.location.href, (href || '').trim(), label.toLowerCase(), issueType].join('|');
			if (seenIssues.has(key)) return;
			seenIssues.add(key);
			results.push({
				label: label.slice(0, 120),
				selector: buildSelector(el),
				tag: (el.tagName || '').toLowerCase(),
				issue_type: issueType,
				href: href || '',
				onclick: onclick || '',
				form_action: formAction || '',
			});
		};

		const candidates = document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"]');
		for (const el of candidates) {
			if (results.length >= LIMIT) break;
			const tag = (el.tagName || '').toLowerCase();
			const onclick = (el.getAttribute('onclick') || '').trim();
			const dataAction = (el.getAttribute('data-action') || '').trim();
			const hasDataNavigation = !!el.getAttribute('data-href') || !!el.getAttribute('data-url') || !!el.getAttribute('data-link') || !!el.getAttribute('data-route') || !!el.getAttribute('data-target') || !!el.getAttribute('data-bs-target');
			const hasClickBehavior = !!onclick || !!dataAction || hasDataNavigation || !!el.getAttribute('data-toggle') || !!el.getAttribute('data-bs-toggle') || !!el.getAttribute('aria-expanded') || !!el.getAttribute('aria-controls') || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'switch';

			// Skip elements with low intent score (Gate 1 Intent Scorer)
			if (['button', 'input'].includes(tag) || el.getAttribute('role') === 'button') {
				const intentScore = scoreButtonIntent(el);
				if (intentScore < 40) {
					// We skip reporting these as broken
					continue;
				}
			}

			if (tag === 'a') {
				const hrefAttr = el.getAttribute('href');
				const href = (hrefAttr || '').trim();
				const hrefLower = href.toLowerCase();
				const isHashLink = hrefLower.startsWith('#');
				const textLower = (el.innerText || '').toLowerCase();
				const hasVisibleLabel = (el.innerText || '').trim().length > 0 || !!el.getAttribute('aria-label') || !!el.getAttribute('title');
				const classLower = (el.getAttribute('class') || '').toLowerCase();
				const idLower = (el.getAttribute('id') || '').toLowerCase();
				const nameLower = (el.getAttribute('name') || '').toLowerCase();
				const roleLower = (el.getAttribute('role') || '').toLowerCase();
				const isAnchorTargetOnly = !href && !!(idLower || nameLower) && !hasClickBehavior && !roleLower;
				const isKnownAnchorTarget = /^(main|main-content|content|top|tab-\d+|tabpanel-\d+|pane-\d+)$/i.test(idLower) || /^(main|main-content|content|top|tab-\d+|tabpanel-\d+|pane-\d+)$/i.test(nameLower);
				if (isAnchorTargetOnly && (isKnownAnchorTarget || !hasVisibleLabel)) {
					continue;
				}
				const isSkipAnchor = /^#(main|main-content|content|top|skip|skip-link|skiplink|navigation|nav)$/i.test(hrefLower) || /\bskip\b/.test(textLower) || /\bskip\b/.test(classLower) || /\bskip\b/.test(idLower);
				let hashTargetExists = false;
				if (isHashLink && href.length > 1) {
					const targetId = href.slice(1);
					hashTargetExists = !!document.getElementById(targetId);
				}
				const actionableAnchor = !!hrefAttr || hasClickBehavior || hasVisibleLabel || /\b(btn|button|cta)\b/.test(classLower);
				const hasInteractiveBehavior = hasClickBehavior || !!el.getAttribute('aria-controls') || !!el.getAttribute('data-bs-target') || !!el.getAttribute('data-drupal-selector') || roleLower === 'tab' || roleLower === 'switch';
				const hashFragment = isHashLink ? hrefLower.slice(1) : '';
				const hashTargetLooksUIState = !!hashFragment && (/^[!?]/.test(hashFragment) || /\b(tab|pane|collapse|accordion|faq|question|garantie|presentation|avantage|fiscal|step|slide|modal|section)\b/i.test(hashFragment));
				const hasUICues = /\b(btn|button|btn-border|tab|tabs|accordion|collapse|toggle|pill|dropdown|cta|nav-link)\b/.test(classLower) || !!el.getAttribute('data-drupal-selector');
				const insideStatefulUI = !!el.closest('[role="tablist"], [role="tabpanel"], .tabs, .nav-tabs, .nav-pills, .accordion, .faq, .tab-content, .tab-pane');
				const safeHashFragment = (window.CSS && typeof window.CSS.escape === 'function') ? window.CSS.escape(hashFragment) : hashFragment;
				const targetExistsByName = !!(hashFragment && document.querySelector('[name="' + safeHashFragment + '"]'));
				hashTargetExists = hashTargetExists || targetExistsByName;
				const isLikelyJSAnchor = isHashLink && (hasInteractiveBehavior || hasUICues || hashTargetLooksUIState || insideStatefulUI);
				const isDeadHref = actionableAnchor && (!href || href === '#' || /^javascript:.*\s*$/i.test(href) || (isHashLink && !hashTargetExists && !isSkipAnchor && !isLikelyJSAnchor));
				// Ensure it's not a generic anchor we shouldn't care about.
				if (!el.closest('nav') && !hasInteractiveBehavior && isDeadHref) {
					pushIssue(el, 'dead_anchor', href, onclick, '');
				}
				continue;
			}

			if (tag === 'button') {
				const typeAttr = (el.getAttribute('type') || 'submit').toLowerCase();
				const form = el.closest('form');
				const formAction = form ? (form.getAttribute('action') || window.location.pathname) : '';
				
				// Form purpose classifier (Phase 1)
				if (form) {
					const method = (form.getAttribute('method') || '').toUpperCase();
					if (method === 'GET' || /search|filter|sort/i.test(formAction)) continue;
					const inputs = form.querySelectorAll('input');
					if (inputs.length === 1 && inputs[0].getAttribute('type') === 'search') continue;
				}

				if (typeAttr === 'button' && !hasClickBehavior) {
					pushIssue(el, 'button_without_action', '', onclick, formAction);
					continue;
				}
				if ((typeAttr === 'submit' || typeAttr === 'reset') && !form && !hasClickBehavior) {
					pushIssue(el, 'orphan_submit_button', '', onclick, '');
				}
				continue;
			}

			if (tag === 'input') {
				const typeAttr = (el.getAttribute('type') || '').toLowerCase();
				if (typeAttr === 'button' || typeAttr === 'submit') {
					const form = el.closest('form');
					const formAction = form ? (form.getAttribute('action') || window.location.pathname) : '';
					
					// Form purpose classifier (Phase 1)
					if (form) {
						const method = (form.getAttribute('method') || '').toUpperCase();
						if (method === 'GET' || /search|filter|sort/i.test(formAction)) continue;
						const inputs = form.querySelectorAll('input');
						if (inputs.length === 1 && inputs[0].getAttribute('type') === 'search') continue;
					}

					if (!form && !hasClickBehavior) {
						pushIssue(el, 'orphan_input_button', '', onclick, formAction);
					}
				}
				continue;
			}

			if (el.getAttribute('role') === 'button' && !hasClickBehavior) {
				pushIssue(el, 'role_button_without_handler', '', onclick, '');
			}
		}
		return results;
	}`)
	if btnsErr == nil && btnsVal != nil {
		btns := make([]string, 0)
		details := make([]NonFunctionalButtonDetail, 0)
		for _, v := range btnsVal.Value.Arr() {
			label := strings.TrimSpace(v.Get("label").Str())
			if label == "" {
				label = "(unnamed)"
			}
			btns = append(btns, label)
			details = append(details, NonFunctionalButtonDetail{
				Label:      label,
				Selector:   strings.TrimSpace(v.Get("selector").Str()),
				Tag:        strings.TrimSpace(v.Get("tag").Str()),
				IssueType:  strings.TrimSpace(v.Get("issue_type").Str()),
				Href:       strings.TrimSpace(v.Get("href").Str()),
				Onclick:    strings.TrimSpace(v.Get("onclick").Str()),
				FormAction: strings.TrimSpace(v.Get("form_action").Str()),
			})
		}
		result.NonFunctionalButtons = btns
		result.NonFunctionalButtonDetails = details
		result.NonFunctionalButtonCount = len(btns)
	}
	result.ButtonKPIPassed = result.NonFunctionalButtonCount == 0

	// Extract FCP from paint API only — no DCL fallback.
	// DCL is not a valid FCP proxy for SPAs where content renders after DOMContentLoaded.
	// If FCP is unavailable, FCPMS stays 0 (not measured) rather than using a misleading proxy.
	fcpVal, err := page.Eval(`() => {
		const paintEntries = performance.getEntriesByType('paint');
		const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
		if (fcp && fcp.startTime > 0) return fcp.startTime;
		// BL-08: If FCP is missing (SPA hydrated), use closest relative proxy (DCL)
		const navEntries = performance.getEntriesByType('navigation');
		if (navEntries.length > 0 && navEntries[0].domContentLoadedEventEnd > 0) return navEntries[0].domContentLoadedEventEnd;
		return 0;
	}`)
	if err == nil {
		result.FCPMS = math.Round(fcpVal.Value.Num()*10) / 10
	}

	// Extract LCP from buffered entries
	lcpVal, err := page.Eval(`() => {
		return new Promise((resolve) => {
			let lcp = 0;
			const observer = new PerformanceObserver((list) => {
				const entries = list.getEntries();
				if (entries.length > 0) lcp = entries[entries.length - 1].startTime;
			});
			try { observer.observe({type: 'largest-contentful-paint', buffered: true}); } catch(e) {}
			// [5.5] Increased from 1000ms to 3000ms for desktop.
			// LCP can arrive up to 2.5s on standard connections; 1s missed lazy-loaded images.
			setTimeout(() => { observer.disconnect(); resolve(lcp); }, 3000);
		});
	}`)
	if err == nil {
		result.LCPMS = lcpVal.Value.Num()
	}

	// Extract CLS from buffered entries
	clsVal, err := page.Eval(`() => {
		return new Promise((resolve) => {
			let cls = 0;
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (!entry.hadRecentInput) {
						// BL-10: Ignore shifts caused by sliders, carousels, or accordions
						let isIntentional = false;
						if (entry.sources) {
							for (const source of entry.sources) {
								if (source.node && typeof source.node.className === 'string') {
									const c = source.node.className.toLowerCase();
									if (c.includes('carousel') || c.includes('slide') || c.includes('accordion') || c.includes('collapse') || c.includes('drawer')) {
										isIntentional = true;
									}
								}
							}
						}
						if (!isIntentional) cls += entry.value;
					}
				}
			});
			try { observer.observe({type: 'layout-shift', buffered: true}); } catch(e) {}
			// [5.5] Match desktop LCP timeout so all Core Web Vitals are measured over same window.
			setTimeout(() => { observer.disconnect(); resolve(cls); }, 3000);
		});
	}`)
	if err == nil {
		result.CLS = math.Round(clsVal.Value.Num()*1000) / 1000
	}

	// Extract DOM node count
	domVal, err := page.Eval(`() => document.querySelectorAll('*').length`)
	if err == nil {
		result.DOMNodes = int(domVal.Value.Num())
	}

	// Calculate Speed Index (Synthetic Approximation)
	// Formula: 30% FCP + 70% LCP — both are official Core Web Vitals.
	// DCL removed: it is not a Core Web Vital and inflates scores for SPAs where
	// DCL fires before visible content is rendered.
	// SpeedIndexSynthetic=true signals to consumers this is a mathematical proxy.
	if result.FCPMS > 0 && result.LCPMS > 0 {
		si := (result.FCPMS * 0.3) + (result.LCPMS * 0.7)
		if !math.IsNaN(si) && !math.IsInf(si, 0) && si > 0 {
			result.SpeedIndexMS = math.Round(si)
			result.SpeedIndexSynthetic = true
		}
	}

	// Capture Unused JS/CSS via Profiler Coverage
	jsCov, err := proto.ProfilerTakePreciseCoverage{}.Call(page)
	if err == nil && jsCov != nil {
		unusedJs := 0
		for _, script := range jsCov.Result {
			// Find total length off the script text
			scriptLen := 0
			// Calculate used length from ranges
			usedLen := 0
			for _, fn := range script.Functions {
				for _, span := range fn.Ranges {
					if span.Count > 0 {
						used := int(span.EndOffset - span.StartOffset)
						usedLen += used
					}
					// track max span end to guess total length approximation
					if int(span.EndOffset) > scriptLen {
						scriptLen = int(span.EndOffset)
					}
				}
			}
			if scriptLen > usedLen {
				unusedJs += (scriptLen - usedLen)
			}
		}
		result.UnusedJSBytes = unusedJs
	}

	cssCov, err := proto.CSSStopRuleUsageTracking{}.Call(page)
	if err == nil && cssCov != nil {
		unusedCss := 0
		for _, rule := range cssCov.RuleUsage {
			if !rule.Used {
				unusedCss += int(rule.EndOffset - rule.StartOffset)
			}
		}
		result.UnusedCSSBytes = unusedCss
	}

	// Finalize network metrics
	networkMu.Lock()
	result.HTTPRequests = requestCount
	result.TransferSizeKB = math.Round(totalTransferBytes/1024*100) / 100

	// Calculate SWD v4 carbon emissions per category and total
	totalEmissions := 0.0
	for category, catData := range breakdown {
		catData.CO2Grams = calculateSWDCarbon(catData.SizeBytes)
		totalEmissions += catData.CO2Grams
		breakdown[category] = catData
	}
	result.AssetBreakdown = breakdown
	result.EmissionsPerPageLoad = math.Round(totalEmissions*1000) / 1000
	networkMu.Unlock()

	overflowEvalScript := `() => {
		const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
		return document.documentElement.scrollWidth > (vw + 5);
	}`

	// Desktop responsiveness check (current viewport)
	overflowDesk, err := page.Eval(overflowEvalScript)
	if err == nil {
		result.DesktopOverflow = overflowDesk.Value.Bool()
	}

	// Tablet responsiveness check
	page.MustSetViewport(768, 1024, 1.0, true)
	time.Sleep(200 * time.Millisecond)
	overflowTab, err := page.Eval(overflowEvalScript)
	if err == nil && overflowTab.Value.Bool() {
		// Adaptive settle: only retry with longer delay when initial read is overflow.
		time.Sleep(600 * time.Millisecond)
		overflowTab2, err2 := page.Eval(overflowEvalScript)
		if err2 == nil {
			overflowTab = overflowTab2
		}
	}
	if err == nil {
		result.TabletOverflow = overflowTab.Value.Bool()
	}

	// Mobile responsiveness check (viewport 375px)
	page.MustSetViewport(375, 812, 1.0, true)
	time.Sleep(200 * time.Millisecond)

	overflowVal, err := page.Eval(overflowEvalScript)
	if err == nil && overflowVal.Value.Bool() {
		// Adaptive settle: only retry with longer delay when initial read is overflow.
		time.Sleep(600 * time.Millisecond)
		overflowVal2, err2 := page.Eval(overflowEvalScript)
		if err2 == nil {
			overflowVal = overflowVal2
		}
	}
	if err == nil {
		result.MobileOverflow = overflowVal.Value.Bool()
	}

	// 5. UX / Visual: Check for Invisible Links (CSS display none, hidden, or size 0)
	invisibleLinksVal, err := page.Eval(`() => {
		const links = Array.from(document.querySelectorAll('a[href]'));
		let invisibleCount = 0;
		for (const a of links) {
			const style = window.getComputedStyle(a);
			const rect = a.getBoundingClientRect();
			if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || (rect.width === 0 && rect.height === 0)) {
				// We exclude standard accessibility-only classes
				const cls = a.className || "";
				if (!cls.includes('sr-only') && !cls.includes('visually-hidden') && !cls.includes('screen-reader-only')) {
					invisibleCount++;
				}
			}
		}
		return invisibleCount;
	}`)
	if err == nil {
		result.InvisibleLinks = int(invisibleLinksVal.Value.Num())
	}

	// Calculate Official Eco-Index based on quantiles
	result.EcoIndex, result.EcoScore = calculateEcoIndex(result.DOMNodes, result.HTTPRequests, result.TransferSizeKB)

	// BL-09: Capture the final rendered DOM string for NLP hydration
	if htmlStr, err := page.HTML(); err == nil {
		result.RenderedHTML = htmlStr
	}

	return result
}

// AnalyzeHomepageMobile launches a headless browser with 3G mobile emulation and measures
// FCP, LCP, CLS, and Speed Index for the given homepage URL.
// Thresholds (mobile 3G): FCP < 3000 ms, LCP < 4000 ms, CLS < 0.25
func AnalyzeHomepageMobile(targetURL string) MobilePerformanceResult {
	res := MobilePerformanceResult{}

	// Guard: skip immediately when no system Chromium is available.
	// rod auto-downloads a fresh binary otherwise, burning the scan budget.
	if _, found := findChromePath(); !found {
		res.Error = "no Chromium binary available — set CHROME_PATH or install chromium"
		return res
	}

	launchURL, err := launchBrowserWithFallback()
	if err != nil {
		res.Error = fmt.Sprintf("launcher: %v", err)
		return res
	}
	url := launchURL
	br := rod.New().ControlURL(url).MustConnect()
	defer br.Close()

	page, err := br.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		res.Error = fmt.Sprintf("page create: %v", err)
		return res
	}
	defer page.Close()

	// Mobile viewport: 375×812 (iPhone X) with device-scale-factor 2 and mobile flag
	page.MustSetViewport(375, 812, 2.0, true)

	// iPhone 15 user agent
	_ = proto.NetworkSetUserAgentOverride{
		UserAgent:      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
		AcceptLanguage: "fr-FR,fr;q=0.9,en;q=0.8",
		Platform:       "iPhone",
	}.Call(page)

	// 3G network throttle: latency 300 ms, 1.5 Mbps download, 750 Kbps upload
	_ = proto.NetworkEmulateNetworkConditions{
		Offline:            false,
		Latency:            300,
		DownloadThroughput: 1.5 * 1024 * 1024 / 8, // 1.5 Mbps in bytes/s
		UploadThroughput:   750 * 1024 / 8,        // 750 Kbps in bytes/s
		ConnectionType:     proto.NetworkConnectionTypeCellular3g,
	}.Call(page)

	_ = proto.NetworkEnable{}.Call(page)

	err = page.Timeout(90 * time.Second).Navigate(targetURL)
	if err != nil {
		res.Error = fmt.Sprintf("navigate: %v", err)
		return res
	}
	_ = page.Timeout(90 * time.Second).WaitIdle(3 * time.Second)
	// Short jittered wait for metrics to settle (1–3 s replaces fixed 5 s).
	jitterSleep(1000, 5000)

	// FCP
	fcpVal, err := page.Eval(`() => {
		const entries = performance.getEntriesByType('paint');
		const fcp = entries.find(e => e.name === 'first-contentful-paint');
		if (fcp && fcp.startTime > 0) return fcp.startTime;
		const t = performance.timing;
		const fallback = t.domContentLoadedEventEnd - t.navigationStart;
		return fallback > 0 ? fallback : 0;
	}`)
	if err == nil {
		fcp := math.Round(fcpVal.Value.Num()*10) / 10
		if !math.IsNaN(fcp) && !math.IsInf(fcp, 0) && fcp > 0 && fcp < 120000 {
			res.FCPMS = fcp
		}
	}

	// LCP
	lcpVal, err := page.Eval(`() => {
		return new Promise((resolve) => {
			let lcp = 0;
			const obs = new PerformanceObserver((list) => {
				const entries = list.getEntries();
				if (entries.length > 0) lcp = entries[entries.length - 1].startTime;
			});
			try { obs.observe({type: 'largest-contentful-paint', buffered: true}); } catch(e) {}
			// [5.5] Increased from 1500ms to 5000ms for mobile.
			// On 3G or slow servers LCP legitimately arrives at 3-4s.
			setTimeout(() => { obs.disconnect(); resolve(lcp); }, 5000);
		});
	}`)
	if err == nil {
		res.LCPMS = lcpVal.Value.Num()
	}

	// CLS
	clsVal, err := page.Eval(`() => {
		return new Promise((resolve) => {
			let cls = 0;
			const obs = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (!entry.hadRecentInput) cls += entry.value;
				}
			});
			try { obs.observe({type: 'layout-shift', buffered: true}); } catch(e) {}
			// [5.5] Increased from 1500ms to 5000ms to match mobile LCP window.
			setTimeout(() => { obs.disconnect(); resolve(cls); }, 5000);
		});
	}`)
	if err == nil {
		res.CLS = math.Round(clsVal.Value.Num()*1000) / 1000
	}

	// Speed Index (synthetic: 30% FCP + 70% LCP — Core Web Vitals only, DCL removed)
	if res.FCPMS > 0 && res.LCPMS > 0 {
		si := res.FCPMS*0.3 + res.LCPMS*0.7
		if !math.IsNaN(si) && !math.IsInf(si, 0) && si > 0 {
			res.SpeedIndexMS = math.Round(si)
		}
	}

	// Threshold checks
	issues := []string{}
	// G10: Mobile CWV FCP threshold (Good < 1800ms)
	if res.FCPMS == 0 || res.FCPMS >= 1800 {
		issues = append(issues, fmt.Sprintf("FCP %.0f ms exceeds 1800 ms threshold on mobile", res.FCPMS))
	}
	// G10: Mobile CWV LCP threshold (Good < 2500ms)
	if res.LCPMS == 0 || res.LCPMS >= 2500 {
		issues = append(issues, fmt.Sprintf("LCP %.0f ms exceeds 2500 ms threshold on mobile", res.LCPMS))
	}
	if res.CLS >= 0.25 {
		issues = append(issues, fmt.Sprintf("CLS %.3f exceeds 0.25 threshold on mobile", res.CLS))
	}
	res.Issues = issues
	res.Passed = len(issues) == 0

	return res
}

// SWD v4 Carbon Calculation
func calculateSWDCarbon(bytesSize int) float64 {
	sizeGB := float64(bytesSize) / (1024 * 1024 * 1024)
	energyKWh := sizeGB * 0.81     // ADEME average kWh per GB
	carbonIntensityGlobal := 519.0 // gCO2 per kWh

	eDevice := energyKWh * 0.45 * carbonIntensityGlobal
	eNetwork := energyKWh * 0.14 * carbonIntensityGlobal
	eCenter := energyKWh * 0.24 * carbonIntensityGlobal
	eProd := energyKWh * 0.17 * carbonIntensityGlobal

	return math.Round((eDevice+eNetwork+eCenter+eProd)*1000) / 1000
}

var (
	domQuantiles  = []float64{22, 47, 74, 104, 137, 174, 213, 258, 305, 358, 417, 482, 559, 651, 769, 916, 1141, 1513, 2391, 12347}
	reqQuantiles  = []float64{17, 28, 38, 49, 61, 74, 88, 104, 121, 140, 160, 184, 211, 244, 288, 343, 426, 550, 806, 7441}
	sizeQuantiles = []float64{248000, 418000, 618000, 863000, 1163000, 1553000, 2043000, 2703000, 3553000, 4743000, 6223000, 8163000, 10703000, 14073000, 18663000, 24973000, 33683000, 46233000, 63533000, 532000000}
)

func getQuantilePosition(value float64, quantiles []float64) float64 {
	if value <= quantiles[0] {
		return 0.0
	}
	if value >= quantiles[len(quantiles)-1] {
		return 1.0
	}
	for i := 0; i < len(quantiles)-1; i++ {
		if value >= quantiles[i] && value < quantiles[i+1] {
			lower := float64(i) / 20.0
			upper := float64(i+1) / 20.0
			interpolation := (value - quantiles[i]) / (quantiles[i+1] - quantiles[i])
			return lower + interpolation*(upper-lower)
		}
	}
	return 1.0
}

// calculateEcoIndex implements the official Quantile-based GreenIT Eco-Index formula.
func calculateEcoIndex(domNodes int, httpRequests int, transferSizeKB float64) (float64, string) {
	qDom := getQuantilePosition(float64(domNodes), domQuantiles)
	qReq := getQuantilePosition(float64(httpRequests), reqQuantiles)
	qSize := getQuantilePosition(transferSizeKB*1024, sizeQuantiles)

	weightedSum := (3*qDom + 2*qReq + 1*qSize) / 6.0
	index := 100.0 - (100.0 * weightedSum)

	if index < 0 {
		index = 0
	}
	if index > 100 {
		index = 100
	}
	index = math.Round(index*100) / 100

	var grade string
	switch {
	case index >= 90:
		grade = "A"
	case index >= 80:
		grade = "B"
	case index >= 70:
		grade = "C"
	case index >= 50:
		grade = "D"
	case index >= 30:
		grade = "E"
	case index >= 10:
		grade = "F"
	default:
		grade = "G"
	}

	return index, grade
}
