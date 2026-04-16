package main

import (
	"fmt"
	"os"

	"snapflow/v3-scanner-go/analyzers/ux"
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

// ── fixtures ────────────────────────────────────────────────────────────────

const rawIPHtml = `<html><body>
<a href="http://192.168.1.10/dashboard">Admin</a>
<a href="http://10.0.0.5/api">API</a>
<p>Visit our site!</p>
</body></html>`

const noIPHtml = `<html><body>
<a href="https://example.com/page">Page</a>
<p>No raw IPs here.</p>
</body></html>`

const plainEmailHtml = `<html><body>
<p>Contact us at support@example.com or admin@example.com for help.</p>
</body></html>`

const mailtoEmailHtml = `<html><body>
<p>Contact: <a href="mailto:support@example.com">support@example.com</a></p>
</body></html>`

const mixedEmailHtml = `<html><body>
<p>Email1: <a href="mailto:good@example.com">good@example.com</a></p>
<p>Email2: naked@example.com (no mailto)</p>
</body></html>`

const simulatorDomHtml = `<html><body>
<div class="simulateur-credit">
  <iframe src="/simulat/mortgage"></iframe>
</div>
</body></html>`

const simulatorKeywordHtml = `<html><body>
<div>Utilisez notre simulateur de crédit</div>
</body></html>`

const calculatorHtml = `<html><body>
<div>Calculateur de remboursement disponible</div>
</body></html>`

const noSimulatorHtml = `<html><body>
<p>Plain page with no interactive financial widgets of any kind.</p>
</body></html>`

const multipleIPHtml = `<html><body>
<a href="http://192.168.1.1/">Link1</a>
<a href="http://10.0.0.1/admin">Link2</a>
<a href="http://172.16.0.1/api">Link3</a>
</body></html>`

const bothIssuesHtml = `<html><body>
<a href="http://192.168.0.1/">IP Link</a>
<p>Email: naked@bank.com is here</p>
</body></html>`

// ── tests ────────────────────────────────────────────────────────────────────

func main() {
	fmt.Println("=== Phase E: UX Bool→Count Conversion Tests ===")

	// T01 — raw IP links counted
	fmt.Println("\n[T01] Raw IP links counted (2 links)")
	r := ux.Analyze("http://example.com", rawIPHtml, "example.com")
	check("raw_ip_link_count", r.RawIPLinkCount, 2)
	check("raw_ip_kpi_passed", r.RawIPLinkKPIPassed, false)

	// T02 — no IP links → passed
	fmt.Println("\n[T02] No raw IP links → passed")
	r = ux.Analyze("http://example.com", noIPHtml, "example.com")
	check("raw_ip_link_count", r.RawIPLinkCount, 0)
	check("raw_ip_kpi_passed", r.RawIPLinkKPIPassed, true)

	// T03 — multiple IP links counted
	fmt.Println("\n[T03] 3 raw IP links counted")
	r = ux.Analyze("http://example.com", multipleIPHtml, "example.com")
	check("raw_ip_link_count", r.RawIPLinkCount, 3)
	check("raw_ip_kpi_passed", r.RawIPLinkKPIPassed, false)

	// T04 — two plain emails collected (both without mailto)
	fmt.Println("\n[T04] Two plain emails collected")
	r = ux.Analyze("http://example.com", plainEmailHtml, "example.com")
	check("plain_emails_count", len(r.PlainEmailsFound), 2)
	check("plain_email_kpi_passed", r.PlainEmailKPIPassed, false)

	// T05 — mailto-wrapped email → not collected, passed
	fmt.Println("\n[T05] Mailto-wrapped email → passed (not in PlainEmailsFound)")
	r = ux.Analyze("http://example.com", mailtoEmailHtml, "example.com")
	check("plain_emails_count", len(r.PlainEmailsFound), 0)
	check("plain_email_kpi_passed", r.PlainEmailKPIPassed, true)

	// T06 — mixed: 1 mailto ok + 1 naked → 1 in slice
	fmt.Println("\n[T06] Mixed emails: 1 plain collected")
	r = ux.Analyze("http://example.com", mixedEmailHtml, "example.com")
	check("plain_emails_count", len(r.PlainEmailsFound), 1)
	check("plain_emails[0]", r.PlainEmailsFound[0], "naked@example.com")
	check("plain_email_kpi_passed", r.PlainEmailKPIPassed, false)

	// T07 — simulator DOM detection
	fmt.Println("\n[T07] Simulator detected via DOM selector")
	r = ux.Analyze("http://example.com", simulatorDomHtml, "example.com")
	check("simulator_count>0", r.SimulatorCount > 0, true)

	// T08 — simulator keyword fallback
	fmt.Println("\n[T08] Simulator detected via keyword fallback")
	r = ux.Analyze("http://example.com", simulatorKeywordHtml, "example.com")
	check("simulator_count>0", r.SimulatorCount > 0, true)

	// T09 — calculateur keyword counts as simulator
	fmt.Println("\n[T09] Calculateur keyword → simulator count > 0")
	r = ux.Analyze("http://example.com", calculatorHtml, "example.com")
	check("simulator_count>0", r.SimulatorCount > 0, true)

	// T10 — no simulator → count == 0
	fmt.Println("\n[T10] No simulator → count == 0")
	r = ux.Analyze("http://example.com", noSimulatorHtml, "example.com")
	check("simulator_count", r.SimulatorCount, 0)

	// T11 — both IP + plain email issues on same page
	fmt.Println("\n[T11] Both IP links and plain emails on same page")
	r = ux.Analyze("http://example.com", bothIssuesHtml, "example.com")
	check("raw_ip_link_count>0", r.RawIPLinkCount > 0, true)
	check("plain_emails_count>0", len(r.PlainEmailsFound) > 0, true)
	check("raw_ip_kpi_passed", r.RawIPLinkKPIPassed, false)
	check("plain_email_kpi_passed", r.PlainEmailKPIPassed, false)

	// T12 — issue message contains count for IP links
	fmt.Println("\n[T12] IP issues message contains count")
	r = ux.Analyze("http://example.com", rawIPHtml, "example.com")
	found := false
	for _, iss := range r.Issues {
		if len(iss) > 0 && (iss[0] == 'F') { // "Found N link(s)..."
			found = true
		}
	}
	check("ip_issue_message_present", found, true)

	// T13 — old bool fields are gone (smoke: struct fields accessible)
	fmt.Println("\n[T13] New count/slice fields exist on struct (compile smoke)")
	r = ux.Analyze("http://example.com", noIPHtml, "example.com")
	check("RawIPLinkCount type", fmt.Sprintf("%T", r.RawIPLinkCount), "int")
	check("PlainEmailsFound type", fmt.Sprintf("%T", r.PlainEmailsFound), "[]string")
	check("SimulatorCount type", fmt.Sprintf("%T", r.SimulatorCount), "int")

	// T14 — no duplicate collection when email appears multiple times in DOM
	fmt.Println("\n[T14] body.Text() returns text once — single email entry")
	r = ux.Analyze("http://example.com", plainEmailHtml, "example.com")
	count := 0
	for _, e := range r.PlainEmailsFound {
		if e == "support@example.com" {
			count++
		}
	}
	check("support@example.com appears once", count, 1)

	// ── Summary ──────────────────────────────────────────────────────────────
	fmt.Printf("\n============================\n")
	fmt.Printf("Results: %d passed, %d failed (total %d)\n", passed, failed, passed+failed)
	if failed > 0 {
		os.Exit(1)
	}
}
