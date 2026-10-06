package main

import "testing"

func TestCrawlOutcomesRetainsRedirectAndAsyncAdmission(t *testing.T) {
	c := newCrawlOutcomes()
	c.start(1, "https://fixture.test/old")
	c.finish(1, "https://fixture.test/new", 200, "response_accepted")
	c.stored(1, true)
	// An async request can finish before Request() returns to admission.
	c.queued("https://fixture.test/old", "a_href")
	c.queued("https://fixture.test/limited", "sitemap")
	c.start(2, "https://fixture.test/limited")
	c.finish(2, "https://fixture.test/limited", 429, "http_error")
	pages := c.snapshot()["pages"].([]crawlOutcome)
	if len(pages) != 2 {
		t.Fatalf("redirect added a spurious page: %v", pages)
	}
	for _, p := range pages {
		if p.URL == "https://fixture.test/old" && (!p.Stored || !p.Queued || p.FinalURL != "https://fixture.test/new" || p.Outcome != "response_accepted") {
			t.Fatalf("request identity or outcome lost: %+v", p)
		}
	}
	counts := c.snapshot()["outcome_counts"].(map[string]int)
	if counts["http_error"] != 1 || counts["response_accepted"] != 1 {
		t.Fatal(counts)
	}
}
