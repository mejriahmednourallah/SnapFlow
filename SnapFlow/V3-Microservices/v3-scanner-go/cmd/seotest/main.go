package main

import (
	"fmt"
	"os"

	"snapflow/v3-scanner-go/analyzers/seo"
)

var passed, failed int

func check(name string, got, want interface{}) {
	if fmt.Sprintf("%v", got) == fmt.Sprintf("%v", want) {
		fmt.Printf("  ✅ PASS  %s\n", name)
		passed++
	} else {
		fmt.Printf("  ❌ FAIL  %s — got %v, want %v\n", name, got, want)
		failed++
	}
}

// ── fixtures ────────────────────────────────────────────────────────────────

const drupalNodeHTML = `<html><body>
<nav>
  <a href="/node/1">Home</a>
  <a href="/node/42">About</a>
  <a href="/node/100">Services</a>
</nav>
<p>Normal content here.</p>
</body></html>`

const qParamHTML = `<html><body>
<nav>
  <a href="/?q=home">Home</a>
  <a href="/?q=about">About</a>
</nav>
</body></html>`

const mixedNodeHTML = `<html><body>
<a href="/node/5">Node link</a>
<a href="/about">Clean link</a>
<a href="https://external.com/node/99">External node (should be ignored)</a>
<a href="/contact">Another clean link</a>
</body></html>`

const cleanSEOHTML = `<html><head>
<title>Clean Page</title>
<meta name="description" content="A clean SEO page." />
</head><body>
<h1>Clean Page</h1>
<a href="/about">About</a>
<a href="/services">Services</a>
<a href="/contact">Contact</a>
</body></html>`

var tenPlusNodeHTML = func() string {
	s := "<html><body>"
	for i := 1; i <= 15; i++ {
		s += fmt.Sprintf(`<a href="/node/%d">Node %d</a>`, i, i)
	}
	return s + "</body></html>"
}()

const sameNodeTwiceHTML = `<html><body>
<a href="/node/5">Link A</a>
<a href="/node/5">Link B</a>
<a href="/node/10">Other</a>
</body></html>`

// ── tests ────────────────────────────────────────────────────────────────────

func main() {
	fmt.Println("=== Phase F: SEO Node-Style URL Detection Tests ===")

	// T01 — 3 Drupal /node/ links found
	fmt.Println("\n[T01] 3 Drupal /node/ links detected")
	r := seo.Analyze("https://example.com/page", drupalNodeHTML, false, false)
	check("node_style_url_count", r.NodeStyleURLCount, 3)
	check("node_style_urls len", len(r.NodeStyleURLs), 3)

	// T02 — issue message appended
	fmt.Println("\n[T02] Issue message appended")
	found := false
	for _, iss := range r.Issues {
		if len(iss) > 6 && iss[:5] == "Found" {
			found = true
		}
	}
	check("issue_present", found, true)

	// T03 — ?q= style links found
	fmt.Println("\n[T03] ?q= Drupal query param links detected")
	r = seo.Analyze("https://example.com/", qParamHTML, false, false)
	check("node_style_url_count", r.NodeStyleURLCount, 2)

	// T04 — clean page: zero node-style URLs
	fmt.Println("\n[T04] Clean page → node_style_url_count == 0")
	r = seo.Analyze("https://example.com/clean", cleanSEOHTML, true, true)
	check("node_style_url_count", r.NodeStyleURLCount, 0)
	check("node_style_urls empty", len(r.NodeStyleURLs), 0)

	// T05 — external /node/ link NOT counted (different domain)
	fmt.Println("\n[T05] External /node/ link ignored, internal counted")
	r = seo.Analyze("https://example.com/page", mixedNodeHTML, false, false)
	check("node_style_url_count", r.NodeStyleURLCount, 1)
	check("node_style_urls[0]", r.NodeStyleURLs[0], "/node/5")

	// T06 — capped at 10 (15 node links → max 10 in slice)
	fmt.Println("\n[T06] More than 10 node URLs → capped at 10 in slice")
	r = seo.Analyze("https://example.com/", tenPlusNodeHTML, false, false)
	check("node_style_urls capped at 10", len(r.NodeStyleURLs), 10)
	check("node_style_url_count equals slice len", r.NodeStyleURLCount, len(r.NodeStyleURLs))

	// T07 — duplicate /node/5 only counted once
	fmt.Println("\n[T07] Duplicate /node/ URL counted once (deduped)")
	r = seo.Analyze("https://example.com/", sameNodeTwiceHTML, false, false)
	check("node_style_url_count", r.NodeStyleURLCount, 2) // /node/5 and /node/10
	check("node_style_urls len", len(r.NodeStyleURLs), 2)

	// T08 — service name preserved
	fmt.Println("\n[T08] ServiceName constant")
	r = seo.Analyze("https://example.com/", cleanSEOHTML, true, true)
	check("service_name", r.ServiceName, "v3-seo-analyzer-go")

	// T09 — NodeStyleURLs is nil/empty on clean page (no issue recorded)
	fmt.Println("\n[T09] No node issue on clean page")
	r = seo.Analyze("https://example.com/clean", cleanSEOHTML, true, true)
	nodeIssue := false
	for _, iss := range r.Issues {
		if len(iss) > 5 && iss[:5] == "Found" {
			nodeIssue = true
		}
	}
	check("no_node_issue", nodeIssue, false)

	// T10 — existing SEO detection still works (title/meta)
	fmt.Println("\n[T10] Existing SEO detection unaffected (has title + meta)")
	r = seo.Analyze("https://example.com/clean", cleanSEOHTML, true, true)
	check("meta.title", r.Meta.Title, "Clean Page")
	check("meta.has_meta_description", r.Meta.HasMetaDesc, true)

	// ── Summary ──────────────────────────────────────────────────────────────
	fmt.Printf("\n============================\n")
	fmt.Printf("Results: %d passed, %d failed (total %d)\n", passed, failed, passed+failed)
	if failed > 0 {
		os.Exit(1)
	}
}
