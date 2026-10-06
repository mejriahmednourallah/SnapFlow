package main

import (
	"sort"
	"sync"
)

// Keep queue admission, terminal HTTP outcomes and SQL storage distinct. A
// redirect retains its originating request identity rather than looking lost.
type crawlOutcome struct {
	URL        string `json:"url"`
	Source     string `json:"source"`
	Queued     bool   `json:"queued"`
	Started    bool   `json:"started"`
	FinalURL   string `json:"final_url,omitempty"`
	StatusCode int    `json:"status_code,omitempty"`
	Outcome    string `json:"outcome"`
	Stored     bool   `json:"stored"`
}

type crawlOutcomes struct {
	mu       sync.Mutex
	pages    map[string]*crawlOutcome
	requests map[uint32]string
}

func newCrawlOutcomes() *crawlOutcomes {
	return &crawlOutcomes{pages: map[string]*crawlOutcome{}, requests: map[uint32]string{}}
}

func (c *crawlOutcomes) page(target string) *crawlOutcome {
	if c.pages[target] == nil {
		c.pages[target] = &crawlOutcome{URL: target, Outcome: "queued"}
	}
	return c.pages[target]
}

func (c *crawlOutcomes) queued(target, source string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	p := c.page(target)
	p.Queued = true
	p.Source = source
}

func (c *crawlOutcomes) start(id uint32, target string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.requests[id] = target
	c.page(target).Started = true
}

func (c *crawlOutcomes) finish(id uint32, final string, status int, outcome string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	origin := c.requests[id]
	if origin == "" {
		origin = final
	}
	p := c.page(origin)
	p.FinalURL = final
	p.StatusCode = status
	p.Outcome = outcome
}

func (c *crawlOutcomes) stored(id uint32, success bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if origin := c.requests[id]; origin != "" {
		p := c.page(origin)
		p.Stored = success
		if !success {
			p.Outcome = "database_error"
		}
	}
}

func (c *crawlOutcomes) snapshot() map[string]interface{} {
	c.mu.Lock()
	defer c.mu.Unlock()
	pages := []crawlOutcome{}
	counts := map[string]int{}
	for _, p := range c.pages {
		pages = append(pages, *p)
		counts[p.Outcome]++
	}
	sort.Slice(pages, func(i, j int) bool { return pages[i].URL < pages[j].URL })
	return map[string]interface{}{"pages": pages, "outcome_counts": counts, "includes_initial_seed": true}
}
