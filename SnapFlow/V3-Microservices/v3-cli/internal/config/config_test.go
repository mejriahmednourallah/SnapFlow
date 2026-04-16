package config

import (
	"testing"
)

func TestConfigLoad_MissingFile(t *testing.T) {
	// Provide a path that definitely does not exist
	cfg, err := Load("/tmp/this/does/not/exist/snapflow.yaml")
	if err == nil {
		t.Errorf("Expected error loading from missing file, got nil")
	}
	// Config should not be nil even on error, it should return default
	if cfg == nil {
		t.Fatalf("Expected non-nil default fallback config, got nil")
	}
	if cfg.APIURL != "http://localhost:8080" {
		t.Errorf("Expected default APIURL, got %s", cfg.APIURL)
	}
}

func TestConfigValidate_MissingAPIURL(t *testing.T) {
	cfg := &Config{
		ScannerURL: "http://localhost:8081",
	}
	errs := cfg.Validate()
	if len(errs) != 1 {
		t.Fatalf("Expected exactly 1 validation error, got %d", len(errs))
	}
	if errs[0] != "api_url is required" {
		t.Errorf("Expected 'api_url is required', got '%s'", errs[0])
	}
}
