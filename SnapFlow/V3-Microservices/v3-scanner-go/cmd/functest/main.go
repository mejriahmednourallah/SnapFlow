package main

import (
	"fmt"
	"os"

	"snapflow/v3-scanner-go/analyzers/functional"
)

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────

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

// ──────────────────────────────────────────────
// HTML fixtures
// ──────────────────────────────────────────────

const rdvForm = `<html><body>
<form action="/rdv" method="POST">
  <input type="text" name="nom" />
  <input type="date" name="date_rendez-vous" />
  <textarea name="motif">Prendre rendez-vous</textarea>
  <button>Confirmer</button>
</form>
</body></html>`

const rdvAppointmentForm = `<html><body>
<form action="/book" method="POST">
  <input type="text" name="name" />
  <select name="slot"></select>
  <button>Book appointment</button>
</form>
</body></html>`

const rdvReservationForm = `<html><body>
<form action="/reserver" method="POST">
  <input type="text" name="nom" />
  <select name="creneau"></select>
  <input type="hidden" name="type" value="réservation" />
</form>
</body></html>`

const contactForm = `<html><body>
<form action="/contact" method="POST">
  <input type="text" name="nom" />
  <textarea name="message"></textarea>
  <button>Envoyer</button>
</form>
</body></html>`

const contactAndRDVForms = `<html><body>
<form action="/contact" method="POST">
  <input type="text" name="nom" />
  <textarea name="message"></textarea>
</form>
<form action="/rendez-vous" method="POST">
  <input type="date" name="date" />
  <textarea name="motif">rdv</textarea>
</form>
</body></html>`

const searchForm = `<html><body>
<form action="/search" method="GET">
  <input type="search" name="q" />
  <button>Search</button>
</form>
</body></html>`

const noForms = `<html><body><p>Aucun formulaire ici.</p></body></html>`

const loginForm = `<html><body>
<form action="/login" method="POST">
  <input type="text" name="username" />
  <input type="password" name="password" />
  <button>Connexion</button>
</form>
</body></html>`

const newsletterForm = `<html><body>
<form class="newsletter" action="/subscribe" method="POST">
  <input type="email" name="email" />
  <button>S'abonner</button>
</form>
</body></html>`

const prisonAppointmentForm = `<html><body>
<form action="/prise-rendez-vous" method="POST">
  <input type="text" name="nom" />
  <input type="date" name="date" />
  <button>Valider</button>
</form>
</body></html>`

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

func main() {
	fmt.Println("=== Phase D: Functional / RDV Form Detection Tests ===")

	// T01 — basic rdv keyword
	fmt.Println("\n[T01] RDV keyword in date field name")
	r := functional.Analyze(rdvForm)
	check("has_rdv", r.HasRDV, true)
	check("has_contact", r.HasContact, false) // must NOT be classified as contact
	check("passed", r.Passed, true)

	// T02 — "book appointment"
	fmt.Println("\n[T02] Book appointment keyword")
	r = functional.Analyze(rdvAppointmentForm)
	check("has_rdv", r.HasRDV, true)
	check("has_contact", r.HasContact, false)
	check("passed", r.Passed, true)

	// T03 — réservation keyword
	fmt.Println("\n[T03] Réservation keyword")
	r = functional.Analyze(rdvReservationForm)
	check("has_rdv", r.HasRDV, true)
	check("passed", r.Passed, true)

	// T04 — contact form (no rdv)
	fmt.Println("\n[T04] Contact form (no RDV)")
	r = functional.Analyze(contactForm)
	check("has_contact", r.HasContact, true)
	check("has_rdv", r.HasRDV, false)
	check("passed", r.Passed, true)

	// T05 — both contact + rdv forms
	fmt.Println("\n[T05] Both contact and RDV forms")
	r = functional.Analyze(contactAndRDVForms)
	check("has_contact", r.HasContact, true)
	check("has_rdv", r.HasRDV, true)
	check("total_forms", r.TotalForms, 2)
	check("passed", r.Passed, true)

	// T06 — search only → passed=false (no interaction form)
	fmt.Println("\n[T06] Search form only → passed=false")
	r = functional.Analyze(searchForm)
	check("has_search", r.HasSearch, true)
	check("has_contact", r.HasContact, false)
	check("has_rdv", r.HasRDV, false)
	check("passed", r.Passed, false)

	// T07 — no forms → passed=false
	fmt.Println("\n[T07] No forms → passed=false")
	r = functional.Analyze(noForms)
	check("total_forms", r.TotalForms, 0)
	check("passed", r.Passed, false)

	// T08 — login form only → passed=false
	fmt.Println("\n[T08] Login form only → passed=false")
	r = functional.Analyze(loginForm)
	check("has_login", r.HasLogin, true)
	check("has_contact", r.HasContact, false)
	check("has_rdv", r.HasRDV, false)
	check("passed", r.Passed, false)

	// T09 — newsletter only → passed=false
	fmt.Println("\n[T09] Newsletter form only → passed=false")
	r = functional.Analyze(newsletterForm)
	check("has_newsletter", r.HasNewsletter, true)
	check("passed", r.Passed, false)

	// T10 — "prise de rendez" keyword (accentless path)
	fmt.Println("\n[T10] Prise de rendez-vous URL path keyword")
	r = functional.Analyze(prisonAppointmentForm)
	check("has_rdv", r.HasRDV, true)
	check("passed", r.Passed, true)

	// T11 — service name always set
	fmt.Println("\n[T11] ServiceName constant")
	r = functional.Analyze(noForms)
	check("service_name", r.ServiceName, "v3-functional-analyzer-go")

	// T12 — issues recorded when no search
	fmt.Println("\n[T12] Issue recorded when no search form")
	r = functional.Analyze(contactForm) // contact only, no search
	hasIssue := false
	for _, iss := range r.Issues {
		if iss == "No search form detected" {
			hasIssue = true
		}
	}
	check("issue:no_search", hasIssue, true)

	// T13 — issues NOT recorded when search present but no contact
	fmt.Println("\n[T13] No 'no search' issue when search is present")
	r = functional.Analyze(searchForm)
	hasNoSearchIssue := false
	for _, iss := range r.Issues {
		if iss == "No search form detected" {
			hasNoSearchIssue = true
		}
	}
	check("no_search_issue_absent", hasNoSearchIssue, false)

	// T14 — "prendre rendez" phrase
	fmt.Println("\n[T14] 'Prendre rendez' phrase detection")
	html := `<form action="/contact-us" method="POST">
	  <p>Vous pouvez prendre rendez en ligne.</p>
	  <input type="text" name="date"/>
	</form>`
	r = functional.Analyze(html)
	check("has_rdv", r.HasRDV, true)
	check("has_contact", r.HasContact, false)

	// ── Summary ──────────────────────────────────
	fmt.Printf("\n============================\n")
	fmt.Printf("Results: %d passed, %d failed (total %d)\n", passed, failed, passed+failed)
	if failed > 0 {
		os.Exit(1)
	}
}
