# SnapFlow V3 — Complete Microservices, Supabase & Frontend Analysis

> **Generated**: 2026-06-24  
> **Codebase**: `SnapFlow/` — Front-Snap + V3-Microservices + k8s  
> **Purpose**: Exhaustive technical reference explaining how every part works, with detailed code sections, commands, scripts, and test suites.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [v3-aggregator — API Gateway & Orchestration Brain](#2-v3-aggregator--api-gateway--orchestration-brain)
3. [v3-scanner-go — Web Crawler & Page Analyzer](#3-v3-scanner-go--web-crawler--page-analyzer)
4. [v3-nlp-worker — Async NLP Enrichment](#4-v3-nlp-worker--async-nlp-enrichment)
5. [v3-visual-regression — Screenshot & Visual Diff](#5-v3-visual-regression--screenshot--visual-diff)
6. [v3-browser-pool — Shared Chromium Pool](#6-v3-browser-pool--shared-chromium-pool)
7. [v3-form-executor — Form Testing Runtime](#7-v3-form-executor--form-testing-runtime)
8. [v3-cli — Developer Command Line](#8-v3-cli--developer-command-line)
9. [PostgreSQL Database Schema](#9-postgresql-database-schema)
10. [Supabase — Auth, Projects, Edge Functions](#10-supabase--auth-projects-edge-functions)
11. [Front-Snap — React SPA Frontend](#11-front-snap--react-spa-frontend)
12. [Kubernetes Deployment (k3s)](#12-kubernetes-deployment-k3s)
13. [Docker Compose Local Stack](#13-docker-compose-local-stack)
14. [KPI System — The Data Contract](#14-kpi-system--the-data-contract)
15. [Test Suites — All Services](#15-test-suites--all-services)
16. [Smoke Tests & End-to-End Validation](#16-smoke-tests--end-to-end-validation)
17. [Commands & Scripts Quick Reference](#17-commands--scripts-quick-reference)

---

## 1. System Architecture Overview

### 1.1 What SnapFlow Does

SnapFlow is a **website audit & digital compliance SaaS platform**. It crawls client websites, analyzes them across **9 audit axes** (Technical, Security, Performance, SEO, UX, Content, GDPR, Functional, Eco-Index), and produces **French-language audit reports** with actionable recommendations, roadmap, and Redmine ticket integration.

### 1.2 Service Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (React SPA)                             │
│  Supabase Auth → Edge Functions (fetch-audit-api, poll-audit-job)        │
│  Pages: Overview, Projects, AuditReport (6 tabs), Forms, Assistant       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ HTTP (via k3s Ingress / localhost)
                                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  v3-aggregator (:8080) — FastAPI (Python 3.11)                          │
│  • Orchestrates scan lifecycle                                           │
│  • Calls scanner, polls NLP progress                                     │
│  • Calls visual regression for VRT KPIs                                  │
│  • Builds KPI reports (kpi_builder.py ~2000 lines)                      │
│  • Generates recommendations (classifier.py ~1500 lines)                 │
│  • Computes quality/drift artifacts                                      │
└───┬───────────────────┬─────────────────────┬───────────────────────────┘
    │ POST /scan         │                     │
    ▼                    ▼                     ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐
│ v3-scanner-go│ │v3-nlp-worker │ │ v3-visual-regression │
│   (:8081)    │ │ (no port,    │ │     (:8083)          │
│ Go 1.25.6    │ │  polls DB)   │ │ Python 3.11          │
│              │ │ Python 3.11  │ │                      │
│ • Crawl      │ │ • Read/Write │ │ • /screenshot        │
│ • Static     │ │   nlp_results│ │ • /compare           │
│ • Headless   │ │ • Per-row    │ │ • /ux-kpis           │
│ • Forms      │ │   commit     │ │ • /browser-compat    │
│ • Fuzzing    │ │              │ │                      │
└──────┬───────┘ └──────┬───────┘ └─────────┬────────────┘
       │                │                    │
       │         ┌──────┴────────┐           │
       │         │  PostgreSQL 16 │           │
       │         │  snapflow_v3   │           │
       │         │  (VPS/k3s)     │           │
       └────────►│               ◄│───────────┘
                 └───────┬────────┘
                         │
                 ┌───────┴────────┐
                 │ v3-browser-pool│
                 │    (:8084)     │
                 │ Playwright     │
                 │ Chromium (15)  │
                 └────────────────┘
```

### 1.3 Data Ownership (Inviolable Contract)

| Data Store | Owner | Writes |
|------------|-------|--------|
| `scan_pages` rows | Scanner | Scanner |
| `scan_pages.nlp_results` | NLP Worker | NLP Worker |
| `scan_summaries` domain KPIs | Scanner | Scanner |
| `form_fuzz_results` | Scanner | Scanner |
| `scan_kpi_outputs` | Aggregator | Aggregator |
| `scan_state` | Aggregator | Aggregator |
| `visual_screenshots` | Visual Regression | Visual Regression |
| Supabase tables | Frontend (via Supabase client) | Frontend |

### 1.4 Scan Lifecycle State Machine

```
PENDING → RUNNING → NLP_PROCESSING → COMPLETE
                  ↘ FAILED
```

Valid transitions only: `PENDING → RUNNING → NLP_PROCESSING → COMPLETE | FAILED`

---

## 2. v3-aggregator — API Gateway & Orchestration Brain

**Location**: `V3-Microservices/v3-aggregator/`  
**Language**: Python 3.11 (FastAPI)  
**Port**: 8080  
**Key files**: `main.py` (~3600 lines), `kpi_builder.py` (~2000 lines), `classifier.py` (~1500 lines)

### 2.1 Role & Responsibility

The aggregator is the **central nervous system** of SnapFlow V3. It:

- Exposes the public REST API
- Orchestrates scan lifecycle (calls scanner, waits for NLP, calls visual regression)
- Builds the canonical KPI report from raw scan data
- Generates recommendations and roadmap
- Computes quality/drift monitoring artifacts
- Persists scan state and KPI outputs to PostgreSQL

### 2.2 Startup Behavior

When the aggregator boots, it performs this sequence:

```python
# main.py — startup behavior (simplified)
@app.on_event("startup")
async def startup():
    # 1. Ensure scan_state table exists (CREATE TABLE IF NOT EXISTS)
    _ensure_scan_state_table()
    
    # 2. Ensure scan_kpi_outputs table + drift index exist
    _ensure_kpi_outputs_table()
    
    # 3. Log KPI mode as "new"
    logger.info("KPI mode: new-only")
    
    # 4. Optionally start Azure heartbeat thread
    if os.getenv("WEBSITE_SITE_NAME"):
        _start_azure_heartbeat()
```

### 2.3 Public API Endpoints (10 Total)

#### `GET /health`
```json
{"status": "healthy", "service": "v3-aggregator"}
```

#### `POST /scan` — Async scan launch
```json
// Request
{"url": "https://example.com", "max_pages": 150, "headless_concurrency": 24}

// Response
{"scan_id": "scan_a1b2c3d4", "status": "pending"}
```
Flow: Creates `scan_id` → persists state `pending` → background thread runs `run_scanner()` → returns immediately.

#### `POST /scan/sync` — Blocking scan
Same as `/scan` but blocks until the complete report is ready (can take minutes). Uses `asyncio.to_thread()` so FastAPI event loop stays responsive.

#### `GET /scan/{scan_id}/status`
```json
{
  "scan_id": "scan_a1b2c3d4", "status": "nlp_processing",
  "url": "https://example.com", "pages_crawled": 150,
  "pages_nlp_done": 120, "kpi_mode": "new",
  "elapsed_seconds": 45.2, "error": null
}
```

#### `GET /scan/{scan_id}/result`
Returns full aggregated report JSON (only when `status=complete`). Returns 409 if still processing.

#### `GET /scan/{scan_id}/recommendations`
```json
{
  "domain": "example.com",
  "summary": {"total": 50, "bugs": 10, "recommendations": 30, "compliance": 10},
  "bugs": [...], "recommendations": [...], "compliance": [...],
  "roadmap": {
    "immediate": [], "this_sprint": [], "this_quarter": [], "backlog": []
  },
  "quick_wins": [...], "audit_coverage": [...], "passing_kpis": [...]
}
```

#### `GET /scan/{scan_id}/kpis` — Canonical KPI payload
```json
{
  "kpi_mode": "new",
  "scan_id": "scan_xxx",
  "domain": "example.com",
  "axes": {
    "SECURITY": {"score": 75, "label": "Sécurité", "icon": "🔒",
      "findings": [...], "passing_kpis": [...]},
    ...
  },
  "top_level_kpis": {
    "health_status": "warning",
    "total_kpis": 200, "passed_kpis": 180, "failed_kpis": 5, ...
  },
  "quality_drift_artifact": {...},
  "generated_at": "2026-06-24T12:00:00Z"
}
```

#### `GET /scan/{scan_id}/kpis/top` — Compact summary
Returns only `top_level_kpis` block: health status, headline, key points, KPI counts.

#### `GET /scan/{scan_id}/kpis/quality` — Quality/drift artifact
```json
{
  "scan_id": "scan_xxx", "kpi_mode": "new",
  "quality_drift_artifact": {
    "quality_score": 78.5, "quality_status": "watch",
    "trend": "improving", "deltas": {...}
  }
}
```

#### `GET /scan/{scan_id}/kpi` — Alias for `/kpis`
Preserved for backward compatibility.

### 2.4 Scanner Invocation & Fallback Routing

```python
def _scanner_base_candidates() -> list[str]:
    """Return ordered scanner base URLs with local fallbacks for non-Docker runs."""
    configured = (SCANNER_API_URL or "").strip().rstrip("/")
    candidates: list[str] = []
    
    def _add(url: str):
        if url and url not in candidates:
            candidates.append(url)
    
    _add(configured)
    
    # Fallback chain: localhost → 127.0.0.1 → host.docker.internal → scanner
    for host in ("localhost", "127.0.0.1", "host.docker.internal", "scanner"):
        _add(f"http://{host}:{8081}")
    
    return candidates
```

The aggregator tries each candidate URL in order when invoking the scanner. This allows the same code to work in Docker (where `scanner` resolves via Docker DNS) and in local development (where `localhost` works).

### 2.5 KPI Builder (`kpi_builder.py` — ~2000 lines)

The KPI builder is the **most sensitive file** in the entire codebase. Changes here affect every audit report.

#### Architecture

```python
# _KPI_META maps kpi_slug → (kpi_id, confidence, evidence_quality)
_KPI_META = {
    "sec_ssl": ("sec_ssl", "high", "concrete"),
    "sec_http_headers": ("sec_http_headers", "high", "aggregate"),
    # ... 60+ KPIs
}

# _KPI_BUSINESS_IMPACT maps kpi_slug → French business impact text
_KPI_BUSINESS_IMPACT = {
    "sec_ssl": "Un certificat SSL invalide expose les données des utilisateurs...",
    # ...
}

# _KPI_TICKET_TEAM maps kpi_slug → Redmine team assignment
_KPI_TICKET_TEAM = {
    "sec_ssl": "infra",
    # ...
}
```

#### KPI Normalization Gate

Every KPI passes through `_normalize_kpi_object()` before entering the final report:

```python
def _normalize_kpi_object(coalesced: dict, kpi_id: str, ...) -> tuple[dict, str]:
    """
    VALID/PARTIAL/MISSING classification:
    - VALID: All 9 required fields present, status valid, severity nullable per rule
    - PARTIAL: Some fields missing but status parseable → defaults filled, logged low-confidence
    - MISSING: Core evidence unavailable → excluded from report, counted in not_evaluated_kpis
    """
    status = coalesced.get("status", "not_available")
    # Coerce legacy statuses
    if status in ("not_applicable", "partial", "unknown"):
        status = "not_available"
    # ... validation logic ...
```

#### Quality Score Formula

$$Q = 100 - \text{failure\_rate} - 0.4 \cdot \text{warning\_rate} - 0.3 \cdot (100 - \text{coverage}) - 0.5 \cdot \text{critical\_rate}$$

Clamped to $[0, 100]$.

**Status thresholds**:
- `good`: $Q \ge 80$
- `watch`: $60 \le Q < 80$
- `at\_risk`: $Q < 60$

#### Evidence Contracts

Each KPI's `data` field must contain evidence-specific keys:
- **Concrete evidence** (`_KPI_META[1] = "concrete"`): `raw_value`, `url`, `screenshot_url`
- **Aggregate evidence** (`_KPI_META[1] = "aggregate"`): `summary`, `page_count`, `percentage`
- **NLP evidence**: `keyword`, `readability_score`, `page_type`

### 2.6 Classifier (`classifier.py` — ~1500 lines)

The classifier transforms raw KPI findings into structured recommendations with severity/effort scoring and a priority roadmap.

```python
def score_effort(scope: str, affected_count: int, fix_complexity: str) -> str:
    if scope == "DOMAIN":
        return "LOW"
    if scope == "PAGE" and affected_count <= 3:
        return "LOW"
    if scope == "SITEWIDE" and fix_complexity == "template":
        return "MEDIUM"
    if scope == "PAGE" and affected_count > 20:
        return "HIGH"
    return "MEDIUM"

def _severity_rank(severity: str) -> int:
    ranks = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    return ranks.get(severity, 0)
```

Roadmap buckets:
- **Immediate**: CRITICAL severity
- **This sprint**: HIGH severity
- **This quarter**: MEDIUM severity
- **Backlog**: LOW severity

### 2.7 Commands & Scripts

```bash
# Run aggregator locally (without Docker)
cd V3-Microservices/v3-aggregator
pip install -r requirements.txt
DB_HOST=localhost python main.py
# → http://localhost:8080

# Run aggregator tests
cd V3-Microservices/v3-aggregator
python -m pytest tests -q

# Run specific test files
python -m pytest tests/test_kpi_migration_flags.py -v
python -m pytest tests/test_kpi_centric_report.py -v
python -m pytest tests/test_recommendations_classifier.py -v
python -m pytest tests/test_form_fuzzer_kpi.py -v
```

### 2.8 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | snapflow_v3 | Database name |
| `DB_USER` | snapflow | Database user |
| `DB_PASS` | snapflow | Database password |
| `SCANNER_API_URL` | http://scanner:8081 | Scanner service URL |
| `VISUAL_REGRESSION_API_URL` | http://v3-visual-regression:8083 | Visual regression URL |
| `BROWSER_POOL_URL` | http://v3-browser-pool:8084 | Browser pool URL |
| `DEFAULT_HEADLESS_CONCURRENCY` | 24 | Default headless concurrency |
| `MAX_HEADLESS_CONCURRENCY` | 48 | Max allowed headless concurrency |
| `DB_SSL_MODE` | disable | SSL mode for PostgreSQL |

---

## 3. v3-scanner-go — Web Crawler & Page Analyzer

**Location**: `V3-Microservices/v3-scanner-go/`  
**Language**: Go 1.25.6  
**Port**: 8081  
**Key files**: `main.go` (~2500 lines), `db/db.go`, `analyzers/*/`

### 3.1 Role & Responsibility

The scanner is the **acquisition engine**. It crawls target websites, runs static and runtime analysis, and writes all per-page and domain-level data to PostgreSQL. It does NOT build KPI reports — that's the aggregator's job.

### 3.2 API Endpoints

#### `POST /scan`
```json
// Request
{
  "scan_id": "scan_xxx",
  "url": "https://example.com",
  "domains": ["example.com"],
  "max_pages": 100,
  "headless_concurrency": 4
}

// Response
{"scan_id": "scan_xxx", "status": "ok"}
```

The scanner runs synchronously — the HTTP response is returned only when the crawl pipeline completes.

#### `GET /health`
```json
{"status": "ok"}
```

### 3.3 10-Phase Pipeline (In Order)

The scanner's pipeline runs in a strict 10-phase sequence. **Phase ordering must not change**.

```
Phase 1:  Pre-fetch
          ├─ SSL check (TLS handshake probe)
          ├─ sitemap.xml probe
          ├─ robots.txt probe
          └─ Homepage fetch (for domain-level analysis)

Phase 2:  Domain Analyzers (parallel)
          ├─ tech.Analyze()      → CMS version, server, language
          ├─ security.Analyze()  → SSL, HTTP headers, cookies
          ├─ privacy.Analyze()   → RGPD/privacy signals
          └─ functional.Analyze()→ Forms, features, search

Phase 3:  Colly Crawl
          ├─ Async collector with SCANNER_PARALLELISM (default 150)
          ├─ Respects robots.txt
          ├─ Collects raw_html per page
          └─ Async insert workers push to scan_pages

Phase 4:  DB Sync
          └─ Wait for all async insert workers to complete

Phase 5:  Cloudflare Fallback
          ├─ If 0 pages crawled (anti-bot block)
          ├─ Seed from prefetch HTML
          └─ isCloudflareChallenge() detection

Phase 6:  Form Discovery + Fuzzing
          ├─ formfuzzer.ExtractForms() — static HTML extraction
          ├─ formfuzzer.Run() — Playwright-based fuzzing
          └─ formbrowser.AnalyzeWithBrowser() — browser-based form discovery

Phase 7:  Headless Sampling (Hybrid Strategy)
          ├─ Homepage always included
          ├─ Worst-SEO pages sampled
          ├─ Stride fill to reach HEADLESS_SAMPLE_RATIO (80%)
          └─ Uses v3-browser-pool for rendering

Phase 8:  Cloudflare Backfill
          └─ Replace synthetic data with rendered analysis if Cloudflare blocked

Phase 9:  Mobile Tests
          ├─ Up to 3 URLs
          └─ performance.RunHeadlessPool (mobile profile)

Phase 10: Final Aggregation
          ├─ Compute SEO summaries
          ├─ Compute UX summaries
          ├─ Persist telemetry
          └─ Return FinalReport
```

### 3.4 Key Go Structs

```go
type FinalReport struct {
    Domain           string
    Sitemap          bool
    RobotsTxt        bool
    DomainSecurity   security.ScanResult
    DomainTech       tech.TechResult
    DomainPrivacy    privacy.PrivacyResult
    DomainFunctional functional.FunctionalResult
    SEOSummary       SEOSummary
    SEOIssues        []PageIssueEntry
    UXSummary        UXSummary
    UXIssues         []UXPageIssue
    BrokenLinks      []BrokenLink
    HeadlessResults  []performance.HeadlessResult
    ImageCompression ImageCompressionStats
    FormFuzzer       formfuzzer.Summary
    PagesScanned     int
    ScanDuration     string
    ScanTelemetry    ScanTelemetry
    IsSPA            bool  // SPA detection flag for downstream KPI consumers
}

type ScanTelemetry struct {
    StopReason        string
    PhaseTimingsMS    PhaseTimings
    PagesAtStop       int
    BudgetRemainingMS int64
    FormFuzzer        formfuzzer.Summary
    HeadlessCoveragePct     float64
    PartialHeadlessCoverage bool
    BlockedRecoveryPartial  bool
    RenderedRecoveryPages   int
}
```

### 3.5 Cloudflare/Anti-Bot Detection

```go
// isCloudflareChallenge checks for Cloudflare/anti-bot challenge markers
func isCloudflareChallenge(body string, headers http.Header) bool {
    markers := []string{
        "cf-challenge", "cf-browser-verification",
        "jschl-answer", "challenge-platform",
        "_cf_chl_opt", "cf_clearance",
    }
    // Check body and headers for challenge markers
    // ...
}
```

When detected:
1. Phase 5 seeds from prefetch HTML
2. Phase 7 samples with headless (bypasses JS challenges)
3. Phase 8 replaces synthetic data with rendered analysis

### 3.6 Analyzer Packages

Each analyzer is a self-contained Go package under `analyzers/`:

| Analyzer | Package | What It Detects |
|----------|---------|-----------------|
| **tech** | `analyzers/tech/` | CMS version, server software, programming language, modules |
| **security** | `analyzers/security/` | SSL validity, HTTP headers, cookies, SQLi/DDoS signals, admin exposure, sensitive files, robots disclosure, error pages, brute force, file upload, JS dependency CVEs, service exposure |
| **privacy** | `analyzers/privacy/` | Cookie consent, privacy policy, data retention, minimization, legal notice, user rights, purpose, pre-consent trackers |
| **functional** | `analyzers/functional/` | Forms, links, buttons, features, search |
| **performance** | `analyzers/performance/` | LCP, FCP, CLS (desktop + mobile), image optimization, cache, compression, console errors |
| **seo** | `analyzers/seo/` | Alt tags, meta tags, sitemap, robots.txt, duplicate content, heading structure, internal/external links, AI readiness |
| **ux** | `analyzers/ux/` | Social sharing, design ergonomics, navigation, mobile-friendliness |
| **formfuzzer** | `analyzers/formfuzzer/` | Form extraction, fuzzing with test payloads (XSS, SQLi, CSRF) |
| **formbrowser** | `analyzers/formbrowser/` | Browser-based form discovery and interaction |
| **browserutil** | `analyzers/browserutil/` | Shared browser utilities for all analyzers |

### 3.7 Database Operations (`db/db.go`)

```go
// Connect establishes a connection to PostgreSQL with retry logic
func Connect() error {
    for i := 0; i < 15; i++ {
        conn, err = sql.Open("postgres", dsn)
        if err == nil {
            err = conn.Ping()
            if err == nil {
                conn.SetMaxOpenConns(10)
                conn.SetMaxIdleConns(5)
                // Ensure columns, telemetry, form fuzzer artifacts
                ensureScanPagesHTMLColumns()
                ensureTelemetryColumn()
                ensureFormFuzzerArtifacts()
                return nil
            }
        }
        time.Sleep(2 * time.Second)
    }
    return fmt.Errorf("could not connect after 15 attempts")
}

// InsertPage upserts a scanned page with raw_html preservation
func InsertPage(scanID, domain, pageURL, html string, metrics interface{}) error {
    // ON CONFLICT (scan_id, url) DO UPDATE
    // Preserves raw_html, updates html and metrics
}

// InsertSummary upserts domain-level KPIs
func InsertSummary(scanID, domain string, secRes, techRes, privRes, funcRes interface{}) error {
    // ON CONFLICT (scan_id) DO UPDATE
}

// InsertFormFuzzResult inserts detailed per-form test records
func InsertFormFuzzResult(record FormFuzzResultRecord) error {
    // INSERT INTO form_fuzz_results
}
```

### 3.8 Commands & Scripts

```bash
# Build scanner
cd V3-Microservices/v3-scanner-go
go build -o v3-scanner-go .

# Run scanner locally
DB_HOST=localhost DB_PORT=5432 ./v3-scanner-go
# → http://localhost:8081

# Run scanner tests
go test ./...

# Run specific analyzer tests
go test ./analyzers/formfuzzer/ -v
go test ./analyzers/performance/ -v

# Build Docker image
docker build -t snapflow/v3-scanner-go:latest .
```

### 3.9 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 8081 | HTTP listen port |
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | snapflow_v3 | Database name |
| `DB_USER` | snapflow | Database user |
| `DB_PASS` | snapflow | Database password |
| `DB_SSL_MODE` | disable | SSL mode |
| `CHROME_NO_SANDBOX` | true | Chrome sandbox bypass (Docker) |
| `BROWSER_POOL_URL` | http://v3-browser-pool:8084 | Browser pool URL |
| `BROWSER_POOL_TIMEOUT_MS` | 90000 | Browser pool timeout |
| `SCANNER_PARALLELISM` | 150 | Colly crawl parallelism |
| `HEADLESS_SAMPLE_RATIO` | 0.80 | Fraction of pages for headless sampling |
| `SCANNER_REQUEST_TIMEOUT_SEC` | 30 | HTTP request timeout |
| `RENDERED_DISCOVERY_MAX_PAGES` | 8 | Max pages for rendered discovery |
| `ENABLE_OBSCURA_PARALLEL_DISCOVERY` | true | Obscura parallel discovery |
| `ENABLE_PORT_SCAN` | false | Port scanning (disabled for safety) |
| `ENABLE_FORM_FUZZER` | true | Form fuzzer toggle |
| `ALLOW_FORM_FUZZER_PROD` | false | Blocks fuzzing in production |
| `APP_ENV` / `SNAPFLOW_ENV` | dev | Environment name |

---

## 4. v3-nlp-worker — Async NLP Enrichment

**Location**: `V3-Microservices/v3-nlp-worker/`  
**Language**: Python 3.11  
**Port**: None (polls DB, no HTTP server)  
**Key file**: `main.py` (~3000 lines)

### 4.1 Role & Responsibility

The NLP worker is a **background polling service**. It continuously scans `scan_pages` for rows where `nlp_results IS NULL`, processes them with NLP, and writes back results. It runs independently of the aggregator — the aggregator waits for NLP but doesn't control the worker directly.

### 4.2 Main Loop

```python
def main():
    """Main polling loop — runs forever."""
    logger.info("NLP Worker started, polling every %ds", POLL_INTERVAL)
    
    while True:
        try:
            conn = get_db_connection()
            process_pending_pages(conn)
            conn.close()
        except Exception as exc:
            logger.error("Poll cycle failed: %s", exc)
        
        time.sleep(POLL_INTERVAL)  # Default: 3 seconds
```

### 4.3 Per-Page Processing Pipeline (9 Steps)

```
Step 1: Extract Text
        ├─ extract_text_main_content_first() — progressive fallback
        ├─ Prefers rendered_html over raw_html over html
        ├─ BeautifulSoup with aggressive boilerplate removal (_prune_non_content_nodes)
        └─ Stores extraction metadata: selected_source, word counts

Step 2: Analyze Content
        ├─ analyze_content()
        ├─ Readability: Kandel-Moles (French), Flesch (English)
        ├─ Keyword density, stemming (SnowballStemmer FR/EN)
        └─ Typo detection: Language-Tool (French) or MIN_DICT_FR_EN_AR fallback

Step 3: Classify Page
        ├─ classify_page_type() — landing, product, article, faq, contact, error
        └─ classify_audience_segment() — B2B vs B2C

Step 4: Extract Dates
        ├─ JSON-LD schema → meta tags → HTTP headers → French text patterns
        └─ extract_dates_and_classify() — freshness scoring

Step 5: Analyze RGPD
        ├─ _has_strong_rgpd_signal() — ≥2 RGPD keywords within 200-word window
        ├─ CMP detection: OneTrust, Didomi, CookieBot, TarteAuCitron
        └─ normalize_for_rgpd_match() — Unicode normalization (FR accents, Arabic diacritics)

Step 6: Build SEO KPIs
        ├─ check_h1_quality(), check_heading_hierarchy()
        ├─ check_title_quality(), check_meta_description_quality()
        └─ compute_keyword_prominence(), compute_lsi_score()

Step 7: Build Content KPIs
        ├─ compute_stuffing_index_v2(), check_cannibalization()
        ├─ compute_lexical_diversity(), detect_missing_ctas()
        └─ content_freshness classification

Step 8: Build RGPD KPIs
        ├─ compute_rights_coverage(), check_dpo_contact()
        ├─ audit_third_party_scripts(), check_pre_consent_tracking()
        └─ compute_privacy_score() with weighted dimensions

Step 9: Persist to DB (Per-Row Commit)
        └─ UPDATE scan_pages SET nlp_results = %s WHERE id = %s
```

### 4.4 Concurrency Model

The NLP worker uses **per-row isolation with FOR UPDATE SKIP LOCKED**:

```python
def process_pending_pages(conn):
    """Process up to BATCH_SIZE pending pages with row-level locking."""
    cur = conn.cursor()
    cur.execute("""
        SELECT id, scan_id, url, raw_html, rendered_html, html, metrics
        FROM scan_pages
        WHERE nlp_results IS NULL
        ORDER BY id
        LIMIT %s
        FOR UPDATE SKIP LOCKED
    """, (BATCH_SIZE,))
    
    rows = cur.fetchall()
    for row in rows:
        try:
            nlp_result = process_single_page(row)
            cur.execute(
                "UPDATE scan_pages SET nlp_results = %s WHERE id = %s",
                (json.dumps(nlp_result), row[0])
            )
            conn.commit()  # Per-row commit
        except Exception as exc:
            logger.error("NLP failed for page %s: %s", row[2], exc)
            conn.rollback()
```

### 4.5 ML Models in Use

| Model | Purpose | Notes |
|-------|---------|-------|
| NLTK `stopwords` (FR, EN, AR) | Stopword removal | Set union, not ordered list |
| NLTK `SnowballStemmer` (FR, EN) | Stemming | `_stem_token()` |
| spaCy `fr_core_news_sm` | NER for protected entities | Optional, lazy-loaded |
| language-tool-python (FR) | Grammar/spell checking | Optional, lazy-loaded |
| `textstat` | Flesch-Kincaid, SMOG, Gunning Fog | English only |
| Kandel-Moles formula | French readability | $207 - 1.015 \cdot ASL - 73.6 \cdot ASyll$ |

### 4.6 SPA Non-Hydration Detection

```python
# SPA shell detection — writes status=not_evaluated instead of misleading thin-content KPIs
def _is_spa_shell_not_hydrated(row):
    """Detect SPA pages with no meaningful rendered content."""
    has_spa_markers = bool(re.search(r'(react|vue|angular|svelte)', 
                           str(row.get("rendered_html", ""))[:2000], re.I))
    rendered_text = extract_text(row.get("rendered_html"))
    word_count = len(rendered_text.split())
    
    if has_spa_markers and word_count < 50:
        return True  # SPA shell, not hydrated
    return False
```

### 4.7 Commands & Scripts

```bash
# Run NLP worker locally
cd V3-Microservices/v3-nlp-worker
pip install -r requirements.txt
DB_HOST=localhost python main.py

# Run NLP tests
python -m pytest tests -q

# Run specific test suites
python -m pytest tests/test_phase_o.py -v   # 36 tests — content analysis
python -m pytest tests/test_phase_l.py -v   # 36 tests — date extraction + NLP
python -m pytest tests/test_schema_org_json_ld.py -v

# Run live site calibration (requires network)
python -m pytest tests/test_live_site_calibration.py -v
```

### 4.8 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_HOST` | localhost | PostgreSQL host |
| `DB_PORT` | 5432 | PostgreSQL port |
| `DB_NAME` | snapflow_v3 | Database name |
| `DB_USER` | snapflow | Database user |
| `DB_PASS` | snapflow | Database password |
| `POLL_INTERVAL` | 3 | Seconds between DB polls |
| `SPACY_FR_MODEL` | fr_core_news_sm | spaCy model name |

---

## 5. v3-visual-regression — Screenshot & Visual Diff

**Location**: `V3-Microservices/v3-visual-regression/`  
**Language**: Python 3.11 (FastAPI)  
**Port**: 8083  
**Key files**: `main.py`, `services/image_comparator.py`, `services/zone_comparator.py`, `services/ux_kpis.py`

### 5.1 Role & Responsibility

The visual regression service captures screenshots, compares them across scans to detect visual regressions, and computes UX KPIs from visual analysis.

### 5.2 API Endpoints

#### `GET /health`
```json
{"status": "healthy", "service": "v3-visual-regression"}
```

#### `POST /screenshot` — Batch screenshot capture
```json
// Request
{"scan_id": "scan_xxx", "urls": ["https://example.com", "https://example.com/about"],
 "max_pages": 10, "full_page": true}

// Response
{"scan_id": "scan_xxx", "captured": 2, "full_page": true,
 "pages": [{"url": "...", "status": "ok", "coverage_mode": "full_page"}, ...]}
```

Coverage modes:
- `viewport_only` — single viewport
- `full_page` — full scroll height (default)
- `segmented` — 3 stitched viewport segments (pages >15000px)

#### `POST /compare` — SSIM + Zone-based visual regression
```json
// Request
{"scan_id_baseline": "scan_old", "scan_id_new": "scan_new",
 "urls": ["https://example.com"], "viewport_height": 768}

// Response — per-page comparison with fused scoring
```

**Fused score formula**:
$$\text{fused} = 0.45 \cdot \text{zone\_norm} + 0.25 \cdot \text{ssim\_delta} + 0.20 \cdot \text{phash\_norm} + 0.10 \cdot \text{lpips\_norm}$$

Threshold: $0.22$ — above this is a regression.

#### `POST /ux-kpis` — UX visual analysis
```json
// Request
{"url": "https://example.com", "viewport_height": 768}

// Response
{
  "visual_complexity_score": 45.2,   // 0-100, lower = simpler
  "cta_prominence_score": 78.5,      // 0-100, higher = more prominent
  "first_impression_score": 72.3     // 0-100 composite
}
```

**First impression formula**:
$$\text{first\_impression} = 0.30 \cdot \text{aboveFold} + 0.35 \cdot \text{cta} + 0.20 \cdot \text{hierarchy} + 0.15 \cdot (1 - \text{complexity})$$

#### `POST /browser-compat` — Cross-browser comparison
```json
// Request
{"url": "https://example.com", "threshold_pct": 5.0}

// Response — Chromium vs WebKit diff
```

### 5.3 Zone-Based Comparison (5 Semantic Zones)

| Zone | Weight | What It Covers |
|------|--------|----------------|
| Header | 30% | Top navigation, logo, primary menus |
| Hero | 25% | Main hero/banner area |
| Content | 15% | Main content body |
| Footer | 5% | Footer links, copyright |
| CTA | 25% | Call-to-action elements |

### 5.4 Image Comparison Algorithms

```python
# services/image_comparator.py
from skimage.metrics import structural_similarity as ssim
from PIL import Image
import imagehash

def compare_images_ssim(img_a: Image.Image, img_b: Image.Image) -> dict:
    """Compute SSIM score between two RGB images."""
    # Resize to common dimensions if needed
    # Compute SSIM
    score = ssim(img_a_array, img_b_array, channel_axis=2, data_range=255)
    return {"ssim_score": round(score, 4), "diff_pct": round((1 - score) * 100, 2)}

# Optional LPIPS (PyTorch-based perceptual loss)
# Controlled by VISUAL_LPIPS_ENABLED env var
```

### 5.5 Size/Structural Change Detection

The comparator detects layout changes BEFORE running pixel diffing:

```python
# BL-16: Reject comparisons where viewport width shifted (mobile vs desktop mixup)
if abs(width_a - width_b) > 5:
    page_results.append({
        "url": url,
        "status": "size_mismatch",
        "diff_pct": None,
        "note": "Viewport width differs (>5px), possibly mobile vs desktop comparison"
    })
```

### 5.6 Commands & Scripts

```bash
# Run visual regression locally
cd V3-Microservices/v3-visual-regression
pip install -r requirements.txt
DATABASE_URL=postgresql://snapflow:snapflow@localhost:5432/snapflow_v3 python main.py
# → http://localhost:8083

# Run tests
python -m pytest tests/ -v
python -m pytest tests/test_image_comparator.py -v
python -m pytest tests/test_zone_comparator.py -v
python -m pytest tests/test_ux_kpis.py -v
python -m pytest tests/test_flags.py -v
```

---

## 6. v3-browser-pool — Shared Chromium Pool

**Location**: `V3-Microservices/v3-browser-pool/`  
**Language**: Python 3.11 (FastAPI + Playwright)  
**Port**: 8084  
**Key files**: `main.py`, `pool.py`

### 6.1 Role & Responsibility

The browser pool provides a **shared, managed pool of Chromium instances** used by the scanner and visual regression services. This avoids each service spawning its own browser processes.

### 6.2 Pool Configuration

```python
class BrowserPool:
    def __init__(self):
        self.concurrency = int(os.getenv("BROWSER_POOL_CONCURRENCY", "15"))
        self.recycle_after = int(os.getenv("BROWSER_POOL_RECYCLE_AFTER", "50"))
        self.default_timeout_ms = int(os.getenv("BROWSER_POOL_DEFAULT_TIMEOUT_MS", "30000"))
        self.acquire_timeout_s = int(os.getenv("BROWSER_POOL_ACQUIRE_TIMEOUT_S", "20"))
```

- **15 concurrent contexts** (pages), not 15 separate Chromium processes
- **Recycle after 50 pages** to prevent memory leaks
- **30s default timeout** for render operations

### 6.3 API Endpoints

#### `GET /health`
```json
{
  "status": "healthy",
  "pool_size": 24,
  "active_sessions": 3,
  "available_sessions": 21,
  "ignore_https_errors": true
}
```

#### `POST /render` — Render a page and return HTML + metadata
```json
// Request
{"url": "https://example.com", "timeout_ms": 30000,
 "wait_until": "domcontentloaded", "engine": "chromium",
 "settle_ms": 1000, "profile": "desktop"}

// Response
{
  "url": "https://example.com",
  "html": "<!DOCTYPE html>...",
  "fcp_ms": 450, "lcp_ms": 1200, "cls": 0.02,
  "dom_node_count": 342, "http_requests": 18,
  "transfer_size": 1250000, "console_errors": 0,
  "asset_breakdown": {"images": 12, "scripts": 4, "styles": 2}
}
```

Render engines:
- `chromium` — standard Playwright Chromium
- `obscura` — Obscura stealth browser (with `obscura` Docker profile)
- `auto` — tries Chromium first, falls back to Obscura

Wait strategies:
- `load` — full page load
- `domcontentloaded` — DOM ready (default)
- `networkidle` — no network activity for 500ms
- `commit` — navigation committed

#### `POST /screenshot` — Single screenshot
```json
// Request
{"url": "https://example.com", "width": 1280, "height": 800,
 "full_page": true, "timeout_ms": 30000}

// Response
{"url": "...", "screenshot": "base64_png_data...", "width": 1280, "height": 4500}
```

#### `POST /batch-screenshot` — Batch screenshots
```json
// Request
{"urls": ["url1", "url2", ...], "max_pages": 10, "full_page": true}

// Response
{"captured": 10, "pages": [...]}
```

#### `POST /discover-rendered` — Discovery-only render
Extracts rendered text, links, and forms from a page without full rendering analysis.

### 6.4 Obscura Integration (Optional)

Obscura is a stealth browser that avoids anti-bot detection. Configured via Docker profile:

```yaml
obscura:
  image: ${OBSCURA_IMAGE:-h4ckf0r0day/obscura:latest}
  profiles: ["obscura"]
  environment:
    CHROME_NO_SANDBOX: "true"
```

Environment variables:
- `ENABLE_OBSCURA_DISCOVERY`: Enables Obscura for discovery
- `OBSCURA_RENDER_ENABLED`: Enables Obscura for rendering
- `OBSCURA_MAX_SESSIONS`: Max concurrent Obscura sessions (48)
- `OBSCURA_CDP_URL`: CDP WebSocket URL for Obscura

### 6.5 Commands & Scripts

```bash
# Run browser pool locally
cd V3-Microservices/v3-browser-pool
pip install -r requirements.txt
python main.py
# → http://localhost:8084

# Check health
curl -s http://localhost:8084/health | jq
```

---

## 7. v3-form-executor — Form Testing Runtime

**Location**: `V3-Microservices/v3-form-executor/`  
**Language**: Python 3.11 (background worker)  
**Port**: 8085  
**Profile**: `form-tester` (Docker Compose)

### 7.1 Role & Responsibility

The form executor processes queued form-testing scenarios. Unlike the scanner's form fuzzer (which does basic SQLi/XSS testing), this service runs structured, scenario-based form testing workflows defined by users in the frontend.

### 7.2 Architecture

- **Queue**: Stored in Supabase PostgreSQL (NOT the scan database)
- **Worker**: Polls queue, executes form scenarios via Playwright
- **Artifacts**: Screenshots and results stored in Supabase Storage bucket
- **CAPTCHA**: Optional 2Captcha integration

### 7.3 Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `FORM_EXECUTOR_DATABASE_URL` | postgresql://postgres:postgres@host.docker.internal:54322/postgres | Supabase DB URL |
| `SUPABASE_URL` | http://host.docker.internal:54321 | Supabase API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | (required) | Supabase service role key |
| `FORM_EXECUTOR_ARTIFACT_BUCKET` | form-test-artifacts | Storage bucket name |
| `FORM_EXECUTOR_CONCURRENCY` | 3 | Max concurrent form executions |
| `FORM_EXECUTOR_POLL_INTERVAL` | 1 | Seconds between queue polls |
| `FORM_EXECUTOR_TIMEOUT_MS` | 90000 | Per-execution timeout |
| `FORM_EXECUTOR_2CAPTCHA_API_KEY` | (optional) | 2Captcha API key |
| `CHROME_NO_SANDBOX` | true | Chrome sandbox bypass |

### 7.4 Commands & Scripts

```bash
# Run with Docker Compose (form-tester profile)
docker compose --profile form-tester up -d v3-form-executor

# Run tests
cd V3-Microservices/v3-form-executor
python -m pytest tests/ -v
```

---

## 8. v3-cli — Developer Command Line

**Location**: `V3-Microservices/v3-cli/`  
**Language**: Go 1.25.6 (Cobra + Bubbletea)  
**Config**: `.snapflow.yaml`

### 8.1 Commands

```bash
# Scan — trigger a scan and watch progress
v3-cli scan --url https://example.com --max-pages 50

# Monitor — check all service health
v3-cli monitor

# Build — cross-compile Go scanner (stub, delegated to TUI)
v3-cli build

# Deploy — Pinggy tunnel setup (stub)
v3-cli deploy
```

---

## 9. PostgreSQL Database Schema

**Location**: `V3-Microservices/db/init.sql`  
**Database**: `snapflow_v3`

### 9.1 `scan_pages` — Per-Page Data

```sql
CREATE TABLE IF NOT EXISTS scan_pages (
    id          SERIAL PRIMARY KEY,
    scan_id     VARCHAR(64)  NOT NULL,     -- groups pages from one scan run
    domain      VARCHAR(255) NOT NULL,
    url         TEXT         NOT NULL,
    html        TEXT,                       -- compatibility HTML (legacy)
    raw_html    TEXT,                       -- raw HTTP HTML from crawler
    rendered_html TEXT,                     -- hydrated DOM HTML from headless renderer
    metrics     JSONB        DEFAULT '{}',  -- scanner per-page KPIs
    nlp_results JSONB        DEFAULT NULL,  -- NLP enrichment (NULL = pending)
    created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_scan_url UNIQUE (scan_id, url)
);

-- Critical index: NLP worker finds unprocessed pages efficiently
CREATE INDEX IF NOT EXISTS idx_nlp_pending
    ON scan_pages (id) WHERE nlp_results IS NULL;

CREATE INDEX IF NOT EXISTS idx_scan_domain
    ON scan_pages (scan_id, domain);
```

### 9.2 `scan_summaries` — Domain-Level KPIs

```sql
CREATE TABLE IF NOT EXISTS scan_summaries (
    scan_id           VARCHAR(64) PRIMARY KEY,
    domain            VARCHAR(255) NOT NULL,
    domain_security   JSONB DEFAULT '{}',
    domain_tech       JSONB DEFAULT '{}',
    domain_privacy    JSONB DEFAULT '{}',
    domain_functional JSONB DEFAULT '{}',
    image_compression    JSONB DEFAULT NULL,
    broken_links_summary JSONB DEFAULT NULL,
    seo_kpi_extended     JSONB DEFAULT NULL,
    form_fuzzer_summary  JSONB DEFAULT NULL,
    scan_telemetry       JSONB DEFAULT NULL,  -- runtime-added
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 9.3 `form_fuzz_results` — Per-Form Test Records

```sql
CREATE TABLE IF NOT EXISTS form_fuzz_results (
    id             BIGSERIAL PRIMARY KEY,
    scan_id        VARCHAR(64) NOT NULL,
    page_url       TEXT        NOT NULL,
    action_url     TEXT        NOT NULL,
    form_id        TEXT        NOT NULL,
    test_type      VARCHAR(32) NOT NULL,  -- xss, sqli, csrf, etc.
    payload        JSONB       DEFAULT '{}'::jsonb,
    response_type  VARCHAR(32) DEFAULT 'error',
    status_code    INTEGER     DEFAULT 0,
    anomaly        BOOLEAN     DEFAULT FALSE,
    anomaly_reason TEXT,
    duration_ms    BIGINT      DEFAULT 0,
    error          TEXT,
    created_at     TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_form_fuzz_scan
    ON form_fuzz_results (scan_id, page_url, form_id, test_type, created_at);
```

### 9.4 `scan_kpi_outputs` — Canonical KPI Persistence

```sql
CREATE TABLE IF NOT EXISTS scan_kpi_outputs (
    scan_id         VARCHAR(64) PRIMARY KEY,
    scan_url        TEXT,
    kpi_json        JSONB        NOT NULL,      -- Full KPI tree
    top_level_kpis  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    quality_drift_artifact JSONB  NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Drift lookup: find previous scan on same URL
CREATE INDEX IF NOT EXISTS idx_scan_kpi_outputs_scan_url_updated
    ON scan_kpi_outputs (scan_url, updated_at DESC);
```

### 9.5 `scan_state` — Scan Lifecycle State

```sql
CREATE TABLE IF NOT EXISTS scan_state (
    scan_id     VARCHAR(64) PRIMARY KEY,
    state_json  JSONB        DEFAULT '{}',
    updated_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);
```

### 9.6 `visual_screenshots` — Screenshot Storage

```sql
CREATE TABLE IF NOT EXISTS visual_screenshots (
    id          SERIAL PRIMARY KEY,
    scan_id     VARCHAR(64) NOT NULL,
    url         TEXT        NOT NULL,
    screenshot  BYTEA,                       -- PNG image data
    created_at  TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (scan_id, url)
);
```

---

## 10. Supabase — Auth, Projects, Edge Functions

**Platform**: Supabase (cloud-hosted)  
**Purpose**: Authentication, user management, project CRUD, notifications, edge functions bridging frontend ↔ backend

### 10.1 Database Tables (Supabase Cloud)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | Client projects | `id`, `site_name`, `url`, `redmine_url`, `logo_url` |
| `audits` | Audit records | `id`, `project_id`, `status`, `report_data` (JSONB), `job_id` |
| `project_assignments` | User↔Project mapping | `project_id`, `user_id` |
| `profiles` | User profiles | `id`, `email`, `full_name` |
| `user_roles` | RBAC | `user_id`, `role` (admin\|charge_de_projet) |
| `activity_reports` | Redmine issue snapshots | `project_id`, `report_data`, `filters` |
| `notifications` | Real-time notifications | `user_id`, `title`, `message`, `category`, `is_read` |
| `report_schedules` | Cron audit schedules | `project_id`, `frequency`, `next_run_at`, `is_active` |
| `trial_usage` | Free trial tracking | `email` |
| `redmine_account_cache` | Redmine data cache | `user_id`, `redmine_data` |

### 10.2 Auth Flow

```
1. User signs up/logs in via Supabase Auth (email + password)
2. AuthProvider context (useAuth.tsx) manages session, user, role
3. user_roles table maps user_id → role (admin | charge_de_projet)
4. AppLayout redirects unauthenticated users to /auth
```

### 10.3 Edge Functions

#### `fetch-audit-api`

Bridges the frontend to the aggregator API:

```typescript
// Location: supabase/functions/fetch-audit-api/index.ts
// Purpose: Proxy frontend audit requests to the aggregator backend

Deno.serve(async (req) => {
  const { url, async_mode = false, max_pages = 100 } = await req.json();
  
  // Redmine URL guard
  if (isRedmineProjectUrl(url)) {
    return error("Refusing to audit a Redmine project URL");
  }
  
  const apiUrl = `${Deno.env.get('SCANNER_BASE_URL')}/scan`;
  
  // Async mode: fire-and-forget, return job_id
  // Sync mode: wait for full results (with retry for 408/429/5xx)
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, max_pages, headless_concurrency: 24 }),
  });
  
  return Response.json(await response.json());
});
```

**Environment variables required**:
- `SCANNER_BASE_URL` — aggregator API base URL (e.g., `https://api.yourdomain.com` or Pinggy tunnel)

#### `poll-audit-job`

Polls the aggregator for job status:

```typescript
Deno.serve(async (req) => {
  const { job_id } = await req.json();
  const apiUrl = `${Deno.env.get('SCANNER_BASE_URL')}/scan/${job_id}/result`;
  const response = await fetch(apiUrl);
  return Response.json(await response.json());
});
```

### 10.4 Commands & Scripts

```bash
# Run local Supabase for development
cd Front-Snap
./scripts/local-supabase-preprod.sh

# This starts:
# - Supabase Studio at http://localhost:54323
# - PostgreSQL at localhost:54322
# - API at http://localhost:54321
# - Inbucket (email) at http://localhost:54324

# Seed local admin user
node scripts/seed-local-admin.mjs

# Deploy edge functions
supabase functions deploy fetch-audit-api
supabase functions deploy poll-audit-job

# Set secrets for edge functions
supabase secrets set SCANNER_BASE_URL=https://your-aggregator-url.com

# Run Supabase migrations
supabase db push
```

---

## 11. Front-Snap — React SPA Frontend

**Location**: `Front-Snap/`  
**Language**: TypeScript (React 18 + Vite)  
**Port**: 5173 (dev), 3000 (Docker/nginx)

### 11.1 Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| Vite | 5.x | Build tool |
| TypeScript | ~5.x | Type safety |
| Tailwind CSS | 3.x | Utility-first CSS |
| React Router | 6.x | Client-side routing |
| TanStack Query | 5.x | Server state management |
| Supabase JS | 2.x | Auth + DB client |
| @react-pdf/renderer | 4.3.2 | PDF generation |
| shadcn/ui | latest | UI component library |
| Zod | 3.x | Schema validation |

### 11.2 Route Structure

```typescript
// src/App.tsx — Route definitions

<Routes>
  <Route path="/" element={<Navigate to="/auth" replace />} />
  <Route path="/auth" element={<Auth />} />
  
  <Route path="/app" element={<AppLayout />}>   {/* Protected layout */}
    <Route index element={<Overview />} />
    <Route path="projects" element={<AdminProjects />} />
    <Route path="projects/:id" element={<ProjectShell />}>
      <Route index element={<ProjectFiche />} />
      <Route path="audits" element={<ProjectAudits />} />
      <Route path="activity" element={<ActivityReport />} />
    </Route>
    <Route path="reports" element={<ReportsPage />} />
    <Route path="schedules" element={<ReportSchedules />} />
    <Route path="notifications" element={<NotificationsPage />} />
    <Route path="assistant" element={<AssistantPage />} />
    <Route path="workflows" element={<WorkflowsPage />} />
    <Route path="workflows/form-tester" element={<FormTesterPage />} />
    <Route path="workflows/form-tester/:id" element={<FormTesterBuilderPage />} />
    <Route path="workflows/form-tester/:id/results" element={<FormTesterResultsPage />} />
    <Route path="users" element={<AdminUsers />} />
  </Route>
  
  <Route path="/audit/:id" element={<AuditReport />} />        {/* Direct audit view */}
  <Route path="/audit/:id/view" element={<AuditReport />} />   {/* Read-only view */}
  <Route path="*" element={<NotFound />} />
</Routes>
```

### 11.3 Key Pages

#### `AuditReport.tsx` — 6-Tab Audit Viewer

```typescript
// The core page — displays full audit reports with 6 tabs:
const [activeTab, setActiveTab] = useState('resume');

<Tabs value={activeTab}>
  <TabsList>
    <TabsTrigger value="resume">Résumé</TabsTrigger>
    <TabsTrigger value="sommaire">Sommaire</TabsTrigger>
    <TabsTrigger value="details">Détails</TabsTrigger>
    <TabsTrigger value="tableau">Tableau</TabsTrigger>
    <TabsTrigger value="simulateur">Simulateur</TabsTrigger>
    <TabsTrigger value="tickets">Tickets</TabsTrigger>
  </TabsList>
</Tabs>
```

Features:
- **Edit mode**: Admin users can edit findings inline
- **PDF export**: 4 themes (Slate, Mineral, Sand, Steel), 11-page document
- **Polling**: Auto-polls job status every 15s during generation
- **Backward compatibility**: Handles missing `logo_url` column gracefully

#### `AdminProjects.tsx` — Project CRUD
Full CRUD for client projects: name, URL, Redmine URL, logo upload.

#### `Overview.tsx` — Dashboard
Summary statistics across all projects and audits.

#### `FormTesterPage.tsx` — Form Testing Workflow
Multi-step form tester with workflow builder, campaign planning, and results viewing.

### 11.4 Data Flow: Frontend → Backend

```
User clicks "Generate Audit"
    │
    ▼
auditService.generateAudit(projectId, url)
    │
    ├─ 1. INSERT INTO audits (status='generating')
    │
    ├─ 2. supabase.functions.invoke('fetch-audit-api', {url, async_mode: true})
    │      │
    │      └─ Edge function POSTs to aggregator /scan
    │         └─ Returns {scan_id (aka job_id)}
    │
    ├─ 3. UPDATE audits SET job_id = scan_id
    │
    └─ 4. useAsyncAuditPoll hooks polls every 15s:
           supabase.functions.invoke('poll-audit-job', {job_id})
             │
             └─ Edge function GETs aggregator /scan/{id}/result
                └─ When complete, maps API → audit display format via auditMapper.ts
                   └─ Normalizes via normalizeAuditReport.ts
                      └─ Persists to audits.report_data
```

### 11.5 `auditMapper.ts` — API → Display Normalization

The audit mapper is the **critical bridge** between backend KPI output and frontend display:

```typescript
// src/lib/auditMapper.ts — Key concepts:

// 1. Axis aliasing — maps backend axis labels to display labels
//    "TECHNIQUE" → "Technique", "CMS" → "TECHNIQUE"

// 2. KPI label rules — each KPI has a resolver function
const KPI_LABEL_RULES: Record<string, KpiLabelResolver> = {
  sec_ssl(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;      // "Concluant"
    if (rawStatus === 'not_available') return NT_DEFAULT; // "Non testé"
    return KO_BUG_MAJ;  // SSL invalid → always Bug/Majeure
  },
  // ... 60+ KPI-specific rules
};

// 3. Status → display triplet mapping:
//    passing      → Concluant / Conforme / Normale
//    failing      → Non concluant / Bug or Recommandation / Majeure or Mineure
//    warning      → Non concluant / Recommandation / Mineure
//    not_available → Non testé / Indéterminé / Normale

// 4. isRiskPassingFinding() — user preference: passing KPIs must NOT display risk wording
```

### 11.6 PDF Report Generation

```typescript
// src/lib/generateAuditPdf.tsx

export async function generateAuditPdf(
  report: AuditReport,
  projectInfo: { site_name: string; logo_url: string | null },
  theme: PdfTheme = 'slate'
): Promise<Blob> {
  // 1. Fetch client logo as base64 (or fallback to gradient)
  // 2. Render AuditDocument (React-PDF):
  //    Page 1: Cover page (logo, site name, date)
  //    Page 2: Table of Contents
  //    Page 3: Executive Summary (health status, key points)
  //    Page 4: KPI Grid (all axes with scores)
  //    Pages 5-7: Per-axis detailed findings
  //    Page 8: Recommendations
  //    Page 9: Roadmap (immediate → backlog)
  //    Page 10: Conclusion
  //    Page 11: Annexe + Back Cover
  // 3. Convert to blob, trigger download
}
```

4 themes: **Slate** (default), **Mineral**, **Sand**, **Steel** — defined in `src/components/pdf/theme.ts`.

### 11.7 Commands & Scripts

```bash
# Install dependencies
cd Front-Snap
npm install

# Start development server
npm run dev
# → http://localhost:5173

# Build for production
npm run build

# Preview production build
npm run preview

# Run linting
npm run lint

# Start local Supabase (in another terminal)
./scripts/local-supabase-preprod.sh

# Seed admin user
node scripts/seed-local-admin.mjs

# Test form tester phases
node scripts/test-form-tester-phase1.mjs
node scripts/test-form-tester-phase2.mjs

# Build Docker image
docker build -t snapflow/frontend:latest .
```

### 11.8 Services

| Service | File | Purpose |
|---------|------|---------|
| `auditService.ts` | `src/services/` | Generate, poll, complete audits |
| `authService.ts` | `src/services/` | User CRUD operations |
| `redmineService.ts` | `src/services/` | Redmine API integration |

### 11.9 Hooks

| Hook | File | Purpose |
|------|------|---------|
| `useAuth.tsx` | `src/hooks/` | Auth context (session, user, role) |
| `useAsyncAuditPoll.ts` | `src/hooks/` | Polls audit job every 15s |
| `useRealtimeNotifications.ts` | `src/hooks/` | Supabase real-time listener |
| `useTheme.tsx` | `src/hooks/` | Dark/light theme |
| `useFormWorkflowBuilder.ts` | `src/hooks/` | Form tester workflow builder |

---

## 12. Kubernetes Deployment (k3s)

**Location**: `k8s/`  
**Platform**: k3s single-node on OVH VPS (12 vCores, 48 GB RAM)

### 12.1 Namespace Layout

```yaml
# 00-bootstrap/namespaces.yaml
---
apiVersion: v1
kind: Namespace
metadata:
  name: snapflow-infra    # PostgreSQL, PgBouncer, Redis
---
apiVersion: v1
kind: Namespace
metadata:
  name: snapflow-prod     # All 6 microservices + frontend
```

### 12.2 Infrastructure Services (`01-infra/`)

| Service | Type | Spec |
|---------|------|------|
| PostgreSQL 16 | StatefulSet | 50Gi PVC, Prometheus exporter |
| PgBouncer | Deployment | Transaction mode, max 200 connections |
| Redis 7.2 | Deployment | 10Gi PVC, 512MB max memory |

### 12.3 Application Services (`02-services/`)

| Service | Replicas | Port | Autoscaling |
|---------|----------|------|-------------|
| aggregator | 1→3 | 8080 | HPA CPU 70% |
| scanner | 1→5 | 8081 | KEDA CPU 75% |
| nlp-worker | 1→4 | — | KEDA scaling |
| visual-regression | 1→3 | 8083 | HPA |
| browserless | 1 | 3000 | — |
| frontend | 1 | 3000 | — |

### 12.4 Autoscaling (`03-autoscaling/`)

```yaml
# hpa-aggregator.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  minReplicas: 1
  maxReplicas: 3
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70

# keda-scanner.yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
spec:
  minReplicaCount: 1
  maxReplicaCount: 5
  triggers:
  - type: cpu
    metricType: Utilization
    metadata:
      value: "75"
```

### 12.5 Networking (`04-networking/`)

- **Ingress**: nginx-ingress (LoadBalancer)
- **TLS**: cert-manager + Let's Encrypt ClusterIssuer
- **NetworkPolicies**: Restrict inter-service communication (aggregator → scanner, scanner → browser-pool, etc.)

### 12.6 Monitoring (`06-monitoring/`)

- **Prometheus**: ServiceMonitors for PostgreSQL, aggregator, scanner
- **Grafana**: Dashboards for health, KPI quality, drift trends
- **Alerting**: PrometheusRules for critical conditions

### 12.7 Deployment Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `00-first-deploy.sh` | Orchestrator — validates prerequisites, runs full flow |
| `01-bootstrap-node.sh` | System prep (sysctl, firewall, Docker) |
| `02-install-k3s-server.sh` | k3s install (single-node, no Traefik) |
| `03-install-operators.sh` | Helm: ingress-nginx, cert-manager, KEDA, Prometheus |
| `04-apply-manifests.sh` | Apply all YAMLs in dependency order |
| `05-run-migrations.sh` | DB init via PgBouncer |
| `06-smoke-test.sh` | Validation — health checks, end-to-end API test hint |
| `07-build-and-import-images.sh` | Build Docker images + import to k3s |

### 12.8 Full Deployment Sequence

```bash
# From the k8s/scripts/ directory:

# 1. Validate prerequisites (--check-only mode)
./00-first-deploy.sh --check-only

# 2. Execute full deployment (--execute mode)
./00-first-deploy.sh --execute

# Which runs internally:
#   ./01-bootstrap-node.sh
#   ./02-install-k3s-server.sh
#   ./03-install-operators.sh
#   [MANUAL: Replace secrets in k8s/07-secrets/]
#   ./07-build-and-import-images.sh
#   ./04-apply-manifests.sh
#   ./05-run-migrations.sh
#   ./06-smoke-test.sh
```

### 12.9 Secrets Management

```yaml
# k8s/07-secrets/snapflow-secrets.yaml — placeholder (DO NOT COMMIT real secrets)
# Required replacements:
#   db_host, db_port, db_name, db_user, db_pass
#   scanner_api_url, visual_regression_api_url
#   Ingress hosts: api.yourdomain.com, app.yourdomain.com
#   ClusterIssuer email: devops@yourdomain.com
```

---

## 13. Docker Compose Local Stack

**Location**: `V3-Microservices/docker-compose.yml`  
**Launcher**: `run.sh` (Bash) / `run.ps1` (PowerShell)

### 13.1 Service Topology (Local)

```yaml
services:
  db:                  # PostgreSQL 16-alpine
  scanner:             # Go scanner (port 8081)
  nlp-worker:          # Python NLP worker (no port)
  aggregator:          # Python FastAPI (port 8080)
  v3-browser-pool:     # Python Playwright pool (port 8084)
  v3-visual-regression:# Python FastAPI (port 8083)
  v3-form-executor:    # Python form tester (port 8085, profile: form-tester)
  obscura:             # Stealth browser (profile: obscura)
```

### 13.2 Base Images

Two shared base images are built once and reused:

- `snapflow/v3-python-fastapi-base` — For aggregator, visual regression, browser pool
- `snapflow/v3-python-heavy-base` — For NLP worker (includes spaCy, NLTK, textstat)

Rebuilt only when:
- You pass `--rebuild-base`
- The image is missing locally

### 13.3 Launcher Flags

```bash
cd V3-Microservices

# Normal start (reuses existing builds)
./run.sh

# Tear down + rebuild + start
./run.sh --down --no-cache

# With Obscura stealth browser
./run.sh  # (Obscura is enabled by default)

# Without Obscura (Chromium only)
./run.sh --no-obscura

# Local development with local Supabase
./run.sh --local

# Force base image rebuild
./run.sh --rebuild-base --no-cache
```

### 13.4 Test Flow After Startup

```bash
# 1. Sync test (blocks until complete)
curl -s -X POST http://localhost:8080/scan/sync \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","max_pages":20}'

# 2. Async test
SCAN_ID=$(curl -s -X POST http://localhost:8080/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","max_pages":20}' | jq -r .scan_id)

# Poll status
curl -s http://localhost:8080/scan/$SCAN_ID/status | jq

# When complete, get full KPIs
curl -s http://localhost:8080/scan/$SCAN_ID/kpis/top | jq
curl -s http://localhost:8080/scan/$SCAN_ID/kpis/quality | jq
```

---

## 14. KPI System — The Data Contract

### 14.1 The 9 Audit Axes

| # | Axis Slug | French Name | KPIs |
|---|-----------|-------------|------|
| 1 | `TECHNIQUE` | Audit Technique | 5 |
| 2 | `SECURITY` | Sécurité | 12 |
| 3 | `FONCTIONNEL` | Audit Fonctionnel | 5 |
| 4 | `PERFORMANCE` | Performance | 7 |
| 5 | `SEO` | SEO | 13 |
| 6 | `UX_UI` | UX/UI | 5 |
| 7 | `CONTENU` | Contenu | 7 |
| 8 | `RGPD` | RGPD/Conformité | 9 |
| 9 | `ECO_INDEX` | Eco-Index | 1 |

**Total**: 64 KPIs across 9 axes.

### 14.2 The 9-Field JSON Schema Contract

```json
{
  "constat": "string (French-language finding statement)",
  "info": "string (technical information/summary)",
  "impact": "string (business/user impact)",
  "pages_affected": 0,
  "pages_affected_urls": ["url1", "url2"],
  "status": "passing | failing | warning | not_available",
  "type": "bug | recommendation | compliance",
  "severity": "critical | high | medium | low | null",
  "data": { "key": "value", "_raw": {} }
}
```

**Rules**:
- `severity` MUST be `null` when `status` is `passing`
- `severity` MUST be set when `status` is `failing` or `warning`
- `type` determines the category bucket in recommendations
- `data._raw` captures any unknown/migration fields

### 14.3 KPI Severity Weight Map

```
critical → ×3
high     → ×2
medium   → ×1
low      → ×1
```

### 14.4 VALID/PARTIAL/MISSING Validation Gate

| Gate | Condition | Action |
|------|-----------|--------|
| VALID | All 9 fields present, status valid, severity nullable per rule | Included in report at full confidence |
| PARTIAL | Some fields missing but status parseable | Defaults filled, logged as low-confidence |
| MISSING | Core evidence unavailable | Excluded from report, counted in `not_evaluated_kpis` |

### 14.5 Invariant Rules

1. **Scanner must write at least one `scan_pages` row** for meaningful downstream processing
2. **NLP worker only processes rows** where HTML exists AND `nlp_results IS NULL`
3. **Aggregator completion does not require full NLP completion** — use `nlp_partiel=true` flag
4. **KPI endpoints are canonical in `new` mode only** — never reintroduce legacy branching
5. **Visual regression is optional** — disabled mode returns 503 semantics
6. **Never invert `Passed` semantics** — `true` = good/passing throughout the codebase
7. **Always clamp quality scores** to [0, 100]
8. **Passing KPIs must not display risk wording** in the frontend
9. **All scan lifecycle transitions** must go through: PENDING → RUNNING → NLP_PROCESSING → COMPLETE/FAILED

---

## 15. Test Suites — All Services

### 15.1 v3-aggregator Tests (8 files, ~60+ tests)

**Location**: `V3-Microservices/v3-aggregator/tests/`

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `test_kpi_migration_flags.py` | 6+ | KPI mode flags, headless concurrency clamping, endpoint routing |
| `test_kpi_centric_report.py` | 20+ | KPI builder: axis structure, normalization, scoring, evidence contracts |
| `test_recommendations_classifier.py` | 15+ | Classifier: severity ranking, effort scoring, roadmap bucketing |
| `test_recommendations_endpoint.py` | 5+ | Recommendations API endpoint response shape |
| `test_recommendations_real_scan_fixture.py` | 5+ | End-to-end with real scan fixture data |
| `test_form_fuzzer_kpi.py` | 5+ | Form fuzzer KPI normalization and scoring |
| `test_phase_mn.py` | 5+ | Phase M/N migration tests |

**Running**:
```bash
cd V3-Microservices/v3-aggregator
python -m pytest tests -q
# Expected: ~52 passed, 3 deselected, 22 subtests passed
```

**Test pattern**: Uses stubbed psycopg2 — no real DB required for unit tests:
```python
psycopg2_stub = ModuleType("psycopg2")
psycopg2_extras_stub = ModuleType("psycopg2.extras")
sys.modules.setdefault("psycopg2", psycopg2_stub)
```

### 15.2 v3-nlp-worker Tests (6 files, ~80+ tests)

**Location**: `V3-Microservices/v3-nlp-worker/tests/`

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `test_phase_o.py` | 36 | Page type classification, RGPD text analysis, content enrichment |
| `test_phase_l.py` | 36 | Date extraction (JSON-LD, meta, HTTP, French patterns), freshness |
| `test_schema_org_json_ld.py` | 10+ | JSON-LD + Schema.org parsing |
| `test_live_site_calibration.py` | 5+ | Live site calibration (requires network) |
| `live_site_calibration.py` | — | Calibration utilities (not a test file) |
| `browser_kpi_groundtruth_audit.py` | — | Ground truth audit utilities |

**Running**:
```bash
cd V3-Microservices/v3-nlp-worker
python -m pytest tests -q
# Expected: ~72 passed
```

**Test pattern**: Pure functions inlined with stdlib only — no psycopg2, textstat, NLTK, or bs4 required.

### 15.3 v3-scanner-go Tests (2 analyzer packages)

**Location**: `V3-Microservices/v3-scanner-go/`

| Package | Tests | What It Covers |
|---------|-------|----------------|
| `analyzers/formfuzzer/` | 5+ | Form extraction, fuzzing payloads, anomaly detection |
| `analyzers/performance/` | 3+ | Performance metrics computation, headless result parsing |

**Running**:
```bash
cd V3-Microservices/v3-scanner-go
go test ./...
# Expected: all pass
```

### 15.4 v3-visual-regression Tests (4 files)

**Location**: `V3-Microservices/v3-visual-regression/tests/`

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `test_image_comparator.py` | 10+ | SSIM computation, LPIPS, perceptual hashing |
| `test_zone_comparator.py` | 5+ | 5-zone weighted regression, fused scoring |
| `test_ux_kpis.py` | 5+ | Visual complexity, CTA prominence, first impression |
| `test_flags.py` | 3+ | Feature flags (VISUAL_REGRESSION_ENABLED, CHROME_NO_SANDBOX) |

### 15.5 v3-form-executor Tests (2 files)

**Location**: `V3-Microservices/v3-form-executor/tests/`

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `test_worker.py` | 5+ | Form execution worker, queue polling |
| `test_submission_oracle.py` | 5+ | Form submission oracle, success/failure detection |

### 15.6 Frontend Tests

**Location**: `Front-Snap/`

```bash
# Run unit tests
cd Front-Snap
npx vitest run

# Run form tester phase tests
node scripts/test-form-tester-phase1.mjs
node scripts/test-form-tester-phase2.mjs
```

---

## 16. Smoke Tests & End-to-End Validation

### 16.1 Kubernetes Smoke Test (`k8s/scripts/06-smoke-test.sh`)

```bash
#!/usr/bin/env bash
# Validates the full deployed stack

# 1. Check infra pods are running
kubectl get pods -n snapflow-infra

# 2. Check app pods are running
kubectl get pods -n snapflow-prod

# 3. Check HPAs and KEDA scaling
kubectl get hpa -n snapflow-prod
kubectl get scaledobjects -n snapflow-prod

# 4. Health-check browserless
kubectl exec -n snapflow-prod deploy/browserless -- curl -s http://localhost:3000/health

# 5. Health-check aggregator from within cluster
kubectl run curl-test --image=curlimages/curl:8.10.1 --restart=Never -n snapflow-prod --rm -i -- \
  curl -fsS http://v3-aggregator.snapflow-prod.svc.cluster.local/health

# 6. Port-forward test hint
echo "kubectl port-forward svc/v3-aggregator -n snapflow-prod 8080:80"
echo "curl -s http://127.0.0.1:8080/health"

# 7. End-to-end API test hint
echo "curl -s -X POST http://127.0.0.1:8080/scan -H 'content-type: application/json' -d '{\"url\":\"https://example.com\",\"max_pages\":20,\"headless_concurrency\":2}'"
```

### 16.2 Docker Compose Smoke Test

```bash
# After docker compose up -d:

# 1. All services healthy?
docker compose ps

# 2. Aggregator health
curl -s http://localhost:8080/health | jq

# 3. Scanner health
curl -s http://localhost:8081/health | jq

# 4. Browser pool health
curl -s http://localhost:8084/health | jq

# 5. Visual regression health
curl -s http://localhost:8083/health | jq

# 6. Quick end-to-end (sync — blocks until done)
curl -s -X POST http://localhost:8080/scan/sync \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","max_pages":5,"headless_concurrency":2}' | jq '.top_level_kpis.health_status'

# 7. Async end-to-end
SCAN_ID=$(curl -s -X POST http://localhost:8080/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://httpbin.org","max_pages":5}' | jq -r '.scan_id')

# Poll until complete
for i in {1..60}; do
  STATUS=$(curl -s http://localhost:8080/scan/$SCAN_ID/status | jq -r '.status')
  echo "Status: $STATUS"
  if [ "$STATUS" = "complete" ] || [ "$STATUS" = "failed" ]; then break; fi
  sleep 3
done

# Get results
curl -s http://localhost:8080/scan/$SCAN_ID/kpis/top | jq
```

### 16.3 Frontend Smoke Test

```bash
# 1. Build check
cd Front-Snap
npm run build

# 2. Local Supabase
./scripts/local-supabase-preprod.sh

# 3. Dev server
npm run dev
# → Open http://localhost:5173
# → Log in with seeded admin credentials
# → Create project, generate audit, view report
```

### 16.4 Azure Smoke Test

```bash
cd V3-Microservices
./azure-smoke-test.sh
```

---

## 17. Commands & Scripts Quick Reference

### 17.1 Full Stack Lifecycle

```bash
# ─── Docker Compose (Local Development) ───

cd V3-Microservices

# Start everything
./run.sh

# Start with Obscura disabled (Chromium only)
./run.sh --no-obscura

# Tear down + rebuild + start
./run.sh --down --no-cache

# Start with local Supabase
./run.sh --local

# Force rebuild base images + services
./run.sh --rebuild-base --no-cache

# Stop everything
docker compose down

# Follow logs
docker compose logs -f aggregator
docker compose logs -f scanner
docker compose logs -f nlp-worker

# ─── Individual Service Cmds ───

# Aggregator
cd v3-aggregator && python main.py
cd v3-aggregator && python -m pytest tests -q

# Scanner
cd v3-scanner-go && go run .
cd v3-scanner-go && go test ./...

# NLP Worker
cd v3-nlp-worker && python main.py
cd v3-nlp-worker && python -m pytest tests -q

# Browser Pool
cd v3-browser-pool && python main.py
curl -s http://localhost:8084/health | jq

# Visual Regression
cd v3-visual-regression && python main.py
cd v3-visual-regression && python -m pytest tests/ -v

# ─── Frontend ───

cd Front-Snap
npm install
npm run dev
npm run build
./scripts/local-supabase-preprod.sh
node scripts/seed-local-admin.mjs

# ─── k3s Deployment ───

cd k8s/scripts
./00-first-deploy.sh --check-only    # Validate
./00-first-deploy.sh --execute       # Deploy
./06-smoke-test.sh                   # Validate deployment
kubectl get pods -n snapflow-prod    # Check running pods
```

### 17.2 Database

```bash
# Connect to PostgreSQL
docker exec -it v3-microservices-db-1 psql -U snapflow -d snapflow_v3

# Useful queries:
SELECT scan_id, status FROM scan_state ORDER BY updated_at DESC LIMIT 5;
SELECT scan_id, COUNT(*) FROM scan_pages GROUP BY scan_id ORDER BY COUNT(*) DESC;
SELECT scan_id, COUNT(*) FROM scan_pages WHERE nlp_results IS NULL GROUP BY scan_id;
SELECT scan_id, kpi_json->'top_level_kpis'->>'health_status' FROM scan_kpi_outputs ORDER BY updated_at DESC LIMIT 5;
```

### 17.3 Docker Maintenance

```bash
# Check disk usage
docker system df

# Clean BuildKit cache
docker builder prune -a -f

# Clean unused images (safe)
docker image prune -a -f

# Full deep clean (use cautiously)
docker builder prune -a -f
docker buildx prune -a -f
docker system prune -f
```

---

## Appendix: File Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| `v3-aggregator/main.py` | ~3600 | API gateway, orchestration, KPI building |
| `v3-aggregator/kpi_builder.py` | ~2000 | KPI-centric report builder |
| `v3-aggregator/classifier.py` | ~1500 | Recommendation engine + roadmap |
| `v3-nlp-worker/main.py` | ~3000 | NLP pipeline (all in one file) |
| `v3-scanner-go/main.go` | ~2500 | 10-phase crawl pipeline |
| `v3-scanner-go/db/db.go` | ~200 | PostgreSQL operations |
| `v3-scanner-go/analyzers/*/` | ~500 each | Per-analyzer detection logic |
| `v3-visual-regression/main.py` | ~600 | Visual regression API |
| `v3-browser-pool/main.py` | ~200 | Browser pool API |
| `v3-browser-pool/pool.py` | ~400 | Playwright pool management |
| `Front-Snap/src/pages/AuditReport.tsx` | ~500 | 6-tab audit viewer |
| `Front-Snap/src/lib/auditMapper.ts` | ~700 | API → display normalization |
| `k8s/scripts/` | ~50-100 each | Deployment scripts |

---

*End of Analysis — SnapFlow V3 Complete Reference*
