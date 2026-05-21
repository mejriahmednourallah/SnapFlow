package functional

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnalyzeWithBaseURLExecutesSafeGetSearchProbe(t *testing.T) {
	var requestedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/search" {
			http.NotFound(w, r)
			return
		}
		requestedQuery = r.URL.Query().Get("q")
		_, _ = w.Write([]byte("<html><title>Search results</title><body>Results</body></html>"))
	}))
	defer server.Close()

	html := `<form action="/search" method="GET"><input type="search" name="q"></form>`
	result := AnalyzeWithBaseURL(server.URL, html)

	if !result.HasSearch {
		t.Fatal("expected search form to be detected")
	}
	if !result.SearchExecuted {
		t.Fatal("expected search probe to be executed")
	}
	if result.SearchPassed == nil || !*result.SearchPassed {
		t.Fatalf("expected passing search probe, got %#v", result.SearchPassed)
	}
	if requestedQuery != "snapflow-test" {
		t.Fatalf("expected safe query to be sent, got %q", requestedQuery)
	}
	if len(result.SearchTests) != 1 {
		t.Fatalf("expected one search test row, got %d", len(result.SearchTests))
	}
	row := result.SearchTests[0]
	if row.Status != "passed" || row.StatusCode != http.StatusOK || !row.Executed {
		t.Fatalf("unexpected search proof row: %#v", row)
	}
	if !strings.Contains(row.SearchURL, "q=snapflow-test") {
		t.Fatalf("expected search URL to include the tested query, got %q", row.SearchURL)
	}
}

func TestAnalyzeWithBaseURLSkipsUnsafePostSearchProbe(t *testing.T) {
	html := `<form action="/search" method="POST"><input type="search" name="q"></form>`
	result := AnalyzeWithBaseURL("https://example.com", html)

	if !result.HasSearch {
		t.Fatal("expected search form to be detected")
	}
	if result.SearchExecuted {
		t.Fatal("POST search form should not be executed by the safe backend probe")
	}
	if result.SearchPassed != nil {
		t.Fatalf("non-executed search probe should not set pass/fail, got %#v", result.SearchPassed)
	}
	if len(result.SearchTests) != 1 {
		t.Fatalf("expected one non-executed proof row, got %d", len(result.SearchTests))
	}
	if result.SearchTests[0].Status != "not_executed" {
		t.Fatalf("expected not_executed row, got %#v", result.SearchTests[0])
	}
}
