package ux

import (
	"strings"
	"testing"
)

func hasIssue(issues []string, needle string) bool {
	for _, issue := range issues {
		if strings.Contains(issue, needle) {
			return true
		}
	}
	return false
}

func TestAnalyzeCountsContextualLinksInMainContent(t *testing.T) {
	longText := strings.Repeat("content words for body section ", 120)
	html := `
		<html><body>
			<nav>
				<a href="/menu-1">Menu 1</a>
				<a href="/menu-2">Menu 2</a>
			</nav>
			<main>
				<article>
					<p>` + longText + `</p>
					<p><a href="/internal-a">Internal A</a></p>
					<div><a href="/internal-b">Internal B</a></div>
					<p><a href="https://outside.test/x">External</a></p>
				</article>
			</main>
		</body></html>
	`

	res := Analyze("https://example.com/page", html, "https://example.com")

	if res.ContextualInternalLinks != 2 {
		t.Fatalf("expected 2 contextual internal links, got %d", res.ContextualInternalLinks)
	}
	if hasIssue(res.Issues, "Maillage default") {
		t.Fatalf("did not expect missing contextual links issue when internal links exist")
	}
}

func TestAnalyzeFlagsMissingContextualLinksWhenOnlyNavLinks(t *testing.T) {
	longText := strings.Repeat("content words for body section ", 120)
	html := `
		<html><body>
			<nav>
				<a href="/menu-1">Menu 1</a>
				<a href="/menu-2">Menu 2</a>
			</nav>
			<main>
				<section>
					<p>` + longText + `</p>
				</section>
			</main>
		</body></html>
	`

	res := Analyze("https://example.com/page", html, "https://example.com")

	if res.ContextualInternalLinks != 0 {
		t.Fatalf("expected 0 contextual internal links, got %d", res.ContextualInternalLinks)
	}
	if !hasIssue(res.Issues, "Maillage default") {
		t.Fatalf("expected missing contextual links issue when only nav links exist")
	}
}

func TestAnalyzeMarksContextualMeasurementUnreliableWithoutContentZone(t *testing.T) {
	html := `<html><body><div class="shell"><a href="/inside">Inside</a></div></body></html>`

	res := Analyze("https://example.com/page", html, "https://example.com")

	if res.ContentZoneDetected {
		t.Fatalf("expected no content zone to be detected")
	}
	if res.ContextualMeasurementReliable {
		t.Fatalf("expected contextual measurement to be unreliable without a content zone")
	}
}
