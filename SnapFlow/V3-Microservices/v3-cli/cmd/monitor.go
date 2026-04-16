package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var monitorCmd = &cobra.Command{
	Use:   "monitor",
	Short: "Live service dashboard",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Monitor TUI is being rebuilt. Use the main 'snapflow' command for the unified dashboard.")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(monitorCmd)
}
