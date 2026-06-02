package ux

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

type UXResult struct {
	ProductCardsMissingImages     []string `json:"product_cards_missing_images"`
	TextContentRatio              float64  `json:"text_content_ratio"`
	ContextualInternalLinks       int      `json:"contextual_internal_links"`
	ContentZoneDetected           bool     `json:"content_zone_detected"`
	ContextualMeasurementReliable bool     `json:"contextual_measurement_reliable"`
	IsReadable                    bool     `json:"is_readable"`
	HasMap                        bool     `json:"has_map"`
	// Phase E: count instead of bool
	SimulatorCount      int      `json:"simulator_count"`
	RawIPLinkCount      int      `json:"raw_ip_link_count"`
	PlainEmailsFound    []string `json:"plain_emails_found"`
	RawIPLinkKPIPassed  bool     `json:"raw_ip_link_kpi_passed"`
	PlainEmailKPIPassed bool     `json:"plain_email_kpi_passed"`
	IsFunnelStep        bool     `json:"is_funnel_step"`
	MenuStructureOK     bool     `json:"menu_structure_ok"`
	MenuStructureIssues []string `json:"menu_structure_issues"`
	IsLowContent        bool     `json:"is_low_content"`
	CleanText           string   `json:"clean_text"`
	Issues              []string `json:"issues"`
}

func hasCommerceFunnelSignal(pageURL, lowerHtml string, doc *goquery.Document) bool {
	lowerURL := strings.ToLower(pageURL)
	for _, signal := range []string{
		"/cart", "panier", "checkout", "commande", "order", "payment", "paiement",
		"mon-compte", "account", "login", "connexion",
	} {
		if strings.Contains(lowerURL, signal) {
			return true
		}
	}

	for _, signal := range []string{
		"add to cart", "ajouter au panier", "mettre au panier", "panier",
		"checkout", "passer commande", "commander", "valider la commande",
		"livraison", "paiement", "payment", "cart-summary", "shopping-cart",
	} {
		if strings.Contains(lowerHtml, signal) {
			return true
		}
	}

	for _, selector := range []string{
		"a[href*='cart']", "a[href*='panier']", "a[href*='checkout']",
		"a[href*='commande']", "a[href*='order']", "a[href*='payment']",
		"button[name*='add']", ".add-to-cart", ".ajax_add_to_cart_button",
		"[data-button-action*='add-to-cart']", "[data-link-action*='add-to-cart']",
		"form[action*='cart']", "form[action*='panier']",
	} {
		if doc.Find(selector).Length() > 0 {
			return true
		}
	}

	return false
}

func Analyze(pageURL string, html string, baseDomain string) UXResult {
	res := UXResult{
		ProductCardsMissingImages: []string{},
		PlainEmailsFound:          []string{},
		MenuStructureIssues:       []string{},
		Issues:                    []string{},
	}

	// Remove schema and www from baseDomain to make matching easier
	cleanDomain := strings.TrimPrefix(baseDomain, "http://")
	cleanDomain = strings.TrimPrefix(cleanDomain, "https://")
	cleanDomain = strings.TrimPrefix(cleanDomain, "www.")
	if parsedBase, parseErr := url.Parse(baseDomain); parseErr == nil && parsedBase.Hostname() != "" {
		cleanDomain = parsedBase.Hostname()
	}
	cleanDomain = strings.ToLower(strings.TrimPrefix(cleanDomain, "www."))

	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		res.Issues = append(res.Issues, "UX analyzer could not parse HTML")
		return res
	}

	// 1. Detect missing images in product cards
	cardSelectors := []string{".card", ".product", ".product-card", ".item", ".grid-item", ".article-card", ".bloc-produit"}
	for _, sel := range cardSelectors {
		doc.Find(sel).Each(func(i int, s *goquery.Selection) {
			text := strings.TrimSpace(s.Text())
			if len(text) > 10 {
				img := s.Find("img")
				if img.Length() == 0 {
					title := strings.TrimSpace(s.Find("h2, h3, h4, .title, .name").First().Text())
					if title == "" {
						title = text
						if len(title) > 30 {
							title = title[:30] + "..."
						}
					}
					// Check if already captured to avoid spam
					alreadyHas := false
					for _, c := range res.ProductCardsMissingImages {
						if c == title {
							alreadyHas = true
							break
						}
					}
					if !alreadyHas {
						res.ProductCardsMissingImages = append(res.ProductCardsMissingImages, title)
					}
				}
			}
		})
	}
	if len(res.ProductCardsMissingImages) > 5 {
		res.ProductCardsMissingImages = res.ProductCardsMissingImages[:5]
	}
	if len(res.ProductCardsMissingImages) > 0 {
		res.Issues = append(res.Issues, "Found product/content cards without images (Ergonomie issue)")
	}

	// 2. Detect unequal text/content ratio (density)
	res.CleanText = strings.TrimSpace(doc.Text())
	htmlLen := float64(len(html))
	textLen := float64(len(res.CleanText))
	if htmlLen > 0 {
		res.TextContentRatio = textLen / htmlLen
	}
	if res.TextContentRatio < 0.05 && htmlLen > 10000 {
		res.IsReadable = false
		res.Issues = append(res.Issues, "Very low text-to-HTML code ratio (bloated DOM or sparse text blocks)")
	} else {
		res.IsReadable = true
	}

	// 3. Detect contextual (in-article) internal links vs. menu links (Maillage)
	mainArea := doc.Find("main, article, [role='main'], #content, #main, .main-content, .content, .region-content, .layout-content, .node__content").First()
	res.ContentZoneDetected = mainArea.Length() > 0
	res.ContextualMeasurementReliable = res.ContentZoneDetected

	contextualLinks := 0
	normalizeHost := func(h string) string {
		h = strings.ToLower(strings.TrimSpace(h))
		h = strings.TrimPrefix(h, "www.")
		if parsed, err := url.Parse("//" + h); err == nil && parsed.Hostname() != "" {
			h = strings.ToLower(strings.TrimPrefix(parsed.Hostname(), "www."))
		}
		return h
	}
	baseHost := normalizeHost(cleanDomain)
	isInternalHref := func(href string) bool {
		href = strings.TrimSpace(strings.ToLower(href))
		if href == "" || strings.HasPrefix(href, "#") || strings.HasPrefix(href, "javascript:") || strings.HasPrefix(href, "mailto:") || strings.HasPrefix(href, "tel:") {
			return false
		}
		if strings.HasPrefix(href, "/") || strings.HasPrefix(href, "./") || strings.HasPrefix(href, "../") {
			return true
		}
		if strings.HasPrefix(href, "//") {
			href = "https:" + href
		}
		if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
			parsedHref, err := url.Parse(href)
			if err != nil || parsedHref.Hostname() == "" {
				return false
			}
			host := normalizeHost(parsedHref.Hostname())
			return host == baseHost
		}
		return false
	}
	isTemplateNavigationLink := func(s *goquery.Selection) bool {
		if s.Closest("nav, header, footer, [role='navigation'], .menu, .navbar, .breadcrumb, .footer, .header, .tab-nav, .accordion__nav, .nav-tabs, .nav-pills").Length() > 0 {
			return true
		}
		return s.Closest("[role='tablist']").Length() > 0
	}
	if mainArea.Length() > 0 {
		mainArea.Find("a[href]").Each(func(i int, s *goquery.Selection) {
			href, exists := s.Attr("href")
			if !exists || !isInternalHref(href) {
				return
			}

			if isTemplateNavigationLink(s) {
				return
			}

			contextualLinks++
		})
	}
	res.ContextualInternalLinks = contextualLinks
	if res.ContextualMeasurementReliable && textLen > 1500 && contextualLinks == 0 {
		res.Issues = append(res.Issues, "Missing contextual internal links (Maillage default) in main content area")
	}

	// 4. Functional heuristics on page level
	lowerHtml := strings.ToLower(html)
	if strings.Contains(lowerHtml, "google.com/maps") || strings.Contains(lowerHtml, "openstreetmap") || strings.Contains(lowerHtml, "leaflet") || strings.Contains(lowerHtml, "mapbox") || strings.Contains(lowerHtml, `id="map"`) || strings.Contains(lowerHtml, `class="map"`) {
		res.HasMap = true
	}
	// Phase E: count simulator widgets (DOM-first, text-keyword fallback)
	simCount := 0
	doc.Find(`iframe[src*="simulat"], div[class*="simulat"], a[href*="simulat"], div[id*="simulat"]`).Each(func(i int, s *goquery.Selection) {
		simCount++
	})
	if simCount == 0 {
		for _, kw := range []string{"simulateur", "calculateur", "simulator", `id="simulator"`, `class="simulator"`} {
			if strings.Contains(lowerHtml, kw) {
				simCount++
				break
			}
		}
	}
	res.SimulatorCount = simCount

	// 6. Detect conversion funnel steps
	lower := strings.ToLower(html)
	if hasCommerceFunnelSignal(pageURL, lower, doc) {
		res.IsFunnelStep = true
	}
	if strings.Contains(lower, "étape ") || strings.Contains(lower, "step ") || strings.Contains(lower, "suivant") || strings.Contains(lower, "next") {
		doc.Find("button, a.btn, .button").Each(func(i int, s *goquery.Selection) {
			txt := strings.ToLower(s.Text())
			if strings.Contains(txt, "continuer") || strings.Contains(txt, "suivant") || strings.Contains(txt, "next") || strings.Contains(txt, "valider") {
				res.IsFunnelStep = true
			}
		})
	}

	// 7. Detect Raw IP Links (Phase E: count not bool)
	ipRegex := regexp.MustCompile(`https?://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`)
	ipMatches := ipRegex.FindAllString(html, -1)
	res.RawIPLinkCount = len(ipMatches)
	if res.RawIPLinkCount > 0 {
		res.Issues = append(res.Issues, fmt.Sprintf("Found %d link(s) using raw IP addresses (Security/Trust issue)", res.RawIPLinkCount))
	}
	res.RawIPLinkKPIPassed = res.RawIPLinkCount == 0

	// 8. Detect Plain Emails not wrapped in mailto: (Phase E: collect all)
	emailRegex := regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	doc.Find("body").Each(func(i int, s *goquery.Selection) {
		text := s.Text()
		emails := emailRegex.FindAllString(text, -1)
		for _, email := range emails {
			foundInLink := false
			doc.Find("a[href^='mailto:']").Each(func(j int, a *goquery.Selection) {
				href := a.AttrOr("href", "")
				if strings.Contains(href, email) {
					foundInLink = true
				}
			})
			if !foundInLink {
				res.PlainEmailsFound = append(res.PlainEmailsFound, email)
				res.Issues = append(res.Issues, fmt.Sprintf("Email address found without mailto link: %s", email))
			}
		}
	})
	res.PlainEmailKPIPassed = len(res.PlainEmailsFound) == 0

	// 9. Detect menu structure quality (D8)
	nav := doc.Find("nav").First()
	if nav.Length() == 0 {
		res.MenuStructureIssues = append(res.MenuStructureIssues, "No <nav> element found")
	} else {
		emptyLinks := 0
		dedup := map[string]int{}
		nav.Find("a[href]").Each(func(i int, s *goquery.Selection) {
			href := strings.TrimSpace(strings.ToLower(s.AttrOr("href", "")))
			text := strings.TrimSpace(s.Text())
			if href == "" || href == "#" || href == "javascript:void(0)" || text == "" {
				emptyLinks++
			}
			if href != "" {
				dedup[href]++
			}
		})

		duplicateLinks := 0
		for _, count := range dedup {
			if count > 1 {
				duplicateLinks++
			}
		}

		// [U-2] Modern mega-menus use aria-expanded / data-* attributes, not ul ul nesting.
		// Check all common patterns before flagging absent submenu structure.
		hasSubMenu := nav.Find(
			"ul ul, li ul, .submenu, .dropdown-menu, [aria-haspopup], [data-dropdown], [data-toggle='dropdown'], [aria-expanded]",
		).Length() > 0
		if !hasSubMenu {
			res.MenuStructureIssues = append(res.MenuStructureIssues, "No submenu/dropdown structure detected")
		}
		if emptyLinks > 0 {
			res.MenuStructureIssues = append(res.MenuStructureIssues, fmt.Sprintf("%d empty/non-actionable nav link(s)", emptyLinks))
		}
		if duplicateLinks > 2 {
			res.MenuStructureIssues = append(res.MenuStructureIssues, fmt.Sprintf("%d duplicate nav href(s)", duplicateLinks))
		}
	}
	res.MenuStructureOK = len(res.MenuStructureIssues) == 0
	if !res.MenuStructureOK {
		res.Issues = append(res.Issues, "Menu structure issues detected")
	}

	// 10. Detect Low Content Pages (Empty/Thin pages)
	words := strings.Fields(res.CleanText)
	if len(words) < 50 && len(words) > 0 {
		res.IsLowContent = true
		res.Issues = append(res.Issues, "Page has very low text content (Thin content issue)")
	}

	return res
}
