package tech

import "testing"

func TestDrupalMajorVersionIsMarkedEOL(t *testing.T) {
	if !isCMSVersionEOL("drupal", "8") {
		t.Fatalf("expected Drupal 8 major-only version to be treated as EOL")
	}
	status, ok := lookupCMSSupport("drupal", "8")
	if !ok {
		t.Fatalf("expected Drupal support lookup to succeed")
	}
	if status != "end_of_life" {
		t.Fatalf("expected Drupal 8 support status to be end_of_life, got %q", status)
	}
}

func TestCollectModuleVersionsPrefersQueryParamAndIgnoresDrupalAggregatePathVersion(t *testing.T) {
	html := `
		<script src="/sites/default/files/js/js_bootstrap_8.9.20_hash.js"></script>
		<script src="/core/assets/vendor/jquery/jquery.min.js?ver=3.5.1"></script>
		<link href="/core/assets/vendor/bootstrap/bootstrap.min.css?ver=5.3.3" rel="stylesheet" />
	`

	versions := collectModuleVersions(html, nil)
	found := map[string]string{}
	for _, version := range versions {
		found[version.Name] = version.Version
	}

	if found["jQuery"] != "3.5.1" {
		t.Fatalf("expected jQuery query-param version 3.5.1, got %q", found["jQuery"])
	}
	if found["Bootstrap"] != "5.3.3" {
		t.Fatalf("expected Bootstrap query-param version 5.3.3, got %q", found["Bootstrap"])
	}
	for _, version := range versions {
		if version.Version == "8.9.20" {
			t.Fatalf("unexpected Drupal aggregate version leaked into module versions: %+v", version)
		}
	}
}
