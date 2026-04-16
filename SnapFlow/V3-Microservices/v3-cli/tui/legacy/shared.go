package tui

import (
	"fmt"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
)

type SpinnerModel struct {
	spinner spinner.Model
	label   string
}

func NewSpinner(label string) SpinnerModel {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = TextPrimary
	return SpinnerModel{
		spinner: s,
		label:   label,
	}
}

func (s SpinnerModel) Init() tea.Cmd {
	return s.spinner.Tick
}

func (s SpinnerModel) Update(msg tea.Msg) (SpinnerModel, tea.Cmd) {
	var cmd tea.Cmd
	s.spinner, cmd = s.spinner.Update(msg)
	return s, cmd
}

func (s SpinnerModel) View() string {
	return fmt.Sprintf("%s %s", s.spinner.View(), TextMuted.Render(s.label))
}
