package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	BaseURL string
	Timeout time.Duration
	client  *http.Client
}

func NewClient(baseURL string) *Client {
	timeout := 10 * time.Second
	return &Client{
		BaseURL: baseURL,
		Timeout: timeout,
		client: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) Ping(ctx context.Context) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/health", nil)
	if err != nil {
		return false, fmt.Errorf("failed to create ping request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return false, fmt.Errorf("api ping failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return true, nil
	}
	return false, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
}

func (c *Client) StartScan(ctx context.Context, url string, maxPages int) (string, error) {
	payload := map[string]interface{}{
		"url":       url,
		"max_pages": maxPages,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal scan payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/scan", bytes.NewBuffer(body))
	if err != nil {
		return "", fmt.Errorf("failed to create scan request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("api start scan failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to start scan, status code: %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode scan response: %w", err)
	}

	scanID, ok := result["scan_id"].(string)
	if !ok {
		return "", fmt.Errorf("scan_id not found in response")
	}

	return scanID, nil
}

type ScanStatus struct {
	ScanID   string `json:"scan_id"`
	Status   string `json:"status"`
	Pages    int    `json:"pages_scanned"`
	MaxPages int    `json:"max_pages"`
	Error    string `json:"error,omitempty"`
}

func (c *Client) GetStatus(ctx context.Context, scanID string) (*ScanStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/scan/%s/status", c.BaseURL, scanID), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create get status request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("api get status failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get status, status code: %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode status response: %w", err)
	}

	status := &ScanStatus{
		ScanID: scanID,
	}

	if statusStr, ok := result["status"].(string); ok {
		status.Status = statusStr
	}
	if pages, ok := result["pages_scanned"].(float64); ok {
		status.Pages = int(pages)
	} else if pages, ok := result["pages_crawled"].(float64); ok {
		status.Pages = int(pages)
	}

	if errStr, ok := result["error"].(string); ok {
		status.Error = errStr
	}

	return status, nil
}
