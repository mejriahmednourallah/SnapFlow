package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/lipgloss"
	"github.com/snapflow/v3-cli/internal/api"
	"github.com/spf13/cobra"
)

var (
	maxPages int
	watch    bool
	timeout  int
)

var scanCmd = &cobra.Command{
	Use:   "scan <url>",
	Short: "Launch a website scan",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		url := args[0]
		client := api.NewClient(cfg.APIURL)

		fmt.Printf("Scanning %s  (max %d pages)\n", url, maxPages)

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		scanID, err := client.StartScan(ctx, url, maxPages)
		cancel()

		if err != nil {
			return fmt.Errorf("failed to start scan: %w", err)
		}

		fmt.Printf("scan_id: %s\n", scanID)

		if !watch {
			fmt.Println("status:  RUNNING")
			fmt.Printf("poll:    snapflow scan status %s\n", scanID)
			return nil
		}

		return watchScan(client, scanID, timeout)
	},
}

var scanStatusCmd = &cobra.Command{
	Use:   "status <scan_id>",
	Short: "Get status of a scan",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		scanID := args[0]
		client := api.NewClient(cfg.APIURL)

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		status, err := client.GetStatus(ctx, scanID)
		cancel()

		if err != nil {
			return fmt.Errorf("failed to get status: %w", err)
		}

		fmt.Printf("scan_id: %s\n", status.ScanID)
		fmt.Printf("status:  %s\n", status.Status)
		fmt.Printf("pages:   %d/%d\n", status.Pages, status.MaxPages)

		if status.Error != "" {
			fmt.Printf("error:   %s\n", status.Error)
		}

		if status.Status == "complete" {
			os.Exit(0)
		} else if status.Status == "failed" {
			os.Exit(1)
		} else {
			os.Exit(2) // still running
		}

		return nil
	},
}

func watchScan(client *api.Client, scanID string, timeoutSec int) error {
	prog := progress.New(progress.WithDefaultGradient())
	start := time.Now()

	fmt.Println()

	for {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		status, err := client.GetStatus(ctx, scanID)
		cancel()

		if err != nil {
			fmt.Fprintf(os.Stderr, "error polling status: %v\n", err)
			time.Sleep(2 * time.Second)
			continue
		}

		pct := 0.0
		if status.MaxPages > 0 {
			pct = float64(status.Pages) / float64(status.MaxPages)
		} else if maxPages > 0 {
			pct = float64(status.Pages) / float64(maxPages)
		}
		if pct > 1.0 {
			pct = 1.0
		}

		nlpStatus := "pending..."
		if status.Status == "nlp_processing" {
			nlpStatus = "processing"
		} else if status.Status == "complete" {
			nlpStatus = "done"
		}

		statusFmt := lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Render(strings.ToUpper(status.Status))

		fmt.Printf("\r  %s  %s  %d pages  NLP: %s    ",
			statusFmt, prog.ViewAs(pct), status.Pages, nlpStatus)

		if status.Status == "complete" {
			fmt.Printf("\n\n  Completed in %ds  ·  %d pages  ·  NLP: done\n", int(time.Since(start).Seconds()), status.Pages)
			fmt.Printf("  GET %s/scan/%s/result\n", client.BaseURL, scanID)
			return nil
		}
		if status.Status == "failed" {
			fmt.Printf("\n\n  ❌ Scan failed: %s\n", status.Error)
			os.Exit(1)
		}

		if time.Since(start).Seconds() > float64(timeoutSec) {
			fmt.Printf("\n\n  ⏱ Watch timeout (%ds) reached. Scan is still running.\n", timeoutSec)
			return nil
		}

		time.Sleep(2 * time.Second)
	}
}

func init() {
	scanCmd.Flags().IntVar(&maxPages, "max-pages", 150, "Max pages to crawl")
	scanCmd.Flags().BoolVar(&watch, "watch", false, "Poll status until complete")
	scanCmd.Flags().IntVar(&timeout, "timeout", 900, "Seconds to wait when --watch")

	scanCmd.AddCommand(scanStatusCmd)
	rootCmd.AddCommand(scanCmd)
}
