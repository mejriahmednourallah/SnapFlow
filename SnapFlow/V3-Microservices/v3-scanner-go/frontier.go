package main

import (
	"context"
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"snapflow/v3-scanner-go/browserpool"
	"sort"
	"strings"
	"sync"
	"time"
)

// Preserve meaningful query routes and trailing slash semantics; fragments do
// not identify another HTTP document. Tracking aliases do not consume slots.
func pageIdentity(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil {
		return ""
	}
	u.Fragment = ""
	u.Host = strings.ToLower(u.Host)
	if u.Path == "" {
		u.Path = "/"
	}
	query := u.Query()
	changed := false
	for key := range query {
		if strings.HasPrefix(strings.ToLower(key), "utm_") || key == "gclid" || key == "fbclid" {
			query.Del(key)
			changed = true
		}
	}
	if changed {
		u.RawQuery = query.Encode()
	}
	return u.String()
}

func discoveryPriority(raw string) int {
	path := strings.ToLower(raw)
	for _, token := range []string{"privacy", "confidential", "legal", "mentions", "contact", "service", "product", "produit", "about", "propos"} {
		if strings.Contains(path, token) {
			return 0
		}
	}
	return 1
}

// Coordinator owns the queue. Completed children can enqueue deeper routes;
// workers cannot deadlock while trying to write back into a full jobs channel.
func runRenderedFrontier(ctx context.Context, seeds []string, maxVisits, concurrency int, allowed []string,
	fetch func(string) (*browserpool.DiscoverRenderedResult, error),
	consume func(string, *browserpool.DiscoverRenderedResult) bool, lateSeeds ...func() []string) int {
	if maxVisits < 1 {
		return 0
	}
	if concurrency < 1 {
		concurrency = 1
	}
	type outcome struct {
		url  string
		page *browserpool.DiscoverRenderedResult
		err  error
	}
	jobs := make(chan string)
	results := make(chan outcome, concurrency)
	var workers sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for target := range jobs {
				page, err := fetch(target)
				results <- outcome{target, page, err}
			}
		}()
	}
	seen := map[string]bool{}
	queue := []string{}
	enqueue := func(raw string) {
		key := pageIdentity(raw)
		parsed, _ := url.Parse(key)
		if key == "" || seen[key] || !isHostAllowedForCrawl(parsed.Hostname(), allowed) {
			return
		}
		lower := strings.ToLower(parsed.Path)
		for _, suffix := range []string{".pdf", ".zip", ".png", ".jpg", ".js", ".css", ".xml"} {
			if strings.HasSuffix(lower, suffix) {
				return
			}
		}
		seen[key] = true
		queue = append(queue, key)
	}
	for _, seed := range seeds {
		enqueue(seed)
	}
	attempted, active, captured := 0, 0, 0
	for len(queue) > 0 || active > 0 || (len(lateSeeds) > 0 && attempted < maxVisits && ctx.Err() == nil) {
		var send chan string
		next := ""
		if len(queue) > 0 && attempted < maxVisits && ctx.Err() == nil {
			sort.SliceStable(queue, func(i, j int) bool { return discoveryPriority(queue[i]) < discoveryPriority(queue[j]) })
			send = jobs
			next = queue[0]
		}
		if active == 0 && send == nil {
			if len(lateSeeds) > 0 && attempted < maxVisits && ctx.Err() == nil {
				feed := lateSeeds[0]
				lateSeeds = lateSeeds[1:]
				for _, seed := range feed() {
					enqueue(seed)
				}
				continue
			}
			break
		}
		select {
		case send <- next:
			queue = queue[1:]
			active++
			attempted++
		case result := <-results:
			active--
			if result.err == nil && result.page != nil && result.page.Error == "" {
				if consume(result.url, result.page) {
					captured++
				}
				// A canonical alias may already be stored, but its children
				// still expose routes absent from the static crawl.
				for _, link := range result.page.InternalLinks {
					enqueue(link)
				}
			}
		}
	}
	close(jobs)
	workers.Wait()
	return captured
}

// Read URL sets and nested indexes without treating arbitrary HTTP-200 HTML as
// a sitemap. All downloads and emitted URLs remain inside the scan perimeter.
func collectSitemapURLs(ctx context.Context, initialURL, initialBody string, allowed []string, maxURLs int) []string {
	type document struct {
		location, body string
		depth          int
	}
	queue := []document{{initialURL, initialBody, 0}}
	seenDocs := map[string]bool{}
	seenURLs := map[string]bool{}
	pages := []string{}
	client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 4 || !isHostAllowedForCrawl(req.URL.Hostname(), allowed) {
			return http.ErrUseLastResponse
		}
		return nil
	}}
	for len(queue) > 0 && len(seenDocs) < 16 && len(pages) < maxURLs && ctx.Err() == nil {
		current := queue[0]
		queue = queue[1:]
		key := pageIdentity(current.location)
		u, _ := url.Parse(key)
		if key == "" || seenDocs[key] || !isHostAllowedForCrawl(u.Hostname(), allowed) {
			continue
		}
		seenDocs[key] = true
		body := current.body
		if body == "" {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, key, nil)
			if err != nil {
				continue
			}
			resp, err := client.Do(req)
			if err != nil {
				continue
			}
			data, readErr := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024+1))
			resp.Body.Close()
			if readErr != nil || resp.StatusCode != 200 || len(data) > 2*1024*1024 {
				continue
			}
			body = string(data)
		}
		decoder := xml.NewDecoder(strings.NewReader(body))
		root := ""
		locations := []string{}
		valid := true
		for {
			token, err := decoder.Token()
			if err == io.EOF {
				break
			}
			if err != nil {
				valid = false
				break
			}
			if start, ok := token.(xml.StartElement); ok {
				if root == "" {
					root = start.Name.Local
				}
				if start.Name.Local == "loc" {
					var loc string
					if decoder.DecodeElement(&loc, &start) != nil {
						valid = false
						break
					}
					locations = append(locations, loc)
				}
			}
		}
		if !valid || (root != "urlset" && root != "sitemapindex") {
			continue
		}
		for _, location := range locations {
			target := pageIdentity(location)
			parsed, _ := url.Parse(target)
			if target == "" || !isHostAllowedForCrawl(parsed.Hostname(), allowed) {
				continue
			}
			if root == "sitemapindex" {
				if current.depth < 3 {
					queue = append(queue, document{target, "", current.depth + 1})
				}
			} else if !seenURLs[target] && len(pages) < maxURLs {
				seenURLs[target] = true
				pages = append(pages, target)
			}
		}
	}
	return pages
}
