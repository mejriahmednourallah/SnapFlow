package tui

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/api"
	"github.com/snapflow/v3-cli/internal/config"
	"github.com/snapflow/v3-cli/internal/docker"
)

type MonitorModel struct {
	services  []ServiceState
	logs      []docker.LogLine
	logScroll int
	width     int
	height    int
	cfg       *config.MonitorConfig
	ctx       context.Context
	cancel    context.CancelFunc
	wg        *sync.WaitGroup
	logCh     chan docker.LogLine
}

type ServiceState struct {
	Name      string
	Up        bool
	LatencyMs int64
	LastCheck time.Time
	CheckErr  string
}

type pollMsg struct{}
type logMsg docker.LogLine

func NewMonitorModel(cfg *config.Config) MonitorModel {
	ctx, cancel := context.WithCancel(context.Background())

	m := MonitorModel{
		cfg:    &cfg.Monitor,
		ctx:    ctx,
		cancel: cancel,
		wg:     new(sync.WaitGroup),
		logCh:  make(chan docker.LogLine, 100),
	}

	for _, svc := range cfg.Monitor.Services {
		m.services = append(m.services, ServiceState{
			Name: svc.Name,
		})
	}

	return m
}

func (m MonitorModel) Init() tea.Cmd {
	// Start tailing limits
	for _, svc := range m.cfg.Services {
		if svc.Check == "docker" {
			m.wg.Add(1)
			go func(container string) {
				defer m.wg.Done()
				_ = docker.TailLogs(m.ctx, container, 50, m.logCh)
			}(svc.Container)
		}
	}

	// Poll services immediately and then at intervals
	return tea.Batch(
		pollServices(m.cfg.Services),
		listenLogs(m.logCh),
	)
}

func pollServices(services []config.ServiceConfig) tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		var wg sync.WaitGroup
		results := make([]ServiceState, len(services))

		for i, svc := range services {
			wg.Add(1)
			go func(idx int, sc config.ServiceConfig) {
				defer wg.Done()
				start := time.Now()

				state := ServiceState{
					Name:      sc.Name,
					LastCheck: start,
				}

				if sc.Check == "docker" {
					up, err := docker.IsRunning(ctx, sc.Container)
					state.Up = up
					if err != nil {
						state.CheckErr = err.Error()
					}
				} else {
					client := api.NewClient(strings.TrimSuffix(sc.URL, "/health"))
					up, err := client.Ping(ctx)
					state.Up = up
					if err != nil {
						state.CheckErr = err.Error()
					}
				}

				state.LatencyMs = time.Since(start).Milliseconds()
				results[idx] = state
			}(i, svc)
		}

		wg.Wait()
		return results
	}
}

func listenLogs(ch <-chan docker.LogLine) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-ch
		if !ok {
			return nil
		}
		return logMsg(msg)
	}
}

func tickPoll(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(t time.Time) tea.Msg {
		return pollMsg{}
	})
}

func (m MonitorModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			m.cancel()
			m.wg.Wait()
			return m, tea.Quit
		case "esc", "q", "b":
			m.cancel()
			m.wg.Wait()
			return m, nil
		case "up", "k":
			if m.logScroll > 0 {
				m.logScroll--
			}
		case "down", "j":
			if m.logScroll < len(m.logs)-1 {
				m.logScroll++
			}
		case "r":
			return m, pollServices(m.cfg.Services)
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	case []ServiceState:
		m.services = msg
		// schedule next tick
		d := time.Duration(m.cfg.PollIntervalMs) * time.Millisecond
		if d == 0 {
			d = 2 * time.Second
		}
		return m, tickPoll(d)
	case pollMsg:
		return m, pollServices(m.cfg.Services)
	case logMsg:
		m.logs = append(m.logs, docker.LogLine(msg))
		if len(m.logs) > m.cfg.LogLinesBuffer {
			m.logs = m.logs[1:]
		}
		// auto-scroll
		maxScroll := len(m.logs) - (m.height - 8)
		if maxScroll > 0 && m.logScroll >= maxScroll-2 {
			m.logScroll = maxScroll
		}
		return m, listenLogs(m.logCh)
	}
	return m, nil
}

func (m MonitorModel) View() string {
	if m.width == 0 {
		return "Initializing Monitor..."
	}

	servicesWidth := 30
	logsWidth := m.width - servicesWidth - 4

	// Services view
	sb := strings.Builder{}
	for _, svc := range m.services {
		status := StatusDot(svc.Up)
		info := "down"
		if svc.Up {
			if svc.LatencyMs > 0 {
				info = fmt.Sprintf("%dms", svc.LatencyMs)
			} else {
				info = "running"
			}
		}

		nameFmt := fmt.Sprintf("%-12s", svc.Name)
		sb.WriteString(fmt.Sprintf("%s %s %s\n", nameFmt, status, info))
	}
	for i := len(m.services); i < m.height-6; i++ {
		sb.WriteString("\n")
	}

	servicesPanel := PanelStyle.
		Width(servicesWidth).
		Height(m.height - 4).
		Render(sb.String())

	// Logs view
	lb := strings.Builder{}
	startIdx := m.logScroll
	maxLines := m.height - 6

	if startIdx < 0 {
		startIdx = 0
	}
	endIdx := startIdx + maxLines
	if endIdx > len(m.logs) {
		endIdx = len(m.logs)
	}

	for i := startIdx; i < endIdx; i++ {
		l := m.logs[i]
		ts := l.Timestamp.Format("15:04:05")

		levelStyle := TextMuted
		if l.Level == "ERROR" {
			levelStyle = TextError
		} else if l.Level == "WARN" {
			levelStyle = TextWarning
		}

		levelRender := levelStyle.Render(fmt.Sprintf("%-5s", l.Level))
		contRender := TextMuted.Render(fmt.Sprintf("%-10s", l.Container))

		// truncate msg
		msgLen := logsWidth - 30
		msg := l.Message
		if msgLen > 0 && len(msg) > msgLen {
			msg = msg[:msgLen-3] + "..."
		}

		lb.WriteString(fmt.Sprintf("[%s] %s %s %s\n", ts, levelRender, contRender, msg))
	}

	for i := endIdx - startIdx; i < maxLines; i++ {
		lb.WriteString("\n")
	}

	logsPanel := PanelStyle.
		Width(logsWidth).
		Height(m.height - 4).
		Render(lb.String())

	// Assemble
	layout := lipgloss.JoinHorizontal(lipgloss.Top, servicesPanel, logsPanel)

	hints := KeyHints(map[string]string{
		"r":   "refresh",
		"↑/↓": "scroll logs",
		"q":   "back",
	})

	return fmt.Sprintf("%s\n%s", layout, hints)
}
