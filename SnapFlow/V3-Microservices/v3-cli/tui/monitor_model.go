package tui

import (
	"fmt"
	"math/rand"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/state"
)

// MonitorModel implements the advanced dual-panel dashboard with adaptive layout
type MonitorModel struct {
	controller *state.StateController
	width      int
	height     int
	lastUpdate time.Time
}

type monitorTickMsg time.Time

func NewMonitorModel(controller *state.StateController) MonitorModel {
	return MonitorModel{
		controller: controller,
	}
}

func (m MonitorModel) Init() tea.Cmd {
	return m.tick()
}

func (m MonitorModel) tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return monitorTickMsg(t)
	})
}

func (m MonitorModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case monitorTickMsg:
		m.lastUpdate = time.Time(msg)
		// Update some simulated values in the controller
		m.controller.SetVar("cpu_usage", fmt.Sprintf("%.1f%%", 5.0+rand.Float64()*15.0))
		m.controller.SetVar("mem_usage", fmt.Sprintf("%d MB", 120+rand.Intn(40)))
		return m, m.tick()

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}

	return m, nil
}

func (m MonitorModel) View() string {
	if m.width == 0 {
		return "Initialiazing Monitor..."
	}

	// 1. Service Status Panel (Left)
	services := []struct {
		name string
		up   bool
	}{
		{"V3-SCANNER", true},
		{"V3-AGGREGATOR", true},
		{"V3-NLP-WORKER", rand.Intn(10) > 1},
		{"V3-VISUAL-REG", true},
	}

	var statusLines []string
	for _, s := range services {
		dot := "●"
		dotStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("2")) // Green
		if !s.up {
			dotStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("1")) // Red
		}
		
		line := fmt.Sprintf("%s %-15s %s", dotStyle.Render(dot), TextBold.Render(s.name), TextMuted.Render("ONLINE"))
		if !s.up {
			line = fmt.Sprintf("%s %-15s %s", dotStyle.Render(dot), TextBold.Render(s.name), TextError.Render("OFFLINE"))
		}
		statusLines = append(statusLines, line)
	}

	leftPanelContent := lipgloss.JoinVertical(lipgloss.Left, statusLines...)
	leftPanel := lipgloss.NewStyle().
		Border(lipgloss.ThickBorder()).
		BorderForeground(lipgloss.Color(ColorCyan)).
		Padding(1, 2).
		Width(40).
		Render(lipgloss.JoinVertical(lipgloss.Left, 
			TextBold.Render("CORE MICROSERVICES"),
			"",
			leftPanelContent,
		))

	// 2. Resource Panel (Right) - Hides below 80 columns
	var finalView string
	if m.width >= 80 {
		cpu := m.controller.GetVar("cpu_usage")
		mem := m.controller.GetVar("mem_usage")
		
		rightPanelContent := lipgloss.JoinVertical(lipgloss.Left,
			fmt.Sprintf("%-12s %s", TextMuted.Render("CPU LOAD:"), TextPrimary.Render(cpu)),
			fmt.Sprintf("%-12s %s", TextMuted.Render("MEMORY:"), TextPrimary.Render(mem)),
			"",
			TextMuted.Render("Last Refreshed:"),
			TextMuted.Render(m.lastUpdate.Format("15:04:05")),
		)
		
		rightPanel := lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color(ColorGrey)).
			Padding(1, 2).
			Width(30).
			Render(lipgloss.JoinVertical(lipgloss.Left,
				TextBold.Render("SYSTEM RESOURCES"),
				"",
				rightPanelContent,
			))
			
		finalView = lipgloss.JoinHorizontal(lipgloss.Top, leftPanel, "  ", rightPanel)
	} else {
		finalView = leftPanel
	}

	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, finalView)
}
