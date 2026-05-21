// Package browserpool is a lightweight HTTP client for the v3-browser-pool
// microservice.  When BROWSER_POOL_URL is set the scanner can delegate
// rendered-HTML capture and screenshots to the shared pool instead of
// launching its own Chromium instances.
//
// Feature flags
//
//	BROWSER_POOL_URL          Service base URL (e.g. "http://v3-browser-pool:8084").
//	                          Empty → pool disabled; all callers fall back to
//	                          their local browser logic.
//	BROWSER_POOL_TIMEOUT_MS   Per-request HTTP timeout (default 90 000 ms).
package browserpool

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

// IsEnabled returns true when the browser-pool service is configured via env.
func IsEnabled() bool { return baseURL() != "" }

func baseURL() string { return os.Getenv("BROWSER_POOL_URL") }

func httpTimeout() time.Duration {
	if raw := os.Getenv("BROWSER_POOL_TIMEOUT_MS"); raw != "" {
		if ms, err := strconv.Atoi(raw); err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 90 * time.Second
}

var client = &http.Client{} // timeout set per-request via context

// ── Response types ─────────────────────────────────────────────────────────────

// RenderResult mirrors the /render response body.
type AssetCategory struct {
	SizeBytes int     `json:"size_bytes"`
	Count     int     `json:"count"`
	CO2Grams  float64 `json:"co2_grams"`
}

type RenderResult struct {
	Status            string                   `json:"status"`
	URL               string                   `json:"url"`
	RenderedHTML      string                   `json:"rendered_html"`
	Title             string                   `json:"title"`
	PageHeight        int                      `json:"page_height"`
	PageWidth         int                      `json:"page_width"`
	FinalURL          string                   `json:"final_url"`
	FCPMS             float64                  `json:"fcp_ms"`
	LCPMS             float64                  `json:"lcp_ms"`
	CLS               float64                  `json:"cls"`
	DOMNodes          int                      `json:"dom_nodes"`
	HTTPRequests      int                      `json:"http_requests"`
	TransferSizeKB    float64                  `json:"transfer_size_kb"`
	AssetBreakdown    map[string]AssetCategory `json:"asset_breakdown"`
	DesktopOverflow   bool                     `json:"desktop_overflow"`
	TabletOverflow    bool                     `json:"tablet_overflow"`
	MobileOverflow    bool                     `json:"mobile_overflow"`
	InvisibleLinks    int                      `json:"invisible_links"`
	ConsoleErrors     []string                 `json:"console_errors"`
	ConsoleErrorCount int                      `json:"console_error_count"`
	TrackerTimeline   []map[string]interface{} `json:"tracker_timeline"`
	CMPBanner         map[string]interface{}   `json:"cmp_banner"`
	Error             string                   `json:"error"`
}

// ScreenshotResult mirrors the /screenshot response body.
type ScreenshotResult struct {
	Status       string `json:"status"`
	URL          string `json:"url"`
	ImageB64     string `json:"image_b64"`
	Width        int    `json:"width"`
	Height       int    `json:"height"`
	CoverageMode string `json:"coverage_mode"`
	Error        string `json:"error"`
}

// BatchScreenshotResult mirrors the /batch-screenshot response body.
type BatchScreenshotResult struct {
	Pages []ScreenshotResult `json:"pages"`
	Total int                `json:"total"`
}

// HealthResult mirrors the /health response body.
type HealthResult struct {
	Status         string `json:"status"`
	PoolSize       int    `json:"pool_size"`
	ActiveSessions int    `json:"active_sessions"`
	PagesServed    int    `json:"pages_served"`
	SuccessCount   int    `json:"success_count"`
	TimeoutCount   int    `json:"timeout_count"`
	CrashCount     int    `json:"crash_count"`
	BrowserAlive   bool   `json:"browser_alive"`
}

// ── Internal HTTP helper ───────────────────────────────────────────────────────

func post(ctx context.Context, path string, payload interface{}) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("browserpool: marshal: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, httpTimeout())
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost,
		baseURL()+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("browserpool: new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("browserpool: %s: %w", path, err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("browserpool: read body: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("browserpool: %s returned HTTP %d: %s",
			path, resp.StatusCode, string(data))
	}
	return data, nil
}

func get(ctx context.Context, path string) ([]byte, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, baseURL()+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Health returns the pool service health snapshot.
func Health(ctx context.Context) (*HealthResult, error) {
	data, err := get(ctx, "/health")
	if err != nil {
		return nil, err
	}
	var r HealthResult
	return &r, json.Unmarshal(data, &r)
}

// Render asks the pool to navigate to url and return the fully rendered HTML.
// waitUntil is one of "load", "domcontentloaded", "networkidle" (default: "networkidle").
func Render(ctx context.Context, url string, timeoutMS int, waitUntil string) (*RenderResult, error) {
	if waitUntil == "" {
		waitUntil = "networkidle"
	}
	payload := map[string]interface{}{
		"url":        url,
		"timeout_ms": timeoutMS,
		"wait_until": waitUntil,
	}
	data, err := post(ctx, "/render", payload)
	if err != nil {
		return nil, err
	}
	var r RenderResult
	return &r, json.Unmarshal(data, &r)
}

// Screenshot captures a screenshot of url and returns the result.
func Screenshot(ctx context.Context, url string, width, height int, fullPage bool, timeoutMS int) (*ScreenshotResult, error) {
	payload := map[string]interface{}{
		"url":        url,
		"width":      width,
		"height":     height,
		"full_page":  fullPage,
		"timeout_ms": timeoutMS,
	}
	data, err := post(ctx, "/screenshot", payload)
	if err != nil {
		return nil, err
	}
	var r ScreenshotResult
	return &r, json.Unmarshal(data, &r)
}

// BatchScreenshot captures screenshots for multiple URLs concurrently.
func BatchScreenshot(ctx context.Context, urls []string, width, height int, fullPage bool, timeoutMS, maxPages int) (*BatchScreenshotResult, error) {
	payload := map[string]interface{}{
		"urls":       urls,
		"width":      width,
		"height":     height,
		"full_page":  fullPage,
		"timeout_ms": timeoutMS,
		"max_pages":  maxPages,
	}
	data, err := post(ctx, "/batch-screenshot", payload)
	if err != nil {
		return nil, err
	}
	var r BatchScreenshotResult
	return &r, json.Unmarshal(data, &r)
}

// DecodeImage decodes the base64-encoded PNG from a ScreenshotResult.
func DecodeImage(b64 string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(b64)
}
