package tui

import "strings"

// ScreenID is a composite string type (base§arg) for navigation
type ScreenID string

const (
	ScreenMain    ScreenID = "main"
	ScreenMonitor ScreenID = "monitor"
	ScreenBuild   ScreenID = "build"
	ScreenDeploy  ScreenID = "deploy"
	ScreenScan    ScreenID = "scan"
)

// GetScreen returns the base part of the ScreenID
func (s ScreenID) GetScreen() string {
	parts := strings.Split(string(s), "§")
	return parts[0]
}

// GetArgs returns everything after the § separator as a slice
func (s ScreenID) GetArgs() []string {
	parts := strings.Split(string(s), "§")
	if len(parts) > 1 {
		return parts[1:]
	}
	return nil
}

// NavigationMsg is sent to the RootModel to trigger screen changes
type NavigationMsg struct {
	Target  ScreenID
	GoBack  bool
	Reset   bool // If true, clear stack
}
