package browserpool

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestDiscoveryCarriesScanScopeAndRetainsRecoveryEvidence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/discover-rendered" {
			t.Errorf("unexpected endpoint %s", r.URL.Path)
		}
		var payload map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if payload["scan_id"] != "scan-pilot" || payload["capture_projection"] != true {
			t.Errorf("missing routing scope or text projection: %v", payload)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","engine":"chromium","acquisition_routed":true,"rendered_html":"<main>Recovered content</main>","text_projection":{"markdown":"Recovered content"},"acquisition_attempts":[{"engine":"obscura","status":"timeout","error":"navigation_timeout"},{"engine":"chromium","status":"success","rendered_html":"<main>Recovered content</main>"}]}`))
	}))
	defer server.Close()
	t.Setenv("BROWSER_POOL_URL", server.URL)
	result, err := DiscoverRenderedWithOptions(context.Background(), "https://fixture.test/", []string{"fixture.test"}, 30, true, 20000, DiscoverRenderedOptions{
		ScanID: "scan-pilot", CaptureProjection: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.AcquisitionRouted || len(result.AcquisitionAttempts) != 2 || result.AcquisitionAttempts[0]["error"] != "navigation_timeout" {
		t.Fatalf("lost recovery evidence: %+v", result)
	}
	// Scanner stores this object as rendered_discovery in JSONB. Verify that
	// serialization keeps both failed acquisition and recovered projection.
	persisted, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var evidence map[string]interface{}
	if err := json.Unmarshal(persisted, &evidence); err != nil {
		t.Fatal(err)
	}
	if len(evidence["acquisition_attempts"].([]interface{})) != 2 || evidence["text_projection"].(map[string]interface{})["markdown"] != "Recovered content" {
		t.Fatalf("incomplete persisted evidence: %s", persisted)
	}
}

func TestRenderHTTPTimeoutAccountsForObscuraFallback(t *testing.T) {
	oldTimeout := os.Getenv("BROWSER_POOL_TIMEOUT_MS")
	defer os.Setenv("BROWSER_POOL_TIMEOUT_MS", oldTimeout)

	os.Setenv("BROWSER_POOL_TIMEOUT_MS", "90000")
	got := renderHTTPTimeout(45000, true, "chromium")
	want := 135 * time.Second
	if got != want {
		t.Fatalf("expected fallback-aware timeout %s, got %s", want, got)
	}
}

func TestRenderHTTPTimeoutKeepsLargerConfiguredTimeout(t *testing.T) {
	oldTimeout := os.Getenv("BROWSER_POOL_TIMEOUT_MS")
	defer os.Setenv("BROWSER_POOL_TIMEOUT_MS", oldTimeout)

	os.Setenv("BROWSER_POOL_TIMEOUT_MS", "180000")
	got := renderHTTPTimeout(45000, true, "chromium")
	want := 180 * time.Second
	if got != want {
		t.Fatalf("expected configured timeout %s, got %s", want, got)
	}
}
