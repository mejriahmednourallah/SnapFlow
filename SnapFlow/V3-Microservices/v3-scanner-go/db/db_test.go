package db

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizeDBTextKeepsValidUTF8(t *testing.T) {
	input := "<html><body>Valid UTF-8 page</body></html>"
	got := sanitizeDBText(input)
	if got != input {
		t.Fatalf("expected valid UTF-8 to stay unchanged, got %q", got)
	}
}

func TestSanitizeDBTextRemovesNullBytes(t *testing.T) {
	got := sanitizeDBText("abc\x00def\x00")
	if got != "abcdef" {
		t.Fatalf("expected null bytes to be removed, got %q", got)
	}
}

func TestSanitizeDBTextRepairsInvalidUTF8(t *testing.T) {
	input := string([]byte{'<', 'h', 't', 'm', 'l', '>', 0xf7, 0xff, 0x00, '<', '/', 'h', 't', 'm', 'l', '>'})
	got := sanitizeDBText(input)

	if !utf8.ValidString(got) {
		t.Fatalf("expected sanitized HTML to be valid UTF-8: %q", got)
	}
	if strings.ContainsRune(got, '\x00') {
		t.Fatalf("expected sanitized HTML to contain no null bytes: %q", got)
	}
	if !strings.Contains(got, "\uFFFD") {
		t.Fatalf("expected invalid bytes to be replaced by U+FFFD: %q", got)
	}
}
