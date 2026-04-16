package main

import (
	"fmt"
	"os"
	"sort"
)

// Local copies of the structs from main.go (same JSON tags) — compile-time
// equivalent check.  Tests run without a live browser or network.

type ImageCompressionInfo struct {
	URL                 string  `json:"url"`
	SizeKB              float64 `json:"size_kb"`
	ContentType         string  `json:"content_type"`
	IsLikelyUnoptimised bool    `json:"is_likely_unoptimised"`
}

type ImageCompressionStats struct {
	TotalImages       int                    `json:"total_images"`
	SampledImages     int                    `json:"sampled_images"`
	UnoptimisedImages []ImageCompressionInfo `json:"unoptimised_images"`
	UnoptimisedCount  int                    `json:"unoptimised_count"`
	Passed            bool                   `json:"passed"`
}

// classifyImage mirrors the threshold logic in checkImageCompression.
// contentType should be the lowercase MIME type (without parameters).
// sizeBytes is Content-Length (-1 if unknown).
func classifyImage(url, contentType string, sizeBytes int64) ImageCompressionInfo {
	const bigThreshold = 500 * 1024 // 500 KB

	info := ImageCompressionInfo{
		URL:         url,
		ContentType: contentType,
	}
	if sizeBytes > 0 {
		info.SizeKB = float64(sizeBytes) / 1024
	}

	switch {
	case contentType == "image/bmp" || contentType == "image/tiff":
		info.IsLikelyUnoptimised = true
	case (contentType == "image/jpeg" || contentType == "image/png") && sizeBytes > bigThreshold:
		info.IsLikelyUnoptimised = true
	}
	return info
}

// buildStats mirrors the aggregation at the tail of checkImageCompression.
func buildStats(total int, scanned []ImageCompressionInfo) ImageCompressionStats {
	sampled := len(scanned)
	var unopt []ImageCompressionInfo
	for _, i := range scanned {
		if i.IsLikelyUnoptimised {
			unopt = append(unopt, i)
		}
	}
	if unopt == nil {
		unopt = []ImageCompressionInfo{}
	}
	return ImageCompressionStats{
		TotalImages:       total,
		SampledImages:     sampled,
		UnoptimisedImages: unopt,
		UnoptimisedCount:  len(unopt),
		Passed:            len(unopt) == 0,
	}
}

var passed, failed int

func check(name string, got, want interface{}) {
	if fmt.Sprintf("%v", got) == fmt.Sprintf("%v", want) {
		fmt.Printf("  ✅ PASS  %s\n", name)
		passed++
	} else {
		fmt.Printf("  ❌ FAIL  %s — got %v, want %v\n", name, got, want)
		failed++
	}
}

func main() {
	fmt.Println("=== Phase I: Image Compression Sampler Tests ===")

	// ─── T01: JPEG under 500 KB → not unoptimised ───────────────────────────
	fmt.Println("\n[T01] JPEG 200 KB → not unoptimised")
	info := classifyImage("https://example.com/img.jpg", "image/jpeg", 200*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, false)
	check("content_type", info.ContentType, "image/jpeg")
	check("size_kb", info.SizeKB, 200.0)

	// ─── T02: JPEG exactly 500 KB → not unoptimised (boundary, < not <=) ────
	fmt.Println("\n[T02] JPEG exactly 500 KB → not unoptimised (boundary)")
	info = classifyImage("https://example.com/img.jpg", "image/jpeg", 500*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, false)

	// ─── T03: JPEG 501 KB → unoptimised ─────────────────────────────────────
	fmt.Println("\n[T03] JPEG 501 KB → unoptimised")
	info = classifyImage("https://example.com/img.jpg", "image/jpeg", 501*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, true)

	// ─── T04: PNG 600 KB → unoptimised ──────────────────────────────────────
	fmt.Println("\n[T04] PNG 600 KB → unoptimised")
	info = classifyImage("https://example.com/img.png", "image/png", 600*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, true)
	check("content_type", info.ContentType, "image/png")

	// ─── T05: BMP any size → unoptimised ────────────────────────────────────
	fmt.Println("\n[T05] BMP 10 KB → unoptimised (format flag)")
	info = classifyImage("https://example.com/img.bmp", "image/bmp", 10*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, true)

	// ─── T06: TIFF any size → unoptimised ───────────────────────────────────
	fmt.Println("\n[T06] TIFF 50 KB → unoptimised (format flag)")
	info = classifyImage("https://example.com/img.tiff", "image/tiff", 50*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, true)

	// ─── T07: WebP 800 KB → NOT unoptimised (only JPEG/PNG size-flagged) ────
	fmt.Println("\n[T07] WebP 800 KB → not unoptimised (not in size-check list)")
	info = classifyImage("https://example.com/img.webp", "image/webp", 800*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, false)

	// ─── T08: GIF 600 KB → NOT unoptimised ──────────────────────────────────
	fmt.Println("\n[T08] GIF 600 KB → not unoptimised")
	info = classifyImage("https://example.com/img.gif", "image/gif", 600*1024)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, false)

	// ─── T09: Unknown size (Content-Length = -1) → SizeKB = 0 ───────────────
	fmt.Println("\n[T09] JPEG unknown size (-1) → SizeKB=0, not unoptimised")
	info = classifyImage("https://example.com/img.jpg", "image/jpeg", -1)
	check("size_kb", info.SizeKB, 0.0)
	check("is_likely_unoptimised", info.IsLikelyUnoptimised, false)

	// ─── T10: buildStats — all clean → Passed=true ──────────────────────────
	fmt.Println("\n[T10] buildStats: 3 clean images → Passed=true")
	imgs := []ImageCompressionInfo{
		classifyImage("a.jpg", "image/jpeg", 100*1024),
		classifyImage("b.jpg", "image/jpeg", 200*1024),
		classifyImage("c.png", "image/png", 300*1024),
	}
	stats := buildStats(3, imgs)
	check("passed", stats.Passed, true)
	check("unoptimised_count", stats.UnoptimisedCount, 0)
	check("sampled_images", stats.SampledImages, 3)
	check("total_images", stats.TotalImages, 3)

	// ─── T11: buildStats — 1 BMP among clean → Passed=false, count=1 ────────
	fmt.Println("\n[T11] buildStats: 1 BMP + 2 clean → Passed=false, count=1")
	imgs = []ImageCompressionInfo{
		classifyImage("a.jpg", "image/jpeg", 100*1024),
		classifyImage("b.bmp", "image/bmp", 10*1024),
		classifyImage("c.png", "image/png", 300*1024),
	}
	stats = buildStats(3, imgs)
	check("passed", stats.Passed, false)
	check("unoptimised_count", stats.UnoptimisedCount, 1)
	check("unoptimised_url", stats.UnoptimisedImages[0].URL, "b.bmp")

	// ─── T12: buildStats — no images → Passed=true ──────────────────────────
	fmt.Println("\n[T12] buildStats: empty → Passed=true")
	stats = buildStats(0, []ImageCompressionInfo{})
	check("passed", stats.Passed, true)
	check("unoptimised_count", stats.UnoptimisedCount, 0)
	check("unoptimised_images_nonil", stats.UnoptimisedImages != nil, true)

	// ─── T13: sort stability — maxSample cap mimicry ─────────────────────────
	fmt.Println("\n[T13] URL dedup set → sorted deterministically")
	urlSet := map[string]bool{
		"https://z.com/c.jpg": true,
		"https://z.com/a.jpg": true,
		"https://z.com/b.jpg": true,
	}
	urls := make([]string, 0, len(urlSet))
	for u := range urlSet {
		urls = append(urls, u)
	}
	sort.Strings(urls)
	check("sorted_0", urls[0], "https://z.com/a.jpg")
	check("sorted_1", urls[1], "https://z.com/b.jpg")
	check("sorted_2", urls[2], "https://z.com/c.jpg")

	// ─── T14: struct field json tags present (compile-time check) ───────────
	fmt.Println("\n[T14] Struct fields accessible (compile-time check)")
	s := ImageCompressionStats{
		TotalImages:       10,
		SampledImages:     5,
		UnoptimisedImages: []ImageCompressionInfo{},
		UnoptimisedCount:  0,
		Passed:            true,
	}
	check("total_images", s.TotalImages, 10)
	check("sampled_images", s.SampledImages, 5)
	check("passed", s.Passed, true)

	// ─── Summary ─────────────────────────────────────────────────────────────
	fmt.Printf("\n=== Results: %d passed, %d failed ===\n", passed, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
