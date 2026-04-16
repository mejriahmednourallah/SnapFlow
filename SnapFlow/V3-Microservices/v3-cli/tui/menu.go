package tui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/locale"
)

// MenuItem represents a single choice in the dashboard
type MenuItem struct {
	Label       string
	Description string
	Target      ScreenID
}

// MenuModel is the main dashboard view
type MenuModel struct {
	items  []MenuItem
	cursor int
	width  int
	height int
}

func NewMenuModel() MenuModel {
	return MenuModel{
		items: []MenuItem{
			{Label: locale.MenuScanLabel, Description: locale.MenuScanDesc, Target: ScreenID("scan")},
			{Label: locale.MenuBuildLabel, Description: locale.MenuBuildDesc, Target: ScreenID("build")},
			{Label: locale.MenuDeployLabel, Description: locale.MenuDeployDesc, Target: ScreenID("deploy")},
			{Label: locale.MenuMonitorLabel, Description: locale.MenuMonitorDesc, Target: ScreenID("monitor")},
		},
	}
}

func (m MenuModel) Init() tea.Cmd { return nil }

func (m MenuModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			} else {
				m.cursor = len(m.items) - 1
			}
		case "down", "j":
			if m.cursor < len(m.items)-1 {
				m.cursor++
			} else {
				m.cursor = 0
			}
		case "enter":
			return m, func() tea.Msg {
				return NavigationMsg{Target: m.items[m.cursor].Target}
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	return m, nil
}

func (m MenuModel) View() string {
	var sections []string

	for i, item := range m.items {
		var card string
		isSelected := i == m.cursor

		// Label & Description Rendering
		label := item.Label
		if isSelected {
			label = "> " + label
		} else {
			label = "  " + label
		}

		labelStyle := TextBold
		if isSelected {
			labelStyle = labelStyle.Copy().Foreground(lipgloss.Color(ColorCyan))
		}

		descStyle := TextMuted
		
		content := lipgloss.JoinVertical(lipgloss.Left,
			labelStyle.Render(label),
			descStyle.Render("    "+item.Description),
		)

		// Card Border Logic
		borderStyle := lipgloss.NewStyle().
			Border(lipgloss.ThickBorder()).
			Width(40).
			Padding(0, 1)

		if isSelected {
			borderStyle = borderStyle.BorderForeground(lipgloss.Color(ColorCyan))
		} else {
			borderStyle = borderStyle.BorderForeground(lipgloss.Color(ColorGrey))
		}

		card = borderStyle.Render(content)
		sections = append(sections, card)
	}

	// Join all cards with spacing
	menuBlock := lipgloss.JoinVertical(lipgloss.Center, sections...)
	
	// Center the menu block in the available area
	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, menuBlock)
}
