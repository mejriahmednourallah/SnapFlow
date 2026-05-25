package browserpool

import (
	"os"
	"testing"
	"time"
)

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
