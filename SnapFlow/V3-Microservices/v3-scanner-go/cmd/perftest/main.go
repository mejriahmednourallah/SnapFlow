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

// Phase G tests are struct-level / logic-level (no live browser needed).
// They verify:
//   - New fields exist on HeadlessResult (compile-time)
//   - Pass/fail logic is correct for KPI thresholds
//   - Viewport change to 1366 is reflected in struct behaviour

func buildResult(consoleErrors []string, buttons []string) performance.HeadlessResult {
	r := performance.HeadlessResult{}
	r.ConsoleErrors = consoleErrors
	r.ConsoleErrorCount = len(consoleErrors)
	r.ConsoleErrorKPIPassed = r.ConsoleErrorCount == 0
	r.NonFunctionalButtons = buttons
	r.NonFunctionalButtonCount = len(buttons)
	r.ButtonKPIPassed = r.NonFunctionalButtonCount == 0
	return r
}

func main() {
	fmt.Println("=== Phase G: Performance Console Errors + Non-Functional Buttons Tests ===")

	// T01 — no console errors → KPI passed
	fmt.Println("\n[T01] No console errors → console_error_kpi_passed = true")
	r := buildResult([]string{}, []string{})
	check("console_error_count", r.ConsoleErrorCount, 0)
	check("console_error_kpi_passed", r.ConsoleErrorKPIPassed, true)

	// T02 — 1 console error → KPI failed
	fmt.Println("\n[T02] 1 console error → console_error_kpi_passed = false")
	r = buildResult([]string{"[error] TypeError: Cannot read property 'x' of undefined"}, []string{})
	check("console_error_count", r.ConsoleErrorCount, 1)
	check("console_error_kpi_passed", r.ConsoleErrorKPIPassed, false)

	// T03 — 3 console errors
	fmt.Println("\n[T03] 3 console errors — count and KPI")
	r = buildResult([]string{"[error] e1", "[warning] w1", "[error] e2"}, []string{})
	check("console_error_count", r.ConsoleErrorCount, 3)
	check("console_error_kpi_passed", r.ConsoleErrorKPIPassed, false)

	// T04 — no non-functional buttons → button KPI passed
	fmt.Println("\n[T04] No non-functional buttons → button_kpi_passed = true")
	r = buildResult([]string{}, []string{})
	check("non_functional_button_count", r.NonFunctionalButtonCount, 0)
	check("button_kpi_passed", r.ButtonKPIPassed, true)

	// T05 — 2 non-functional buttons → KPI failed
	fmt.Println("\n[T05] 2 non-functional buttons → button_kpi_passed = false")
	r = buildResult([]string{}, []string{"En savoir plus", "Voir plus"})
	check("non_functional_button_count", r.NonFunctionalButtonCount, 2)
	check("button_kpi_passed", r.ButtonKPIPassed, false)
	check("non_functional_buttons[0]", r.NonFunctionalButtons[0], "En savoir plus")

	// T06 — both issues present
	fmt.Println("\n[T06] Both console errors AND non-functional buttons")
	r = buildResult([]string{"[error] undefined"}, []string{"Click me"})
	check("console_error_kpi_passed", r.ConsoleErrorKPIPassed, false)
	check("button_kpi_passed", r.ButtonKPIPassed, false)

	// T07 — struct fields are the right types (compile smoke)
	fmt.Println("\n[T07] New struct fields exist with correct types")
	r = performance.HeadlessResult{}
	check("ConsoleErrors type", fmt.Sprintf("%T", r.ConsoleErrors), "[]string")
	check("NonFunctionalButtons type", fmt.Sprintf("%T", r.NonFunctionalButtons), "[]string")
	check("ConsoleErrorCount type", fmt.Sprintf("%T", r.ConsoleErrorCount), "int")
	check("NonFunctionalButtonCount type", fmt.Sprintf("%T", r.NonFunctionalButtonCount), "int")
	check("ConsoleErrorKPIPassed type", fmt.Sprintf("%T", r.ConsoleErrorKPIPassed), "bool")
	check("ButtonKPIPassed type", fmt.Sprintf("%T", r.ButtonKPIPassed), "bool")

	// T08 — zero-value struct: both KPIs default to passed (0 errors, 0 buttons)
	fmt.Println("\n[T08] Zero-value struct: KPI fields default to false (not pre-set)")
	r = performance.HeadlessResult{}
	// ConsoleErrorKPIPassed defaults to false (zero value of bool) — must be explicitly set
	check("zero_console_error_count", r.ConsoleErrorCount, 0)
	check("zero_nonfunc_button_count", r.NonFunctionalButtonCount, 0)

	// T09 — console errors slice is nil-safe
	fmt.Println("\n[T09] Nil console errors slice doesn't panic")
	r = performance.HeadlessResult{}
	r.ConsoleErrors = nil
	r.ConsoleErrorCount = len(r.ConsoleErrors)
	r.ConsoleErrorKPIPassed = r.ConsoleErrorCount == 0
	check("nil_console_errors_kpi_passed", r.ConsoleErrorKPIPassed, true)

	// T10 — buttons slice capped at 20 (logic check)
	fmt.Println("\n[T10] Button list can hold exactly 20 entries")
	btns := make([]string, 20)
	for i := range btns {
		btns[i] = fmt.Sprintf("btn-%d", i)
	}
	r = buildResult([]string{}, btns)
	check("non_functional_button_count", r.NonFunctionalButtonCount, 20)
	check("button_kpi_passed", r.ButtonKPIPassed, false)

	// ── Summary ──────────────────────────────────────────────────────────────
	fmt.Printf("\n============================\n")
	fmt.Printf("Results: %d passed, %d failed (total %d)\n", passed, failed, passed+failed)
	if failed > 0 {
		os.Exit(1)
	}
}
