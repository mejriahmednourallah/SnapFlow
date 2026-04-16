package formbrowser

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"snapflow/v3-scanner-go/analyzers/formfuzzer"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

type Config struct {
	Timeout  time.Duration
	MaxForms int
	Headless bool
}

func AnalyzeWithBrowser(ctx context.Context, targetURL string, cfg Config) ([]formfuzzer.DiscoveredForm, error) {
	if strings.TrimSpace(targetURL) == "" {
		return nil, fmt.Errorf("empty target URL")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 60 * time.Second
	}
	if cfg.MaxForms <= 0 {
		cfg.MaxForms = 25
	}

	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline) - 2*time.Second
		if remaining <= 0 {
			return nil, context.DeadlineExceeded
		}
		if remaining < cfg.Timeout {
			cfg.Timeout = remaining
		}
	}

	l := launcher.New().Headless(cfg.Headless)
	if chromePath := os.Getenv("CHROME_PATH"); chromePath != "" {
		l.Bin(chromePath)
	} else if path, found := launcher.LookPath(); found {
		l.Bin(path)
	}
	if shouldDisableSandbox() {
		l.Set("no-sandbox").
			Set("disable-dev-shm-usage").
			Set("disable-gpu")
	}

	launchURL, err := l.Launch()
	if err != nil {
		return nil, fmt.Errorf("failed to launch browser: %w", err)
	}

	browser := rod.New().ControlURL(launchURL)
	if err := browser.Connect(); err != nil {
		return nil, fmt.Errorf("failed to connect browser: %w", err)
	}
	defer browser.MustClose()

	page, err := browser.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		return nil, fmt.Errorf("failed to create page: %w", err)
	}
	defer page.Close()

	page = page.Timeout(cfg.Timeout)
	if err := page.Navigate(targetURL); err != nil {
		return nil, fmt.Errorf("failed to navigate: %w", err)
	}
	_ = page.WaitLoad()

	// Give challenge scripts a short window to redirect to real content.
	waitUntil := time.Now().Add(cfg.Timeout)
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		html, err := page.HTML()
		if err != nil {
			break
		}
		if !looksLikeCloudflareChallenge(html) {
			break
		}
		if time.Now().After(waitUntil) {
			break
		}
		time.Sleep(1500 * time.Millisecond)
		_ = page.WaitLoad()
	}

	currentURL := targetURL
	if info, err := page.Info(); err == nil && strings.TrimSpace(info.URL) != "" {
		currentURL = info.URL
	}

	formEls, err := page.Elements("form")
	if err != nil {
		return nil, fmt.Errorf("failed to query forms: %w", err)
	}

	forms := make([]formfuzzer.DiscoveredForm, 0, len(formEls))
	for idx, formEl := range formEls {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if len(forms) >= cfg.MaxForms {
			break
		}

		formID := strings.TrimSpace(attrValue(formEl, "id"))
		if formID == "" {
			formID = fmt.Sprintf("rod_form_%d", idx+1)
		}

		actionRaw := strings.TrimSpace(attrValue(formEl, "action"))
		actionURL := resolveActionURL(currentURL, actionRaw)
		if actionURL == "" {
			actionURL = currentURL
		}

		method := strings.ToUpper(strings.TrimSpace(attrValue(formEl, "method")))
		if method == "" {
			method = "POST"
		}
		if method != "GET" && method != "POST" {
			method = "POST"
		}

		fieldEls, _ := formEl.Elements("input, textarea, select")
		fields := make([]formfuzzer.FormField, 0, len(fieldEls))
		for _, fieldEl := range fieldEls {
			name := strings.TrimSpace(attrValue(fieldEl, "name"))
			id := strings.TrimSpace(attrValue(fieldEl, "id"))
			label := strings.TrimSpace(attrValue(fieldEl, "placeholder"))
			if label == "" {
				label = strings.TrimSpace(attrValue(fieldEl, "aria-label"))
			}
			if name == "" {
				name = id
			}
			if name == "" {
				continue
			}

			tagName := strings.ToLower(jsString(fieldEl, "el => el.tagName.toLowerCase()"))
			fieldType := "text"
			switch tagName {
			case "textarea":
				fieldType = "textarea"
			case "select":
				fieldType = "select"
			default:
				t := strings.ToLower(strings.TrimSpace(attrValue(fieldEl, "type")))
				if t != "" {
					fieldType = t
				}
			}

			required := hasAttr(fieldEl, "required")
			field := formfuzzer.FormField{
				Name:     name,
				ID:       id,
				Label:    label,
				Type:     fieldType,
				Required: required,
			}

			if tagName == "select" {
				optEls, _ := fieldEl.Elements("option")
				for _, optEl := range optEls {
					val := attrValue(optEl, "value")
					if strings.TrimSpace(val) == "" {
						if txt, err := optEl.Text(); err == nil {
							val = strings.TrimSpace(txt)
						}
					}
					if strings.TrimSpace(val) != "" {
						field.Options = append(field.Options, val)
					}
				}
			}

			fields = append(fields, field)
		}

		if len(fields) == 0 {
			continue
		}

		// Phase 1 - Form Purpose Classifier: Skip search/filter/sort widgets
		actionLower := strings.ToLower(actionURL)
		isSearchAction := strings.Contains(actionLower, "search") || strings.Contains(actionLower, "filter") || strings.Contains(actionLower, "sort")
		if method == "GET" && isSearchAction {
			continue // Skip GET search forms
		}
		if len(fields) == 1 && strings.ToLower(fields[0].Type) == "search" {
			continue // Skip single input search forms
		}

		forms = append(forms, formfuzzer.DiscoveredForm{
			FormID:    formID,
			PageURL:   currentURL,
			ActionURL: actionURL,
			Method:    method,
			Fields:    fields,
		})
	}

	return forms, nil
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
	return os.Getuid() == 0
}

func looksLikeCloudflareChallenge(html string) bool {
	lower := strings.ToLower(html)
	return strings.Contains(lower, "one moment, please") ||
		strings.Contains(lower, "attention required") ||
		strings.Contains(lower, "/cdn-cgi/challenge-platform/") ||
		strings.Contains(lower, "cf-challenge")
}

func attrValue(el *rod.Element, name string) string {
	v, err := el.Attribute(name)
	if err != nil || v == nil {
		return ""
	}
	return *v
}

func hasAttr(el *rod.Element, name string) bool {
	v, err := el.Attribute(name)
	return err == nil && v != nil
}

func jsString(el *rod.Element, expression string) string {
	value, err := el.Eval(expression)
	if err != nil || value == nil {
		return ""
	}
	if value.Value.Str() != "" {
		return value.Value.Str()
	}
	if value.Value.String() != "" {
		return value.Value.String()
	}
	return ""
}

func resolveActionURL(pageURL, action string) string {
	action = strings.TrimSpace(action)
	if action == "" {
		return pageURL
	}
	base, err := url.Parse(pageURL)
	if err != nil {
		return action
	}
	u, err := url.Parse(action)
	if err != nil {
		return action
	}
	return base.ResolveReference(u).String()
}
