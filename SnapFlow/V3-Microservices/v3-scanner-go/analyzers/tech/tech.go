package tech

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// ─── JS framework version patterns (unchanged) ────────────────────────────────
var versionPatterns = map[string]*regexp.Regexp{
	"jQuery":    regexp.MustCompile(`(?i)jquery[.-]?(\d+\.\d+(?:\.\d+)?)`),
	"Bootstrap": regexp.MustCompile(`(?i)bootstrap[.-]?(\d+\.\d+(?:\.\d+)?)`),
	"React":     regexp.MustCompile(`(?i)react[.-]?(\d+\.\d+(?:\.\d+)?)`),
	"Vue.js":    regexp.MustCompile(`(?i)vue[.-]?(\d+\.\d+(?:\.\d+)?)`),
	"Angular":   regexp.MustCompile(`(?i)angular[.-]?(\d+\.\d+(?:\.\d+)?)`),
}

var poweredBySplitter = regexp.MustCompile(`^([^/]+)(?:/(.+))?$`)

var scriptSrcRE = regexp.MustCompile(`(?is)<script[^>]+src=["']([^"']+)["']`)
var queryVersionRE = regexp.MustCompile(`(?i)[?&](?:ver|v|version)=([0-9]+(?:\.[0-9]+){1,3})`)

var moduleSrcVersionPatterns = map[string]*regexp.Regexp{
	"jQuery":    regexp.MustCompile(`(?i)jquery[^0-9]*([0-9]+(?:\.[0-9]+){1,3})`),
	"Bootstrap": regexp.MustCompile(`(?i)bootstrap[^0-9]*([0-9]+(?:\.[0-9]+){1,3})`),
	"React":     regexp.MustCompile(`(?i)react[^0-9]*([0-9]+(?:\.[0-9]+){1,3})`),
	"Vue.js":    regexp.MustCompile(`(?i)vue[^0-9]*([0-9]+(?:\.[0-9]+){1,3})`),
	"Angular":   regexp.MustCompile(`(?i)angular[^0-9]*([0-9]+(?:\.[0-9]+){1,3})`),
}

var moduleKeywords = map[string][]string{
	"jQuery":    {"jquery"},
	"Bootstrap": {"bootstrap"},
	"React":     {"react"},
	"Vue.js":    {"vue"},
	"Angular":   {"angular"},
}

// Gap #3: extract server/language version from Server or X-Powered-By header
var versionHeaderRE = regexp.MustCompile(`(?i)(php|nginx|apache|node\.?js?|asp\.?net|iis|tomcat|openresty|caddy)[/\s]([0-9]+(?:\.[0-9]+){1,3})`)
var serverOSHintRE = regexp.MustCompile(`(?i)\(([^)]+)\)`)

// ─── CMS version extraction patterns (meta generator + header) ───────────────
// Each is a map from lowercase CMS name to compiled regex.
// Group 1 must capture the version string.
var cmsVersionPatterns = map[string]*regexp.Regexp{
	"wordpress":  regexp.MustCompile(`(?i)<meta[^>]+content=["'][^"']*WordPress\s+([\d.]+)`),
	"drupal":     regexp.MustCompile(`(?i)<meta[^>]+content=["'][^"']*Drupal\s+([\d.]+)`),
	"joomla":     regexp.MustCompile(`(?i)<meta[^>]+content=["'][^"']*Joomla[!]?\s+([\d.]+)`),
	"typo3":      regexp.MustCompile(`(?i)<meta[^>]+content=["'][^"']*TYPO3(?:\s+CMS)?\s+([\d.]+)`),
	"prestashop": regexp.MustCompile(`(?i)<meta[^>]+content=["'][^"']*PrestaShop\s+([\d.]+)`),
	"magento":    regexp.MustCompile(`(?i)/mage/([\d.]+)/`),
}

// cmsHeaderVersionPatterns: for CMS that expose version in a response header.
var cmsHeaderVersionPatterns = map[string]*regexp.Regexp{
	"drupal": regexp.MustCompile(`(?i)Drupal\s+([\d.]+)`),
}

// ─── CMS EOL version prefix maps ─────────────────────────────────────────────
// A detected version is EOL if it starts with any listed prefix.
var cmsEOLMap = map[string][]string{
	"wordpress":  {"3.", "4."},
	"drupal":     {"6.", "7.", "8.", "9."},
	"joomla":     {"1.", "2.", "3."},
	"typo3":      {"6.", "7.", "8.", "9.", "10.", "11."},
	"magento":    {"1."},
	"prestashop": {"1.4", "1.5", "1.6", "1.7"}, // 1.7 reached EOL October 2023
}

// ─── Structs ──────────────────────────────────────────────────────────────────
type DetectedTech struct {
	Name     string `json:"name"`
	Category string `json:"category"`
	Version  string `json:"version,omitempty"`
	Source   string `json:"source"`
}

// Gap #2: explicit module/framework versions
type ModuleVersion struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Source  string `json:"source"` // "script_src" | "header" | "inline"
}

// Gap #5: CVE severity breakdown
type CVESeverity struct {
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
}

// TechResult no longer carries a numeric Score.
// Passed is false only when CMS version is detectable AND is known EOL.
type TechResult struct {
	URL           string         `json:"url"`
	Stack         []DetectedTech `json:"stack"`
	CMS           string         `json:"cms,omitempty"`
	CMSVersion    string         `json:"cms_version,omitempty"`
	CMSVersionEOL bool           `json:"cms_version_eol"`
	Server        string         `json:"server,omitempty"`
	Language      string         `json:"language,omitempty"`
	LanguageVersion string       `json:"language_version,omitempty"`
	// Gap #2: module versions extracted from stack
	ModuleVersions []ModuleVersion `json:"module_versions"`
	// Gap #3: server/language version from response headers
	ServerTech    string `json:"server_tech,omitempty"`
	ServerVersion string `json:"server_version,omitempty"`
	ServerBanner  string `json:"server_banner,omitempty"`
	OSHint        string `json:"os_hint,omitempty"`
	// Gap #5: CVE severity (populated by CVE lookup, zero by default)
	CVESeverity CVESeverity `json:"cve_severity"`
	Passed      bool        `json:"passed"`
	Issues      []string    `json:"issues"`
	ServiceName string      `json:"service_name"`
}

func inferOSHintFromServerBanner(banner string) string {
	if banner == "" {
		return ""
	}
	bannerLower := strings.ToLower(banner)
	if strings.Contains(bannerLower, "win64") || strings.Contains(bannerLower, "windows") {
		return "windows"
	}
	if strings.Contains(bannerLower, "ubuntu") || strings.Contains(bannerLower, "debian") || strings.Contains(bannerLower, "centos") || strings.Contains(bannerLower, "linux") {
		return "linux"
	}
	if m := serverOSHintRE.FindStringSubmatch(banner); len(m) > 1 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// ─── CMS Signature definition ─────────────────────────────────────────────────
// Cookies: regex patterns matched against the raw value of Set-Cookie headers.
type Signature struct {
	Name     string
	Category string
	Patterns []string
	Headers  map[string]string // header name → value regex
	Cookies  []string          // regex patterns for Set-Cookie header values
}

// ─── 9-CMS signatures with multi-signal fingerprinting ───────────────────────
var signatures = []Signature{
	// ── CMS ──────────────────────────────────────────────────────────────────
	{
		Name:     "WordPress",
		Category: "cms",
		Patterns: []string{`/wp-content/`, `/wp-includes/`, `wp-json`, `wp-login.php`},
	},
	{
		Name:     "Drupal",
		Category: "cms",
		Patterns: []string{`/sites/default/`, `/sites/all/`, `drupal.js`, `Drupal.settings`},
		Headers:  map[string]string{"X-Drupal-Cache": `.+`, "X-Generator": `(?i)Drupal`},
		Cookies:  []string{`(?i)^SESS[a-f0-9]{32}`},
	},
	{
		Name:     "Joomla",
		Category: "cms",
		Patterns: []string{`/components/com_`, `/media/jui/`, `Joomla!`},
	},
	{
		Name:     "TYPO3",
		Category: "cms",
		Patterns: []string{`/typo3/`, `typo3conf`, `t3lib_`},
	},
	{
		Name:     "Shopify",
		Category: "cms",
		Patterns: []string{`cdn.shopify.com`, `Shopify.theme`, `shopify_pay`},
	},
	{
		Name:     "Wix",
		Category: "cms",
		Patterns: []string{`static.wixstatic.com`, `wix-bolt`, `wixsite.com`},
		Headers:  map[string]string{"X-Wix-Published-Version": `.+`},
	},
	{
		Name:     "Magento",
		Category: "cms",
		Patterns: []string{`/skin/frontend/`, `Mage.Cookies`, `magento`, `/mage/`},
	},
	{
		Name:     "PrestaShop",
		Category: "cms",
		Patterns: []string{`prestashop`, `/modules/prestashop`, `PrestaShop`},
	},
	{
		Name:     "OpenCart",
		Category: "cms",
		Patterns: []string{`route=common/`, `/catalog/view/theme/`, `opencart`},
	},

	// ── Frameworks ────────────────────────────────────────────────────────────
	{Name: "React", Category: "framework", Patterns: []string{`react.production.min.js`, `__NEXT_DATA__`, `_next/static`}},
	{Name: "Vue.js", Category: "framework", Patterns: []string{`vue.min.js`, `vue.runtime`, `__vue__`}},
	{Name: "Angular", Category: "framework", Patterns: []string{`ng-version`, `angular.min.js`}},
	{Name: "jQuery", Category: "framework", Patterns: []string{`jquery.min.js`, `jquery-`}},
	{Name: "Bootstrap", Category: "framework", Patterns: []string{`bootstrap.min.css`, `bootstrap.min.js`}},
	{Name: "Tailwind CSS", Category: "framework", Patterns: []string{`tailwindcss`, `tailwind.min.css`}},

	// ── Analytics ─────────────────────────────────────────────────────────────
	{Name: "Google Analytics", Category: "analytics", Patterns: []string{`google-analytics.com`, `gtag/js`, `GoogleAnalyticsObject`}},
	{Name: "Google Tag Manager", Category: "analytics", Patterns: []string{`googletagmanager.com`}},

	// ── CDN ───────────────────────────────────────────────────────────────────
	{Name: "Cloudflare", Category: "cdn", Headers: map[string]string{"Server": `cloudflare`, "Cf-Ray": `.+`}},
	{Name: "AWS CloudFront", Category: "cdn", Headers: map[string]string{"X-Amz-Cf-Id": `.+`, "Via": `CloudFront`}},

	// ── Servers ───────────────────────────────────────────────────────────────
	{Name: "Nginx", Category: "server", Headers: map[string]string{"Server": `(?i)nginx`}},
	{Name: "Apache", Category: "server", Headers: map[string]string{"Server": `(?i)apache`}},
}

// ─── extractCMSVersion ────────────────────────────────────────────────────────
// Returns the version string for a detected CMS, or "" if not detectable.
// cmsKey must be the lowercase CMS name (e.g. "drupal", "wordpress").
func extractCMSVersion(html string, headers *http.Header, cmsKey string) string {
	// 1. Try meta generator / inline HTML pattern
	if re, ok := cmsVersionPatterns[cmsKey]; ok {
		if m := re.FindStringSubmatch(html); len(m) > 1 {
			return m[1]
		}
	}

	// 2. Try header-based version extraction (e.g. X-Generator: Drupal 9.5)
	if re, ok := cmsHeaderVersionPatterns[cmsKey]; ok {
		xgen := headers.Get("X-Generator")
		if xgen != "" {
			if m := re.FindStringSubmatch(xgen); len(m) > 1 {
				return m[1]
			}
		}
	}

	return ""
}

// ─── isCMSVersionEOL ─────────────────────────────────────────────────────────
func isCMSVersionEOL(cmsKey, version string) bool {
	if version == "" {
		return false
	}
	prefixes, ok := cmsEOLMap[cmsKey]
	if !ok {
		return false
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(version, prefix) {
			return true
		}
	}
	return false
}

// ─── DetectStack ─────────────────────────────────────────────────────────────
func DetectStack(html string, headers *http.Header) []DetectedTech {
	var detected []DetectedTech
	seen := map[string]bool{}

	// Collect all Set-Cookie header values once for cookie matching
	setCookieValues := headers.Values("Set-Cookie")

	for _, sig := range signatures {
		if seen[sig.Name] {
			continue
		}

		matched := false
		// [T-1] Track which signal channel caused the match so Source is accurate.
		matchSource := "html"

		// 1. HTML pattern match
		for _, pattern := range sig.Patterns {
			if strings.Contains(html, pattern) {
				matched = true
				matchSource = "html"
				break
			}
		}

		// 2. Header match
		if !matched && sig.Headers != nil {
			for headerName, pattern := range sig.Headers {
				val := headers.Get(headerName)
				if val != "" {
					if ok, _ := regexp.MatchString(pattern, val); ok {
						matched = true
						matchSource = "header"
						break
					}
				}
			}
		}

		// 3. Cookie match (only for CMS signatures that declare Cookie patterns)
		if !matched && len(sig.Cookies) > 0 {
			for _, cookiePattern := range sig.Cookies {
				re := regexp.MustCompile(cookiePattern)
				for _, cookieVal := range setCookieValues {
					// match against the cookie name (first token before =)
					cookieName := strings.SplitN(cookieVal, "=", 2)[0]
					if re.MatchString(cookieName) {
						matched = true
						matchSource = "cookie"
						break
					}
				}
				if matched {
					break
				}
			}
		}

		if matched {
			version := ""
			if sig.Category == "cms" {
				// version from HTML/header CMS-specific patterns
				version = extractCMSVersion(html, headers, strings.ToLower(sig.Name))
			} else if vp, ok := versionPatterns[sig.Name]; ok {
				if vm := vp.FindStringSubmatch(html); len(vm) > 1 {
					version = vm[1]
				}
			}
			detected = append(detected, DetectedTech{
				Name:     sig.Name,
				Category: sig.Category,
				Version:  version,
				Source:   matchSource, // [T-1] reflect actual detection channel
			})
			seen[sig.Name] = true
		}
	}

	// X-Powered-By header
	if poweredBy := headers.Get("X-Powered-By"); poweredBy != "" {
		matches := poweredBySplitter.FindStringSubmatch(poweredBy)
		if len(matches) > 1 {
			name := matches[1]
			version := ""
			if len(matches) > 2 {
				version = matches[2]
			}
			category := "language"
			if strings.EqualFold(name, "Express") || strings.EqualFold(name, "Next.js") || strings.EqualFold(name, "ASP.NET") {
				category = "framework"
			}
			if !seen[name] {
				detected = append(detected, DetectedTech{
					Name:     name,
					Category: category,
					Version:  version,
					Source:   "header",
				})
				seen[name] = true
			}
		}
	}

	return detected
}

func collectModuleVersions(html string, stack []DetectedTech) []ModuleVersion {
	versions := []ModuleVersion{}
	seen := map[string]bool{}

	addVersion := func(name, version, source string) {
		version = strings.TrimSpace(version)
		if name == "" || version == "" {
			return
		}
		key := strings.ToLower(name) + "|" + version
		if seen[key] {
			return
		}
		seen[key] = true
		versions = append(versions, ModuleVersion{Name: name, Version: version, Source: source})
	}

	// 1) Existing stack-derived versions
	for _, t := range stack {
		if t.Category == "framework" && t.Version != "" {
			addVersion(t.Name, t.Version, t.Source)
		}
	}

	// 2) Script src URL parsing (file name or query-string version)
	matches := scriptSrcRE.FindAllStringSubmatch(html, -1)
	for _, match := range matches {
		if len(match) < 2 {
			continue
		}
		src := match[1]
		srcLower := strings.ToLower(src)

		for moduleName, keywords := range moduleKeywords {
			containsKeyword := false
			for _, kw := range keywords {
				if strings.Contains(srcLower, kw) {
					containsKeyword = true
					break
				}
			}
			if !containsKeyword {
				continue
			}

			if re, ok := moduleSrcVersionPatterns[moduleName]; ok {
				if m := re.FindStringSubmatch(src); len(m) > 1 {
					addVersion(moduleName, m[1], "script_src")
					continue
				}
			}
			if q := queryVersionRE.FindStringSubmatch(src); len(q) > 1 {
				addVersion(moduleName, q[1], "script_src")
			}
		}
	}

	return versions
}

// ─── Analyze ─────────────────────────────────────────────────────────────────
func Analyze(targetURL string, html string, headers *http.Header) TechResult {
	stack := DetectStack(html, headers)

	cms, server, lang := "", "", ""
	langVersion := ""
	var cmsVersion string
	for _, t := range stack {
		switch t.Category {
		case "cms":
			if cms == "" {
				cms = t.Name
				cmsVersion = t.Version
			}
		case "server":
			if server == "" {
				server = t.Name
			}
		case "language":
			if lang == "" {
				lang = t.Name
				langVersion = t.Version
			}
		}
	}

	if lang == "" {
		xPoweredBy := strings.TrimSpace(headers.Get("X-Powered-By"))
		if xPoweredBy != "" {
			if parts := poweredBySplitter.FindStringSubmatch(xPoweredBy); len(parts) > 1 {
				lang = strings.TrimSpace(parts[1])
				if len(parts) > 2 {
					langVersion = strings.TrimSpace(parts[2])
				}
			}
		}
	}
	if lang == "" {
		if aspVer := strings.TrimSpace(headers.Get("X-AspNet-Version")); aspVer != "" {
			lang = "ASP.NET"
			langVersion = aspVer
		}
	}

	var issues []string
	eol := false

	if cms != "" && cmsVersion != "" {
		eol = isCMSVersionEOL(strings.ToLower(cms), cmsVersion)
		if eol {
			issues = append(issues, fmt.Sprintf("%s version %s is end-of-life and no longer receives security patches", cms, cmsVersion))
		}
	}

	// Passed = false only when we can positively confirm an EOL version.
	// If CMS is undetected or version is unknown, we cannot fail the KPI.
	passed := !eol

	// Gap #2: collect module versions from stack + script src URLs
	moduleVersions := collectModuleVersions(html, stack)

	// Gap #3: parse Server and X-Powered-By headers for tech/version strings
	serverTech, serverVersion := "", ""
	for _, h := range []string{headers.Get("Server"), headers.Get("X-Powered-By")} {
		if h == "" {
			continue
		}
		clean := strings.TrimSpace(strings.Split(h, "(")[0])
		if m := versionHeaderRE.FindStringSubmatch(clean); len(m) == 3 {
			serverTech = m[1]
			serverVersion = m[2]
			break
		}
		// Fallback: bare "Name/version" split without regex match
		if parts := strings.SplitN(clean, "/", 2); len(parts) == 2 && serverVersion == "" {
			serverTech = strings.TrimSpace(parts[0])
			tokens := strings.Fields(strings.TrimSpace(parts[1]))
			if len(tokens) > 0 {
				serverVersion = strings.TrimSpace(tokens[0])
			}
			continue
		}
		// Secondary fallback: "Name version" format (e.g. "nginx 1.24.0")
		fields := strings.Fields(clean)
		if len(fields) >= 2 && serverVersion == "" {
			serverTech = strings.TrimSpace(fields[0])
			serverVersion = strings.TrimSpace(fields[1])
			continue
		}
		// Keep at least the detected technology name when version is unavailable.
		if serverTech == "" && len(fields) >= 1 {
			serverTech = strings.TrimSpace(fields[0])
		}
	}
	if serverTech == "" && server != "" {
		serverTech = server
	}
	serverBanner := strings.TrimSpace(headers.Get("Server"))
	osHint := inferOSHintFromServerBanner(serverBanner)

	return TechResult{
		URL:            targetURL,
		Stack:          stack,
		CMS:            cms,
		CMSVersion:     cmsVersion,
		CMSVersionEOL:  eol,
		Server:         server,
		Language:       lang,
		LanguageVersion: langVersion,
		ModuleVersions: moduleVersions,
		ServerTech:     serverTech,
		ServerVersion:  serverVersion,
		ServerBanner:   serverBanner,
		OSHint:         osHint,
		CVESeverity:    CVESeverity{}, // populated by future CVE lookup service
		Passed:         passed,
		Issues:         issues,
		ServiceName:    "v3-tech-detector-go",
	}
}
