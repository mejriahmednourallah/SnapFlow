// Phase A validation tests — kept for regression use.
// Run: go run ./cmd/techtest/main.go (from v3-scanner-go root)
package main

import (
	"fmt"
	"net/http"
	"snapflow/v3-scanner-go/analyzers/tech"
)

func fakeHeader(pairs ...string) *http.Header {
	h := http.Header{}
	for i := 0; i+1 < len(pairs); i += 2 {
		h.Set(pairs[i], pairs[i+1])
	}
	return &h
}

func main() {
	tests := []struct {
		name    string
		html    string
		headers *http.Header
		wantCMS string
		wantEOL bool
	}{
		{
			name:    "WordPress latest (should pass)",
			html:    `<link rel='stylesheet' href='/wp-content/themes/main.css'><meta name="generator" content="WordPress 6.4.2">`,
			headers: fakeHeader(),
			wantCMS: "WordPress",
			wantEOL: false,
		},
		{
			name:    "WordPress EOL 4.x",
			html:    `<link href='/wp-includes/css/admin-bar.min.css'><meta name="generator" content="WordPress 4.9.8">`,
			headers: fakeHeader(),
			wantCMS: "WordPress",
			wantEOL: true,
		},
		{
			name:    "Drupal via X-Generator header (EOL 9.x)",
			html:    `/sites/default/files/logo.png`,
			headers: fakeHeader("X-Generator", "Drupal 9.5.7"),
			wantCMS: "Drupal",
			wantEOL: true,
		},
		{
			name:    "Drupal via meta generator (current 10.x - should pass)",
			html:    `/sites/default/files/img.png <meta name="generator" content="Drupal 10.1.2">`,
			headers: fakeHeader(),
			wantCMS: "Drupal",
			wantEOL: false,
		},
		{
			name:    "Joomla EOL 3.x",
			html:    `/components/com_content/router.php <meta name="generator" content="Joomla! 3.10.11">`,
			headers: fakeHeader(),
			wantCMS: "Joomla",
			wantEOL: true,
		},
		{
			name:    "Shopify (no version, should pass)",
			html:    `<script src="https://cdn.shopify.com/s/files/1/theme.js">`,
			headers: fakeHeader(),
			wantCMS: "Shopify",
			wantEOL: false,
		},
		{
			name:    "No CMS detected (should pass)",
			html:    `<html><body>Hello world</body></html>`,
			headers: fakeHeader(),
			wantCMS: "",
			wantEOL: false,
		},
		{
			name:    "TYPO3 EOL 9.x via meta",
			html:    `/typo3/sysext/frontend/ <meta name="generator" content="TYPO3 CMS 9.5.0">`,
			headers: fakeHeader(),
			wantCMS: "TYPO3",
			wantEOL: true,
		},
		{
			name:    "PrestaShop EOL 1.6",
			html:    `prestashop <meta name="generator" content="PrestaShop 1.6.1.24">`,
			headers: fakeHeader(),
			wantCMS: "PrestaShop",
			wantEOL: true,
		},
		{
			name:    "Wix via static pattern (no version in EOL map, should pass)",
			html:    `<img src="https://static.wixstatic.com/media/logo.png">`,
			headers: fakeHeader("X-Wix-Published-Version", "abc123"),
			wantCMS: "Wix",
			wantEOL: false,
		},
		{
			name:    "Magento EOL 1.x via URL pattern",
			html:    `/skin/frontend/enterprise/default/css/styles.css Mage.Cookies /mage/1.9.4/`,
			headers: fakeHeader(),
			wantCMS: "Magento",
			wantEOL: true,
		},
		{
			name:    "OpenCart via route pattern",
			html:    `<a href="index.php?route=common/home">Home</a> /catalog/view/theme/default/`,
			headers: fakeHeader(),
			wantCMS: "OpenCart",
			wantEOL: false,
		},
	}

	pass, fail := 0, 0
	for _, tt := range tests {
		res := tech.Analyze("https://example.com", tt.html, tt.headers)

		cmsOK := res.CMS == tt.wantCMS
		eolOK := res.CMSVersionEOL == tt.wantEOL
		passedOK := res.Passed == !tt.wantEOL

		if cmsOK && eolOK && passedOK {
			fmt.Printf("  PASS  %s  (cms=%q version=%q eol=%v passed=%v)\n",
				tt.name, res.CMS, res.CMSVersion, res.CMSVersionEOL, res.Passed)
			pass++
		} else {
			fmt.Printf("  FAIL  %s\n", tt.name)
			fmt.Printf("        got  cms=%q version=%q eol=%v passed=%v\n",
				res.CMS, res.CMSVersion, res.CMSVersionEOL, res.Passed)
			fmt.Printf("        want cms=%q eol=%v passed=%v\n",
				tt.wantCMS, tt.wantEOL, !tt.wantEOL)
			fail++
		}
	}
	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
}
