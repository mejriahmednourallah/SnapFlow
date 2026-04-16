package pinggy

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

type Tunnel struct {
	Token      string
	TargetPort int
	PublicURL  string
	cmd        *exec.Cmd
	freeTier   bool
	mu         sync.Mutex
	statusErr  error
	exitMsg    string
}

func NewTunnel(token string, port int) *Tunnel {
	return &Tunnel{
		Token:      token,
		TargetPort: port,
		freeTier:   true,
	}
}

// Start starts pinggy process, blocks until public URL is extracted from stderr
func (t *Tunnel) Start(ctx context.Context) error {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cmd != nil && t.cmd.Process != nil {
		// Already running
		return nil
	}

	t.PublicURL = ""
	t.statusErr = nil
	t.exitMsg = ""

	// pinggy free tier command using ssh
	// ssh -p 443 -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R0:localhost:{TARGET_PORT} {TOKEN}@a.pinggy.io
	args := []string{
		"-p", "443",
		"-o", "StrictHostKeyChecking=no",
		"-o", "ServerAliveInterval=30",
		fmt.Sprintf("-R0:localhost:%d", t.TargetPort),
		fmt.Sprintf("%s@a.pinggy.io", t.Token),
	}

	t.cmd = exec.CommandContext(ctx, "ssh", args...)

	stderr, err := t.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	if err := t.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start pinggy tunnel: %w", err)
	}

	urlCh := make(chan string)
	urlRegex := regexp.MustCompile(`https://[a-zA-Z0-9]+\.a\.pinggy\.io`)

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()

			// Detect URL
			if match := urlRegex.FindString(line); match != "" {
				select {
				case urlCh <- match:
				default:
				}
			}

			// Store exit reason hints if found
			if strings.Contains(line, "Permission denied") {
				t.exitMsg = "Permission denied"
			} else if strings.Contains(line, "Connection closed") {
				t.exitMsg = "Connection closed"
			} else if strings.Contains(line, "Network error") {
				t.exitMsg = "Network error"
			}
		}

		err := t.cmd.Wait()
		t.mu.Lock()
		t.statusErr = err
		if t.exitMsg == "" && err != nil {
			t.exitMsg = err.Error()
		}
		t.mu.Unlock()
	}()

	select {
	case url := <-urlCh:
		t.PublicURL = url
		return nil
	case <-time.After(20 * time.Second):
		t.Stop()
		return fmt.Errorf("timeout waiting for pinggy public url")
	case <-ctx.Done():
		t.Stop()
		return ctx.Err()
	}
}

// Stop kills the pinggy process
func (t *Tunnel) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	t.cmd = nil
	t.PublicURL = ""
}

// IsAlive returns true if process is still running
func (t *Tunnel) IsAlive() bool {
	t.mu.Lock()
	defer t.mu.Unlock()

	if t.cmd == nil || t.cmd.Process == nil {
		return false
	}

	// Pre-check if Wait() already fired and set statusErr
	if t.statusErr != nil || t.exitMsg != "" {
		return false
	}

	// This is slightly tricky, ProcessState is only populated after Wait()
	if t.cmd.ProcessState != nil {
		return !t.cmd.ProcessState.Exited()
	}

	return true
}

func (t *Tunnel) GetExitReason() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.exitMsg
}
