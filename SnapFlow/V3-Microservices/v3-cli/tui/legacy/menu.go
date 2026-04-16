package tui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/api"
	"github.com/snapflow/v3-cli/internal/config"
)

type MenuModel struct {
	choices []menuItem
	cursor  int
	width   int
	height  int
	config  *config.Config
	apiUp   bool
	apiMsg  string
}

type menuItem struct {
	key   string
	label string
	desc  string
}

type apiStatusMsg struct {
	up  bool
	err error
}

func checkAPI(url string) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		client := api.NewClient(url)
		up, err := client.Ping(ctx)
		return apiStatusMsg{up: up, err: err}
	}
}

func NewMenuModel(cfg *config.Config) MenuModel {
	return MenuModel{
		config: cfg,
		choices: []menuItem{
			{key: "1", label: "Scan", desc: "Launch a scan"},
			{key: "2", label: "Build", desc: "Build with flags"},
			{key: "3", label: "Deploy", desc: "Pinggy tunnel"},
			{key: "4", label: "Monitor", desc: "Live dashboard"},
		},
		apiMsg: "checking...",
	}
}

func (m MenuModel) Init() tea.Cmd {
	return checkAPI(m.config.APIURL)
}

func (m MenuModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.choices)-1 {
				m.cursor++
			}
		case "1", "2", "3", "4":
			return m, m.handleSelection(msg.String())
		case "enter":
			return m, m.handleSelection(m.choices[m.cursor].key)
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	case apiStatusMsg:
		m.apiUp = msg.up
		if msg.err != nil {
			m.apiMsg = "down"
		} else {
			m.apiMsg = "up"
		}
	}
	return m, nil
}

func (m MenuModel) View() string {
	if m.width == 0 {
		return "Initializing..."
	}

	// Choices inside a cohesive list
	var choices strings.Builder
	for i, choice := range m.choices {
		prefix := "  "
		style := TextPrimary
		if m.cursor == i {
			prefix = TextPrimary.Bold(true).Render("▶ ")
			style = TextBold.Foreground(lipgloss.Color(ColorPrimary))
		}

		label := style.Render(fmt.Sprintf("%s %-12s", choice.key, choice.label))
		desc := TextMuted.Render(choice.desc)
		
		choices.WriteString(fmt.Sprintf("%s%s %s\n", prefix, label, desc))
	}

	// Wrap in DashboardPanel
	panel := DashboardPanel.
		Width(m.width / 2).
		Render(choices.String())

	// Full view assembly
	doc := lipgloss.JoinVertical(lipgloss.Center,
		Header("SnapFlow", "Developer Console", m.width),
		lipgloss.NewStyle().PaddingTop(2).Render(panel),
		lipgloss.NewStyle().PaddingTop(2).Render(KeyHints(map[string]string{
			"↑/↓": "Navigate",
			"Enter": "Select",
			"Esc": "Back",
			"^C": "Exit",
		})),
	)

	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, doc)
}

func (m MenuModel) handleSelection(key string) tea.Cmd {
	return func() tea.Msg {
		switch key {
		case "2":
			return SwitchViewMsg{View: BuildView}
		case "3":
			return SwitchViewMsg{View: DeployView}
		case "4":
			return SwitchViewMsg{View: MonitorView}
		}
		return nil
	}
}
