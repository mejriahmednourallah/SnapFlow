package tui

import (
	"github.com/charmbracelet/bubbles/textinput"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/state"
)

// DeployModel implements a complex form with auto-scrolling
type DeployModel struct {
	controller   *state.StateController
	inputs       []textinput.Model
	focusedIndex int
	viewport     viewport.Model
	width        int
	height       int
}

const (
	deployArgToken = "deploy_token"
	deployArgPort  = "deploy_port"
	deployArgEnv   = "deploy_env"
)

func NewDeployModel(controller *state.StateController) DeployModel {
	inputs := make([]textinput.Model, 3)
	
	// API Token
	inputs[0] = textinput.New()
	inputs[0].Placeholder = "Enter token"
	inputs[0].EchoMode = textinput.EchoPassword
	inputs[0].Focus()
	inputs[0].SetValue(controller.GetVar(deployArgToken))

	// Target Port
	inputs[1] = textinput.New()
	inputs[1].Placeholder = "e.g., 8080"
	inputs[1].SetValue(controller.GetVar(deployArgPort))

	// Environment
	inputs[2] = textinput.New()
	inputs[2].Placeholder = "production or staging"
	inputs[2].SetValue(controller.GetVar(deployArgEnv))

	return DeployModel{
		controller: controller,
		inputs:     inputs,
		viewport:   viewport.New(0, 0),
	}
}

func (m DeployModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m DeployModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "tab", "shift+tab", "up", "down":
			s := msg.String()
			if s == "up" || s == "shift+tab" {
				m.focusedIndex--
			} else {
				m.focusedIndex++
			}

			if m.focusedIndex < 0 {
				m.focusedIndex = len(m.inputs) - 1
			} else if m.focusedIndex >= len(m.inputs) {
				m.focusedIndex = 0
			}

			for i := 0; i < len(m.inputs); i++ {
				if i == m.focusedIndex {
					cmds = append(cmds, m.inputs[i].Focus())
				} else {
					m.inputs[i].Blur()
				}
			}

			// Auto-Scroll Math
			// Each input block is roughly 4 lines (label + input + spacing)
			inputHeight := 4
			currTop := m.focusedIndex * inputHeight
			currBot := currTop + inputHeight

			if currTop < m.viewport.YOffset {
				m.viewport.SetYOffset(currTop)
			} else if currBot > m.viewport.YOffset+m.viewport.Height {
				m.viewport.SetYOffset(currBot - m.viewport.Height)
			}

		case "enter":
			if m.focusedIndex == len(m.inputs)-1 {
				// Save and go back
				m.controller.SetVar(deployArgToken, m.inputs[0].Value())
				m.controller.SetVar(deployArgPort, m.inputs[1].Value())
				m.controller.SetVar(deployArgEnv, m.inputs[2].Value())
				
				return m, func() tea.Msg {
					return NavigationMsg{GoBack: true}
				}
			}
			// Move to next field
			m.focusedIndex++
			if m.focusedIndex >= len(m.inputs) {
				m.focusedIndex = 0
			}
			for i := 0; i < len(m.inputs); i++ {
				if i == m.focusedIndex {
					cmds = append(cmds, m.inputs[i].Focus())
				} else {
					m.inputs[i].Blur()
				}
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		// Header/Footer overhead is roughly 10 lines
		m.height = msg.Height - 10
		if m.height < 0 {
			m.height = 0
		}
		m.viewport.Width = m.width
		m.viewport.Height = m.height
	}

	// Update the focused input
	var cmd tea.Cmd
	m.inputs[m.focusedIndex], cmd = m.inputs[m.focusedIndex].Update(msg)
	cmds = append(cmds, cmd)

	// Refresh viewport content
	m.viewport.SetContent(m.renderForm())
	
	return m, tea.Batch(cmds...)
}

func (m DeployModel) renderForm() string {
	var sections []string
	labels := []string{"PINGGY API TOKEN", "TARGET PORT", "ENVIRONMENT"}

	for i, input := range m.inputs {
		labelStyle := TextBold
		if i == m.focusedIndex {
			labelStyle = labelStyle.Copy().Foreground(lipgloss.Color(ColorCyan))
		}

		field := lipgloss.JoinVertical(lipgloss.Left,
			labelStyle.Render(labels[i]),
			input.View(),
			"", // Spacing
		)
		sections = append(sections, field)
	}

	return lipgloss.JoinVertical(lipgloss.Left, sections...)
}

func (m DeployModel) View() string {
	return lipgloss.NewStyle().
		Padding(1, 2).
		Render(m.viewport.View())
}
