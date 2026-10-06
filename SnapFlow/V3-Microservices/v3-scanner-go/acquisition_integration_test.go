package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"snapflow/v3-scanner-go/db"
)

// Opt-in acceptance against the isolated PostgreSQL fixture. The scanner and
// crawler are real; the browser service is a known-observation HTTP adapter.
// This proves acquisition orchestration/persistence, not browser throughput.
func TestScannerAcquisitionIntegration(t *testing.T) {
	if os.Getenv("SCANNER_EVIDENCE_INTEGRATION") != "1" {
		t.Skip("requires isolated fixture DB and explicit integration opt-in")
	}
	if os.Getenv("DB_NAME") != "snapflow_evidence" {
		t.Fatal("refusing to run outside the isolated evidence database")
	}
	var base string
	staticHTML := func(route string) string {
		links := ""
		if route == "/" {
			links = `<a href="/static">Static page</a>`
		}
		return fmt.Sprintf(`<html lang="en"><head><title>Fixture %s</title></head><body><main><h1>Original %s</h1><p>%s</p>%s</main></body></html>`, route, route, strings.Repeat("Useful instructions for customers. ", 50), links)
	}
	renderedHTML := func(route string) string {
		return fmt.Sprintf(`<html lang="en"><head><title>Hydrated %s</title></head><body><main><h1>Recovered %s</h1><p>%s</p></main></body></html>`, route, route, strings.Repeat("Recovered instructions describing this service. ", 50))
	}
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		switch r.URL.Path {
		case "/robots.txt":
			w.Header().Set("Content-Type", "text/plain")
			fmt.Fprintf(w, "User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n", base)
		case "/sitemap.xml":
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprintf(w, `<sitemapindex><sitemap><loc>%s/child.xml</loc></sitemap></sitemapindex>`, base)
		case "/child.xml":
			w.Header().Set("Content-Type", "application/xml")
			fmt.Fprintf(w, `<urlset><url><loc>%s/sitemap-only</loc></url></urlset>`, base)
		case "/", "/static", "/sitemap-only", "/js-parent", "/js-child", "/js-grandchild":
			fmt.Fprint(w, staticHTML(r.URL.Path))
		default:
			http.NotFound(w, r)
		}
	}))
	defer site.Close()
	base = site.URL
	children := map[string][]string{"/": {"/js-parent"}, "/js-parent": {"/js-child"}, "/js-child": {"/js-grandchild"}}
	var observationDB *sql.DB
	var streamingVerified atomic.Bool
	browser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			URL     string `json:"url"`
			Profile string `json:"profile"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("invalid browser request: %v", err)
			w.WriteHeader(400)
			return
		}
		parsed, _ := url.Parse(request.URL)
		if r.URL.Path == "/render" && parsed.Path == "/static" && request.Profile != "mobile_3g" {
			var ready bool
			if err := observationDB.QueryRow("SELECT nlp_ready FROM scan_pages WHERE scan_id='scanner_acquisition_fixture' AND url=$1", request.URL).Scan(&ready); err != nil || ready {
				t.Errorf("page exposed before rendering finished: ready=%v error=%v", ready, err)
			}
			// Hold this visit until a different completed page is released to
			// NLP, proving publication does not wait for the whole batch.
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				if err := observationDB.QueryRow("SELECT nlp_ready FROM scan_pages WHERE scan_id='scanner_acquisition_fixture' AND url=$1", base+"/").Scan(&ready); err == nil && ready {
					streamingVerified.Store(true)
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
		}
		links := []string{}
		for _, child := range children[parsed.Path] {
			links = append(links, base+child)
		}
		w.Header().Set("Content-Type", "application/json")
		dom := renderedHTML(parsed.Path)
		if r.URL.Path == "/render" {
			dom = strings.Replace(dom, "</head>", `<meta name="description" content="Measured customer guide with useful service information."></head>`, 1)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success", "url": request.URL, "final_url": request.URL,
			"engine": "chromium", "render_engine": "chromium", "internal_links": links,
			"raw_html": staticHTML(parsed.Path), "rendered_html": dom,
			"visible_text": "Recovered instructions", "response_headers": map[string]string{"last-modified": "Sun, 20 Sep 2026 10:00:00 GMT"},
			"metrics_available": false,
		})
	}))
	defer browser.Close()
	for key, value := range map[string]string{
		"BROWSER_POOL_URL": browser.URL, "ENABLE_FORM_FUZZER": "false", "ENABLE_FORM_BROWSER": "false",
		"ENABLE_MODAL_FORM_DETECTION": "false", "ENABLE_PORT_SCAN": "false", "SCANNER_VERBOSE_CRAWL_LOGS": "false",
		"RENDERED_DISCOVERY_MAX_PAGES": "0", "HEADLESS_SAMPLE_RATIO": "1",
	} {
		t.Setenv(key, value)
	}
	if err := db.Connect(); err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	connection, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s sslmode=disable", os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_NAME"), os.Getenv("DB_USER"), os.Getenv("DB_PASS")))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	observationDB = connection
	const scanID = "scanner_acquisition_fixture"
	if _, err := connection.Exec("DELETE FROM scan_pages WHERE scan_id=$1", scanID); err != nil {
		t.Fatal(err)
	}
	previous, _ := os.Getwd()
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(previous)
	host, _ := url.Parse(base)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	started := time.Now()
	startScan(ctx, ScannerConfig{ScanID: scanID, StartURL: base + "/", AllowedDomains: []string{host.Hostname()}, MaxDepth: 5, MaxPages: 10, Parallelism: 3, HeadlessConcurrency: 2})
	if !streamingVerified.Load() {
		t.Fatal("completed homepage was held behind an unfinished rendering visit")
	}
	rows, err := connection.Query("SELECT url, raw_html, rendered_html, content_revision, metrics FROM scan_pages WHERE scan_id=$1 ORDER BY url", scanID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	observations := []map[string]interface{}{}
	paths := []string{}
	for rows.Next() {
		var target string
		var raw, rendered sql.NullString
		var revision int64
		var metrics []byte
		if err := rows.Scan(&target, &raw, &rendered, &revision, &metrics); err != nil {
			t.Fatal(err)
		}
		parsed, _ := url.Parse(target)
		paths = append(paths, parsed.Path)
		if !rendered.Valid || !strings.Contains(rendered.String, "Recovered "+parsed.Path) {
			t.Fatalf("DOM lost without CWV for %s", target)
		}
		if parsed.Path == "/" && (!raw.Valid || !strings.Contains(raw.String, "Original /")) {
			t.Fatal("static original response overwritten by hydrated DOM")
		}
		var measured map[string]interface{}
		json.Unmarshal(metrics, &measured)
		response, ok := measured["rendered_response"].(map[string]interface{})
		if !ok || response["raw_html"] != staticHTML(parsed.Path) {
			t.Fatalf("measurement response lost for %s", target)
		}
		headers, ok := response["response_headers"].(map[string]interface{})
		if !ok || headers["last-modified"] != "Sun, 20 Sep 2026 10:00:00 GMT" {
			t.Fatalf("measurement headers lost for %s", target)
		}
		if headless, ok := measured["headless"].(map[string]interface{}); ok && headless["available"] == true {
			t.Fatal("missing timings fabricated as measurements")
		}
		observations = append(observations, map[string]interface{}{"url": target, "raw_html": raw, "rendered_html": rendered.String, "revision": revision, "metrics": measured})
	}
	want := []string{"/", "/static", "/sitemap-only", "/js-parent", "/js-child", "/js-grandchild"}
	sort.Strings(want)
	sort.Strings(paths)
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("expected static + sitemap + recursive JS routes, got %v", paths)
	}
	reportBytes, err := os.ReadFile("scan_report.json")
	if err != nil {
		t.Fatal(err)
	}
	var report FinalReport
	json.Unmarshal(reportBytes, &report)
	if report.SEOSummary.TotalPages != len(want) {
		t.Fatalf("summary lost or duplicated acquisition rows: %d", report.SEOSummary.TotalPages)
	}
	if report.ScanTelemetry.HeadlessExecuted != len(want) || report.ScanTelemetry.HeadlessContentCaptured != len(want) || report.ScanTelemetry.HeadlessMeasured != 0 {
		t.Fatalf("selected/captured visits mistaken for successful measurements: %+v", report.ScanTelemetry)
	}
	if report.SEOSummary.PagesMissingMetaDesc != 0 {
		t.Fatalf("summary retained pre-measurement missing descriptions: %d", report.SEOSummary.PagesMissingMetaDesc)
	}
	for _, issue := range report.SEOIssues {
		if !issue.Meta.HasMetaDesc {
			t.Fatalf("detail retained stale metadata for %s", issue.URL)
		}
	}
	if output := os.Getenv("SCANNER_EVIDENCE_OUTPUT"); output != "" {
		proof := map[string]interface{}{"scan_id": scanID, "elapsed_ms": time.Since(started).Milliseconds(), "observations": observations, "report": report,
			"completed_page_released_before_batch": streamingVerified.Load(),
			"methodology":                          "Real scanner, HTTP crawl and PostgreSQL; known browser-response adapter with unavailable CWV; not a production browser or full SaaS scan-duration baseline"}
		bytes, _ := json.MarshalIndent(proof, "", "  ")
		if err := os.WriteFile(filepath.Clean(output), bytes, 0644); err != nil {
			t.Fatal(err)
		}
	}
}
