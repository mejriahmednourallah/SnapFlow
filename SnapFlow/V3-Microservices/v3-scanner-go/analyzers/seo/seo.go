package seo

import (
	"crypto/md5"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

type MetaInfo struct {
	Title          string `json:"title"`
	MetaDesc       string `json:"meta_description"`
	HasMetaDesc    bool   `json:"has_meta_description"`
	TitleLength    int    `json:"title_length"`
	MetaDescLength int    `json:"meta_desc_length"`
}

type HeadingInfo struct {
	Tag   string `json:"tag"`
	Text  string `json:"text"`
	Count int    `json:"count,omitempty"`
}

type LinkInfo struct {
	InternalLinks int `json:"internal_links"`
	ExternalLinks int `json:"external_links"`
	BrokenLinks   int `json:"broken_links"`
}

type SEOResult struct {
	URL           string        `json:"url"`
	RawHTML       string        `json:"-"`
	Meta          MetaInfo      `json:"meta"`
	Headings      []HeadingInfo `json:"headings"`
	HeadingValid  bool          `json:"heading_hierarchy_valid"`
	Links         LinkInfo      `json:"links"`
	HasSitemap    bool          `json:"has_sitemap"`
	HasRobotsTxt  bool          `json:"has_robots_txt"`
	ImagesNoAlt   int           `json:"images_without_alt"`
	TotalImages   int           `json:"total_images"`
	HasLazyImages bool          `json:"has_lazy_loading"`
	URLClean      bool          `json:"url_clean"`
	ContentHash   string        `json:"content_hash"`
	// Phase F: node-style URL detection
	NodeStyleURLCount int      `json:"node_style_url_count"`
	NodeStyleURLs     []string `json:"node_style_urls"`
	HasOGType         bool     `json:"has_og_type"`
	HasTwitterCard    bool     `json:"has_twitter_card"`
	SocialShareButtons []string `json:"social_share_buttons"`
	SocialSharingScore int      `json:"social_sharing_score"`
	Score             int      `json:"score"`
	Passed            bool     `json:"passed"`
	Issues            []string `json:"issues"`
	ServiceName       string   `json:"service_name"`
}

var (
	titleRe     = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	metaDescRe  = regexp.MustCompile(`(?is)<meta[^>]+name=["']description["'][^>]+content=["'](.*?)["']`)
	metaDescRe2 = regexp.MustCompile(`(?is)<meta[^>]+content=["'](.*?)["'][^>]+name=["']description["']`)
	linkRe      = regexp.MustCompile(`(?is)<a[^>]+href=["'](.*?)["']`)
	nodeStyleRe = regexp.MustCompile(`(?i)(/node/\d+|[?&]q=)`)
	ogTypeRe    = regexp.MustCompile(`(?is)<meta[^>]+property=["']og:type["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:type["']`)
	twitterCardRe = regexp.MustCompile(`(?is)<meta[^>]+name=["']twitter:card["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:card["']`)
	facebookShareRe = regexp.MustCompile(`(?i)(facebook\.com/(?:sharer|share)|share-facebook|class=["'][^"']*(?:facebook-share|share-facebook)[^"']*["'])`)
	linkedinShareRe = regexp.MustCompile(`(?i)(linkedin\.com/(?:shareArticle|sharing/share-offsite)|share-linkedin|class=["'][^"']*(?:linkedin-share|share-linkedin)[^"']*["'])`)
	twitterShareRe = regexp.MustCompile(`(?i)(twitter\.com/intent/tweet|x\.com/intent/post|share-twitter|class=["'][^"']*(?:twitter-share|share-twitter)[^"']*["'])`)
	whatsappShareRe = regexp.MustCompile(`(?i)(wa\.me/|api\.whatsapp\.com/send|share-whatsapp|class=["'][^"']*(?:whatsapp-share|share-whatsapp)[^"']*["'])`)
)

func extractSocialSharing(html string) (bool, bool, []string, int) {
	hasOGType := ogTypeRe.MatchString(html)
	hasTwitterCard := twitterCardRe.MatchString(html)

	buttons := make([]string, 0, 4)
	if facebookShareRe.MatchString(html) {
		buttons = append(buttons, "facebook")
	}
	if linkedinShareRe.MatchString(html) {
		buttons = append(buttons, "linkedin")
	}
	if twitterShareRe.MatchString(html) {
		buttons = append(buttons, "twitter")
	}
	if whatsappShareRe.MatchString(html) {
		buttons = append(buttons, "whatsapp")
	}
	sort.Strings(buttons)

	score := 0
	if hasOGType {
		score += 40
	}
	if hasTwitterCard {
		score += 40
	}
	if len(buttons) > 0 {
		score += 20
	}

	return hasOGType, hasTwitterCard, buttons, score
}

func extractMeta(html string) MetaInfo {
	info := MetaInfo{}

	if m := titleRe.FindStringSubmatch(html); len(m) > 1 {
		info.Title = strings.TrimSpace(m[1])
		info.TitleLength = len(info.Title)
	}

	if m := metaDescRe.FindStringSubmatch(html); len(m) > 1 {
		info.MetaDesc = strings.TrimSpace(m[1])
		info.HasMetaDesc = true
		info.MetaDescLength = len(info.MetaDesc)
	} else if m := metaDescRe2.FindStringSubmatch(html); len(m) > 1 {
		info.MetaDesc = strings.TrimSpace(m[1])
		info.HasMetaDesc = true
		info.MetaDescLength = len(info.MetaDesc)
	}

	return info
}

func extractHeadings(doc *goquery.Document) ([]HeadingInfo, bool) {
	var headings []HeadingInfo
	counts := map[string]int{}

	doc.Find("h1, h2, h3, h4, h5, h6").Each(func(i int, s *goquery.Selection) {
		tag := strings.ToLower(goquery.NodeName(s))
		text := strings.TrimSpace(s.Text())
		counts[tag]++
		headings = append(headings, HeadingInfo{Tag: tag, Text: text})
	})

	valid := counts["h1"] == 1
	return headings, valid
}

// seoNormalizeHost strips www. and lowercases a hostname for comparison.
func seoNormalizeHost(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	h = strings.TrimPrefix(h, "www.")
	return h
}

// isInternalLink returns true when href belongs to the same host as baseURL.
// Handles relative URLs, protocol-relative URLs, and www/non-www variants.
func isInternalLink(href, baseURL string) bool {
	// Relative URLs (no scheme/host) are always internal.
	if !strings.Contains(href, "://") && !strings.HasPrefix(href, "//") {
		return true
	}
	// Protocol-relative: prepend https so url.Parse works.
	if strings.HasPrefix(href, "//") {
		href = "https:" + href
	}
	parsedBase, err := url.Parse(baseURL)
	if err != nil {
		// Fall back to substring check if base URL is malformed.
		return strings.Contains(href, baseURL)
	}
	parsedHref, err := url.Parse(href)
	if err != nil {
		return false
	}
	return seoNormalizeHost(parsedHref.Hostname()) == seoNormalizeHost(parsedBase.Hostname())
}

func extractLinks(html, baseURL string) LinkInfo {
	matches := linkRe.FindAllStringSubmatch(html, -1)
	info := LinkInfo{}

	for _, m := range matches {
		href := strings.TrimSpace(m[1])
		if href == "" || strings.HasPrefix(href, "#") || strings.HasPrefix(href, "javascript:") {
			continue
		}
		if isInternalLink(href, baseURL) {
			info.InternalLinks++
		} else {
			info.ExternalLinks++
		}
	}
	return info
}

func extractImages(doc *goquery.Document, res *SEOResult) {
	doc.Find("img").Each(func(i int, s *goquery.Selection) {
		res.TotalImages++
		src, _ := s.Attr("src")
		alt, altExists := s.Attr("alt")
		if !altExists || strings.TrimSpace(alt) == "" {
			res.ImagesNoAlt++
		}

		// [E-1] Detect non-optimized images by extension, but first check whether
		// the image is inside a <picture> element that already serves WebP/AVIF
		// via <source type="image/webp"> — so sites using server-format negotiation
		// or responsive images don't get false-positives.
		srcLower := strings.ToLower(src)
		if strings.HasSuffix(srcLower, ".png") || strings.HasSuffix(srcLower, ".jpg") || strings.HasSuffix(srcLower, ".jpeg") {
			parentPicture := s.Closest("picture")
			hasModernSource := false
			if parentPicture.Length() > 0 {
				parentPicture.Find("source[type]").Each(func(_ int, src *goquery.Selection) {
					t, _ := src.Attr("type")
					tl := strings.ToLower(t)
					if strings.Contains(tl, "webp") || strings.Contains(tl, "avif") {
						hasModernSource = true
					}
				})
			}
			if !hasModernSource {
				res.Issues = append(res.Issues, fmt.Sprintf("Non-optimized image format detected: %s (Consider using WebP or AVIF)", src))
			}
		}

		if _, lazy := s.Attr("loading"); lazy {
			res.HasLazyImages = true
		}
	})
}

// detectNodeStyleURLs finds internal links matching Drupal /node/123 or ?q= patterns.
// Returns count and up to 10 sample URLs.
func detectNodeStyleURLs(html, baseURL string) (int, []string) {
	matches := linkRe.FindAllStringSubmatch(html, -1)
	var found []string
	seen := map[string]bool{}

	for _, m := range matches {
		href := strings.TrimSpace(m[1])
		if href == "" || strings.HasPrefix(href, "#") || strings.HasPrefix(href, "javascript:") {
			continue
		}
		// Skip clearly external links.
		if !isInternalLink(href, baseURL) {
			continue
		}
		if nodeStyleRe.MatchString(href) && !seen[href] {
			seen[href] = true
			found = append(found, href)
			if len(found) >= 10 {
				break
			}
		}
	}
	return len(found), found
}

func CheckSitemap(baseURL string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(strings.TrimRight(baseURL, "/") + "/sitemap.xml")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func CheckRobotsTxt(baseURL string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(strings.TrimRight(baseURL, "/") + "/robots.txt")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func Analyze(targetURL string, html string, hasSitemap bool, hasRobots bool) SEOResult {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		// Fallback or empty result
		return SEOResult{URL: targetURL, ServiceName: "v3-seo-analyzer-go"}
	}

	res := SEOResult{
		URL:         targetURL,
		RawHTML:     html,
		ServiceName: "v3-seo-analyzer-go",
	}

	res.Meta = extractMeta(html)
	res.Headings, res.HeadingValid = extractHeadings(doc)
	res.Links = extractLinks(html, targetURL)
	// Phase F: node-style URL detection
	res.NodeStyleURLCount, res.NodeStyleURLs = detectNodeStyleURLs(html, targetURL)
	if res.NodeStyleURLCount > 0 {
		res.Issues = append(res.Issues, fmt.Sprintf("Found %d node-style URL(s) in internal links (Drupal /node/<id> or ?q= — bad for SEO)", res.NodeStyleURLCount))
	}
	extractImages(doc, &res)
	res.HasOGType, res.HasTwitterCard, res.SocialShareButtons, res.SocialSharingScore = extractSocialSharing(html)

	// Lazy loading detection (additional check)
	if !res.HasLazyImages {
		res.HasLazyImages = strings.Contains(html, `loading="lazy"`) || strings.Contains(html, `loading='lazy'`)
	}

	// URL structure check
	res.URLClean = !strings.ContainsAny(targetURL, "?&=") || strings.Count(targetURL, "?") <= 1

	// Content hash for duplicate detection — focus on main content, strip boilerplate.
	res.ContentHash = computeContentHash(doc)

	score := 100

	if res.Meta.Title == "" {
		score -= 15
		res.Issues = append(res.Issues, "Missing page title")
	}

	if !res.Meta.HasMetaDesc {
		score -= 15
		res.Issues = append(res.Issues, "Missing meta description")
	}

	if !res.HeadingValid {
		score -= 10
		res.Issues = append(res.Issues, "Invalid heading hierarchy (should have exactly 1 H1)")
	}

	if res.ImagesNoAlt > 0 {
		score -= res.ImagesNoAlt * 3
	}

	if !hasSitemap {
		score -= 10
	}

	if !hasRobots {
		score -= 10
	}

	if score < 0 {
		score = 0
	}

	res.Score = score
	res.Passed = score >= 60

	return res
}

// boilerplateSelectors lists structural elements and class/id patterns that
// contain shared template content rather than page-unique main content.
var boilerplateSelectors = []string{
	"header", "footer", "nav", "aside",
}

// boilerplateClassIDWords are substrings matched against class and id attribute
// values to remove shared-template nodes before hashing.
var boilerplateClassIDWords = []string{
	"header", "footer", "nav", "menu", "sidebar",
	"breadcrumb", "cookie", "banner", "widget",
}

// computeContentHash strips boilerplate from the document, focuses on the main
// content block, and returns an MD5 hex hash suitable for duplicate detection.
// If the extracted main content is shorter than 100 characters the function
// falls back to the full body text (behaviour identical to the old code).
func computeContentHash(doc *goquery.Document) string {
	// Clone the selection so removals don't affect the rest of the analysis.
	clone := doc.Clone()

	// Remove structural boilerplate tags.
	for _, sel := range boilerplateSelectors {
		clone.Find(sel).Remove()
	}

	// Remove elements whose class or id contains a boilerplate keyword.
	clone.Find("*").Each(func(_ int, s *goquery.Selection) {
		class, _ := s.Attr("class")
		id, _ := s.Attr("id")
		combined := strings.ToLower(class + " " + id)
		for _, word := range boilerplateClassIDWords {
			if strings.Contains(combined, word) {
				s.Remove()
				return
			}
		}
	})

	// Prefer the main content block.
	mainContent := ""
	for _, sel := range []string{"main", "article", "[role='main']", "[role=\"main\"]", ".content", "#content", "#main"} {
		clone.Find(sel).Each(func(i int, s *goquery.Selection) {
			if i == 0 {
				mainContent = strings.TrimSpace(s.Text())
			}
		})
		if mainContent != "" {
			break
		}
	}

	// Normalize whitespace.
	mainContent = strings.Join(strings.Fields(mainContent), " ")

	if len(mainContent) < 100 {
		// Fall back to full body text when the main block is too small.
		fullBody := ""
		clone.Find("body").Each(func(_ int, s *goquery.Selection) {
			fullBody = strings.Join(strings.Fields(s.Text()), " ")
		})
		if len(fullBody) >= len(mainContent) {
			mainContent = fullBody
		}
	}

	return fmt.Sprintf("%x", md5.Sum([]byte(mainContent)))
}
