package api

import (
	"context"
	"testing"
	"time"
)

func TestClient_Ping_Unreachable(t *testing.T) {
	// Provide a URL that is deliberately unreachable (no listener)
	client := NewClient("http://127.0.0.1:59999")
	client.client.Timeout = 100 * time.Millisecond // very short timeout

	ctx := context.Background()
	_, err := client.Ping(ctx)
	if err == nil {
		t.Errorf("Expected error for unreachable URL, got nil")
	}
}
