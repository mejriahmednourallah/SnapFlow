package seo

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/PuerkitoBio/goquery"
)

func TestCheckSitemapUsesRobotsDeclaration(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("User-agent: *\nSitemap: /custom-sitemap.xml\n"))
		case "/custom-sitemap.xml":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<urlset></urlset>"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	if !CheckSitemap(srv.URL) {
		t.Fatalf("expected CheckSitemap to detect sitemap declared in robots.txt")
	}
}

func TestCheckRobotsTxtFollowsRedirect(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/robots.txt":
			http.Redirect(w, r, "/seo/robots.txt", http.StatusMovedPermanently)
		case "/seo/robots.txt":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("User-agent: *\nDisallow:\n"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	if !CheckRobotsTxt(srv.URL) {
		t.Fatalf("expected CheckRobotsTxt to follow redirects and return true")
	}
}

func TestExtractLinksCapturesUniqueExternalDomains(t *testing.T) {
	html := `
		<a href="https://www.google.com/maps">Maps</a>
		<a href="https://espaceclients.gat.com.tn/login">Client space</a>
		<a href="/contact">Contact</a>
	`

	info := extractLinks(html, "https://www.gatvie.com.tn/")
	if info.InternalLinks != 1 {
		t.Fatalf("expected 1 internal link, got %d", info.InternalLinks)
	}
	if info.ExternalLinks != 2 {
		t.Fatalf("expected 2 external links, got %d", info.ExternalLinks)
	}
	if len(info.ExternalDomains) != 2 {
		t.Fatalf("expected 2 unique external domains, got %v", info.ExternalDomains)
	}
}

func TestComputeContentHashLowQualityReturnsEmptyHash(t *testing.T) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(`<html><body><nav>Menu links</nav><footer>Footer</footer></body></html>`))
	if err != nil {
		t.Fatalf("failed to build document: %v", err)
	}

	info := computeContentHash(doc)
	if info.Hash != "" {
		t.Fatalf("expected empty hash for insufficient content, got %q", info.Hash)
	}
	if info.Method != "insufficient_content" {
		t.Fatalf("expected insufficient_content method, got %q", info.Method)
	}
}

func TestComputeContentHashMainContentHighConfidence(t *testing.T) {
	mainText := strings.Repeat("This is the main article content with meaningful words. ", 12)
	html := `<html><body><main>` + mainText + `</main></body></html>`
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		t.Fatalf("failed to build document: %v", err)
	}

	info := computeContentHash(doc)
	if info.Hash == "" {
		t.Fatalf("expected non-empty hash for rich main content")
	}
	if info.Method != "main_content" {
		t.Fatalf("expected main_content method, got %q", info.Method)
	}
	if info.Confidence < 0.9 {
		t.Fatalf("expected high confidence hash, got %.2f", info.Confidence)
	}
}
