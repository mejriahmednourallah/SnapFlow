package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"sync"
	"testing"

	"snapflow/v3-scanner-go/analyzers/seo"
	"snapflow/v3-scanner-go/browserpool"
)

func TestSitemapAndRecursiveRenderedRoutesShareBudget(t *testing.T) {
	var base string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/child.xml" {
			fmt.Fprintf(w, `<urlset><url><loc>%s/sitemap-only</loc></url><url><loc>https://outside.invalid/no</loc></url></urlset>`, base)
			return
		}
		t.Errorf("unexpected sitemap request: %s", r.URL.Path)
	}))
	defer server.Close()
	base = server.URL
	host, _ := url.Parse(base)
	allowed := []string{host.Hostname()}
	xml := fmt.Sprintf(`<sitemapindex><sitemap><loc>%s/child.xml</loc></sitemap><sitemap><loc>%s/child.xml</loc></sitemap></sitemapindex>`, base, base)
	seeds := collectSitemapURLs(context.Background(), base+"/sitemap.xml", xml, allowed, 10)
	seeds = append(seeds, base+"/js-parent", base+"/js-parent?utm_source=alias")
	children := map[string][]string{
		base + "/js-parent": {base + "/js-child"},
		base + "/js-child":  {base + "/js-grandchild", base + "/js-parent#loop"},
	}
	var lock sync.Mutex
	visits := []string{}
	captured := runRenderedFrontier(context.Background(), seeds, 10, 3, allowed,
		func(target string) (*browserpool.DiscoverRenderedResult, error) {
			lock.Lock()
			visits = append(visits, target)
			lock.Unlock()
			return &browserpool.DiscoverRenderedResult{Status: "success", InternalLinks: children[target]}, nil
		}, func(string, *browserpool.DiscoverRenderedResult) bool { return true })
	want := []string{base + "/js-parent", base + "/js-child", base + "/js-grandchild", base + "/sitemap-only"}
	sort.Strings(want)
	sort.Strings(visits)
	if captured != 4 || !reflect.DeepEqual(visits, want) {
		t.Fatalf("expected all four source routes once, got %d %v", captured, visits)
	}
}

func TestFrontierRetainsChildrenOfStoredCanonicalAlias(t *testing.T) {
	visits := []string{}
	count := runRenderedFrontier(context.Background(), []string{"https://example.test/alias"}, 3, 1, []string{"example.test"},
		func(target string) (*browserpool.DiscoverRenderedResult, error) {
			visits = append(visits, target)
			return &browserpool.DiscoverRenderedResult{InternalLinks: []string{"https://example.test/child"}}, nil
		}, func(target string, _ *browserpool.DiscoverRenderedResult) bool {
			return target != "https://example.test/alias"
		})
	if count != 1 || len(visits) != 2 || visits[1] != "https://example.test/child" {
		t.Fatalf("stored alias discarded new child: %d %v", count, visits)
	}
}

func TestFrontierConsumesLateDiscoveryAfterInitialQueueDrains(t *testing.T) {
	for _, seeds := range [][]string{nil, {"https://example.test/initial"}} {
		visits := []string{}
		feeds := 0
		count := runRenderedFrontier(context.Background(), seeds, 4, 1, []string{"example.test"},
			func(target string) (*browserpool.DiscoverRenderedResult, error) {
				visits = append(visits, target)
				return &browserpool.DiscoverRenderedResult{}, nil
			}, func(string, *browserpool.DiscoverRenderedResult) bool { return true },
			func() []string {
				feeds++
				return []string{"https://example.test/late", "https://example.test/late#duplicate"}
			})
		if count != len(seeds)+1 || feeds != 1 || visits[len(visits)-1] != "https://example.test/late" {
			t.Fatalf("late discovery lost after initial queue drained: count=%d feeds=%d visits=%v", count, feeds, visits)
		}
	}
}

func TestFrontierVisitBudgetAndMeaningfulQueries(t *testing.T) {
	var visits int
	runRenderedFrontier(context.Background(), []string{"https://example.test/search?q=a", "https://example.test/search?q=b", "https://example.test/search?q=c"}, 2, 4, []string{"example.test"},
		func(target string) (*browserpool.DiscoverRenderedResult, error) {
			return &browserpool.DiscoverRenderedResult{}, nil
		},
		func(string, *browserpool.DiscoverRenderedResult) bool { visits++; return true })
	if visits != 2 {
		t.Fatalf("expected two distinct query routes within budget, got %d", visits)
	}
	if pageIdentity("https://example.test/route/") == pageIdentity("https://example.test/route") {
		t.Fatal("trailing slash semantics were collapsed")
	}
}

func TestSitemapRejectsHTMLAndMalformedXML(t *testing.T) {
	for _, body := range []string{"<html><loc>https://example.test/no</loc></html>", "<urlset><url><loc>https://example.test/no</loc>"} {
		if urls := collectSitemapURLs(context.Background(), "https://example.test/sitemap.xml", body, []string{"example.test"}, 10); len(urls) != 0 {
			t.Fatalf("invalid sitemap emitted pages: %v", urls)
		}
	}
}

func TestMeasurementBudgetUsesRequestedScopeBeyondOneHundredPages(t *testing.T) {
	pages := []seo.SEOResult{}
	for index := 0; index < 150; index++ {
		pages = append(pages, seo.SEOResult{URL: fmt.Sprintf("https://example.test/page/%d", index)})
	}
	t.Setenv("HEADLESS_MAX_PAGES", "0")
	if got := len(buildHeadlessSample(pages, nil, pages[0].URL, 1)); got != 150 {
		t.Fatalf("requested 150-page scope still capped: %d", got)
	}
	t.Setenv("HEADLESS_MAX_PAGES", "40")
	if got := len(buildHeadlessSample(pages, nil, pages[0].URL, 1)); got != 40 {
		t.Fatalf("explicit operator budget ignored: %d", got)
	}
}
