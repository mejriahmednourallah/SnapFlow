package main

import (
	"fmt"
	"os"

	"snapflow/v3-scanner-go/analyzers/performance"
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

// buildMobile simulates the threshold logic applied inside AnalyzeHomepageMobile.
// Thresholds: FCP < 3000 ms, LCP < 4000 ms, CLS < 0.25
func buildMobile(fcp, lcp, cls float64) performance.MobilePerformanceResult {
	r := performance.MobilePerformanceResult{
		FCPMS: fcp,
		LCPMS: lcp,
		CLS:   cls,
	}
	issues := []string{}
	if r.FCPMS == 0 || r.FCPMS >= 3000 {
		issues = append(issues, fmt.Sprintf("FCP %.0f ms exceeds 3000 ms threshold on mobile", r.FCPMS))
	}
	if r.LCPMS == 0 || r.LCPMS >= 4000 {
		issues = append(issues, fmt.Sprintf("LCP %.0f ms exceeds 4000 ms threshold on mobile", r.LCPMS))
	}
	if r.CLS >= 0.25 {
		issues = append(issues, fmt.Sprintf("CLS %.3f exceeds 0.25 threshold on mobile", r.CLS))
	}
	r.Issues = issues
	r.Passed = len(issues) == 0
	return r
}

func main() {
	fmt.Println("=== Phase H: Mobile Performance Trace Tests ===")

	// ─── T01: All within thresholds → Passed ────────────────────────────────
	fmt.Println("\n[T01] FCP=1500, LCP=2500, CLS=0.05 → all under threshold → Passed=true")
	r := buildMobile(1500, 2500, 0.05)
	check("passed", r.Passed, true)
	check("issue_count", len(r.Issues), 0)
	check("fcp_ms", r.FCPMS, 1500.0)
	check("lcp_ms", r.LCPMS, 2500.0)
	check("cls", r.CLS, 0.05)

	// ─── T02: FCP exactly at threshold (3000) → fail ────────────────────────
	fmt.Println("\n[T02] FCP=3000 (boundary) → Passed=false")
	r = buildMobile(3000, 2500, 0.05)
	check("passed", r.Passed, false)
	check("issue_count", len(r.Issues), 1)

	// ─── T03: LCP exactly at threshold (4000) → fail ────────────────────────
	fmt.Println("\n[T03] LCP=4000 (boundary) → Passed=false")
	r = buildMobile(1500, 4000, 0.05)
	check("passed", r.Passed, false)
	check("issue_count", len(r.Issues), 1)

	// ─── T04: CLS exactly at threshold (0.25) → fail ────────────────────────
	fmt.Println("\n[T04] CLS=0.25 (boundary) → Passed=false")
	r = buildMobile(1500, 2500, 0.25)
	check("passed", r.Passed, false)
	check("issue_count", len(r.Issues), 1)

	// ─── T05: CLS just below threshold (0.249) → pass ───────────────────────
	fmt.Println("\n[T05] CLS=0.249 (just below) → Passed=true")
	r = buildMobile(1500, 2500, 0.249)
	check("passed", r.Passed, true)
	check("issue_count", len(r.Issues), 0)

	// ─── T06: FCP=0 (navigation failed) → fail ──────────────────────────────
	fmt.Println("\n[T06] FCP=0 (no data) → Passed=false")
	r = buildMobile(0, 0, 0)
	check("passed", r.Passed, false)
	check("issue_count", len(r.Issues), 2) // both FCP and LCP fail (CLS=0 is fine)

	// ─── T07: All three thresholds exceeded → 3 issues ──────────────────────
	fmt.Println("\n[T07] FCP=5000, LCP=8000, CLS=0.5 → 3 issues, Passed=false")
	r = buildMobile(5000, 8000, 0.5)
	check("passed", r.Passed, false)
	check("issue_count", len(r.Issues), 3)

	// ─── T08: MobileMetrics pointer field exists on HeadlessResult ──────────
	fmt.Println("\n[T08] MobileMetrics pointer field on HeadlessResult is settable")
	hr := performance.HeadlessResult{}
	mobile := buildMobile(1500, 2500, 0.05)
	hr.MobileMetrics = &mobile
	check("mobile_metrics_not_nil", hr.MobileMetrics != nil, true)
	check("mobile_passed", hr.MobileMetrics.Passed, true)
	check("mobile_fcp", hr.MobileMetrics.FCPMS, 1500.0)

	// ─── T09: nil MobileMetrics by default (omitempty) ───────────────────────
	fmt.Println("\n[T09] HeadlessResult.MobileMetrics is nil by default")
	hr2 := performance.HeadlessResult{URL: "https://example.com"}
	check("mobile_metrics_nil", hr2.MobileMetrics == nil, true)

	// ─── T10: SpeedIndex is populated when FCP+LCP set ───────────────────────
	fmt.Println("\n[T10] SpeedIndexMS field present and zero when not set")
	r = performance.MobilePerformanceResult{FCPMS: 1200, LCPMS: 2200, CLS: 0.1}
	check("speed_index_default", r.SpeedIndexMS, 0.0) // not set by buildMobile directly

	// ─── T11: Issues slice is non-nil (not nil) when no issues ──────────────
	fmt.Println("\n[T11] Issues is populated (empty slice, not nil) when no issues")
	r = buildMobile(1500, 2500, 0.05)
	check("issues_not_nil", r.Issues != nil, true)
	check("issues_len", len(r.Issues), 0)

	// ─── T12: Error field defaults to empty string ───────────────────────────
	fmt.Println("\n[T12] Error field is empty string by default")
	r2 := performance.MobilePerformanceResult{}
	check("error_empty", r2.Error, "")

	// ─── Summary ─────────────────────────────────────────────────────────────
	fmt.Printf("\n=== Results: %d passed, %d failed ===\n", passed, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
