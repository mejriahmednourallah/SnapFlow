package tui

import (
	"github.com/charmbracelet/lipgloss"
)

// color constants
const (
	ColorCyan       = "6"
	ColorGrey       = "8"
	ColorBackground = "#050505"
)

var (
	// Header Style
	HeaderStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color(ColorCyan)).
			Bold(true).
			Padding(1, 0)

	// Dashboard Layout Styles
	DashboardBoxStyle = lipgloss.NewStyle().
				Border(lipgloss.ThickBorder()).
				BorderForeground(lipgloss.Color(ColorCyan)).
				Padding(0, 2)

	MenuItemStyle = lipgloss.NewStyle().
			Padding(0, 1)

	ActiveMenuItemStyle = MenuItemStyle.Copy().
				Foreground(lipgloss.Color(ColorCyan)).
				Bold(true)

	// Footer Style (Strictly 1-line as per user requirement)
	FooterStyle = lipgloss.NewStyle().
			Background(lipgloss.Color(ColorCyan)).
			Foreground(lipgloss.Color("0")). // Black text on Cyan bg
			Padding(0, 1)

	// Stub Styles for buildability (Phase 1)
	TextPrimary = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorCyan))
	TextMuted   = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorGrey))
	TextSuccess = lipgloss.NewStyle().Foreground(lipgloss.Color("2"))
	TextWarning = lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	TextError   = lipgloss.NewStyle().Foreground(lipgloss.Color("1"))
	TextBold    = lipgloss.NewStyle().Bold(true)

	PanelStyle     = DashboardBoxStyle
	ActivePanel    = DashboardBoxStyle
	DashboardPanel = DashboardBoxStyle
)

func StatusDot(up bool) string { return "●" }
func KeyHints(hints map[string]string) string { return "" }
func Header(title, sub string, w int) string { return RenderHeader(w) }
func Separator(w int) string { return "" }

const SnapflowAscii = `
   _____                      ____  __               
  / ___/ ____   ____ _ ____  / __/ / /____  _      __
  \__ \ / __ \ / __ '// __ \/ /_  / // __ \| | /| / /
 ___/ // / / // /_/ // /_/ / __/ / // /_/ /| |/ |/ / 
/____//_/ /_/ \__,_// .___/_/   /_/ \____/ |__/|__/  
                   /_/                               
`

func RenderHeader(width int) string {
	return lipgloss.Place(width, 0, lipgloss.Center, lipgloss.Center,
		HeaderStyle.Render(SnapflowAscii),
	)
}

func RenderFooter(width int, text string) string {
	// User Requirement: Fixed 1-line persistent navigation bar
	return FooterStyle.Width(width).Render(text)
}

