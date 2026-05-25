package main

import "testing"

func TestExpandAllowedDomainsForCanonicalRedirect(t *testing.T) {
	allowed := []string{"albarakabank.com.tn", "www.albarakabank.com.tn"}
	expanded, changed, fromHost, toHost := expandAllowedDomainsForCanonicalRedirect(
		allowed,
		"https://www.albarakabank.com.tn/fr",
		"https://www.albaraka.com.tn/fr",
	)

	if !changed {
		t.Fatal("expected canonical redirect to expand allowed domains")
	}
	if fromHost != "www.albarakabank.com.tn" || toHost != "www.albaraka.com.tn" {
		t.Fatalf("unexpected redirect hosts: %q -> %q", fromHost, toHost)
	}
	if !isHostAllowedForCrawl("www.albaraka.com.tn", expanded) {
		t.Fatalf("expected redirected host to be allowed, got %v", expanded)
	}
	if !isHostAllowedForCrawl("albaraka.com.tn", expanded) {
		t.Fatalf("expected redirected base host to be allowed, got %v", expanded)
	}
}

func TestExpandAllowedDomainsForCanonicalRedirectRejectsLocalhost(t *testing.T) {
	allowed := []string{"example.com", "www.example.com"}
	expanded, changed, _, _ := expandAllowedDomainsForCanonicalRedirect(
		allowed,
		"https://www.example.com",
		"http://localhost:8080/admin",
	)

	if changed {
		t.Fatalf("did not expect unsafe redirect host to expand scope: %v", expanded)
	}
}
