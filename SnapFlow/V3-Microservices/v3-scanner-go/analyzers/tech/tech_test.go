package tech

import (
	"net/http"
	"testing"
)

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

func TestDetectStackIgnoresDrupalAggregateVersionForBootstrap(t *testing.T) {
	html := `
		<link href="/sites/default/files/css/css_bootstrap_8.9.20_hash.css" rel="stylesheet" />
		<script src="/core/assets/vendor/jquery/jquery.min.js?ver=3.5.1"></script>
	`

	stack := DetectStack(html, &http.Header{})
	for _, tech := range stack {
		if tech.Name == "Bootstrap" && tech.Version == "8.9.20" {
			t.Fatalf("expected Drupal aggregate version not to be attributed to Bootstrap: %+v", tech)
		}
	}
}

func TestDetectStackUsesExactBootstrapAssetVersion(t *testing.T) {
	html := `<link href="/themes/custom/site/vendor/bootstrap-4.2.1.min.css" rel="stylesheet" />`

	stack := DetectStack(html, &http.Header{})
	for _, tech := range stack {
		if tech.Name == "Bootstrap" {
			if tech.Version != "4.2.1" {
				t.Fatalf("expected Bootstrap version 4.2.1, got %+v", tech)
			}
			return
		}
	}
	t.Fatalf("expected Bootstrap to be detected")
}

func TestBootstrapDoesNotInheritJQueryQueryVersion(t *testing.T) {
	html := `
		<script src="/core/assets/vendor/jquery/jquery.min.js?ver=3.7.3"></script>
		<link href="/themes/custom/site/vendor/bootstrap/bootstrap.min.css" rel="stylesheet" />
	`

	stack := DetectStack(html, &http.Header{})
	for _, tech := range stack {
		if tech.Name != "Bootstrap" {
			continue
		}
		if tech.Version != "" {
			t.Fatalf("expected Bootstrap version to stay empty without a Bootstrap-owned version source, got %+v", tech)
		}
		return
	}
	t.Fatalf("expected Bootstrap to be detected")
}

func TestBootstrapAcceptsOwnedQueryVersion(t *testing.T) {
	version, ok := extractModuleVersionFromAsset("/themes/custom/site/vendor/bootstrap/bootstrap.min.css?ver=4.2.1", "Bootstrap")
	if !ok {
		t.Fatalf("expected Bootstrap-owned query version to be accepted")
	}
	if version != "4.2.1" {
		t.Fatalf("expected Bootstrap version 4.2.1, got %q", version)
	}
}

func TestJQueryDoesNotInheritQueryVersionFromRelatedAssets(t *testing.T) {
	html := `
		<link href="/core/assets/vendor/jquery.ui/themes/base/theme.css?ver=4.3.0" rel="stylesheet" />
		<script src="/core/assets/vendor/jquery/jquery.min.js?ver=3.6.3"></script>
	`

	versions := collectModuleVersions(html, nil)
	found := map[string]string{}
	for _, version := range versions {
		found[version.Name] = version.Version
		if version.Name == "jQuery" && version.Version == "4.3.0" {
			t.Fatalf("unexpected jQuery version inherited from a related CSS asset: %+v", version)
		}
	}
	if found["jQuery"] != "3.6.3" {
		t.Fatalf("expected exact jQuery asset version 3.6.3, got %q", found["jQuery"])
	}
}
