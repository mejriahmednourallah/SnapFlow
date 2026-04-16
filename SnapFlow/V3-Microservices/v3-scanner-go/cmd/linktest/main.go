// cmd/linktest/main.go — Phase J: Broken Links Hardening unit tests.
//
// Uses local struct copies (BrokenLink, BrokenLinkSummary) because the
// canonical types live in package main and cannot be imported.
//
// Run:  go run ./cmd/linktest/main.go
package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ── Local mirrors of main.go types ──────────────────────────────────────────

type BrokenLink struct {
	URL        string `json:"url"`
	FoundOn    string `json:"found_on"`
	AnchorText string `json:"anchor_text"`
	StatusCode int    `json:"status_code,omitempty"`
	Error      string `json:"error"`
}

type BrokenLinkSummary struct {
	BrokenLinkCount   int          `json:"broken_link_count"`
	BrokenLinksPassed bool         `json:"broken_links_passed"`
	BrokenLinks       []BrokenLink `json:"broken_links"`
}

// ── Test helpers ─────────────────────────────────────────────────────────────

var pass, fail int

func check(name string, got, want interface{}) {
	if fmt.Sprintf("%v", got) == fmt.Sprintf("%v", want) {
		fmt.Printf("  ✓ %s\n", name)
		pass++
	} else {
		fmt.Printf("  ✗ %s\n    got:  %v\n    want: %v\n", name, got, want)
		fail++
	}
}

func checkTrue(name string, cond bool) { check(name, cond, true) }

// ── Simulated logic mirrors (replicated from main.go OnError handler) ────────

// shouldFlagAsBroken returns true when a URL should be added to broken links.
// Mirrors the Phase J c.OnError logic.
func shouldFlagAsBroken(urlStr, errStr string, statusCode int) bool {
	if strings.Contains(errStr, "already visited") {
		return false
	}
	if strings.Contains(errStr, "context deadline exceeded") {
		return false
	}
	if strings.Contains(errStr, "unsupported protocol scheme") {
		return false
	}
	// Skip 1xx / 2xx / 3xx
	if statusCode > 0 && statusCode < 400 {
		return false
	}
	return strings.HasPrefix(urlStr, "http")
}

// shouldSkipHref returns true when a href value should not be followed.
// Mirrors the Phase J c.OnHTML("a[href]") additions.
func shouldSkipHref(href string) bool {
	lower := strings.ToLower(href)
	if strings.HasPrefix(lower, "tel:") {
		return true
	}
	if strings.HasPrefix(lower, "javascript:") {
		return true
	}
	if strings.HasPrefix(lower, "mailto:") {
		return true
	}
	// email without mailto: prefix (existing logic unchanged)
	if strings.Contains(href, "@") &&
		!strings.HasPrefix(lower, "mailto:") &&
		!strings.HasPrefix(lower, "http") {
		return true
	}
	// file extensions
	for _, ext := range []string{".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".rar"} {
		if strings.HasSuffix(lower, ext) {
			return true
		}
	}
	return false
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func testBrokenLinkStruct() {
	fmt.Println("\n[BrokenLink struct]")

	bl := BrokenLink{
		URL:        "https://example.com/404",
		FoundOn:    "https://example.com/",
		AnchorText: "Click here",
		StatusCode: 404,
		Error:      "Not Found",
	}
	check("URL", bl.URL, "https://example.com/404")
	check("StatusCode", bl.StatusCode, 404)
	check("FoundOn", bl.FoundOn, "https://example.com/")

	// StatusCode must be omitted from JSON when zero
	bl2 := BrokenLink{URL: "https://x.com/err", Error: "dial tcp: no such host"}
	data, _ := json.Marshal(bl2)
	checkTrue("status_code omitted when zero", !strings.Contains(string(data), "status_code"))

	// StatusCode must appear when non-zero
	data3, _ := json.Marshal(bl)
	checkTrue("status_code present when set", strings.Contains(string(data3), `"status_code":404`))
}

func testShouldFlagAsBroken() {
	fmt.Println("\n[shouldFlagAsBroken — status code filtering]")

	checkTrue("404 → flag", shouldFlagAsBroken("https://example.com/missing", "404 Not Found", 404))
	checkTrue("500 → flag", shouldFlagAsBroken("https://example.com/error", "Internal Server Error", 500))
	checkTrue("0 (network) → flag", shouldFlagAsBroken("https://example.com/timeout", "dial tcp: i/o timeout", 0))
	checkTrue("403 → flag", shouldFlagAsBroken("https://example.com/forbidden", "403 Forbidden", 403))
	checkTrue("503 → flag", shouldFlagAsBroken("https://example.com/down", "503 Service Unavailable", 503))

	// Should NOT flag
	checkTrue("301 → skip", !shouldFlagAsBroken("https://example.com/redir", "Moved Permanently", 301))
	checkTrue("302 → skip", !shouldFlagAsBroken("https://example.com/redir", "Found", 302))
	checkTrue("200 → skip", !shouldFlagAsBroken("https://example.com/ok", "OK", 200))
	checkTrue("already visited → skip", !shouldFlagAsBroken("https://example.com/", "already visited", 0))
	checkTrue("context deadline → skip", !shouldFlagAsBroken("https://example.com/slow", "context deadline exceeded", 0))
	checkTrue("unsupported scheme → skip", !shouldFlagAsBroken("ftp://example.com/file", "unsupported protocol scheme", 0))
	checkTrue("non-http url → skip", !shouldFlagAsBroken("ftp://example.com/x", "some error", 404))
}

func testShouldSkipHref() {
	fmt.Println("\n[shouldSkipHref — href filtering]")

	// Must skip
	checkTrue("tel: → skip", shouldSkipHref("tel:+21612345678"))
	checkTrue("TEL: → skip (case-insensitive)", shouldSkipHref("TEL:+21612345678"))
	checkTrue("javascript:void → skip", shouldSkipHref("javascript:void(0)"))
	checkTrue("JavaScript: → skip (case-insensitive)", shouldSkipHref("JavaScript:void(0)"))
	checkTrue("mailto: → skip", shouldSkipHref("mailto:info@example.com"))
	checkTrue("MAILTO: → skip (case-insensitive)", shouldSkipHref("MAILTO:info@example.com"))
	checkTrue("bare email → skip", shouldSkipHref("user@example.com"))
	checkTrue(".pdf → skip", shouldSkipHref("https://example.com/file.pdf"))
	checkTrue(".docx → skip", shouldSkipHref("https://example.com/file.docx"))
	checkTrue(".zip → skip", shouldSkipHref("archive.zip"))

	// Must NOT skip
	checkTrue("http link → follow", !shouldSkipHref("https://example.com/page"))
	checkTrue("relative link → follow", !shouldSkipHref("/about"))
	checkTrue("hash fragment → follow", !shouldSkipHref("#section"))
	checkTrue("empty → follow (handled by AbsoluteURL)", !shouldSkipHref(""))
}

func testBrokenLinkSummary() {
	fmt.Println("\n[BrokenLinkSummary — aggregate logic]")

	links := []BrokenLink{
		{URL: "https://example.com/404", StatusCode: 404, Error: "Not Found"},
		{URL: "https://example.com/500", StatusCode: 500, Error: "Server Error"},
	}

	summary := BrokenLinkSummary{
		BrokenLinkCount:   len(links),
		BrokenLinksPassed: len(links) == 0,
		BrokenLinks:       links,
	}
	check("count", summary.BrokenLinkCount, 2)
	checkTrue("not passed when links exist", !summary.BrokenLinksPassed)

	empty := BrokenLinkSummary{
		BrokenLinkCount:   0,
		BrokenLinksPassed: true,
		BrokenLinks:       []BrokenLink{},
	}
	checkTrue("passed when no broken links", empty.BrokenLinksPassed)
	check("empty count", empty.BrokenLinkCount, 0)
}

func testJSONRoundTrip() {
	fmt.Println("\n[JSON round-trip]")

	original := BrokenLinkSummary{
		BrokenLinkCount:   1,
		BrokenLinksPassed: false,
		BrokenLinks: []BrokenLink{
			{URL: "https://x.com/notfound", FoundOn: "https://x.com/", AnchorText: "link", StatusCode: 404, Error: "Not Found"},
		},
	}
	data, err := json.Marshal(original)
	checkTrue("marshal no error", err == nil)

	var parsed BrokenLinkSummary
	err = json.Unmarshal(data, &parsed)
	checkTrue("unmarshal no error", err == nil)
	check("count preserved", parsed.BrokenLinkCount, 1)
	checkTrue("passed=false preserved", !parsed.BrokenLinksPassed)
	check("link URL preserved", parsed.BrokenLinks[0].URL, "https://x.com/notfound")
	check("status code preserved", parsed.BrokenLinks[0].StatusCode, 404)

	// JSON keys
	s := string(data)
	checkTrue("has broken_link_count key", strings.Contains(s, `"broken_link_count"`))
	checkTrue("has broken_links_passed key", strings.Contains(s, `"broken_links_passed"`))
	checkTrue("has broken_links key", strings.Contains(s, `"broken_links"`))
}

func testEdgeCases() {
	fmt.Println("\n[Edge cases]")

	// 400 Bad Request — should flag
	checkTrue("400 → flag", shouldFlagAsBroken("https://example.com/bad", "400 Bad Request", 400))
	// 410 Gone — should flag
	checkTrue("410 → flag", shouldFlagAsBroken("https://example.com/gone", "410 Gone", 410))
	// 429 Too Many Requests — should flag
	checkTrue("429 → flag", shouldFlagAsBroken("https://example.com/limit", "429 Too Many Requests", 429))
	// 304 Not Modified — should NOT flag (3xx)
	checkTrue("304 → skip", !shouldFlagAsBroken("https://example.com/cached", "304 Not Modified", 304))
	// 100 Continue — should NOT flag
	checkTrue("100 → skip", !shouldFlagAsBroken("https://example.com/continue", "100 Continue", 100))
}

func main() {
	fmt.Println("=== Phase J: Broken Links Hardening — Unit Tests ===")

	testBrokenLinkStruct()
	testShouldFlagAsBroken()
	testShouldSkipHref()
	testBrokenLinkSummary()
	testJSONRoundTrip()
	testEdgeCases()

	fmt.Printf("\n=== Results: %d passed, %d failed ===\n", pass, fail)
	if fail > 0 {
		fmt.Println("FAIL")
	} else {
		fmt.Println("PASS — all tests pass")
	}
}
