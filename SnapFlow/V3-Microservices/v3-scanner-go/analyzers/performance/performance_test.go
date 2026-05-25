package performance

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestParseEnvBool(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		want   bool
		okWant bool
	}{
		{name: "true", input: "true", want: true, okWant: true},
		{name: "1", input: "1", want: true, okWant: true},
		{name: "yes", input: "yes", want: true, okWant: true},
		{name: "false", input: "false", want: false, okWant: true},
		{name: "0", input: "0", want: false, okWant: true},
		{name: "invalid", input: "abc", want: false, okWant: false},
		{name: "empty", input: "", want: false, okWant: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseEnvBool(tc.input)
			if got != tc.want || ok != tc.okWant {
				t.Fatalf("parseEnvBool(%q)=(%v,%v), want (%v,%v)", tc.input, got, ok, tc.want, tc.okWant)
			}
		})
	}
}

func TestShouldDisableSandboxExplicitEnv(t *testing.T) {
	old := os.Getenv("CHROME_NO_SANDBOX")
	defer os.Setenv("CHROME_NO_SANDBOX", old)

	os.Setenv("CHROME_NO_SANDBOX", "false")
	if shouldDisableSandbox() {
		t.Fatal("expected shouldDisableSandbox=false when CHROME_NO_SANDBOX=false")
	}

	os.Setenv("CHROME_NO_SANDBOX", "true")
	if !shouldDisableSandbox() {
		t.Fatal("expected shouldDisableSandbox=true when CHROME_NO_SANDBOX=true")
	}
}

func TestRenderPagesViaBrowserPoolReturnsRenderedHTML(t *testing.T) {
	oldPoolURL := os.Getenv("BROWSER_POOL_URL")
	oldPoolTimeout := os.Getenv("BROWSER_POOL_TIMEOUT_MS")
	defer os.Setenv("BROWSER_POOL_URL", oldPoolURL)
	defer os.Setenv("BROWSER_POOL_TIMEOUT_MS", oldPoolTimeout)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/render" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode render payload: %v", err)
		}
		if payload["wait_until"] != "domcontentloaded" {
			t.Fatalf("expected domcontentloaded render wait, got %v", payload["wait_until"])
		}
		if payload["allow_obscura_fallback"] != true {
			t.Fatalf("expected Obscura fallback to be enabled, got %v", payload["allow_obscura_fallback"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","url":"https://example.com","rendered_html":"<html><body><main>ok</main></body></html>","final_url":"https://example.com","fcp_ms":321.4,"lcp_ms":987.6,"cls":0.012,"dom_nodes":42,"http_requests":8,"transfer_size_kb":123.45,"asset_breakdown":{"html":{"size_bytes":1000,"count":1,"co2_grams":0},"scripts":{"size_bytes":2000,"count":2,"co2_grams":0}},"desktop_overflow":false,"tablet_overflow":true,"mobile_overflow":true,"invisible_links":3,"console_errors":["[warning] example"],"console_error_count":1,"render_engine":"chromium","confidence":"primary","error":""}`))
	}))
	defer server.Close()

	os.Setenv("BROWSER_POOL_URL", server.URL)
	os.Setenv("BROWSER_POOL_TIMEOUT_MS", "1000")

	results := renderPagesViaBrowserPool([]string{"https://example.com"}, 1)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Error != "" {
		t.Fatalf("expected browser-pool fallback to succeed, got error %q", results[0].Error)
	}
	if results[0].RenderedHTML == "" {
		t.Fatal("expected rendered HTML from browser-pool fallback")
	}
	if results[0].FCPMS != 321.4 || results[0].LCPMS != 987.6 || results[0].CLS != 0.012 {
		t.Fatalf("expected browser-pool timing metrics to be mapped, got FCP %.1f LCP %.1f CLS %.3f", results[0].FCPMS, results[0].LCPMS, results[0].CLS)
	}
	if results[0].DOMNodes != 42 || results[0].HTTPRequests != 8 || results[0].TransferSizeKB != 123.45 {
		t.Fatalf("expected browser-pool resource metrics to be mapped, got DOM %d requests %d transfer %.2f", results[0].DOMNodes, results[0].HTTPRequests, results[0].TransferSizeKB)
	}
	if results[0].EcoScore == "" || results[0].EcoIndex <= 0 {
		t.Fatalf("expected browser-pool fallback to calculate eco score, got score %q index %.2f", results[0].EcoScore, results[0].EcoIndex)
	}
	if !results[0].ButtonKPIPassed || results[0].ConsoleErrorKPIPassed {
		t.Fatal("expected pool fallback to keep neutral button defaults and map console KPI state")
	}
	if results[0].RenderEngine != "chromium" || results[0].Estimated {
		t.Fatalf("expected primary chromium render metadata, got engine=%q estimated=%v", results[0].RenderEngine, results[0].Estimated)
	}
}
