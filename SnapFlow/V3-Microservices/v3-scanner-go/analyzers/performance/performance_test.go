package performance

import (
	"os"
	"testing"
)

func TestParseEnvBool(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		want   bool
		okWant bool
	}{
		{name: "true", input: "true", want: true, okWant: true},
		{name: "1", input: "1", want: true, okWant: true},
		{name: "yes", input: "yes", want: true, okWant: true},
		{name: "false", input: "false", want: false, okWant: true},
		{name: "0", input: "0", want: false, okWant: true},
		{name: "invalid", input: "abc", want: false, okWant: false},
		{name: "empty", input: "", want: false, okWant: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseEnvBool(tc.input)
			if got != tc.want || ok != tc.okWant {
				t.Fatalf("parseEnvBool(%q)=(%v,%v), want (%v,%v)", tc.input, got, ok, tc.want, tc.okWant)
			}
		})
	}
}

func TestShouldDisableSandboxExplicitEnv(t *testing.T) {
	old := os.Getenv("CHROME_NO_SANDBOX")
	defer os.Setenv("CHROME_NO_SANDBOX", old)

	os.Setenv("CHROME_NO_SANDBOX", "false")
	if shouldDisableSandbox() {
		t.Fatal("expected shouldDisableSandbox=false when CHROME_NO_SANDBOX=false")
	}

	os.Setenv("CHROME_NO_SANDBOX", "true")
	if !shouldDisableSandbox() {
		t.Fatal("expected shouldDisableSandbox=true when CHROME_NO_SANDBOX=true")
	}
}
