package browserutil

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/go-rod/rod/lib/launcher"
)

func ResolveBrowserBinary() (string, bool) {
	return resolveBrowserBinary(strings.TrimSpace(os.Getenv("CHROME_PATH")), launcher.LookPath, os.Stat, knownBrowserCandidates())
}

type lookPathFunc func() (string, bool)
type statFunc func(string) (os.FileInfo, error)

func resolveBrowserBinary(envPath string, lookPath lookPathFunc, stat statFunc, candidates []string) (string, bool) {
	if envPath != "" {
		if _, err := stat(envPath); err == nil {
			return envPath, true
		}
	}
	if path, found := lookPath(); found {
		if _, err := stat(path); err == nil {
			return path, true
		}
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if _, err := stat(candidate); err == nil {
			return candidate, true
		}
	}
	return "", false
}

func knownBrowserCandidates() []string {
	switch runtime.GOOS {
	case "windows":
		programFiles := []string{
			os.Getenv("ProgramFiles"),
			os.Getenv("ProgramFiles(x86)"),
		}
		localAppData := os.Getenv("LocalAppData")
		paths := make([]string, 0, 12)
		for _, root := range programFiles {
			if strings.TrimSpace(root) == "" {
				continue
			}
			paths = append(paths,
				filepath.Join(root, "Google", "Chrome", "Application", "chrome.exe"),
				filepath.Join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(root, "Chromium", "Application", "chrome.exe"),
				filepath.Join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
			)
		}
		if strings.TrimSpace(localAppData) != "" {
			paths = append(paths,
				filepath.Join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
				filepath.Join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(localAppData, "Chromium", "Application", "chrome.exe"),
				filepath.Join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
			)
		}
		return paths
	case "darwin":
		return []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		}
	default:
		return []string{
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/usr/bin/microsoft-edge",
			"/usr/bin/microsoft-edge-stable",
			"/usr/bin/brave-browser",
			"/snap/bin/chromium",
		}
	}
}
