package main

import (
	"reflect"
	"testing"
)

func TestSanitizeDomainsUsesHostnamesForPortTargets(t *testing.T) {
	got := sanitizeDomains([]string{"preprod-fixture:18991", "https://EXAMPLE.com:8443/path", "example.com", "[::1]:8080", "::1"})
	want := []string{"preprod-fixture", "example.com", "::1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("domain scope must contain hostnames, got %v", got)
	}
	if !isHostAllowedForCrawl("preprod-fixture", got) || isHostAllowedForCrawl("outside.test", got) {
		t.Fatal("explicit port target must be in scope without admitting another host")
	}
}

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
