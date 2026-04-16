package cmd

import (
	"fmt"
	"os"

	"github.com/charmbracelet/log"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/snapflow/v3-cli/internal/config"
	"github.com/snapflow/v3-cli/internal/state"
	"github.com/snapflow/v3-cli/tui"
	"github.com/spf13/cobra"
)

var cfgFile string
var cfg *config.Config

var rootCmd = &cobra.Command{
	Use:   "snapflow",
	Short: "SnapFlow V3 - AI Security Agent",
	PersistentPreRun: func(cmd *cobra.Command, args []string) {
		var err error
		cfg, err = config.Load(cfgFile)
		if err != nil {
			log.Warn("Failed to load config", "error", err)
		}
		if cfg != nil {
			errs := cfg.Validate()
			if len(errs) > 0 {
				for _, e := range errs {
					fmt.Fprintf(os.Stderr, "config error: %s\n", e)
				}
			}
		}
	},
	RunE: func(cmd *cobra.Command, args []string) error {
		sc := state.NewStateController()
		if cfg != nil {
			sc.SetVar("api_url", cfg.APIURL)
		}
		
		p := tea.NewProgram(tui.NewRootModel(sc), tea.WithAltScreen())
		_, err := p.Run()
		return err
	},
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().StringVar(&cfgFile, "config", "", "config file path")
}
