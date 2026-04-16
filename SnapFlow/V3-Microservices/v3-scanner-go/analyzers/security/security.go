package security

import (
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─── Structs ──────────────────────────────────────────────────────────────────

type HeaderCheck struct {
	Header  string `json:"header"`
	Present bool   `json:"present"`
	Value   string `json:"value,omitempty"`
}

type SSLInfo struct {
	Valid    bool   `json:"valid"`
	Issuer   string `json:"issuer,omitempty"`
	Expiry   string `json:"expiry,omitempty"`
	Protocol string `json:"protocol,omitempty"`
	Error    string `json:"error,omitempty"`
	// Status is set to "non_evalue" when the probe ran but data couldn't be determined (e.g. empty cert chain).
	Status   string `json:"status,omitempty"`
}

// CookieFlagResult holds a single cookie that is missing HttpOnly or Secure.
type CookieFlagResult struct {
	Name            string `json:"name"`
	MissingHttpOnly bool   `json:"missing_http_only"`
	MissingSecure   bool   `json:"missing_secure"`
}

// ─── Tech Info for CVE Matching ───────────────────────────────────────────────

type TechInfo struct {
	Name    string
	Version string
}

// ─── GROUP A: Wordlist Probes ─────────────────────────────────────────────────

type AdminExposureResult struct {
	Exposed      []string       `json:"exposed"`
	Forbidden    []string       `json:"forbidden"`
	ServerErrors []string       `json:"server_errors"`
	StatusCodes  map[string]int `json:"status_codes"`
	Status       string         `json:"status"` // "pass" | "warning" | "fail"
	Severity     string         `json:"severity"`
	Impact       string         `json:"impact"` // populated by aggregator
}

type VersionDisclosureResult struct {
	Disclosed    []string       `json:"disclosed"`
	Forbidden    []string       `json:"forbidden"`
	ServerErrors []string       `json:"server_errors"`
	StatusCodes  map[string]int `json:"status_codes"`
	Status       string         `json:"status"`
	Severity     string         `json:"severity"`
	Impact       string         `json:"impact"`
}

type SensitiveFileResult struct {
	Exposed      []string       `json:"exposed"`
	Forbidden    []string       `json:"forbidden"`
	ServerErrors []string       `json:"server_errors"`
	StatusCodes  map[string]int `json:"status_codes"`
	Status       string         `json:"status"`
	Severity     string         `json:"severity"`
	Impact       string         `json:"impact"`
}

// ─── GROUP B: Passive Checks ──────────────────────────────────────────────────

type RobotsTxtResult struct {
	DisclosedPaths []string `json:"disclosed_paths"`
	Status         string   `json:"status"`
	Severity       string   `json:"severity"`
	Impact         string   `json:"impact"`
}

type ErrorPageLeakResult struct {
	LeakIndicators []string `json:"leak_indicators"`
	Status         string   `json:"status"`
	Severity       string   `json:"severity"`
	Impact         string   `json:"impact"`
}

type TraceMethodsResult struct {
	Detected bool   `json:"detected"`
	Status   string `json:"status"`
	Severity string `json:"severity"`
	Impact   string `json:"impact"`
}

type CORSResult struct {
	Misconfigured bool   `json:"misconfigured"`
	Status        string `json:"status"`
	Severity      string `json:"severity"`
	Impact        string `json:"impact"`
	Details       string `json:"details,omitempty"`
}

// ─── GROUP C: Form-Based Checks ───────────────────────────────────────────────

type BruteForceResult struct {
	Protected bool   `json:"protected"`
	Status    string `json:"status"`
	Severity  string `json:"severity"`
	Impact    string `json:"impact"`
	Details   string `json:"details,omitempty"`
}

type FileUploadResult struct {
	RestrictionsFound bool     `json:"restrictions_found"`
	Issues            []string `json:"issues"`
	Status            string   `json:"status"`
	Severity          string   `json:"severity"`
	Impact            string   `json:"impact"`
}

type ExposedService struct {
	Port    int    `json:"port"`
	Service string `json:"service"`
	State   string `json:"state"`
	Risk    string `json:"risk"`
	Banner  string `json:"banner,omitempty"`
	Note    string `json:"note,omitempty"`
}

type ServiceExposureResult struct {
	Enabled      bool             `json:"enabled"`
	Host         string           `json:"host,omitempty"`
	TimeoutMS    int              `json:"timeout_ms,omitempty"`
	PortsScanned []int            `json:"ports_scanned,omitempty"`
	OpenServices []ExposedService `json:"open_services"`
	Status       string           `json:"status"`
	Severity     string           `json:"severity"`
	Impact       string           `json:"impact"`
	Warning      string           `json:"warning,omitempty"`
	Error        string           `json:"error,omitempty"`
}

// ─── GROUP D: Data-Matching Check ─────────────────────────────────────────────

type VulnerableLibrary struct {
	Name     string   `json:"name"`
	Version  string   `json:"version"`
	CVEs     []string `json:"cves"`
	Severity string   `json:"severity"`
	Source   string   `json:"source"` // "hardcoded" | "osv"
}

type VulnerableJSResult struct {
	VulnerableLibraries []VulnerableLibrary `json:"vulnerable_libraries"`
	Status              string              `json:"status"`
	Severity            string              `json:"severity"`
	Impact              string              `json:"impact"`
}

// ─── ScanResult: Consolidated Results ──────────────────────────────────────────

type ScanResult struct {
	URL            string        `json:"url"`
	SSL            SSLInfo       `json:"ssl"`
	Headers        []HeaderCheck `json:"headers"`
	MissingHeaders []string      `json:"missing_headers"`
	CacheControl   string        `json:"cache_control,omitempty"`
	HasCache       bool          `json:"has_cache"`
	Compression    string        `json:"compression,omitempty"`
	HasCompression bool          `json:"has_compression"`

	// ── Phase B (Existing): Cookie flag KPI ────────────────────────────────────
	CookiesWithMissingFlags []CookieFlagResult `json:"cookies_with_missing_flags"`
	MissingCookieFlagCount  int                `json:"missing_cookie_flag_count"`
	CookieKPIPassed         bool               `json:"cookie_kpi_passed"`

	// ── Phase B (Existing): Exposed sensitive paths KPI ───────────────────────
	ExposedPaths         []string `json:"exposed_paths"`
	GoogleDorksVulnCount int      `json:"google_dorks_vuln_count"`
	ExposedPathKPIPassed bool     `json:"exposed_path_kpi_passed"`

	// ── Checks 1-10 (New): Group A - Wordlist Probes ────────────────────────
	AdminSensitivePageExposed AdminExposureResult     `json:"admin_sensitive_page_exposed"`
	VersionDisclosureCMS      VersionDisclosureResult `json:"version_disclosure_cms"`
	SensitiveFileExposed      SensitiveFileResult     `json:"sensitive_file_exposed"`

	// ── Checks 1-10 (New): Group B - Passive Checks ────────────────────────
	RobotsTxtInfoDisclosure RobotsTxtResult     `json:"robots_txt_info_disclosure"`
	CustomErrorPageInfoLeak ErrorPageLeakResult `json:"custom_error_page_info_leak"`
	HTTPTraceMethods        TraceMethodsResult  `json:"http_trace_methods"`
	CORSMisconfiguration    CORSResult          `json:"cors_misconfiguration"`

	// ── Checks 1-10 (New): Group C - Form-Based Checks ─────────────────────
	BruteForcedProtectionLogin BruteForceResult `json:"bruteforced_protection_login"`
	FileUploadExtensionControl FileUploadResult `json:"file_upload_extension_control"`

	// ── Checks 1-10 (New): Group D - Data-Matching Check ───────────────────
	VulnerableJSDependencies VulnerableJSResult `json:"vulnerable_js_dependencies"`
	ServiceExposure          ServiceExposureResult `json:"service_exposure"`

	// Overall pass/fail: SSL valid + no missing critical headers
	Passed      bool   `json:"passed"`
	ServiceName string `json:"service_name"`
}

type servicePortSpec struct {
	Name string
	Risk string
	Note string
}

var defaultPortScanPorts = []int{21, 22, 25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995, 1433, 1521, 3306, 3389, 5432, 6379, 8080, 8443}

var servicePortCatalog = map[int]servicePortSpec{
	21:   {Name: "FTP", Risk: "high", Note: "File transfer may expose credentials when misconfigured."},
	22:   {Name: "SSH", Risk: "medium", Note: "Harden with keys, fail2ban, and strict allow-lists."},
	25:   {Name: "SMTP", Risk: "medium", Note: "Verify relay restrictions and anti-abuse controls."},
	53:   {Name: "DNS", Risk: "medium", Note: "Avoid open resolver behavior and unwanted recursion."},
	80:   {Name: "HTTP", Risk: "low", Note: "Keep redirect to HTTPS and harden headers."},
	110:  {Name: "POP3", Risk: "high", Note: "Prefer encrypted variants only."},
	143:  {Name: "IMAP", Risk: "high", Note: "Prefer encrypted variants only."},
	443:  {Name: "HTTPS", Risk: "low", Note: "Standard web endpoint; maintain TLS hygiene."},
	445:  {Name: "SMB", Risk: "critical", Note: "Never expose SMB publicly."},
	465:  {Name: "SMTPS", Risk: "medium", Note: "Mail service should be strictly hardened."},
	587:  {Name: "SMTP Submission", Risk: "medium", Note: "Require auth and TLS."},
	993:  {Name: "IMAPS", Risk: "medium", Note: "Restrict exposure to trusted networks."},
	995:  {Name: "POP3S", Risk: "medium", Note: "Restrict exposure to trusted networks."},
	1433: {Name: "MSSQL", Risk: "critical", Note: "Database ports should not be internet-exposed."},
	1521: {Name: "Oracle", Risk: "critical", Note: "Database ports should not be internet-exposed."},
	3306: {Name: "MySQL", Risk: "critical", Note: "Database ports should not be internet-exposed."},
	3389: {Name: "RDP", Risk: "critical", Note: "Remote desktop should not be exposed to public internet."},
	5432: {Name: "PostgreSQL", Risk: "critical", Note: "Database ports should not be internet-exposed."},
	6379: {Name: "Redis", Risk: "critical", Note: "Never expose unauthenticated Redis publicly."},
	8080: {Name: "HTTP-alt/Proxy", Risk: "medium", Note: "Often hosts admin or alternate services."},
	8443: {Name: "HTTPS-alt/Proxy", Risk: "medium", Note: "Often hosts admin or alternate services."},
}

func envBool(name string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(name)))
	if v == "" {
		return def
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return def
	}
}

func envInt(name string, def int) int {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func parsePortScanList() []int {
	raw := strings.TrimSpace(os.Getenv("PORT_SCAN_PORTS"))
	if raw == "" {
		ports := make([]int, len(defaultPortScanPorts))
		copy(ports, defaultPortScanPorts)
		return ports
	}

	seen := map[int]bool{}
	ports := []int{}
	for _, token := range strings.Split(raw, ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		p, err := strconv.Atoi(token)
		if err != nil || p <= 0 || p > 65535 {
			continue
		}
		if !seen[p] {
			seen[p] = true
			ports = append(ports, p)
		}
	}
	if len(ports) == 0 {
		ports = append(ports, defaultPortScanPorts...)
	}
	sort.Ints(ports)
	return ports
}

func resolveScanHost(targetURL string) string {
	u, err := url.Parse(strings.TrimSpace(targetURL))
	if err == nil && u.Hostname() != "" {
		return strings.TrimSpace(u.Hostname())
	}
	trimmed := strings.TrimSpace(targetURL)
	trimmed = strings.TrimPrefix(trimmed, "https://")
	trimmed = strings.TrimPrefix(trimmed, "http://")
	if i := strings.IndexByte(trimmed, '/'); i >= 0 {
		trimmed = trimmed[:i]
	}
	if i := strings.IndexByte(trimmed, ':'); i >= 0 {
		trimmed = trimmed[:i]
	}
	return strings.TrimSpace(trimmed)
}

func classifyServiceRisk(openServices []ExposedService) (string, string, string) {
	if len(openServices) == 0 {
		return "pass", "low", "No monitored risky ports were reachable."
	}
	hasCritical := false
	hasHigh := false
	for _, svc := range openServices {
		switch svc.Risk {
		case "critical":
			hasCritical = true
		case "high":
			hasHigh = true
		}
	}
	if hasCritical {
		return "fail", "critical", "Critical service exposure detected (database/remote administration port reachable)."
	}
	if hasHigh {
		return "warning", "high", "High-risk internet-exposed services detected."
	}
	return "warning", "medium", "Non-critical exposed services detected; verify necessity and hardening."
}

func probeServiceBanner(conn net.Conn, port int) string {
	_ = conn.SetReadDeadline(time.Now().Add(700 * time.Millisecond))
	buf := make([]byte, 256)
	n, err := conn.Read(buf)
	if err != nil || n <= 0 {
		return ""
	}
	banner := strings.TrimSpace(strings.ReplaceAll(string(buf[:n]), "\x00", ""))
	banner = strings.ReplaceAll(banner, "\r", "")
	banner = strings.ReplaceAll(banner, "\n", " ")
	if len(banner) > 180 {
		banner = banner[:180]
	}
	// Avoid noisy non-printable banners in JSON output.
	if strings.Count(banner, "?") > len(banner)/3 {
		return ""
	}
	return banner
}

func scanExposedServices(targetURL string, responseHeaders *http.Header) ServiceExposureResult {
	if !envBool("ENABLE_PORT_SCAN", false) {
		return ServiceExposureResult{
			Enabled:      false,
			OpenServices: []ExposedService{},
			Status:       "non_evalue",
			Severity:     "info",
			Impact:       "Port scan disabled by policy.",
			Warning:      "Set ENABLE_PORT_SCAN=true to enable TCP reachability checks on monitored ports.",
		}
	}

	host := resolveScanHost(targetURL)
	if host == "" {
		return ServiceExposureResult{
			Enabled:      true,
			OpenServices: []ExposedService{},
			Status:       "non_evalue",
			Severity:     "info",
			Impact:       "Could not resolve host for service exposure scan.",
			Error:        "host_unresolved",
		}
	}

	timeoutMS := envInt("PORT_SCAN_TIMEOUT_MS", 900)
	if timeoutMS < 100 {
		timeoutMS = 100
	}
	if timeoutMS > 5000 {
		timeoutMS = 5000
	}

	ports := parsePortScanList()
	open := make([]ExposedService, 0, len(ports))
	mu := sync.Mutex{}
	wg := sync.WaitGroup{}
	sem := make(chan struct{}, 24)
	serverHeader := strings.TrimSpace(responseHeaders.Get("Server"))

	for _, port := range ports {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			addr := net.JoinHostPort(host, strconv.Itoa(p))
			conn, err := net.DialTimeout("tcp", addr, time.Duration(timeoutMS)*time.Millisecond)
			if err != nil {
				return
			}
			defer conn.Close()

			spec, ok := servicePortCatalog[p]
			if !ok {
				spec = servicePortSpec{Name: "Unknown", Risk: "medium", Note: "Open port should be reviewed and justified."}
			}

			banner := probeServiceBanner(conn, p)
			if (p == 80 || p == 443 || p == 8080 || p == 8443) && banner == "" && serverHeader != "" {
				banner = serverHeader
			}

			mu.Lock()
			open = append(open, ExposedService{
				Port:    p,
				Service: spec.Name,
				State:   "open",
				Risk:    spec.Risk,
				Banner:  banner,
				Note:    spec.Note,
			})
			mu.Unlock()
		}(port)
	}
	wg.Wait()

	sort.Slice(open, func(i, j int) bool { return open[i].Port < open[j].Port })
	status, severity, impact := classifyServiceRisk(open)

	return ServiceExposureResult{
		Enabled:      true,
		Host:         host,
		TimeoutMS:    timeoutMS,
		PortsScanned: ports,
		OpenServices: open,
		Status:       status,
		Severity:     severity,
		Impact:       impact,
	}
}

// ─── Configuration ────────────────────────────────────────────────────────────

var securityHeaders = []string{
	"Strict-Transport-Security",
	"Content-Security-Policy",
	"X-Content-Type-Options",
	"X-Frame-Options",
	"Referrer-Policy",
	"Permissions-Policy",
}

// sensitivePaths: probed via HTTP HEAD to detect exposed files.
var sensitivePaths = []string{
	"/.git/HEAD",
	"/.env",
	"/wp-config.php",
	"/config.php",
	"/admin/",
	"/phpmyadmin/",
	"/.htaccess",
	"/.svn/entries",
	"/backup/",
	"/db_backup/",
	"/.DS_Store",
	"/web.config",
	"/server-status",
	"/composer.json",
	"/package.json",
	"/install.php",
}

// ─── CheckSSL ─────────────────────────────────────────────────────────────────

func CheckSSL(targetURL string) SSLInfo {
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
		},
	}

	resp, err := client.Get(targetURL)
	if err != nil {
		return SSLInfo{Valid: false, Error: err.Error()}
	}
	defer resp.Body.Close()

	if resp.TLS == nil {
		return SSLInfo{Valid: false, Error: "No TLS connection"}
	}

	// [G1] Guard against empty certificate chain — a misconfigured server can complete
	// the TLS handshake but provide zero PeerCertificates, causing an index-out-of-range panic.
	if len(resp.TLS.PeerCertificates) == 0 {
		return SSLInfo{
			Valid:  false,
			Error:  "TLS handshake succeeded but server provided no certificate (empty chain)",
			Status: "non_evalue",
		}
	}
	cert := resp.TLS.PeerCertificates[0]
	return SSLInfo{
		Valid:    time.Now().Before(cert.NotAfter),
		Issuer:   cert.Issuer.CommonName,
		Expiry:   cert.NotAfter.Format("2006-01-02"),
		Protocol: fmt.Sprintf("TLS %d.%d", resp.TLS.Version>>8, resp.TLS.Version&0xff),
	}
}

// ─── CheckHeadersFromColly ────────────────────────────────────────────────────

func CheckHeadersFromColly(targetURL string, responseHeaders *http.Header) ([]HeaderCheck, []string) {
	var checks []HeaderCheck
	var missing []string

	for _, h := range securityHeaders {
		val := responseHeaders.Get(h)
		present := val != ""
		checks = append(checks, HeaderCheck{
			Header:  h,
			Present: present,
			Value:   val,
		})
		if !present {
			missing = append(missing, h)
		}
	}
	return checks, missing
}

// ─── CheckCookieFlags (Phase B) ───────────────────────────────────────────────
// Parses all Set-Cookie response headers and returns cookies that are missing
// HttpOnly and/or Secure flags.
func CheckCookieFlags(responseHeaders *http.Header) []CookieFlagResult {
	var results []CookieFlagResult

	for _, raw := range responseHeaders.Values("Set-Cookie") {
		// Cookie name is everything before the first '='
		nameEnd := strings.IndexByte(raw, '=')
		if nameEnd <= 0 {
			continue
		}
		name := strings.TrimSpace(raw[:nameEnd])

		// Parse flags — split by ';', check each part
		rawLower := strings.ToLower(raw)
		missingHttpOnly := !strings.Contains(rawLower, "httponly")
		missingSecure := !strings.Contains(rawLower, "; secure") &&
			!strings.HasSuffix(strings.TrimSpace(rawLower), "secure")

		if missingHttpOnly || missingSecure {
			results = append(results, CookieFlagResult{
				Name:            name,
				MissingHttpOnly: missingHttpOnly,
				MissingSecure:   missingSecure,
			})
		}
	}
	return results
}

// ─── CheckExposedPaths (Phase B) ──────────────────────────────────────────────
// Sends parallel HEAD requests to sensitive paths.
// Returns list of paths that return HTTP 200.
func CheckExposedPaths(baseURL string) []string {
	baseURL = strings.TrimRight(baseURL, "/")

	type result struct {
		path   string
		status int
	}
	results := make(chan result, len(sensitivePaths))

	client := &http.Client{
		Timeout: 6 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			// Don't follow redirects — a redirect is NOT an exposure
			return http.ErrUseLastResponse
		},
	}

	var wg sync.WaitGroup
	for _, path := range sensitivePaths {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			resp, err := client.Head(baseURL + p)
			if err != nil {
				return
			}
			resp.Body.Close()
			results <- result{path: p, status: resp.StatusCode}
		}(path)
	}

	wg.Wait()
	close(results)

	var exposed []string
	for r := range results {
		if r.status == http.StatusOK {
			exposed = append(exposed, r.path)
		}
	}
	return exposed
}

// ─── Analyze ──────────────────────────────────────────────────────────────────
// Analyze performs comprehensive security scanning on a target URL.
// Parameters:
//   - targetURL: the domain/URL being scanned
//   - responseHeaders: HTTP response headers from the target
//   - ssl: SSL certificate info
//   - cmsName: detected CMS name from tech analyzer (e.g., "WordPress", "Drupal")
//   - robotsTxtContent: raw content of robots.txt file (empty if not found)
//   - htmlBody: HTML body content from the target URL (for form parsing)
//   - detectedTechs: list of detected technologies with versions (for CVE matching)
func Analyze(targetURL, cmsName, robotsTxtContent, htmlBody string, responseHeaders *http.Header, ssl SSLInfo, detectedTechs []TechInfo) ScanResult {
	headers, missing := CheckHeadersFromColly(targetURL, responseHeaders)

	// Cache detection
	cacheControl := responseHeaders.Get("Cache-Control")
	etag := responseHeaders.Get("ETag")
	expires := responseHeaders.Get("Expires")
	hasCache := cacheControl != "" || etag != "" || expires != ""

	// Compression detection
	compression := responseHeaders.Get("Content-Encoding")
	hasCompression := compression != ""

	// ── Phase B: Cookie flags ─────────────────────────────────────────────
	cookiesWithMissingFlags := CheckCookieFlags(responseHeaders)
	cookieKPIPassed := len(cookiesWithMissingFlags) == 0

	// ── Phase B: Exposed sensitive paths ──────────────────────────────────
	exposedPaths := CheckExposedPaths(targetURL)
	exposedPathKPIPassed := len(exposedPaths) == 0

	// ── GROUP A: Wordlist Probes ─────────────────────────────────────────
	adminExposed := checkAdminSensitivePages(targetURL, cmsName)
	versionDisclosed := checkCMSVersionDisclosure(targetURL, cmsName)
	sensitiveFilesExposed := checkSensitiveFileExposure(targetURL)

	// ── GROUP B: Passive Checks ──────────────────────────────────────────
	robotsTxtIssues := checkRobotsTxtInfoDisclosure(robotsTxtContent)
	errorPageLeaks := checkCustomErrorPageLeak(targetURL)
	traceMethods := checkHTTPTraceMethods(targetURL)
	corsIssues := checkCORSMisconfiguration(targetURL, responseHeaders)

	// ── GROUP C: Form-Based Checks ───────────────────────────────────────
	bruteForceProtection := checkBruteForcedProtectionLogin(targetURL, htmlBody, adminExposed)
	fileUploadControl := checkFileUploadExtensionControl(targetURL, htmlBody)

	// ── GROUP D: Data-Matching Check ─────────────────────────────────────
	vulnerableLibs := checkVulnerableJSDependencies(detectedTechs)
	serviceExposure := scanExposedServices(targetURL, responseHeaders)

	// Overall pass: SSL valid + no critical headers missing + no exposed paths
	passed := ssl.Valid && len(missing) == 0 && exposedPathKPIPassed

	return ScanResult{
		URL:            targetURL,
		SSL:            ssl,
		Headers:        headers,
		MissingHeaders: missing,
		CacheControl:   cacheControl,
		HasCache:       hasCache,
		Compression:    compression,
		HasCompression: hasCompression,

		CookiesWithMissingFlags: cookiesWithMissingFlags,
		MissingCookieFlagCount:  len(cookiesWithMissingFlags),
		CookieKPIPassed:         cookieKPIPassed,

		ExposedPaths:         exposedPaths,
		GoogleDorksVulnCount: len(exposedPaths),
		ExposedPathKPIPassed: exposedPathKPIPassed,

		AdminSensitivePageExposed:  adminExposed,
		VersionDisclosureCMS:       versionDisclosed,
		SensitiveFileExposed:       sensitiveFilesExposed,
		RobotsTxtInfoDisclosure:    robotsTxtIssues,
		CustomErrorPageInfoLeak:    errorPageLeaks,
		HTTPTraceMethods:           traceMethods,
		CORSMisconfiguration:       corsIssues,
		BruteForcedProtectionLogin: bruteForceProtection,
		FileUploadExtensionControl: fileUploadControl,
		VulnerableJSDependencies:   vulnerableLibs,
		ServiceExposure:            serviceExposure,

		Passed:      passed,
		ServiceName: "v3-security-scanner-go",
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP A: WORDLIST PROBES
// ═════════════════════════════════════════════════════════════════════════════

// adminPaths: CMS-agnostic admin and management paths
var adminPaths = []string{
	"/admin", "/admin/", "/administrator", "/administrator/",
	"/admin/login", "/admin/login.php", "/admin/index.php",
	"/administrator/index.php", "/adminer", "/adminer.php",
	"/phpmyadmin", "/phpmyadmin/", "/pma", "/dbadmin",
	"/cpanel", "/cpanel/", "/webmail", "/manager/html", "/manager/status",
	"/console", "/dashboard", "/backend", "/controlpanel", "/login",
}

// cmsAdminPaths: CMS-specific admin entrypoints (expanded from public fuzzing patterns)
var cmsAdminPaths = map[string][]string{
	"wordpress": {
		"/wp-admin/", "/wp-admin/admin.php", "/wp-admin/setup-config.php", "/wp-admin/network/", "/wp-login.php", "/wp-signup.php", "/wp-json/", "/xmlrpc.php",
		"/wp-content/debug.log", "/wp-content/uploads/", "/wp-content/backup-db/", "/wp-content/backups/",
	},
	"drupal": {
		"/user/login", "/admin/", "/admin/config", "/admin/content", "/admin/reports", "/core/install.php", "/authorize.php", "/update.php",
		"/sites/default/settings.php", "/sites/default/default.settings.php",
	},
	"joomla": {
		"/administrator/", "/administrator/index.php", "/administrator/manifests/files/joomla.xml", "/index.php?option=com_admin", "/cli/joomla.php",
		"/installation/", "/installation/index.php",
	},
	"prestashop": {
		"/admin-dev/", "/admin123/", "/admin/login", "/index.php?controller=AdminLogin", "/install/", "/install-dev/", "/admin/autoupgrade/",
		"/config/settings.inc.php", "/app/config/parameters.php",
	},
	"magento": {
		"/admin/", "/admin/dashboard", "/downloader/", "/index.php/admin", "/setup/", "/adminhtml/", "/index.php/adminhtml",
		"/app/etc/env.php", "/app/etc/local.xml",
	},
	"opencart": {
		"/admin/", "/admin/index.php", "/admin/config.php", "/install/", "/system/storage/logs/error.log", "/system/config/",
	},
	"shopware": {
		"/backend/", "/api/", "/recovery/install/index.php", "/shopware.php", "/recovery/update/index.php", "/recovery/install/",
	},
	"typo3": {
		"/typo3/", "/typo3/install.php", "/typo3conf/", "/typo3/sysext/", "/typo3conf/system/settings.php", "/typo3conf/system/additional.php",
	},
	"woocommerce": {
		"/wp-admin/", "/wp-login.php", "/wp-json/wc/v3", "/wp-content/plugins/woocommerce/",
	},
	"drupalcommerce": {
		"/user/login", "/admin/commerce", "/admin/config/services", "/sites/default/settings.php",
	},
	"moodle": {
		"/admin/", "/login/index.php", "/install.php", "/config.php", "/admin/tool/",
	},
	"craftcms": {
		"/admin/", "/cpresources/", "/index.php/admin", "/web/index.php/admin",
	},
	"contao": {
		"/contao/", "/contao/install", "/system/config/localconfig.php",
	},
	"dnn": {
		"/admin/", "/install/install.aspx", "/desktopmodules/", "/providers/dataProviders/",
	},
	"umbraco": {
		"/umbraco/", "/umbraco#/login", "/umbraco/api/", "/install/",
	},
	"ghost": {
		"/ghost/", "/ghost/api/admin/", "/ghost/#/signin",
	},
	"strapi": {
		"/admin/", "/admin/auth/login", "/api/",
	},
}

// cmsVersionFiles: CMS-specific files that disclose version info
var cmsVersionFiles = map[string][]string{
	"wordpress": {
		"/readme.html", "/wp-includes/version.php", "/wp-content/plugins/wordpress-seo/readme.txt", "/license.txt", "/wp-config-sample.php",
	},
	"drupal": {
		"/CHANGELOG.txt", "/INSTALL.txt", "/core/CHANGELOG.txt", "/modules/system/system.info", "/README.txt",
	},
	"joomla": {
		"/administrator/manifests/files/joomla.xml", "/language/en-GB/en-GB.xml", "/README.txt", "/administrator/help/en-GB/toc.json",
	},
	"typo3": {
		"/typo3conf/ext/version/ext_emconf.php", "/TYPO3-VERSION.txt", "/typo3/sysext/core/composer.json", "/composer.lock",
	},
	"prestashop": {
		"/docs/CHANGELOG.txt", "/config/xml/install.xml", "/install/version.php", "/install-dev/upgrade/sql/",
	},
	"magento": {
		"/RELEASE_NOTES.txt", "/magento_version", "/composer.json", "/composer.lock", "/app/etc/config.php",
	},
	"opencart": {
		"/CHANGELOG.md", "/install/index.php", "/admin/config.php", "/install.txt",
	},
	"shopware": {
		"/recovery/install/data/sql/version.sql", "/shopware.php", "/composer.lock", "/recovery/install/index.php",
	},
}

// extendedSensitiveFiles: expanded cross-CMS and framework sensitive paths
var extendedSensitiveFiles = []string{
	"/.env", "/.env.local", "/.env.production", "/.env.example", "/.git/HEAD", "/.git/config", "/.gitignore",
	"/.github/workflows/", "/.gitlab-ci.yml", "/.dockerignore", "/Dockerfile", "/docker-compose.yml", "/docker-compose.prod.yml",
	"/package.json", "/package-lock.json", "/yarn.lock", "/pnpm-lock.yaml", "/composer.json", "/composer.lock",
	"/Gemfile", "/Gemfile.lock", "/requirements.txt", "/Pipfile", "/Pipfile.lock", "/poetry.lock", "/go.mod", "/go.sum",
	"/Jenkinsfile", "/.travis.yml", "/.circleci/config.yml", "/kubernetes.yml",
	"/config.php", "/configuration.php", "/web.config", "/.htaccess", "/.htpasswd", "/phpinfo.php",
	"/backup/", "/backups/", "/db_backup/", "/dump.sql", "/database.sql", "/sql/", "/storage/logs/laravel.log",
	"/.svn/entries", "/.bzr/branch-root", "/.hg/store", "/.DS_Store",
	"/README.md", "/readme.md", "/SECURITY.md", "/security.md", "/API.md", "/SERVER.md", "/DEPLOY.txt",
	"/install.php", "/setup.php", "/test.php", "/debug.log", "/error.log",
	"/wp-config.php", "/wp-content/debug.log", "/wp-content/uploads/", "/xmlrpc.php",
	"/app/etc/env.php", "/app/etc/local.xml", "/var/log/system.log", "/downloader/",
	"/admin/config.php", "/system/storage/logs/error.log", "/install/index.php",
	"/typo3conf/LocalConfiguration.php", "/typo3conf/AdditionalConfiguration.php",
	"/config/settings.inc.php", "/config/defines.inc.php", "/admin-dev/",
	"/sites/default/settings.php", "/sites/default/files/", "/core/install.php",
	"/administrator/configuration.php", "/configuration.php-dist",
	"/ghost/api/admin/", "/content/data/", "/content/images/",
	"/api/openapi", "/swagger.json", "/.well-known/security.txt",
	"/wp-config.php.bak", "/wp-config.php.old", "/wp-config.php.save", "/wp-config.php.swp",
	"/wp-json/wp/v2/users", "/wp-content/uploads/dump.sql", "/wp-app.log",
	"/sites/default/default.settings.php", "/sites/README.txt", "/sites/example.sites.php",
	"/administrator/backups/", "/administrator/logs/", "/administrator/components/com_admin/",
	"/installation/sql/", "/installation/language/en-GB/", "/language/en-GB/joomla.ini",
	"/config.inc.php", "/config.inc.php.bak", "/config.inc.php.old",
	"/app/etc/config.php", "/var/export/", "/var/report/", "/var/backups/",
	"/index.php/admin", "/index.php/adminhtml", "/recovery/update/index.php",
	"/system/storage/logs/", "/system/storage/backup/", "/admin/storage/",
	"/typo3conf/system/settings.php", "/typo3conf/system/additional.php", "/config/system/settings.php", "/config/system/additional.php",
	"/storage/framework/cache/", "/storage/framework/sessions/", "/storage/debugbar/",
	"/config/database.php", "/config/services.yaml", "/.vscode/launch.json",
	"/.idea/workspace.xml", "/.aws/credentials", "/id_rsa", "/id_rsa.pub", "/known_hosts",
	"/phpmyadmin/", "/pma/", "/sqlbuddy/", "/adminer.php", "/webadmin/",
	"/server-info", "/status", "/status.php", "/error500.htm", "/debug/",
	"/backup.sql", "/backup.zip", "/site.sql", "/db.sql", "/sql_dump.sql", "/dump.tar.gz",
}

func uniquePaths(paths []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}

type probeResult struct {
	Exposed      []string
	Forbidden    []string
	ServerErrors []string
	StatusCodes  map[string]int
}

// probeWordlistPaths: probe endpoints and classify HTTP status.
// Rule: 200 => exposed, 401/403 => forbidden (warning), >=500 => server_errors (fail).
//
// HEAD is issued first. When HEAD returns an ambiguous status (not 200, 401,
// 403, 404, or 5xx) a follow-up GET is sent. If HEAD=403 but GET=200 the GET
// result wins; if HEAD=200 but GET=404 the GET result wins. This prevents false
// verdicts on servers that handle HEAD differently from GET.
func probeWordlistPaths(baseURL string, paths []string) probeResult {
	baseURL = strings.TrimRight(baseURL, "/")

	type result struct {
		path   string
		status int
	}
	results := make(chan result, len(paths))

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	// isDefinitive returns true for HTTP status codes that don't require GET confirmation.
	isDefinitive := func(code int) bool {
		return code == http.StatusOK ||
			code == http.StatusUnauthorized ||
			code == http.StatusForbidden ||
			code == http.StatusNotFound ||
			code == http.StatusGone ||
			code >= http.StatusInternalServerError
	}

	var wg sync.WaitGroup
	for _, path := range paths {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			fullURL := baseURL + p

			headResp, err := client.Head(fullURL)
			if err != nil {
				return
			}
			headResp.Body.Close()
			headStatus := headResp.StatusCode

			finalStatus := headStatus

			if !isDefinitive(headStatus) {
				// Ambiguous HEAD — confirm with GET.
				getResp, err := client.Get(fullURL)
				if err == nil {
					getResp.Body.Close()
					finalStatus = getResp.StatusCode
				}
			} else if headStatus == http.StatusForbidden || headStatus == http.StatusOK {
				// For 403 or 200 from HEAD, confirm with GET to catch discrepancies.
				getResp, err := client.Get(fullURL)
				if err == nil {
					getResp.Body.Close()
					getStatus := getResp.StatusCode
					// If HEAD=403 but GET=200, the resource IS accessible — use GET.
					// If HEAD=200 but GET=404, HEAD was misleading — use GET.
					if headStatus != getStatus {
						finalStatus = getStatus
					}
				}
			}

			results <- result{path: p, status: finalStatus}
		}(path)
	}

	wg.Wait()
	close(results)

	out := probeResult{StatusCodes: map[string]int{}}
	for r := range results {
		out.StatusCodes[r.path] = r.status
		switch {
		case r.status == http.StatusOK:
			out.Exposed = append(out.Exposed, r.path)
		case r.status == http.StatusUnauthorized || r.status == http.StatusForbidden:
			out.Forbidden = append(out.Forbidden, r.path)
		case r.status >= http.StatusInternalServerError:
			out.ServerErrors = append(out.ServerErrors, r.path)
		}
	}
	return out
}

// checkAdminSensitivePages probes for exposed admin and sensitive pages.
// Check #1: Admin & Sensitive Page Exposure
func checkAdminSensitivePages(targetURL, cmsName string) AdminExposureResult {
	pathsToProbe := append([]string{}, adminPaths...)
	if cmsSpecific, exists := cmsAdminPaths[strings.ToLower(cmsName)]; exists {
		pathsToProbe = append(pathsToProbe, cmsSpecific...)
	}
	pathsToProbe = uniquePaths(pathsToProbe)

	probe := probeWordlistPaths(targetURL, pathsToProbe)
	status := "pass"
	severity := "high"

	if len(probe.Exposed) > 0 || len(probe.ServerErrors) > 0 {
		status = "fail"
	} else if len(probe.Forbidden) > 0 {
		status = "warning"
	}

	return AdminExposureResult{
		Exposed:      probe.Exposed,
		Forbidden:    probe.Forbidden,
		ServerErrors: probe.ServerErrors,
		StatusCodes:  probe.StatusCodes,
		Status:       status,
		Severity:     severity,
		Impact:       "",
	}
}

// checkCMSVersionDisclosure probes for CMS-specific version disclosure files.
// Check #2: Version Disclosure via CMS Files
func checkCMSVersionDisclosure(targetURL, cmsName string) VersionDisclosureResult {
	pathsToProbe := []string{}
	if files, exists := cmsVersionFiles[strings.ToLower(cmsName)]; exists {
		pathsToProbe = append(pathsToProbe, files...)
	}
	pathsToProbe = uniquePaths(pathsToProbe)

	probe := probeWordlistPaths(targetURL, pathsToProbe)
	status := "pass"
	severity := "medium"

	if len(probe.ServerErrors) > 0 {
		status = "fail"
	} else if len(probe.Exposed) > 0 || len(probe.Forbidden) > 0 {
		status = "warning"
	}

	return VersionDisclosureResult{
		Disclosed:    probe.Exposed,
		Forbidden:    probe.Forbidden,
		ServerErrors: probe.ServerErrors,
		StatusCodes:  probe.StatusCodes,
		Status:       status,
		Severity:     severity,
		Impact:       "",
	}
}

// benignPublicFiles lists files that are intentionally public and should only
// generate an info-level finding when found (not critical/high).
var benignPublicFiles = map[string]bool{
	"/README.md": true, "/readme.md": true,
	"/SECURITY.md": true, "/security.md": true,
	"/LICENSE": true, "/license": true,
	"/LICENSE.txt": true, "/license.txt": true,
	"/CONTRIBUTING.md": true, "/contributing.md": true,
	"/CODE_OF_CONDUCT.md": true, "/code_of_conduct.md": true,
	"/robots.txt": true,
	"/sitemap.xml": true,
	"/favicon.ico": true,
	"/.well-known/security.txt": true,
}

// sensitiveContentRe matches content that escalates severity regardless of filename.
var sensitiveContentRe = regexp.MustCompile(`(?i)(password\s*=|db_password|secret[_\s]*key|private_key|api[_\s]*key\s*=|DB_PASSWORD|AWS_SECRET)`)

// SensitiveFileInfo carries per-file probe detail used internally.
type sensitiveFileDetail struct {
	path     string
	status   int
	isBenign bool
	hasSecret bool
}

// probeWordlistPathsGET probes each path with GET (for body inspection) and
// returns per-file detail records. HEAD is used for non-benign paths to keep
// traffic low; GET is used for benign paths so we can sniff content.
func probeWordlistPathsGET(baseURL string, paths []string) []sensitiveFileDetail {
	baseURL = strings.TrimRight(baseURL, "/")
	detailCh := make(chan sensitiveFileDetail, len(paths))

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	var wg sync.WaitGroup
	for _, path := range paths {
		wg.Add(1)
		go func(p string) {
			defer wg.Done()
			isBenign := benignPublicFiles[p]
			method := http.MethodHead
			if isBenign {
				method = http.MethodGet
			}
			req, err := http.NewRequest(method, baseURL+p, nil)
			if err != nil {
				return
			}
			resp, err := client.Do(req)
			if err != nil {
				return
			}
			defer resp.Body.Close()

			hasSecret := false
			if isBenign && resp.StatusCode == http.StatusOK {
				bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
				hasSecret = sensitiveContentRe.Match(bodyBytes)
			}
			detailCh <- sensitiveFileDetail{
				path:      p,
				status:    resp.StatusCode,
				isBenign:  isBenign,
				hasSecret: hasSecret,
			}
		}(path)
	}

	wg.Wait()
	close(detailCh)

	out := make([]sensitiveFileDetail, 0, len(paths))
	for d := range detailCh {
		out = append(out, d)
	}
	return out
}

// checkSensitiveFileExposure probes for extended sensitive file paths.
// Check #5: Sensitive File Exposure Extended
func checkSensitiveFileExposure(targetURL string) SensitiveFileResult {
	details := probeWordlistPathsGET(targetURL, uniquePaths(extendedSensitiveFiles))

	statusCodes := map[string]int{}
	var exposed, forbidden, serverErrors []string
	status := "pass"
	severity := "high"

	for _, d := range details {
		statusCodes[d.path] = d.status
		switch {
		case d.status == http.StatusOK:
			if d.isBenign && !d.hasSecret {
				// Benign public file found without sensitive content — info only, not exposed.
				// Do not add to exposed list to avoid raising severity.
			} else {
				exposed = append(exposed, d.path)
			}
		case d.status == http.StatusUnauthorized || d.status == http.StatusForbidden:
			forbidden = append(forbidden, d.path)
		case d.status >= http.StatusInternalServerError:
			serverErrors = append(serverErrors, d.path)
		}
	}

	if len(exposed) > 0 || len(serverErrors) > 0 {
		status = "fail"
	} else if len(forbidden) > 0 {
		status = "warning"
	}

	return SensitiveFileResult{
		Exposed:      exposed,
		Forbidden:    forbidden,
		ServerErrors: serverErrors,
		StatusCodes:  statusCodes,
		Status:       status,
		Severity:     severity,
		Impact:       "",
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP B: PASSIVE CHECKS
// ═════════════════════════════════════════════════════════════════════════════

// sensitiveKeywords: exact path-segment keywords that indicate sensitive paths in robots.txt.
// [NEW-3] Using exact segment matching instead of substring to prevent false positives
// like /api-docs matching "api" or /monkey matching "key".
var sensitiveSegments = map[string]bool{
	"admin": true, "backup": true, "config": true, "private": true,
	"internal": true, "staging": true, "debug": true, "secret": true,
	"password": true, "database": true, "phpmyadmin": true, "adminer": true,
	"wp-admin": true, "wp-login": true, "cpanel": true, "webmail": true,
}

// errorIndicators: patterns that indicate information disclosure in error pages
var errorIndicators = []string{
	"Exception thrown", "Stack trace", "at line", "Fatal error",
	"Warning:", "Notice:", "Parse error", "Deprecated:",
	"Class not found", "Method not found", "File not found",
	"java.lang", "python", "traceback", "Traceback",
	"SQL error", "mysql_error", "SQLSTATE", "ORA-",
	"Error: database", "Error: connection", "database connection",
	"config path", "file path", "/home/", "/var/", "/opt/",
}

// checkRobotsTxtInfoDisclosure analyzes robots.txt for information disclosure.
// Check #3: robots.txt Info Disclosure
func checkRobotsTxtInfoDisclosure(robotsTxtContent string) RobotsTxtResult {
	var disclosedPaths []string
	status := "pass"
	severity := "medium"

	if robotsTxtContent == "" {
		// No robots.txt present
		return RobotsTxtResult{
			DisclosedPaths: []string{},
			Status:         status,
			Severity:       severity,
			Impact:         "",
		}
	}

	// Parse Disallow lines
	lines := strings.Split(robotsTxtContent, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "disallow:") {
			path := strings.TrimPrefix(line, "Disallow:")
			path = strings.TrimSpace(path)

			if path == "" || path == "/" {
				continue // Non-interesting paths
			}

			// [NEW-3] Check if any path segment exactly matches a sensitive keyword.
			// Substring matching (old: strings.Contains) over-flags benign paths like /api-docs.
			segments := strings.Split(strings.ToLower(strings.Trim(path, "/")), "/")
			for _, seg := range segments {
				seg = strings.TrimSpace(seg)
				if seg != "" && sensitiveSegments[seg] {
					disclosedPaths = append(disclosedPaths, path)
					status = "warning"
					break
				}
			}
		}
	}

	return RobotsTxtResult{
		DisclosedPaths: disclosedPaths,
		Status:         status,
		Severity:       severity,
		Impact:         "",
	}
}

// checkCustomErrorPageLeak checks error pages for sensitive information leaks.
// Check #4: Custom Error Page Info Leak
func checkCustomErrorPageLeak(targetURL string) ErrorPageLeakResult {
	var leakIndicators []string
	status := "pass"
	severity := "medium"

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	// Request a non-existent path to trigger error page
	errorURL := strings.TrimRight(targetURL, "/") + "/nonexistent-" + fmt.Sprintf("%d", time.Now().Unix()) + ".html"
	resp, err := client.Get(errorURL)
	if err != nil {
		return ErrorPageLeakResult{
			LeakIndicators: []string{},
			Status:         status,
			Severity:       severity,
			Impact:         "",
		}
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyStr := string(bodyBytes)
	bodyLower := strings.ToLower(bodyStr)

	// Check for error indicators
	for _, indicator := range errorIndicators {
		if strings.Contains(bodyLower, strings.ToLower(indicator)) {
			leakIndicators = append(leakIndicators, indicator)
			status = "fail"
		}
	}

	return ErrorPageLeakResult{
		LeakIndicators: leakIndicators,
		Status:         status,
		Severity:       severity,
		Impact:         "",
	}
}

// checkHTTPTraceMethods probes for TRACE/TRACK HTTP methods.
// Check #6: HTTP TRACE/TRACK Methods
func checkHTTPTraceMethods(targetURL string) TraceMethodsResult {
	detected := false
	status := "pass"
	severity := "high"

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	// Create TRACE request
	req, err := http.NewRequest("TRACE", targetURL, nil)
	if err != nil {
		return TraceMethodsResult{
			Detected: false,
			Status:   status,
			Severity: severity,
			Impact:   "",
		}
	}

	resp, err := client.Do(req)
	if err == nil {
		defer resp.Body.Close()
		// TRACE is allowed if status is 200 and body echoes request
		if resp.StatusCode == http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			bodyStr := string(bodyBytes)
			// Check if body contains request headers (echo)
			if strings.Contains(bodyStr, "TRACE") || len(bodyStr) > 0 {
				detected = true
				status = "fail"
			}
		}
	}

	return TraceMethodsResult{
		Detected: detected,
		Status:   status,
		Severity: severity,
		Impact:   "",
	}
}

// checkCORSMisconfiguration analyzes CORS headers for misconfigurations.
// Check #7: CORS Misconfiguration
func checkCORSMisconfiguration(targetURL string, responseHeaders *http.Header) CORSResult {
	misconfigured := false
	status := "pass"
	severity := "high"
	details := ""

	acaoHeader := responseHeaders.Get("Access-Control-Allow-Origin")
	acaHeader := responseHeaders.Get("Access-Control-Allow-Credentials")

	// Check for wildcard ACAO with credentials (dangerous combo)
	if acaoHeader == "*" && acaHeader == "true" {
		misconfigured = true
		status = "fail"
		details = "Wildcard ACAO with credentials=true allows any origin to access sensitive data"
	} else if acaoHeader == "*" {
		// Wildcard alone might be acceptable for public data
		status = "pass"
	}

	// Check for reflected ACAO
	if acaoHeader != "" && acaoHeader != "*" {
		// Send request with Origin header to check if it's reflected
		client := &http.Client{Timeout: 5 * time.Second}
		req, err := http.NewRequest("GET", targetURL, nil)
		if err == nil {
			req.Header.Set("Origin", "https://attacker.com")
			resp, err := client.Do(req)
			if err == nil {
				defer resp.Body.Close()
				reflectedOriginHeader := resp.Header.Get("Access-Control-Allow-Origin")
				if reflectedOriginHeader == "https://attacker.com" {
					misconfigured = true
					status = "fail"
					details = "CORS header reflects user-supplied Origin header (allows any origin)"
				}
			}
		}
	}

	return CORSResult{
		Misconfigured: misconfigured,
		Status:        status,
		Severity:      severity,
		Impact:        "",
		Details:       details,
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP C: FORM-BASED CHECKS
// ═════════════════════════════════════════════════════════════════════════════

// loginFormKeywords: words that indicate a login form
var loginFormKeywords = []string{
	"login", "signin", "authenticate", "auth", "password",
	"username", "user", "email", "credentials", "account",
}

// findLoginForm searches for the first login form in HTML.
// Returns the form's action URL or empty string if not found.
func findLoginForm(htmlBody, baseURL string) string {
	htmlLower := strings.ToLower(htmlBody)

	// Simple regex to find form tags
	formPattern := regexp.MustCompile(`(?i)<form[^>]*action=["']([^"']+)["']`)
	matches := formPattern.FindAllStringSubmatch(htmlBody, -1)

	for _, match := range matches {
		if len(match) > 1 {
			action := match[1]
			actionLower := strings.ToLower(action)

			// Check if this form is likely a login form
			for _, keyword := range loginFormKeywords {
				if strings.Contains(actionLower, keyword) {
					// Convert relative URL to absolute
					if strings.HasPrefix(action, "http") {
						return action
					}
					action = strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(action, "/")
					return action
				}
			}
		}
	}

	// Check if /login path is common
	potentialLoginPaths := []string{"/login", "/signin", "/auth", "/user/login", "/account/login"}
	for _, path := range potentialLoginPaths {
		if strings.Contains(htmlLower, path) {
			return baseURL + path
		}
	}

	return ""
}

// testBruteForceProtection sends rapid requests to test for brute force protection.
// Checks for 429 (Too Many Requests), rate limit headers, or CAPTCHA challenges.
func testBruteForceProtection(loginURL string) (protected bool, details string) {
	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	// Send 6 rapid POST requests with dummy credentials
	rateLimitDetected := false
	captchaDetected := false

	for i := 0; i < 6; i++ {
		req, err := http.NewRequest("POST", loginURL, nil)
		if err != nil {
			continue
		}

		// Add basic form data
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		bodyBytes, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		// Check for 429 Too Many Requests
		if resp.StatusCode == 429 {
			rateLimitDetected = true
			break
		}

		// Check for rate limit headers
		if resp.Header.Get("Retry-After") != "" ||
			resp.Header.Get("X-RateLimit-Remaining") == "0" ||
			resp.Header.Get("X-RateLimit-Reset") != "" {
			rateLimitDetected = true
			break
		}

		// Check for CAPTCHA in response (basic heuristic)
		bodyStr := strings.ToLower(string(bodyBytes))
		if strings.Contains(bodyStr, "captcha") ||
			strings.Contains(bodyStr, "recaptcha") ||
			strings.Contains(bodyStr, "challenge") {
			captchaDetected = true
			break
		}
	}

	if rateLimitDetected {
		protected = true
		details = "Rate limiting detected (429 or rate-limit headers)"
	} else if captchaDetected {
		protected = true
		details = "CAPTCHA challenge detected"
	}

	return protected, details
}

// checkBruteForcedProtectionLogin checks login forms for brute force protection.
// Check #8: Brute Force Protection on Login (first URL only)
func checkBruteForcedProtectionLogin(targetURL, htmlBody string, adminExposure AdminExposureResult) BruteForceResult {
	status := "pass"
	severity := "high"
	details := ""

	loginTargets := []string{}
	seen := map[string]bool{}

	addTarget := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			return
		}
		if !strings.HasPrefix(candidate, "http://") && !strings.HasPrefix(candidate, "https://") {
			base := strings.TrimRight(targetURL, "/")
			if strings.HasPrefix(candidate, "/") {
				candidate = base + candidate
			} else {
				candidate = base + "/" + candidate
			}
		}
		if seen[candidate] {
			return
		}
		seen[candidate] = true
		loginTargets = append(loginTargets, candidate)
	}

	// 1) Homepage-derived form login target.
	addTarget(findLoginForm(htmlBody, targetURL))

	// 2) Exposed admin/login endpoints discovered by wordlist probe.
	for _, p := range adminExposure.Exposed {
		pLower := strings.ToLower(strings.TrimSpace(p))
		if strings.Contains(pLower, "login") || strings.Contains(pLower, "signin") || strings.Contains(pLower, "auth") {
			addTarget(p)
		}
	}

	if len(loginTargets) == 0 {
		// [NEW-2] No login surface detected — the brute-force protection check cannot run.
		// Returning Protected=true silently masks an untested state as success. Use non_evalue.
		return BruteForceResult{
			Protected: false,
			Status:    "non_evalue",
			Severity:  "",
			Impact:    "",
			Details:   "No login form or endpoint detected — brute-force protection not evaluated",
		}
	}

	allProtected := true
	unprotectedTarget := ""
	protectedDetail := ""
	for _, target := range loginTargets {
		protected, protectionDetails := testBruteForceProtection(target)
		if !protected {
			allProtected = false
			unprotectedTarget = target
			break
		}
		if protectedDetail == "" {
			protectedDetail = protectionDetails
		}
	}

	if !allProtected {
		status = "fail"
		details = fmt.Sprintf("No brute force protection detected on %s", unprotectedTarget)
	} else if protectedDetail != "" {
		details = protectedDetail
	} else {
		details = "Brute force protection detected"
	}

	return BruteForceResult{
		Protected: allProtected,
		Status:    status,
		Severity:  severity,
		Impact:    "",
		Details:   details,
	}
}

// findFileUploadInputs searches for file upload input fields in HTML.
// Returns list of upload inputs with their "accept" attribute values.
func findFileUploadInputs(htmlBody string) []string {
	var uploads []string

	// Find all file input elements
	inputPattern := regexp.MustCompile(`(?i)<input[^>]*type\s*=\s*["']?file["']?[^>]*>`)
	matches := inputPattern.FindAllString(htmlBody, -1)

	for _, match := range matches {
		// Check for accept attribute
		acceptPattern := regexp.MustCompile(`(?i)accept\s*=\s*["']?([^"'\s>]+)["']?`)
		acceptMatches := acceptPattern.FindStringSubmatch(match)

		if len(acceptMatches) > 1 {
			uploads = append(uploads, acceptMatches[1])
		} else {
			// No accept attribute - dangerous!
			uploads = append(uploads, "(no-accept-attribute)")
		}
	}

	return uploads
}

// checkFileUploadExtensionControl validates file upload restrictions.
// Check #10: File Upload Extension Control
func checkFileUploadExtensionControl(targetURL, htmlBody string) FileUploadResult {
	var issues []string
	status := "pass"
	severity := "high"

	uploads := findFileUploadInputs(htmlBody)

	if len(uploads) == 0 {
		// No file uploads found - good
		status = "pass"
		return FileUploadResult{
			RestrictionsFound: true,
			Issues:            []string{},
			Status:            status,
			Severity:          severity,
			Impact:            "",
		}
	}

	for _, acceptVal := range uploads {
		if acceptVal == "(no-accept-attribute)" {
			issues = append(issues, "File upload input missing 'accept' attribute - allows any file type")
			status = "fail"
		} else if acceptVal == "*/*" {
			issues = append(issues, "File upload accepts all MIME types (*/*)")
			status = "fail"
		} else if strings.HasPrefix(acceptVal, ".") {
			// Single extension like ".pdf" - better but not perfect
			// could be spoofed with .pdf.exe
		}
	}

	return FileUploadResult{
		RestrictionsFound: len(issues) == 0,
		Issues:            issues,
		Status:            status,
		Severity:          severity,
		Impact:            "",
	}
}

// ═════════════════════════════════════════════════════════════════════════════
// GROUP D: DATA-MATCHING CHECK
// ═════════════════════════════════════════════════════════════════════════════

// CVEMap: hardcoded known vulnerable library versions
type CVEInfo struct {
	CVEs     []string
	Severity string // "critical" | "high" | "medium" | "low"
}

// knownVulnerableLibs: map of library@version → CVE info
var knownVulnerableLibs = map[string]CVEInfo{
	"jquery@3.4.0": {
		CVEs:     []string{"CVE-2020-11022"},
		Severity: "high",
	},
	"jquery@3.4.1": {
		CVEs:     []string{},
		Severity: "",
	},
	"bootstrap@3.3.7": {
		CVEs:     []string{"CVE-2018-14041"},
		Severity: "high",
	},
	"lodash@4.17.15": {
		CVEs:     []string{"CVE-2019-10744"},
		Severity: "high",
	},
	"moment@2.24.0": {
		CVEs:     []string{"CVE-2016-4055"},
		Severity: "medium",
	},
	"react-dom@16.9.0": {
		CVEs:     []string{},
		Severity: "",
	},
	"express@4.16.4": {
		CVEs:     []string{"CVE-2019-9997"},
		Severity: "high",
	},
	"node-fetch@2.6.0": {
		CVEs:     []string{"CVE-2020-15168"},
		Severity: "high",
	},
}

// isVulnerableVersion checks if a library version is known to be vulnerable.
func isVulnerableVersion(libName, version string) (CVEInfo, bool) {
	key := fmt.Sprintf("%s@%s", strings.ToLower(libName), version)
	cveInfo, exists := knownVulnerableLibs[key]
	return cveInfo, exists && len(cveInfo.CVEs) > 0
}

// compareVersions: simple version comparison (returns true if detected <= known vulnerable)
// This is a simplified version - treats as vulnerable if detected version equals known
func compareVersions(detected, knownVuln string) bool {
	// For simplicity: exact match
	// In production, use semver comparison
	return strings.TrimSpace(detected) == strings.TrimSpace(knownVuln)
}

// queryOSVAPI: queries OSV database for vulnerability info  (best-effort, 3s timeout, fail-soft)
func queryOSVAPI(libName, version string, resultChan chan<- VulnerableLibrary) {
	defer func() {
		if r := recover(); r != nil {
			// Silently ignore panics - fail-soft
		}
	}()

	client := &http.Client{
		Timeout: 3 * time.Second,
	}

	// OSV API request body
	reqBody := fmt.Sprintf(`{"package":{"name":"%s","purl":"pkg:npm/%s"},"version":"%s"}`,
		libName, libName, version)

	resp, err := client.Post(
		"https://api.osv.dev/v1/query",
		"application/json",
		strings.NewReader(reqBody),
	)

	if err != nil {
		// Timeout or network error - fail-soft, return nothing
		return
	}
	defer resp.Body.Close()

	// Parse response and extract CVEs
	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyStr := string(bodyBytes)

	// Simple regex to find CVE IDs in response
	cvePattern := regexp.MustCompile(`CVE-\d+-\d+`)
	matches := cvePattern.FindAllString(bodyStr, -1)

	if len(matches) > 0 {
		resultChan <- VulnerableLibrary{
			Name:     libName,
			Version:  version,
			CVEs:     matches,
			Severity: "high", // OSV detected vulnerabilities are typically serious
			Source:   "osv",
		}
	}
}

// checkVulnerableJSDependencies checks for known vulnerable JavaScript libraries.
// Check #9: Vulnerable JS Dependencies + OSV
func checkVulnerableJSDependencies(detectedTechs []TechInfo) VulnerableJSResult {
	var vulnerableLibraries []VulnerableLibrary
	status := "pass"
	severity := "high"

	if len(detectedTechs) == 0 {
		// [G2] Tech detection didn't run or detected nothing — cannot confirm absence of vulnerabilities.
		// Returning "pass" here is a false negative; use non_evalue instead.
		return VulnerableJSResult{
			VulnerableLibraries: []VulnerableLibrary{},
			Status:              "non_evalue",
			Severity:            "",
			Impact:              "Tech detection produced no results; vulnerable dependency check was not performed.",
		}
	}

	// Check against hardcoded map first
	for _, tech := range detectedTechs {
		if cveInfo, isVuln := isVulnerableVersion(tech.Name, tech.Version); isVuln {
			vulnerableLibraries = append(vulnerableLibraries, VulnerableLibrary{
				Name:     tech.Name,
				Version:  tech.Version,
				CVEs:     cveInfo.CVEs,
				Severity: cveInfo.Severity,
				Source:   "hardcoded",
			})
			status = "fail"
		}
	}

	// For libraries not in hardcoded map, query OSV (best-effort, parallel with 3s timeout each)
	unresolvedTechs := []TechInfo{}
	for _, tech := range detectedTechs {
		key := fmt.Sprintf("%s@%s", strings.ToLower(tech.Name), strings.TrimSpace(tech.Version))
		if _, known := knownVulnerableLibs[key]; !known {
			unresolvedTechs = append(unresolvedTechs, tech)
		}
	}

	// Parallel OSV API calls with timeout
	if len(unresolvedTechs) > 0 {
		resultChan := make(chan VulnerableLibrary, len(unresolvedTechs))
		var wg sync.WaitGroup

		for _, tech := range unresolvedTechs {
			wg.Add(1)
			go func(t TechInfo) {
				defer wg.Done()
				queryOSVAPI(t.Name, t.Version, resultChan)
			}(tech)
		}

		// Wait with overall timeout
		doneChan := make(chan struct{})
		go func() {
			wg.Wait()
			close(doneChan)
		}()

		// Collect results with timeout
		for {
			select {
			case result := <-resultChan:
				vulnerableLibraries = append(vulnerableLibraries, result)
				status = "fail"
			case <-doneChan:
				close(resultChan)
				// Drain any remaining results
				for result := range resultChan {
					vulnerableLibraries = append(vulnerableLibraries, result)
					status = "fail"
				}
				goto OSVComplete
			case <-time.After(15 * time.Second):
				// Overall timeout for all OSV queries
				goto OSVComplete
			}
		}

	OSVComplete:
	}

	return VulnerableJSResult{
		VulnerableLibraries: vulnerableLibraries,
		Status:              status,
		Severity:            severity,
		Impact:              "",
	}
}
