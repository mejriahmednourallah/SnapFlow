package formfuzzer

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/proto"
)

// SubmitOutcome represents the exact behavioral response of a form after submission attempts
type SubmitOutcome struct {
	Navigated        bool
	ValidSubmitFired bool
	ValidationFailed bool
	CaptchaDetected  bool
	NoReaction       bool
	OutcomeReason    string // SUCCESS_SUBMITTED, VALIDATION_FAILED, INCONCLUSIVE_CAPTCHA, FALSE_POSITIVE_NO_REACTION
}

// SubmitWithBrowser implements Gate 2: Post-Submit Classification
// It performs a dry-run text fill, sets up network interceptors, physically clicks Submit,
// and observes the DOM and Network traffic for reactions.
func SubmitWithBrowser(ctx context.Context, browser *rod.Browser, form DiscoveredForm, payload map[string]string) (SubmitOutcome, error) {
	var outcome SubmitOutcome

	page, err := browser.Page(proto.TargetCreateTarget{URL: form.PageURL})
	if err != nil {
		return outcome, fmt.Errorf("failed to open page: %w", err)
	}
	defer page.Close()

	page = page.Timeout(15 * time.Second)
	_ = page.WaitLoad()

	// 1. Setup Network Interception (Layer 3: Network pre-intercept)
	router := page.HijackRequests()
	defer router.Stop()

	router.MustAdd("*", func(ctx *rod.Hijack) {
		req := ctx.Request.Req()
		// If a POST/PUT/PATCH fires after click, it's a confirmed transactional form
		method := strings.ToUpper(req.Method)
		if method == "POST" || method == "PUT" || method == "PATCH" {
			urlStr := req.URL.String()
			// Ignore analytics beacons
			if !strings.Contains(urlStr, "analytics") && !strings.Contains(urlStr, "collect") {
				outcome.ValidSubmitFired = true
			}
		}
		ctx.ContinueRequest(&proto.FetchContinueRequest{})
	})
	go router.Run()

	// 2. Find the Form in the Headless DOM
	formSelector := fmt.Sprintf("form#%s", form.FormID)
	if form.FormID == "" {
		formSelector = "form"
	}

	formEl, err := page.Element(formSelector)
	if err != nil {
		// Try fallback if ID fails
		formEl, err = page.Element("form")
		if err != nil {
			return outcome, fmt.Errorf("form not found in DOM during browser run")
		}
	}

	// 3. The "Dry-Run" Probe (Layer 3: Trigger input, change, blur)
	for name, val := range payload {
		selector := fmt.Sprintf("[name='%s'], [id='%s']", name, name)
		if input, err := formEl.Element(selector); err == nil {
			_ = input.Input(val)
			_ = input.Blur() // Trigger client-side validation
		}
	}

	// 4. Check for Defensive Barriers Before Submit (Layer 5 Edge Cases)
	if iframes, err := page.Elements("iframe"); err == nil {
		for _, frm := range iframes {
			src, _ := frm.Attribute("src")
			if src != nil && (strings.Contains(strings.ToLower(*src), "recaptcha") || strings.Contains(strings.ToLower(*src), "hcaptcha")) {
				outcome.CaptchaDetected = true
				outcome.OutcomeReason = "INCONCLUSIVE_CAPTCHA"
			}
		}
	}

	// 5. Fire Submit!
	if submitBtn, err := formEl.Element("button[type='submit'], input[type='submit']"); err == nil {
		_ = submitBtn.Click(proto.InputMouseButtonLeft, 1)
	} else if fallbackBtn, err := formEl.Element("button"); err == nil {
		_ = fallbackBtn.Click(proto.InputMouseButtonLeft, 1)
	} else {
		// Fallback to ENTER key submission
		_ = page.Keyboard.Press('\r')
	}

	// 6. Observation Window: 5 Seconds max budget (Layer 4)
	waitStart := time.Now()
	for time.Since(waitStart) < 5*time.Second {
		// Gate 2a: Network event check
		if outcome.ValidSubmitFired {
			break
		}

		// Gate 2b: Navigation event check
		if info, err := page.Info(); err == nil {
			if info.URL != form.PageURL && info.URL != form.PageURL+"#" {
				outcome.Navigated = true
				outcome.ValidSubmitFired = true
				break
			}
		}

		// Gate 2c: DOM Mutation error states check
		hasError, err := page.Eval(`() => {
			return !!document.querySelector('[class*="error"], [class*="invalid"], [aria-invalid="true"], [aria-live="assertive"]');
		}`)
		if err == nil && hasError != nil && hasError.Value.Bool() {
			outcome.ValidationFailed = true
			outcome.ValidSubmitFired = true // DOM explicitly reacted
			break
		}

		time.Sleep(500 * time.Millisecond)
	}

	// 7. Final Classification
	if !outcome.ValidSubmitFired && !outcome.Navigated && !outcome.ValidationFailed && !outcome.CaptchaDetected {
		// The "Ghost Click" Detector
		outcome.NoReaction = true
		outcome.OutcomeReason = "FALSE_POSITIVE_NO_REACTION"
	} else if outcome.OutcomeReason == "" {
		if outcome.ValidationFailed {
			outcome.OutcomeReason = "VALIDATION_FAILED"
		} else {
			outcome.OutcomeReason = "SUCCESS_SUBMITTED"
		}
	}

	return outcome, nil
}

// DiscoverModalForms implements Layer 5: Modal/Popup Form Detection
// It scans for CTA (Call-To-Action) buttons, clicks them to spawn modals,
// and discovers forms hidden inside those modal overlays.
func DiscoverModalForms(ctx context.Context, browser *rod.Browser, pageURL string) ([]DiscoveredForm, error) {
	var discovered []DiscoveredForm

	page, err := browser.Page(proto.TargetCreateTarget{URL: pageURL})
	if err != nil {
		return nil, fmt.Errorf("failed to open page for modal detection: %w", err)
	}
	defer page.Close()

	page = page.Timeout(15 * time.Second)
	_ = page.WaitLoad()

	// Layer 5a: Find CTA Button Candidates
	// Common CTA text patterns that trigger modals
	ctaPatterns := []string{
		"get demo", "request demo", "book demo",
		"contact us", "schedule call", "book a call", "talk to us",
		"get started", "start free trial", "try free",
		"get quote", "request quote",
		"more info", "learn more", "see pricing",
		"apply now", "join now", "sign up",
	}

	buttons, err := page.Elements("button, a[role='button'], input[type='button'], input[type='submit']")
	if err != nil || len(buttons) == 0 {
		return nil, nil // No buttons found, no modals to trigger
	}

	for _, btn := range buttons {
		btnText, _ := btn.Text()
		btnTextLower := strings.ToLower(strings.TrimSpace(btnText))

		// Check if button text matches CTA pattern
		isCTA := false
		for _, pattern := range ctaPatterns {
			if strings.Contains(btnTextLower, pattern) {
				isCTA = true
				break
			}
		}

		if !isCTA {
			continue
		}

		// Layer 5b: Set up Modal Detector Before Click
		// Listen for new DOM elements (modal containers) to appear
		detectModalScript := `
		window._modalDetected = false;
		const observer = new MutationObserver((mutations) => {
			for (const mut of mutations) {
				for (const node of mut.addedNodes) {
					if (node.nodeType !== 1) continue;
					const html = node.outerHTML || '';
					const cls = (node.className || '').toLowerCase();
					const role = (node.getAttribute('role') || '').toLowerCase();
					// Detect modal/dialog/popup containers
					if (role === 'dialog' || cls.includes('modal') || cls.includes('popup') || cls.includes('overlay') || cls.includes('drawer')) {
						window._modalDetected = true;
						// Stop monitoring after first detection
						observer.disconnect();
						return;
					}
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		`
		_, _ = page.Eval(detectModalScript)

		// Layer 5c: Click the CTA Button
		_ = btn.Click(proto.InputMouseButtonLeft, 1)

		// Layer 5d: Wait for Modal to Appear (max 3 seconds)
		waitStart := time.Now()
		var hasModal bool
		for time.Since(waitStart) < 3*time.Second {
			detected, _ := page.Eval(`() => window._modalDetected === true`)
			if detected != nil && detected.Value.Bool() {
				hasModal = true
				break
			}
			time.Sleep(300 * time.Millisecond)
		}

		if !hasModal {
			continue // Button click didn't spawn a modal
		}

		// Layer 5e: Extract forms from modal content
		// Find modal container(s) and scan for forms
		modalScript := `
		(() => {
			const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="popup"], [class*="overlay"], [class*="drawer"]');
			if (modals.length === 0) return [];

			const forms = [];
			for (const modal of modals) {
				const formsInModal = modal.querySelectorAll('form');
				for (const form of formsInModal) {
					forms.push({
						html: form.outerHTML,
						action: form.getAttribute('action') || '',
						method: form.getAttribute('method') || 'post',
						id: form.getAttribute('id') || '',
						modal: true
					});
				}
			}
			return forms;
		})()
		`
		result, _ := page.Eval(modalScript)
		if result == nil || result.Value.Str() == "" {
			continue
		}

		// Parse modal forms and add to discovered list
		// Extract form HTML from modal and convert to DiscoveredForm
		formHTMLs, _ := page.Elements("[role='dialog'] form, [class*='modal'] form, [class*='popup'] form")
		for _, formEl := range formHTMLs {
			formHTML, _ := formEl.HTML()
			formAction, _ := formEl.Attribute("action")
			formMethod, _ := formEl.Attribute("method")
			formID, _ := formEl.Attribute("id")

			fields := extractFields(formHTML)
			if len(fields) > 0 {

				discovered = append(discovered, DiscoveredForm{
					PageURL:   pageURL,
					ActionURL: *formAction,
					FormID:    *formID,
					Method:    strings.ToUpper(*formMethod),
					Fields:    fields,
					IsModal:   true,
				})
			}
		}
	}

	return discovered, nil
}

// scoreButtonIntent (extracted for reuse) calculates CTA button likelihood
// Returns a score out of 100 indicating likelihood this button triggers an action
func scoreButtonIntent(el *rod.Element) int {
	score := 0

	// Get button properties
	tagName, _ := el.Attribute("tagName")
	typeAttr, _ := el.Attribute("type")
	text, _ := el.Text()
	ariaLabel, _ := el.Attribute("aria-label")

	buttonText := strings.ToLower(strings.TrimSpace(text))
	if buttonText == "" && ariaLabel != nil {
		buttonText = strings.ToLower(*ariaLabel)
	}

	// Positive signals
	if typeAttr != nil && *typeAttr == "submit" {
		score += 30
	}
	if isCtaKeyword(buttonText) {
		score += 25
	}
	if tagName != nil && (*tagName == "BUTTON" || *tagName == "INPUT") {
		score += 20
	}

	// Negative signals (contradictory UI patterns)
	isUIButton := isUIKeyword(buttonText)
	if isUIButton {
		score -= 40
	}

	return score
}

func isCtaKeyword(text string) bool {
	keywords := []string{"send", "submit", "register", "book", "request", "get started", "buy", "order", "demo", "quote", "trial", "contact"}
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}

func isUIKeyword(text string) bool {
	keywords := []string{"close", "cancel", "back", "next", "skip", "load more", "filter", "sort", "toggle", "menu"}
	for _, kw := range keywords {
		if strings.Contains(text, kw) {
			return true
		}
	}
	return false
}
