package cmd

import (
	"fmt"
	"github.com/spf13/cobra"
)

var buildCmd = &cobra.Command{
	Use:   "build",
	Short: "Build scanner binary",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Build TUI is being rebuilt. Use the main 'snapflow' command for the unified dashboard.")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(buildCmd)
}
