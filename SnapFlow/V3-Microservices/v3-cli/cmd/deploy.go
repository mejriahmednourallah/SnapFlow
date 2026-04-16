package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var deployCmd = &cobra.Command{
	Use:   "deploy",
	Short: "Start Pinggy tunnel",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Println("Deploy TUI is being rebuilt. Use the main 'snapflow' command for the unified dashboard.")
		return nil
	},
}

func init() {
	rootCmd.AddCommand(deployCmd)
}
