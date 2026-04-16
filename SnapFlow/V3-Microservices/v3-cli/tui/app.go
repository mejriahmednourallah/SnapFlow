package tui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/state"
	"github.com/snapflow/v3-cli/locale"
)

// RootModel is the central orchestrator (PentAGI Pattern)
type RootModel struct {
	stack      []tea.Model
	controller *state.StateController
	width      int
	height     int
}

func NewRootModel(controller *state.StateController) RootModel {
	return RootModel{
		stack:      []tea.Model{NewMenuModel()},
		controller: controller,
	}
}

func (m RootModel) Init() tea.Cmd {
	if len(m.stack) > 0 {
		return m.stack[len(m.stack)-1].Init()
	}
	return nil
}

func (m RootModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, tea.Quit
		case "esc":
			if len(m.stack) > 1 {
				m.stack = m.stack[:len(m.stack)-1]
				// After popping, we might need to trigger an Init or just rely on Update
				return m, m.Init()
			}
		}

	case NavigationMsg:
		if msg.GoBack {
			if len(m.stack) > 1 {
				m.stack = m.stack[:len(m.stack)-1]
				return m, m.Init()
			}
		} else {
			var newModel tea.Model
			switch msg.Target.GetScreen() {
			case string(ScreenDeploy):
				newModel = NewDeployModel(m.controller)
			case string(ScreenScan):
				newModel = NewScanModel()
			case string(ScreenMonitor):
				newModel = NewMonitorModel(m.controller)
			default:
				newModel = NewPlaceholderModel("Module: " + string(msg.Target))
			}
			
			m.stack = append(m.stack, newModel)
			
			// Ensure the new model gets the current window size immediately
			if m.width > 0 && m.height > 0 {
				var cmd tea.Cmd
				newModel, cmd = newModel.Update(tea.WindowSizeMsg{Width: m.width, Height: m.height})
				m.stack[len(m.stack)-1] = newModel
				return m, tea.Batch(newModel.Init(), cmd)
			}
			return m, newModel.Init()
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		// Pass to all models in stack? Usually just the active one is enough, 
		// but passing to top ensures it resizes.
		if len(m.stack) > 0 {
			var cmd tea.Cmd
			top := len(m.stack) - 1
			m.stack[top], cmd = m.stack[top].Update(msg)
			cmds = append(cmds, cmd)
		}
		return m, tea.Batch(cmds...)
	}

	// Delegate to top of stack
	if len(m.stack) > 0 {
		var cmd tea.Cmd
		top := len(m.stack) - 1
		m.stack[top], cmd = m.stack[top].Update(msg)
		cmds = append(cmds, cmd)
	}

	return m, tea.Batch(cmds...)
}

func (m RootModel) View() string {
	if m.width == 0 || m.height == 0 {
		return locale.MsgLoading
	}

	// 1. Header
	header := lipgloss.JoinVertical(lipgloss.Center,
		RenderHeader(m.width),
		TextMuted.Render(locale.AppSubtitle),
	)
	header = lipgloss.NewStyle().Width(m.width).Align(lipgloss.Center).Padding(1, 0).Render(header)

	// 2. Footer (Strictly 1-line background/padding approach)
	footer := lipgloss.NewStyle().
		Width(m.width).
		Background(lipgloss.Color(ColorCyan)).
		Foreground(lipgloss.Color("0")).
		Padding(0, 1).
		Render(locale.FooterNav)

	// 3. Content Area Calculation
	headerHeight := lipgloss.Height(header)
	footerHeight := lipgloss.Height(footer)
	contentHeight := m.height - headerHeight - footerHeight

	var content string
	if len(m.stack) > 0 {
		content = m.stack[len(m.stack)-1].View()
	} else {
		content = "Empty Navigation Stack"
	}

	contentArea := lipgloss.NewStyle().
		Height(contentHeight).
		Width(m.width).
		Align(lipgloss.Center, lipgloss.Center).
		Render(content)

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		contentArea,
		footer,
	)
}

// PlaceholderModel for verify execution
type PlaceholderModel struct {
	text string
}

func NewPlaceholderModel(t string) PlaceholderModel {
	return PlaceholderModel{text: t}
}

func (p PlaceholderModel) Init() tea.Cmd { return nil }
func (p PlaceholderModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	return p, nil
}
func (p PlaceholderModel) View() string {
	return TextBold.Render(p.text)
}
