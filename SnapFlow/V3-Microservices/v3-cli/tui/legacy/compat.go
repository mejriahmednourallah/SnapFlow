package tui

import base "github.com/snapflow/v3-cli/tui"

const ColorPrimary = base.ColorCyan

var (
	TextPrimary = base.TextPrimary
	TextMuted   = base.TextMuted
	TextSuccess = base.TextSuccess
	TextWarning = base.TextWarning
	TextError   = base.TextError
	TextBold    = base.TextBold

	PanelStyle     = base.PanelStyle
	DashboardPanel = base.DashboardPanel
)

func StatusDot(up bool) string                { return base.StatusDot(up) }
func KeyHints(hints map[string]string) string { return base.KeyHints(hints) }
func Header(title, sub string, w int) string  { return base.Header(title, sub, w) }
func Separator(w int) string                  { return base.Separator(w) }

type legacyView string

const (
	BuildView   legacyView = "build"
	DeployView  legacyView = "deploy"
	MonitorView legacyView = "monitor"
)

type SwitchViewMsg struct {
	View legacyView
}
