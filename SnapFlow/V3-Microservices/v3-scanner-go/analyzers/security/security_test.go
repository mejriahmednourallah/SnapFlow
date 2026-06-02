package security

import "testing"

func TestFindLoginFormRejectsNewsletterFooter(t *testing.T) {
	html := `<form id="blockEmailSubscription_displayFooter" action="#blockEmailSubscription_displayFooter">
		<input type="email" name="email">
		<button>Subscribe</button>
	</form>`

	target, rejected := findLoginForm(html, "https://example.test")
	if target != "" {
		t.Fatalf("expected no login target, got %q", target)
	}
	if len(rejected) == 0 {
		t.Fatalf("expected newsletter candidate to be recorded as rejected")
	}
}

func TestFindLoginFormAcceptsPasswordLogin(t *testing.T) {
	html := `<form id="login" action="/account/login">
		<input type="email" name="email">
		<input type="password" name="password">
		<button>Login</button>
	</form>`

	target, _ := findLoginForm(html, "https://example.test")
	if target != "https://example.test/account/login" {
		t.Fatalf("expected password login target, got %q", target)
	}
}
