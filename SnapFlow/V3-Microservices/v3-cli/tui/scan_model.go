package tui

import (
	"context"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Custom message types for background execution
type logMsg string
type scanDoneMsg struct{}

// ScanModel handles live feedback for background processes
type ScanModel struct {
	spinner  spinner.Model
	viewport viewport.Model
	logs     []string
	isDone   bool
	width    int
	height   int
	msgChan  chan tea.Msg
	ctx      context.Context
	cancel   context.CancelFunc
}

func NewScanModel() ScanModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color(ColorCyan))

	ctx, cancel := context.WithCancel(context.Background())

	return ScanModel{
		spinner:  s,
		viewport: viewport.New(0, 0),
		logs:     []string{},
		msgChan:  make(chan tea.Msg, 100), // Buffered to prevent leaks
		ctx:      ctx,
		cancel:   cancel,
	}
}

func (m ScanModel) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		m.simulateScan(),
		m.waitForActivity(),
	)
}

func (m ScanModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "esc":
			m.cancel() // Kill the background goroutine
			return m, func() tea.Msg {
				return NavigationMsg{GoBack: true}
			}
		case "enter":
			if m.isDone {
				return m, func() tea.Msg {
					return NavigationMsg{GoBack: true}
				}
			}
		}

	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd

	case logMsg:
		m.logs = append(m.logs, string(msg))
		m.viewport.SetContent(strings.Join(m.logs, "\n"))
		m.viewport.GotoBottom()
		return m, m.waitForActivity()

	case scanDoneMsg:
		m.isDone = true
		return m, nil

	case tea.WindowSizeMsg:
		m.width = msg.Width
		// Overhead for header/footer
		m.height = msg.Height - 10
		if m.height < 0 {
			m.height = 0
		}
		m.viewport.Width = m.width
		m.viewport.Height = m.height
	}

	return m, nil
}

func (m ScanModel) View() string {
	var header string
	if !m.isDone {
		header = lipgloss.JoinHorizontal(lipgloss.Left,
			m.spinner.View(),
			" ",
			TextBold.Render("SYSTEM SCAN IN PROGRESS..."),
		)
	} else {
		header = TextSuccess.Copy().Bold(true).Render("✔ SCAN COMPLETE!")
	}

	content := lipgloss.JoinVertical(lipgloss.Left,
		header,
		"",
		m.viewport.View(),
	)

	if m.isDone {
		content = lipgloss.JoinVertical(lipgloss.Left,
			content,
			"",
			TextMuted.Render("Press [Enter] to return to Dashboard"),
		)
	} else {
		content = lipgloss.JoinVertical(lipgloss.Left,
			content,
			"",
			TextMuted.Render("Press [Esc] to cancel scan"),
		)
	}

	return lipgloss.NewStyle().
		Padding(1, 4).
		Render(content)
}

// simulateScan background process emulator using a goroutine with context awareness
func (m ScanModel) simulateScan() tea.Cmd {
	return func() tea.Msg {
		go func() {
			steps := []string{
				"  » Connecting to V3-Aggregator...",
				"  » Initializing NLP worker cluster...",
				"  » Crawling target URL components...",
				"  » Analyzing visual regression buffers...",
				"  » Finalizing audit report...",
			}

			for _, step := range steps {
				select {
				case <-m.ctx.Done():
					return // Abandon ship!
				case <-time.After(1200 * time.Millisecond):
					m.msgChan <- logMsg(step)
				}
			}

			select {
			case <-m.ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
				m.msgChan <- scanDoneMsg{}
			}
		}()
		return nil
	}
}

// waitForActivity listens for messages on the background channel
func (m ScanModel) waitForActivity() tea.Cmd {
	return func() tea.Msg {
		select {
		case <-m.ctx.Done():
			return nil
		case msg := <-m.msgChan:
			return msg
		}
	}
}
