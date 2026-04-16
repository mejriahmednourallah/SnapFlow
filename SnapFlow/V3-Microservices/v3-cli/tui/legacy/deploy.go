package tui

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/config"
	"github.com/snapflow/v3-cli/internal/pinggy"
)

type DeployModel struct {
	tunnel       *pinggy.Tunnel
	status       deployStatus
	publicURL    string
	copied       bool
	sessionStart time.Time
	cfg          *config.DeployConfig

	width  int
	height int

	ctx    context.Context
	cancel context.CancelFunc
	wg     *sync.WaitGroup
}

type deployStatus int

const (
	StatusIdle deployStatus = iota
	StatusConnecting
	StatusActive
	StatusExpired
	StatusInvalidToken
	StatusError
	StatusNoToken
)

func NewDeployModel(cfg *config.Config) DeployModel {
	m := DeployModel{
		cfg: &cfg.Deploy,
		wg:  new(sync.WaitGroup),
	}

	if m.cfg.PinggyToken == "" {
		m.status = StatusNoToken
	} else {
		m.status = StatusIdle
		m.tunnel = pinggy.NewTunnel(m.cfg.PinggyToken, m.cfg.TargetPort)
	}

	return m
}

type tickDeployMsg time.Time

func tickDeploy() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return tickDeployMsg(t)
	})
}

// starts the tunnel and returns a message when done
func (m *DeployModel) startTunnel() tea.Cmd {
	return func() tea.Msg {
		ctx, cancel := context.WithCancel(context.Background())
		m.ctx = ctx
		m.cancel = cancel

		m.sessionStart = time.Now()
		err := m.tunnel.Start(ctx)
		if err != nil {
			return fmt.Errorf("tunnel failed: %w", err)
		}
		return m.tunnel.PublicURL
	}
}

func (m DeployModel) Init() tea.Cmd {
	if m.status == StatusNoToken {
		return nil
	}
	return tickDeploy()
}

func (m DeployModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			if m.tunnel != nil {
				m.tunnel.Stop()
			}
			return m, tea.Quit
		case "esc", "q":
			return m, nil
		case "s":
			if m.status == StatusNoToken {
				return m, nil
			}
			m.publicURL = ""
			m.copied = false
			m.status = StatusConnecting
			if m.tunnel != nil {
				m.tunnel.Stop()
			}
			// Wait a bit
			time.Sleep(100 * time.Millisecond)
			return m, tea.Batch(m.startTunnel(), tickDeploy())
		case "x":
			if m.tunnel != nil {
				m.tunnel.Stop()
			}
			m.status = StatusIdle
			m.publicURL = ""
		case "c":
			if m.publicURL != "" {
				m.copyToClipboard(m.publicURL)
				m.copied = true
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case string:
		// got url
		m.publicURL = msg
		m.status = StatusActive

	case error:
		// failed to start or stopped
		if m.tunnel != nil {
			reason := m.tunnel.GetExitReason()
			if strings.Contains(reason, "Permission denied") {
				m.status = StatusInvalidToken
			} else if strings.Contains(reason, "Connection closed") {
				m.status = StatusExpired
			} else {
				m.status = StatusError
			}
		} else {
			m.status = StatusError
		}

	case tickDeployMsg:
		// Only tick if active or connecting, check if it died
		if m.status == StatusActive || m.status == StatusConnecting {
			if m.tunnel != nil && !m.tunnel.IsAlive() && m.status == StatusActive {
				reason := m.tunnel.GetExitReason()
				if strings.Contains(reason, "Permission denied") {
					m.status = StatusInvalidToken
				} else if strings.Contains(reason, "Connection closed") {
					m.status = StatusExpired
				} else {
					m.status = StatusError
				}
			} else {
				// clear copied after a few seconds? not needed, but can keep UI ticking
				return m, tickDeploy()
			}
		}
	}

	return m, nil
}

func (m DeployModel) View() string {
	if m.width == 0 {
		return ""
	}

	doc := strings.Builder{}

	if m.status == StatusNoToken {
		doc.WriteString(Header("Pinggy Tunnel", "Missing Token", m.width))
		doc.WriteString("\n\n")
		doc.WriteString(TextError.Render("  ✗ No Pinggy token configured\n\n"))
		doc.WriteString("  1. Sign up free at https://pinggy.io\n")
		doc.WriteString("  2. Copy your token from the dashboard\n")
		doc.WriteString("  3. Add to .snapflow.yaml:\n")
		doc.WriteString("       deploy:\n")
		doc.WriteString("         pinggy_token: \"your-token-here\"\n")
		doc.WriteString("         target_port: 8080\n")
		doc.WriteString("\n" + KeyHints(map[string]string{"Esc": "back"}))
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, doc.String())
	}

	if m.status == StatusExpired {
		doc.WriteString(Header("Pinggy Tunnel", "Free Tier", m.width))
		doc.WriteString("\n\n")
		doc.WriteString("  Status     " + StatusDot(false) + " expired\n\n")
		doc.WriteString("  Free tier sessions last 60 minutes.\n")
		doc.WriteString("  Press s to start a new session.\n")
		doc.WriteString("  Note: your public URL will change.\n")
		doc.WriteString("\n" + KeyHints(map[string]string{"s": "new session", "Esc": "back"}))
		return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, doc.String())
	}

	doc.WriteString(Header("Pinggy Tunnel", "Free Tier", m.width))
	doc.WriteString("\n\n")

	doc.WriteString(fmt.Sprintf("  %-10s localhost:%d\n", "Target", m.cfg.TargetPort))
	masked := "****-****"
	if len(m.cfg.PinggyToken) > 8 {
		masked = m.cfg.PinggyToken[:4] + "****" + m.cfg.PinggyToken[len(m.cfg.PinggyToken)-4:]
	}
	doc.WriteString(fmt.Sprintf("  %-10s %s\n", "Token", masked))

	statusStr := ""
	switch m.status {
	case StatusIdle:
		statusStr = StatusDot(false) + TextMuted.Render(" idle")
	case StatusConnecting:
		statusStr = StatusDot(true) + TextWarning.Render(" connecting...")
	case StatusActive:
		elapsed := time.Since(m.sessionStart)
		mins := int(elapsed.Minutes())
		secs := int(elapsed.Seconds()) % 60
		statusStr = StatusDot(true) + TextSuccess.Render(" active") + TextMuted.Render(fmt.Sprintf("  (session: %dm %ds elapsed)", mins, secs))
	case StatusInvalidToken:
		statusStr = StatusDot(false) + TextError.Render(" invalid token (Permission denied)")
	case StatusError:
		statusStr = StatusDot(false) + TextError.Render(" error")
	}
	doc.WriteString(fmt.Sprintf("  %-10s %s\n\n", "Status", statusStr))

	if m.status == StatusActive {
		doc.WriteString(fmt.Sprintf("  %-10s %s\n", "Public URL", TextPrimary.Render(m.publicURL)))

		copyStr := "  [c] copy to clipboard"
		if m.copied {
			copyStr += TextSuccess.Render("  ✓ copied!")
		}
		doc.WriteString(fmt.Sprintf("             %s\n\n", copyStr))

		elapsed := time.Since(m.sessionStart)
		rem := 60.0 - elapsed.Minutes()

		remStyle := TextMuted
		if rem < 2 {
			remStyle = TextError
		} else if rem < 10 {
			remStyle = TextWarning
		}

		doc.WriteString(remStyle.Render(fmt.Sprintf("  ⚠ Free tier: session expires in ~%.0f minutes\n", rem)))
		doc.WriteString(TextMuted.Render("    URL will change on reconnect\n"))
	}

	doc.WriteString("\n" + KeyHints(map[string]string{"s": "start", "x": "stop", "c": "copy URL", "Esc": "back"}))

	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, doc.String())
}

func (m DeployModel) copyToClipboard(s string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("pbcopy")
	case "linux":
		cmd = exec.Command("xclip", "-selection", "clipboard")
		// fallback to xsel if xclip not there
		err := cmd.Run()
		if err != nil {
			cmd = exec.Command("xsel", "--clipboard", "--input")
		}
	case "windows":
		cmd = exec.Command("clip")
	}
	if cmd != nil {
		in, err := cmd.StdinPipe()
		if err == nil {
			if err := cmd.Start(); err == nil {
				_, _ = in.Write([]byte(s))
				_ = in.Close()
				_ = cmd.Wait()
			}
		}
	}
}
