package docker

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type LogLine struct {
	Container string
	Level     string // INFO|WARN|ERROR
	Message   string
	Timestamp time.Time
}

func parseLevel(line string) string {
	upperLine := strings.ToUpper(line)
	if strings.Contains(upperLine, "ERROR") {
		return "ERROR"
	}
	if strings.Contains(upperLine, "WARN") || strings.Contains(upperLine, "WARNING") {
		return "WARN"
	}
	return "INFO"
}

// TailLogs streams docker logs for a container name, writing lines to ch
func TailLogs(ctx context.Context, container string, lines int, ch chan<- LogLine) error {
	cmd := exec.CommandContext(ctx, "docker", "logs", "--follow", "--tail", strconv.Itoa(lines), container)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start docker logs: %w", err)
	}

	// Read both stdout and stderr
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			level := parseLevel(line)

			select {
			case ch <- LogLine{
				Container: container,
				Level:     level,
				Message:   line,
				Timestamp: time.Now(),
			}:
			case <-ctx.Done():
				return
			}
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			level := parseLevel(line)

			select {
			case ch <- LogLine{
				Container: container,
				Level:     level,
				Message:   line,
				Timestamp: time.Now(),
			}:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Don't wait on cmd here, just let it run until ctx is done
	go func() {
		cmd.Wait()
	}()

	return nil
}

// IsRunning returns true if the container is currently running
func IsRunning(ctx context.Context, container string) (bool, error) {
	cmd := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Running}}", container)
	output, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("failed to inspect container: %w", err)
	}

	result := strings.TrimSpace(string(output))
	if result == "true" {
		return true, nil
	}

	return false, nil
}
