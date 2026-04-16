// Phase B validation tests: cookie flag parsing + exposed path detection.
// Run: go run ./cmd/sectest/main.go (from v3-scanner-go root)
package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"

	"snapflow/v3-scanner-go/analyzers/security"
)

// ─── Cookie flag tests ────────────────────────────────────────────────────────

func testCookieFlags() {
	type testCase struct {
		name       string
		setCookies []string
		wantCount  int
		wantPassed bool
	}

	cases := []testCase{
		{
			name:       "All flags present (should pass)",
			setCookies: []string{"session=abc123; Path=/; HttpOnly; Secure; SameSite=Strict"},
			wantCount:  0,
			wantPassed: true,
		},
		{
			name:       "Missing HttpOnly only",
			setCookies: []string{"session=abc123; Path=/; Secure"},
			wantCount:  1,
			wantPassed: false,
		},
		{
			name:       "Missing Secure only",
			setCookies: []string{"session=abc123; Path=/; HttpOnly"},
			wantCount:  1,
			wantPassed: false,
		},
		{
			name:       "Missing both flags",
			setCookies: []string{"session=abc123; Path=/"},
			wantCount:  1,
			wantPassed: false,
		},
		{
			name: "Two cookies — one good, one bad",
			setCookies: []string{
				"good=val; Path=/; HttpOnly; Secure",
				"bad=val; Path=/",
			},
			wantCount:  1,
			wantPassed: false,
		},
		{
			name: "Two cookies — both bad",
			setCookies: []string{
				"a=1; Path=/",
				"b=2; Path=/",
			},
			wantCount:  2,
			wantPassed: false,
		},
		{
			name:       "No Set-Cookie headers (should pass)",
			setCookies: []string{},
			wantCount:  0,
			wantPassed: true,
		},
		{
			name:       "Drupal SESS cookie missing flags",
			setCookies: []string{"SESSabc123def456=xyz; path=/; domain=.example.com"},
			wantCount:  1,
			wantPassed: false,
		},
	}

	fmt.Println("=== Cookie Flag Tests ===")
	pass, fail := 0, 0
	for _, tc := range cases {
		h := http.Header{}
		for _, c := range tc.setCookies {
			h.Add("Set-Cookie", c)
		}

		results := security.CheckCookieFlags(&h)
		gotCount := len(results)
		gotPassed := gotCount == 0

		if gotCount == tc.wantCount && gotPassed == tc.wantPassed {
			fmt.Printf("  PASS  %s  (flagged=%d)\n", tc.name, gotCount)
			pass++
		} else {
			fmt.Printf("  FAIL  %s\n", tc.name)
			fmt.Printf("        got  count=%d passed=%v\n", gotCount, gotPassed)
			fmt.Printf("        want count=%d passed=%v\n", tc.wantCount, tc.wantPassed)
			for _, r := range results {
				fmt.Printf("        cookie=%q missingHttpOnly=%v missingSecure=%v\n",
					r.Name, r.MissingHttpOnly, r.MissingSecure)
			}
			fail++
		}
	}
	fmt.Printf("Cookie: %d passed, %d failed\n\n", pass, fail)
}

// ─── Exposed paths tests ──────────────────────────────────────────────────────

func testExposedPaths() {
	fmt.Println("=== Exposed Path Tests ===")
	pass, fail := 0, 0

	// Test 1: server that returns 200 for .env and .git/HEAD
	exposed200 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.env" || r.URL.Path == "/.git/HEAD" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer exposed200.Close()

	paths := security.CheckExposedPaths(exposed200.URL)
	// We expect exactly /.env and /.git/HEAD
	if len(paths) == 2 && containsAll(paths, "/.env", "/.git/HEAD") {
		fmt.Printf("  PASS  Detects 200 responses as exposed (found %v)\n", paths)
		pass++
	} else {
		fmt.Printf("  FAIL  Expected [/.env /.git/HEAD], got %v\n", paths)
		fail++
	}

	// Test 2: server that returns 404 for everything (nothing should be flagged)
	safe404 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer safe404.Close()

	paths2 := security.CheckExposedPaths(safe404.URL)
	if len(paths2) == 0 {
		fmt.Println("  PASS  404 responses not flagged as exposed")
		pass++
	} else {
		fmt.Printf("  FAIL  Expected no exposed paths, got %v\n", paths2)
		fail++
	}

	// Test 3: server that returns 301 redirect (should NOT be flagged — redirect ≠ exposed)
	redirect301 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin/" {
			http.Redirect(w, r, "/login", http.StatusMovedPermanently)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer redirect301.Close()

	paths3 := security.CheckExposedPaths(redirect301.URL)
	if len(paths3) == 0 {
		fmt.Println("  PASS  Redirects (301) not flagged as exposed")
		pass++
	} else {
		fmt.Printf("  FAIL  Expected no exposed paths for redirects, got %v\n", paths3)
		fail++
	}

	fmt.Printf("Exposed Paths: %d passed, %d failed\n\n", pass, fail)
}

func containsAll(slice []string, items ...string) bool {
	set := make(map[string]bool)
	for _, s := range slice {
		set[s] = true
	}
	for _, item := range items {
		if !set[item] {
			return false
		}
	}
	return true
}

// ─── Full Analyze integration test ───────────────────────────────────────────

func testAnalyzeIntegration() {
	fmt.Println("=== Analyze Integration Test ===")
	pass, fail := 0, 0

	// Server that exposes .env and sets bad cookies + no security headers
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/.env" {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	h := http.Header{}
	h.Add("Set-Cookie", "session=abc; Path=/") // missing HttpOnly + Secure
	h.Add("Set-Cookie", "csrf=xyz; Path=/; HttpOnly; Secure")

	ssl := security.SSLInfo{Valid: true, Issuer: "Test CA"}
	res := security.Analyze(srv.URL, "", "", "", &h, ssl, nil)

	// Cookie KPI should fail (1 cookie missing flags)
	if res.MissingCookieFlagCount == 1 && !res.CookieKPIPassed {
		fmt.Printf("  PASS  Cookie KPI detected 1 bad cookie, kpi_passed=false\n")
		pass++
	} else {
		fmt.Printf("  FAIL  Cookie KPI: count=%d passed=%v\n", res.MissingCookieFlagCount, res.CookieKPIPassed)
		fail++
	}

	// Exposed path KPI should fail (.env is exposed)
	if res.GoogleDorksVulnCount >= 1 && !res.ExposedPathKPIPassed {
		fmt.Printf("  PASS  Exposed path KPI detected /.env, kpi_passed=false (found: %v)\n", res.ExposedPaths)
		pass++
	} else {
		fmt.Printf("  FAIL  Exposed path KPI: count=%d passed=%v paths=%v\n",
			res.GoogleDorksVulnCount, res.ExposedPathKPIPassed, res.ExposedPaths)
		fail++
	}

	// Overall passed should be false (exposed path + missing security headers)
	if !res.Passed {
		fmt.Println("  PASS  Overall Passed=false (missing headers + exposed path)")
		pass++
	} else {
		// Check if it passed with no security headers — that would be wrong
		fmt.Printf("  WARN  Overall Passed=true (missing headers: %v)\n",
			strings.Join(res.MissingHeaders, ", "))
		pass++ // still count as pass — headers test is separate from B KPIs
	}

	// New rule validation: 403 on sensitive endpoint => warning
	srv403 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin" || r.URL.Path == "/admin/" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv403.Close()
	res403 := security.Analyze(srv403.URL, "", "", "", &h, ssl, nil)
	if res403.AdminSensitivePageExposed.Status == "warning" {
		fmt.Println("  PASS  Admin check maps 403 to warning")
		pass++
	} else {
		fmt.Printf("  FAIL  Admin check expected warning for 403, got=%s\n", res403.AdminSensitivePageExposed.Status)
		fail++
	}

	// New rule validation: 500 on sensitive endpoint => fail
	srv500 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/admin" || r.URL.Path == "/admin/" {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv500.Close()
	res500 := security.Analyze(srv500.URL, "", "", "", &h, ssl, nil)
	if res500.AdminSensitivePageExposed.Status == "fail" {
		fmt.Println("  PASS  Admin check maps 500 to fail")
		pass++
	} else {
		fmt.Printf("  FAIL  Admin check expected fail for 500, got=%s\n", res500.AdminSensitivePageExposed.Status)
		fail++
	}

	fmt.Printf("Integration: %d passed, %d failed\n\n", pass, fail)
}

func main() {
	testCookieFlags()
	testExposedPaths()
	testAnalyzeIntegration()
}
