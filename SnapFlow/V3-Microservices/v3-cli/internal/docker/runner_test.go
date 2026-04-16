package docker

import (
	"testing"
)

func TestLogLine_LevelParsing(t *testing.T) {
	tests := []struct {
		line     string
		expected string
	}{
		{"Some random info msg", "INFO"},
		{"[ERROR] Something broke", "ERROR"},
		{"[ WARN ] Approaching limit", "WARN"},
		{"WARNING constraint failed", "WARN"},
		{"Everything is fine", "INFO"},
		{"unexpected eRRor occurred", "ERROR"},
	}

	for _, tt := range tests {
		actual := parseLevel(tt.line)
		if actual != tt.expected {
			t.Errorf("parseLevel(%q): expected %s, got %s", tt.line, tt.expected, actual)
		}
	}
}
