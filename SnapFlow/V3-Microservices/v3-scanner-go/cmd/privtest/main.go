// Phase C validation tests: security_policy link, information rights, consent checkbox.
// Run: go run ./cmd/privtest/main.go (from v3-scanner-go root)
package main

import (
	"fmt"
	"snapflow/v3-scanner-go/analyzers/privacy"
)

type testCase struct {
	name              string
	html              string
	wantSecPolicy     bool
	wantInfoRights    bool
	wantConsentChkbox bool
	wantHasPrivPolicy bool
	wantPassed        bool
}

func main() {
	cases := []testCase{
		// ── Security policy link ──────────────────────────────────────────────
		{
			name: "Security policy link via 'politique de sécurité'",
			html: `<a href="/securite">Politique de sécurité informatique</a>
					<a href="/privacy">Politique de confidentialité</a>
					<div class="didomi-popup">Cookie consent</div>
					<p>Droit d'accès à vos données personnelles.</p>`,
			wantSecPolicy:     true,
			wantInfoRights:    true,
			wantConsentChkbox: false,
			wantHasPrivPolicy: true,
			wantPassed:        true,
		},
		{
			name:              "Security policy link via 'security policy' English",
			html:              `<a href="/legal/security-policy">Security Policy</a>`,
			wantSecPolicy:     true,
			wantInfoRights:    false,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name:              "Security policy via 'charte sécurité'",
			html:              `<a href="/charte">Charte sécurité</a>`,
			wantSecPolicy:     true,
			wantInfoRights:    false,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name:              "No security policy link",
			html:              `<a href="/about">About us</a><p>Hello world</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    false,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},

		// ── Information rights ────────────────────────────────────────────────
		{
			name:              "Droit d'accès mentioned",
			html:              `<p>Vous disposez d'un droit d'accès à vos données.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    true,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name:              "Droit de rectification mentioned",
			html:              `<p>Vous avez un droit de rectification.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    true,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name:              "Right to erasure (English) mentioned",
			html:              `<p>You have the right to erasure of your personal data.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    true,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name:              "Data subject rights mentioned",
			html:              `<p>Data subject rights are protected under GDPR.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    true,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name:              "Droits des personnes mentioned",
			html:              `<p>Les droits des personnes concernées sont garantis.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    true,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},

		// ── Consent checkbox near RGPD keyword ───────────────────────────────
		{
			name: "Checkbox near 'consentement'",
			html: `<div class="rgpd-form">
						<p>Votre consentement est requis.</p>
						<input type="checkbox" name="agree" id="consent">
						<label for="consent">J'accepte la politique de confidentialité</label>
					</div>`,
			wantSecPolicy:     false,
			wantInfoRights:    false,
			wantConsentChkbox: true,
			wantHasPrivPolicy: false, // text is in <label>, not in <a href>
			wantPassed:        false,
		},
		{
			name: "Checkbox near 'données personnelles'",
			html: `<p>En soumettant ce formulaire, vous acceptez le traitement de vos données personnelles.</p>
					<input type="checkbox" id="agree">`,
			wantSecPolicy:     false,
			wantInfoRights:    false,
			wantConsentChkbox: true,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},
		{
			name: "Checkbox far from RGPD keywords (>500 chars away)",
			html: `<input type="checkbox" id="unrelated">` +
				// 600 chars of filler
				"<!-- " + repeatStr("x", 600) + " -->" +
				`<p>Politique de confidentialité et RGPD.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    false,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false, // plain <p> text, not a link — no <a href>
			wantPassed:        false,
		},
		{
			name:              "No checkbox at all",
			html:              `<p>RGPD consentement données personnelles.</p>`,
			wantSecPolicy:     false,
			wantInfoRights:    false,
			wantConsentChkbox: false,
			wantHasPrivPolicy: false,
			wantPassed:        false,
		},

		// ── Full compliant page ───────────────────────────────────────────────
		{
			name: "Fully compliant privacy page",
			html: `<!-- Didomi CMP -->
					<script src="https://sdk.privacy-center.org/didomi/loader.js"></script>
					<footer>
						<a href="/politique-de-confidentialite">Politique de confidentialité</a>
						<a href="/securite-informatique">Politique de sécurité informatique</a>
					</footer>
					<div class="rgpd">
						<p>Droit d'accès, droit de rectification et droits des personnes conformément au RGPD.</p>
						<input type="checkbox" id="consent">
						<label for="consent">J'accepte le traitement de mes données personnelles</label>
					</div>`,
			wantSecPolicy:     true,
			wantInfoRights:    true,
			wantConsentChkbox: true,
			wantHasPrivPolicy: true,
			wantPassed:        true,
		},
	}

	pass, fail := 0, 0
	for _, tc := range cases {
		res := privacy.Analyze(tc.html)

		ok := res.HasSecurityPolicy == tc.wantSecPolicy &&
			res.HasInformationRights == tc.wantInfoRights &&
			res.HasConsentCheckbox == tc.wantConsentChkbox &&
			res.HasPrivacyPolicy == tc.wantHasPrivPolicy &&
			res.Passed == tc.wantPassed

		if ok {
			fmt.Printf("  PASS  %s\n", tc.name)
			pass++
		} else {
			fmt.Printf("  FAIL  %s\n", tc.name)
			if res.HasSecurityPolicy != tc.wantSecPolicy {
				fmt.Printf("        HasSecurityPolicy:    got=%v want=%v\n", res.HasSecurityPolicy, tc.wantSecPolicy)
			}
			if res.HasInformationRights != tc.wantInfoRights {
				fmt.Printf("        HasInformationRights: got=%v want=%v\n", res.HasInformationRights, tc.wantInfoRights)
			}
			if res.HasConsentCheckbox != tc.wantConsentChkbox {
				fmt.Printf("        HasConsentCheckbox:   got=%v want=%v\n", res.HasConsentCheckbox, tc.wantConsentChkbox)
			}
			if res.HasPrivacyPolicy != tc.wantHasPrivPolicy {
				fmt.Printf("        HasPrivacyPolicy:     got=%v want=%v\n", res.HasPrivacyPolicy, tc.wantHasPrivPolicy)
			}
			if res.Passed != tc.wantPassed {
				fmt.Printf("        Passed:               got=%v want=%v issues=%v\n", res.Passed, tc.wantPassed, res.Issues)
			}
			fail++
		}
	}
	fmt.Printf("\n%d passed, %d failed\n", pass, fail)
}

func repeatStr(s string, n int) string {
	result := make([]byte, len(s)*n)
	for i := 0; i < n; i++ {
		copy(result[i*len(s):], s)
	}
	return string(result)
}
