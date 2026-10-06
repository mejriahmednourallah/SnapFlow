package performance

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestCompletedPagePublishesBeforeSlowPageAndCancellationReleasesWork(t *testing.T) {
	slowStarted := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body.URL == "https://fixture.test/slow" {
			close(slowStarted)
			<-r.Context().Done()
			return
		}
		<-slowStarted
		json.NewEncoder(w).Encode(map[string]interface{}{"rendered_html": "<main>Ready</main>", "fcp_ms": 10, "lcp_ms": 20, "metrics_available": true, "render_engine": "chromium"})
	}))
	defer server.Close()
	t.Setenv("BROWSER_POOL_URL", server.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	published := make(chan struct{})
	done := make(chan []HeadlessResult, 1)
	var once sync.Once
	go func() {
		done <- RunHeadlessPoolContext(ctx, []string{"https://fixture.test/fast", "https://fixture.test/slow"}, 2, func(page HeadlessResult) {
			if page.URL == "https://fixture.test/fast" && page.Available {
				once.Do(func() { close(published) })
			}
		})
	}()
	select {
	case <-published:
	case <-time.After(3 * time.Second):
		t.Fatal("fast page was held behind slow page")
	}
	select {
	case <-done:
		t.Fatal("batch ended before slow page completed")
	default:
	}
	cancel()
	select {
	case results := <-done:
		if len(results) != 2 || results[1].Error == "" {
			t.Fatal("cancelled visit presented as a measurement")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled work did not finish")
	}
}
