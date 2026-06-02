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

func TestRobotsTxtPrestashopStandardDisallowsAreNotDisclosure(t *testing.T) {
	robots := `User-agent: *
Disallow: /cache/
Disallow: /classes/
Disallow: /config/
Disallow: /controllers/
Disallow: /img/
Disallow: /modules/
Disallow: /themes/
Disallow: /translations/`

	result := checkRobotsTxtInfoDisclosure(robots)
	if result.Status != "pass" {
		t.Fatalf("expected standard PrestaShop robots paths to pass, got status %q with paths %#v", result.Status, result.DisclosedPaths)
	}
	if len(result.DisclosedPaths) != 0 {
		t.Fatalf("expected no disclosed paths, got %#v", result.DisclosedPaths)
	}
}

func TestRobotsTxtStillFlagsNonStandardSensitivePath(t *testing.T) {
	robots := `User-agent: *
Disallow: /cache/
Disallow: /classes/
Disallow: /modules/
Disallow: /private/`

	result := checkRobotsTxtInfoDisclosure(robots)
	if result.Status != "warning" {
		t.Fatalf("expected sensitive non-standard path to warn, got %q", result.Status)
	}
	if len(result.DisclosedPaths) != 1 || result.DisclosedPaths[0] != "/private/" {
		t.Fatalf("expected /private/ disclosed, got %#v", result.DisclosedPaths)
	}
}
