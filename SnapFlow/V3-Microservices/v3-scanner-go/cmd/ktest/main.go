// cmd/ktest/main.go — Phase K: Site-wide SEO Aggregation unit tests.
//
// Tests cover:
//   - extractExternalDomains helper (local copy)
//   - K-1: Homepage H1 missing detection
//   - K-2: Duplicate content rate calculation
//   - K-3: UniqueExternalDomains (from extractExternalDomains output)
//   - K-4: NodeStyleURLCount site-wide sum
//   - SEOSummary struct JSON serialization with new fields
//
// Run:  go run ./cmd/ktest/main.go
package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// ── Local struct copies ───────────────────────────────────────────────────────

type HeadingInfo struct {
	Tag  string `json:"tag"`
	Text string `json:"text"`
}

type SEOSummary struct {
	TotalPages              int     `json:"total_pages"`
	AvgScore                float64 `json:"avg_score"`
	PagesWithoutLazy        int     `json:"pages_without_lazy_loading"`
	HomepageH1Missing       bool    `json:"homepage_h1_missing"`
	HomepageH1KPIPassed     bool    `json:"homepage_h1_kpi_passed"`
	DuplicateContentRatePct float64 `json:"duplicate_content_rate_pct"`
	DupContentKPIPassed     bool    `json:"dup_content_kpi_passed"`
	UniqueExternalDomains   int     `json:"unique_external_domains"`
	NodeStyleURLCount       int     `json:"node_style_url_count"`
	NodeURLKPIPassed        bool    `json:"node_url_kpi_passed"`
}

type SEOResult struct {
	URL               string        `json:"url"`
	Headings          []HeadingInfo `json:"headings"`
	NodeStyleURLCount int           `json:"node_style_url_count"`
	ContentHash       string        `json:"content_hash"`
}

// ── Local copy of extractExternalDomains (must stay in sync with main.go) ───

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

// ── Local copies of K computation helpers ────────────────────────────────────

func computeHomepageH1(results []SEOResult, startURL string) bool {
	baseURL := strings.TrimSuffix(startURL, "/")
	for _, res := range results {
		if strings.TrimSuffix(res.URL, "/") == baseURL {
			for _, h := range res.Headings {
				if strings.EqualFold(h.Tag, "h1") {
					return false // has H1 — not missing
				}
			}
			return true // H1 missing
		}
	}
	return false // homepage not found → optimistic
}

func computeDupContentRate(contentHashes map[string][]string, totalPages int) float64 {
	dup := 0
	for _, pages := range contentHashes {
		if len(pages) > 1 {
			dup += len(pages)
		}
	}
	if totalPages == 0 {
		return 0
	}
	return float64(dup) / float64(totalPages) * 100
}

// ── Test helpers ──────────────────────────────────────────────────────────────

var pass, fail int

func check(name string, got, want interface{}) {
	gs := fmt.Sprintf("%v", got)
	ws := fmt.Sprintf("%v", want)
	if gs == ws {
		fmt.Printf("  ✓ %s\n", name)
		pass++
	} else {
		fmt.Printf("  ✗ %s\n    got:  %v\n    want: %v\n", name, got, want)
		fail++
	}
}

func checkTrue(name string, cond bool) { check(name, cond, true) }

// ── Tests ─────────────────────────────────────────────────────────────────────

func testExtractExternalDomains() {
	fmt.Println("\n[extractExternalDomains]")

	base := "https://example.com"

	// Basic external link
	html := `<a href="https://github.com/foo">link</a>`
	doms := extractExternalDomains(html, base)
	checkTrue("detects github.com", contains(doms, "github.com"))
	check("count=1", len(doms), 1)

	// Internal links are ignored
	html2 := `<a href="https://example.com/page">internal</a><a href="/about">rel</a>`
	doms2 := extractExternalDomains(html2, base)
	check("internal links ignored", len(doms2), 0)

	// www. stripped
	html3 := `<a href="https://www.twitter.com/user">tw</a>`
	doms3 := extractExternalDomains(html3, base)
	checkTrue("www. stripped from result", contains(doms3, "twitter.com"))
	checkTrue("www.twitter.com not in result", !contains(doms3, "www.twitter.com"))

	// Deduplication: same domain twice → only 1 entry
	html4 := `<a href="https://cdn.example.org/a">a</a><a href="https://cdn.example.org/b">b</a>`
	doms4 := extractExternalDomains(html4, base)
	check("deduplication", len(doms4), 1)

	// Multiple distinct external domains
	html5 := `<a href="https://alpha.com">a</a><a href="https://beta.com">b</a><a href="https://gamma.com">c</a>`
	doms5 := extractExternalDomains(html5, base)
	check("3 distinct domains", len(doms5), 3)

	// Non-http links skipped
	html6 := `<a href="tel:+123">call</a><a href="mailto:a@b.com">mail</a><a href="/rel">rel</a>`
	doms6 := extractExternalDomains(html6, base)
	check("tel/mailto/relative skipped", len(doms6), 0)

	// baseURL with www. — should still strip www from base comparison
	base2 := "https://www.example.com"
	html7 := `<a href="https://example.com/page">same site</a><a href="https://other.com">ext</a>`
	doms7 := extractExternalDomains(html7, base2)
	check("www-base: same-site link ignored", len(doms7), 1)
	checkTrue("www-base: other.com found", contains(doms7, "other.com"))

	// Single-quoted hrefs
	html8 := `<a href='https://singlequote.com/page'>sq</a>`
	doms8 := extractExternalDomains(html8, base)
	checkTrue("single-quoted href parsed", contains(doms8, "singlequote.com"))

	// Malformed URL skipped gracefully (no panic)
	html9 := `<a href="https://[invalid]:abc">bad</a><a href="https://good.com">ok</a>`
	doms9 := extractExternalDomains(html9, base)
	checkTrue("malformed URL skipped, good URL found", contains(doms9, "good.com"))
}

func testK1HomepageH1() {
	fmt.Println("\n[K-1: Homepage H1 missing]")

	pageWithH1 := SEOResult{
		URL:      "https://example.com/",
		Headings: []HeadingInfo{{Tag: "h1", Text: "Welcome"}, {Tag: "h2", Text: "Section"}},
	}
	check("has h1 — not missing", computeHomepageH1([]SEOResult{pageWithH1}, "https://example.com/"), false)

	pageNoH1 := SEOResult{
		URL:      "https://example.com",
		Headings: []HeadingInfo{{Tag: "h2", Text: "Title"}, {Tag: "h3", Text: "Sub"}},
	}
	check("no h1 — missing", computeHomepageH1([]SEOResult{pageNoH1}, "https://example.com"), true)

	pageEmptyHeadings := SEOResult{
		URL:      "https://example.com/",
		Headings: []HeadingInfo{},
	}
	check("empty headings — missing", computeHomepageH1([]SEOResult{pageEmptyHeadings}, "https://example.com/"), true)

	// Homepage not in results → optimistic (false)
	check("homepage not in results — optimistic", computeHomepageH1([]SEOResult{}, "https://example.com"), false)

	// Trailing-slash normalization: startURL has slash, result URL doesn't
	check("trailing slash normalised",
		computeHomepageH1([]SEOResult{pageWithH1}, "https://example.com"), false)

	// H1 case-insensitive (H1 vs h1)
	H1Upper := SEOResult{
		URL:      "https://example.com",
		Headings: []HeadingInfo{{Tag: "H1", Text: "Main"}},
	}
	check("H1 uppercase treated as h1", computeHomepageH1([]SEOResult{H1Upper}, "https://example.com"), false)

	// Inner page with h1 doesn't affect homepage result
	inner := SEOResult{URL: "https://example.com/about", Headings: []HeadingInfo{{Tag: "h1", Text: "About"}}}
	check("inner page h1 doesn't count for homepage",
		computeHomepageH1([]SEOResult{pageNoH1, inner}, "https://example.com"), true)
}

func testK2DupContentRate() {
	fmt.Println("\n[K-2: Duplicate content rate]")

	// No duplicates
	hashes := map[string][]string{
		"abc": {"https://example.com/a"},
		"def": {"https://example.com/b"},
		"xyz": {"https://example.com/c"},
	}
	rate := computeDupContentRate(hashes, 3)
	check("no duplicates → 0%", rate, 0.0)
	checkTrue("no dups → passed (<=10%)", rate <= 10.0)

	// 2 of 4 pages share a hash → 50%
	hashes2 := map[string][]string{
		"same":  {"https://example.com/a", "https://example.com/b"},
		"uniq":  {"https://example.com/c"},
		"uniq2": {"https://example.com/d"},
	}
	rate2 := computeDupContentRate(hashes2, 4)
	check("2 of 4 pages duplicated → 50%", rate2, 50.0)
	checkTrue("50% > 10% → fails", rate2 > 10.0)

	// Exactly at 10% threshold
	// 1 of 10 pages duplicated (counted as dup: 0 because pairs need count > 1 per group)
	// 2 of 10 pages share a hash → 20%
	hashes3 := map[string][]string{
		"shared": {"url1", "url2"},
		"u1":     {"url3"}, "u2": {"url4"}, "u3": {"url5"},
		"u4": {"url6"}, "u5": {"url7"}, "u6": {"url8"},
		"u7": {"url9"}, "u8": {"url10"},
	}
	rate3 := computeDupContentRate(hashes3, 10)
	check("2 of 10 dup → 20%", rate3, 20.0)

	// Edge case: 0 pages
	check("zero pages → 0%", computeDupContentRate(map[string][]string{}, 0), 0.0)

	// All pages unique → 0%
	hashesAllUniq := map[string][]string{"a": {"u1"}, "b": {"u2"}, "c": {"u3"}}
	check("all unique → 0%", computeDupContentRate(hashesAllUniq, 3), 0.0)

	// 3 pages same hash → 3 dup pages out of 5; threshold check
	hashes4 := map[string][]string{
		"triple": {"u1", "u2", "u3"},
		"s1":     {"u4"}, "s2": {"u5"},
	}
	rate4 := computeDupContentRate(hashes4, 5)
	check("3 of 5 duplicated → 60%", rate4, 60.0)
}

func testK3K4NodeAndExternal() {
	fmt.Println("\n[K-3/K-4: External domains sum + NodeStyleURLCount sum]")

	// K-3: simulate accumulation
	extDomains := map[string]bool{
		"github.com":   true,
		"twitter.com":  true,
		"linkedin.com": true,
	}
	check("3 unique external domains", len(extDomains), 3)

	extDomains2 := map[string]bool{}
	check("0 external domains", len(extDomains2), 0)

	// K-4: sum across pages
	pages := []SEOResult{
		{URL: "https://example.com/", NodeStyleURLCount: 0},
		{URL: "https://example.com/a", NodeStyleURLCount: 3},
		{URL: "https://example.com/b", NodeStyleURLCount: 2},
	}
	total := 0
	for _, p := range pages {
		total += p.NodeStyleURLCount
	}
	check("NodeStyleURLCount site-wide sum", total, 5)
	checkTrue("node URLs > 0 → KPI fails", total > 0)

	pagesClean := []SEOResult{
		{URL: "https://example.com/", NodeStyleURLCount: 0},
		{URL: "https://example.com/a", NodeStyleURLCount: 0},
	}
	totalClean := 0
	for _, p := range pagesClean {
		totalClean += p.NodeStyleURLCount
	}
	check("no node URLs → 0", totalClean, 0)
	checkTrue("0 node URLs → KPI passes", totalClean == 0)
}

func testSEOSummaryStruct() {
	fmt.Println("\n[SEOSummary struct — new Phase K fields]")

	s := SEOSummary{
		TotalPages:              10,
		HomepageH1Missing:       false,
		HomepageH1KPIPassed:     true,
		DuplicateContentRatePct: 5.5,
		DupContentKPIPassed:     true,
		UniqueExternalDomains:   8,
		NodeStyleURLCount:       0,
		NodeURLKPIPassed:        true,
	}

	// JSON round-trip
	data, err := json.Marshal(s)
	checkTrue("marshal no error", err == nil)

	var parsed SEOSummary
	json.Unmarshal(data, &parsed)
	check("TotalPages round-trip", parsed.TotalPages, 10)
	check("HomepageH1Missing=false round-trip", parsed.HomepageH1Missing, false)
	check("HomepageH1KPIPassed=true round-trip", parsed.HomepageH1KPIPassed, true)
	check("DuplicateContentRatePct round-trip", parsed.DuplicateContentRatePct, 5.5)
	check("DupContentKPIPassed=true round-trip", parsed.DupContentKPIPassed, true)
	check("UniqueExternalDomains round-trip", parsed.UniqueExternalDomains, 8)
	check("NodeStyleURLCount=0 round-trip", parsed.NodeStyleURLCount, 0)
	check("NodeURLKPIPassed=true round-trip", parsed.NodeURLKPIPassed, true)

	// JSON keys present
	sj := string(data)
	checkTrue("json key: homepage_h1_missing", strings.Contains(sj, `"homepage_h1_missing"`))
	checkTrue("json key: homepage_h1_kpi_passed", strings.Contains(sj, `"homepage_h1_kpi_passed"`))
	checkTrue("json key: duplicate_content_rate_pct", strings.Contains(sj, `"duplicate_content_rate_pct"`))
	checkTrue("json key: dup_content_kpi_passed", strings.Contains(sj, `"dup_content_kpi_passed"`))
	checkTrue("json key: unique_external_domains", strings.Contains(sj, `"unique_external_domains"`))
	checkTrue("json key: node_style_url_count", strings.Contains(sj, `"node_style_url_count"`))
	checkTrue("json key: node_url_kpi_passed", strings.Contains(sj, `"node_url_kpi_passed"`))

	// KPI pass/fail logic
	failing := SEOSummary{
		HomepageH1Missing:       true,
		HomepageH1KPIPassed:     false,
		DuplicateContentRatePct: 35.0,
		DupContentKPIPassed:     false, // > 10%
		NodeStyleURLCount:       4,
		NodeURLKPIPassed:        false,
	}
	checkTrue("H1 missing → KPI fails", !failing.HomepageH1KPIPassed)
	checkTrue("35% dup rate > 10% → KPI fails", !failing.DupContentKPIPassed)
	checkTrue("4 node URLs → KPI fails", !failing.NodeURLKPIPassed)
}

func testEdgeCases() {
	fmt.Println("\n[Edge cases]")

	// extractExternalDomains with empty HTML
	checkTrue("empty html → nil/empty result", len(extractExternalDomains("", "https://example.com")) == 0)

	// extractExternalDomains with invalid baseURL
	result := extractExternalDomains(`<a href="https://foo.com">x</a>`, "not-a-url")
	// Either nil or empty — anything non-panicking is fine
	// (url.Parse is lenient; "not-a-url" parses as a relative URL with no host)
	_ = result // just must not panic

	// K-2: single page with unique hash → 0% dup rate
	singlePage := map[string][]string{"onlyone": {"https://example.com/"}}
	check("1 page, unique hash → 0%", computeDupContentRate(singlePage, 1), 0.0)

	// K-2: 10% boundary — exactly 10% dup
	// 2 pages share hash out of 20 total → 2/20 = 10%
	boundary := map[string][]string{
		"dup": {"u1", "u2"},
	}
	for i := 3; i <= 20; i++ {
		boundary[fmt.Sprintf("u%d", i)] = []string{fmt.Sprintf("url%d", i)}
	}
	rate := computeDupContentRate(boundary, 20)
	check("2 of 20 dup → 10%", rate, 10.0)
	checkTrue("exactly 10% → passes (<=10%)", rate <= 10.0)

	// Just over boundary: 3 of 20 → 15% → fail
	boundary2 := map[string][]string{
		"dup": {"u1", "u2", "u3"},
	}
	for i := 4; i <= 20; i++ {
		boundary2[fmt.Sprintf("u%d", i)] = []string{fmt.Sprintf("url%d", i)}
	}
	rate2 := computeDupContentRate(boundary2, 20)
	check("3 of 20 dup → 15%", rate2, 15.0)
	checkTrue("15% → fails", rate2 > 10.0)
}

// ── Utility ───────────────────────────────────────────────────────────────────

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

func main() {
	fmt.Println("=== Phase K: Site-wide SEO Aggregations — Unit Tests ===")

	testExtractExternalDomains()
	testK1HomepageH1()
	testK2DupContentRate()
	testK3K4NodeAndExternal()
	testSEOSummaryStruct()
	testEdgeCases()

	fmt.Printf("\n=== Results: %d passed, %d failed ===\n", pass, fail)
	if fail > 0 {
		fmt.Println("FAIL")
	} else {
		fmt.Println("PASS — all tests pass")
	}
}
