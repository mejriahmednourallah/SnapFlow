package tui

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/config"
)

type BuildModel struct {
	fields   []buildField
	focused  int
	running  bool
	output   []string
	done     bool
	exitCode int
	cfg      *config.BuildConfig
	width    int
	height   int

	ctx    context.Context
	cancel context.CancelFunc
	wg     *sync.WaitGroup
	outCh  chan buildLine
}

type buildField struct {
	key       string
	label     string
	textInput textinput.Model
}

type buildLine struct {
	text  string
	isErr bool
}

type buildDoneMsg int

func NewBuildModel(cfg *config.Config) BuildModel {
	m := BuildModel{
		cfg:   &cfg.Build,
		outCh: make(chan buildLine, 100),
		wg:    new(sync.WaitGroup),
	}

	keys := []string{"cgo_enabled", "goos", "goarch", "output", "source", "extra_flags"}
	labels := []string{"CGO_ENABLED", "GOOS", "GOARCH", "Output", "Source", "Extra flags"}
	vals := []string{m.cfg.CgoEnabled, m.cfg.Goos, m.cfg.Goarch, m.cfg.Output, m.cfg.Source, strings.Join(m.cfg.ExtraFlags, " ")}

	for i, k := range keys {
		ti := textinput.New()
		ti.Placeholder = ""
		ti.SetValue(vals[i])
		if i == 0 {
			ti.Focus()
		}
		m.fields = append(m.fields, buildField{
			key:       k,
			label:     labels[i],
			textInput: ti,
		})
	}

	return m
}

func (m BuildModel) Init() tea.Cmd {
	return textinput.Blink
}

func (m BuildModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmds []tea.Cmd

	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			if m.cancel != nil {
				m.cancel()
				m.wg.Wait()
			}
			return m, tea.Quit
		}
		if msg.String() == "esc" {
			if m.cancel != nil {
				m.cancel()
				m.wg.Wait()
			}
			return m, nil
		}

		if !m.running && !m.done {
			switch msg.String() {
			case "up", "shift+tab":
				m.fields[m.focused].textInput.Blur()
				m.focused--
				if m.focused < 0 {
					m.focused = len(m.fields) - 1
				}
				m.fields[m.focused].textInput.Focus()
			case "down", "tab":
				m.fields[m.focused].textInput.Blur()
				m.focused++
				if m.focused >= len(m.fields) {
					m.focused = 0
				}
				m.fields[m.focused].textInput.Focus()
			case "enter":
				m.running = true
				m.ctx, m.cancel = context.WithCancel(context.Background())
				// Start build and start listening for outputs
				cmds = append(cmds, m.doBuild())
				cmds = append(cmds, listenBuildOutput(m.outCh))
			default:
				var cmd tea.Cmd
				m.fields[m.focused].textInput, cmd = m.fields[m.focused].textInput.Update(msg)
				cmds = append(cmds, cmd)
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case buildLine:
		style := TextMuted
		if msg.isErr {
			style = TextError
		}
		m.output = append(m.output, style.Render(msg.text))

		// cap output lines
		if len(m.output) > m.height-10 && m.height > 10 {
			m.output = m.output[len(m.output)-(m.height-10):]
		}

		// Keep listening
		cmds = append(cmds, listenBuildOutput(m.outCh))

	case buildDoneMsg:
		m.running = false
		m.done = true
		m.exitCode = int(msg)
	}

	return m, tea.Batch(cmds...)
}

func (m BuildModel) doBuild() tea.Cmd {
	return func() tea.Msg {
		args := []string{"build", "-o", m.fields[3].textInput.Value()}

		extraStr := m.fields[5].textInput.Value()
		if extraStr != "" {
			args = append(args, "-ldflags", extraStr)
		}

		args = append(args, "./...")

		cmd := exec.CommandContext(m.ctx, "go", args...)
		cmd.Dir = m.fields[4].textInput.Value()

		cmd.Env = append(os.Environ(),
			"CGO_ENABLED="+m.fields[0].textInput.Value(),
			"GOOS="+m.fields[1].textInput.Value(),
			"GOARCH="+m.fields[2].textInput.Value(),
		)

		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()

		if err := cmd.Start(); err != nil {
			return buildDoneMsg(1)
		}

		var outWg sync.WaitGroup
		outWg.Add(2)

		go func() {
			defer outWg.Done()
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				m.outCh <- buildLine{text: scanner.Text(), isErr: false}
			}
		}()

		go func() {
			defer outWg.Done()
			scanner := bufio.NewScanner(stderr)
			for scanner.Scan() {
				m.outCh <- buildLine{text: scanner.Text(), isErr: true}
			}
		}()

		// Wait for streams to finish
		outWg.Wait()

		err := cmd.Wait()

		exitCode := 0
		if err != nil {
			if exitError, ok := err.(*exec.ExitError); ok {
				exitCode = exitError.ExitCode()
			} else {
				exitCode = 1
			}
		}

		return buildDoneMsg(exitCode)
	}
}

func listenBuildOutput(ch <-chan buildLine) tea.Cmd {
	return func() tea.Msg {
		msg, ok := <-ch
		if !ok {
			return nil
		}
		return msg
	}
}

func (m BuildModel) View() string {
	doc := strings.Builder{}

	if m.running || m.done {
		// Output view
		doc.WriteString(Header("Build Output", "Live", m.width))
		doc.WriteString("\n\n")

		for _, line := range m.output {
			doc.WriteString(line + "\n")
		}

		if m.done {
			doc.WriteString("\n" + Separator(50) + "\n")
			if m.exitCode == 0 {
				doc.WriteString(TextSuccess.Render("✅ Build successful"))
			} else {
				doc.WriteString(TextError.Render(fmt.Sprintf("❌ Build failed (exit code %d)", m.exitCode)))
			}
		}

		hints := map[string]string{"Esc": "back"}
		doc.WriteString("\n" + KeyHints(hints))
	} else {
		// Form view
		doc.WriteString(Header("Build Configuration", "Overrides", m.width))
		doc.WriteString("\n\n")

		for i := range m.fields {
			focusChar := " "
			if m.focused == i {
				focusChar = TextPrimary.Render("▶")
			}
			label := fmt.Sprintf("%-15s", m.fields[i].label)
			input := m.fields[i].textInput.View()

			doc.WriteString(fmt.Sprintf("%s %s [%s]\n", focusChar, label, input))
		}

		doc.WriteString("\n" + Separator(50))
		hints := map[string]string{"Enter": "build", "Tab": "next", "Esc": "back"}
		doc.WriteString("\n" + KeyHints(hints))
	}

	return lipgloss.Place(m.width, m.height, lipgloss.Center, lipgloss.Center, doc.String())
}
