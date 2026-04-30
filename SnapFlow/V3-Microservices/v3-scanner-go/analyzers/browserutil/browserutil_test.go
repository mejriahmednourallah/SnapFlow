package browserutil

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestResolveBrowserBinaryPrefersConfiguredPath(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "chrome.exe")
	if err := os.WriteFile(bin, []byte("stub"), 0o600); err != nil {
		t.Fatalf("write temp browser: %v", err)
	}

	path, found := resolveBrowserBinary(bin, func() (string, bool) {
		return "", false
	}, os.Stat, nil)
	if !found || path != bin {
		t.Fatalf("expected configured path %q to win, got (%q, %v)", bin, path, found)
	}
}

func TestResolveBrowserBinaryFallsBackToKnownCandidates(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "msedge.exe")
	if err := os.WriteFile(bin, []byte("stub"), 0o600); err != nil {
		t.Fatalf("write temp browser: %v", err)
	}

	path, found := resolveBrowserBinary("", func() (string, bool) {
		return "", false
	}, os.Stat, []string{bin})
	if !found || path != bin {
		t.Fatalf("expected candidate path %q to be used, got (%q, %v)", bin, path, found)
	}
}

func TestKnownBrowserCandidatesIncludeEdgeOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-specific candidate coverage")
	}

	candidates := knownBrowserCandidates()
	found := false
	for _, candidate := range candidates {
		if strings.HasSuffix(strings.ToLower(candidate), `microsoft\edge\application\msedge.exe`) {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected Windows browser candidates to include Microsoft Edge")
	}
}
