package security

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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

func TestConfirmLoginTargetRejectsHomepageRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/login" {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		_, _ = w.Write([]byte(`<html><body>Homepage</body></html>`))
	}))
	defer server.Close()

	target, reason := confirmLoginTarget(server.URL+"/login", server.URL)
	if target.ActionURL != "" {
		t.Fatalf("expected redirected candidate to be rejected, got %#v", target)
	}
	if reason != "login_candidate_redirected_to_homepage" {
		t.Fatalf("expected homepage redirect reason, got %q", reason)
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
