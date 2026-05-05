# SnapFlow — Complete Project Bible (AGENTS.md)

> Generated: 2026-05-04  
> Codebase: `SnapFlow/` (Front-Snap + V3-Microservices + k8s)  
> Purpose: Exhaustive reference for AI coding sessions. Every path, function, and contract is real.

---

## 1. PROJECT IDENTITY

### What SnapFlow Does
SnapFlow is a **website audit & digital compliance SaaS platform**. It crawls client websites, analyzes them across 9 audit axes (technical, security, performance, SEO, UX, content, GDPR, functional, eco-index), and produces French-language audit reports with actionable recommendations, roadmap, and Redmine ticket integration.

### Business Purpose
SnapFlow helps digital agencies and compliance officers audit client websites for:
- **Technical health**: broken links, SSL, CMS versions, exposed services
- **Security**: HTTP headers, cookie flags, SQLi/DDoS signals, JS dependency CVEs
- **SEO**: meta tags, heading hierarchy, sitemaps, duplicate content, AI readiness (llms.txt)
- **Performance**: Core Web Vitals (LCP, FCP, CLS), image optimization, caching
- **UX**: social sharing, navigation, mobile-friendliness, visual regression
- **Content quality**: readability, keyword stuffing, freshness, lexical diversity
- **GDPR/RGPD compliance**: cookie consent, privacy policy, data retention, user rights
- **Functional**: forms, search, contact, login, cart/checkout detection
- **Visual regression**: SSIM + zone-based perceptual diffing between baseline and current

### Target Users
- **Internal team** (admins, charge_de_projet roles) — generating/managing audits
- **External clients** (view audit reports, receive PDF exports)
- French-speaking market primarily (all reports in French; NLP supports FR/EN/AR)

### Current Development Phase
**Phase 5 of migration plan** — canonical KPI API mode is `new` only:
- Legacy KPI branching removed from scanner, NLP worker, and aggregator runtime paths
- Quality/drift monitoring artifacts implemented and persisted
- Daily drift report and root-cause categorization still pending (Phase 5 remaining tasks)
- Post-cutover stabilization window (Phase 7) and legacy cleanup (Phase 8) partially done

### What "Done" Looks Like for V3
- All 9 audit axes producing reliable, validated KPIs
- Quality/drift monitoring with ≥95% coverage, stable/improving score trend
- KPI data contract enforced (VALID/PARTIAL/MISSING gate) before aggregation
- No unexplained spikes in critical failing KPI counts
- Daily drift report generated and reviewable
- All legacy feature flags and dead code paths removed

---

## 2. FULL TECH STACK

### Languages & Runtimes

| Language | Version | Used In |
|----------|---------|---------|
| Go | 1.25.6 | `v3-scanner-go`, `v3-cli` |
| Python | 3.11 | `v3-aggregator`, `v3-nlp-worker`, `v3-visual-regression`, `v3-browser-pool` |
| TypeScript | ~5.x | `Front-Snap/` (React SPA) |
| Shell | Bash + PowerShell | Build/deploy scripts, k8s deployment scripts |

### Go Dependencies (`V3-Microservices/v3-scanner-go/go.mod`)

| Module | Version | Purpose |
|--------|---------|---------|
| `github.com/gocolly/colly/v2` | v2.3.0 | Web crawling framework |
| `github.com/go-rod/rod` | v0.116.2 | Chromium browser automation |
| `github.com/PuerkitoBio/goquery` | v1.11.0 | jQuery-style HTML parsing |
| `github.com/lib/pq` | v1.11.2 | PostgreSQL driver |
| `github.com/antchfx/htmlquery` | v1.3.5 | XPath HTML queries |
| `rsc.io/pdf` | v0.1.1 | PDF parsing (privacy analyzer) |
| `github.com/spf13/cobra` | (v3-cli) | CLI framework |
| `github.com/charmbracelet/bubbletea` | (v3-cli) | TUI framework |

### Python Dependencies (per service)

**v3-aggregator** (`requirements.txt`):
- `fastapi==0.115.0`, `uvicorn[standard]==0.30.1`
- `psycopg2-binary==2.9.9`, `pydantic==2.7.1`, `requests==2.32.3`

**v3-nlp-worker** (`requirements.txt`):
- `fastapi==0.111.0`, `uvicorn[standard]==0.30.1`
- `psycopg2-binary==2.9.9`, `beautifulsoup4==4.12.3`
- `nltk==3.9.1`, `textstat==0.7.4`, `spacy`, `language-tool-python`, `json5`

**v3-visual-regression** (`requirements.txt`):
- `fastapi`, `uvicorn`, `psycopg2-binary`
- `Pillow`, `scikit-image`, `opencv-python`, `torch`, `lpips`

**v3-browser-pool** (`requirements.txt`):
- `fastapi`, `uvicorn`, `playwright`

### Infrastructure

| Component | Spec / Config |
|-----------|--------------|
| **OVH VPS** | 12 vCores, 48 GB RAM |
| **k3s** | v1.32.13+k3s1, single-node, no Traefik |
| **PostgreSQL** | 16-alpine, 50Gi PVC, Prometheus exporter |
| **PgBouncer** | Transaction mode, max 200 connections |
| **Redis** | 7.2, 10Gi PVC, 512MB max memory |
| **KEDA** | Event-driven autoscaling (CPU-based triggers) |
| **cert-manager** | Let's Encrypt TLS |
| **Ingress** | ingress-nginx (LoadBalancer) |
| **Monitoring** | Prometheus + Grafana stack |
| **Deployment scripts** | Bash (`*.sh`) + PowerShell (`*.ps1`) |

### External Services
- **Supabase** (cloud): Auth, user_roles table, real-time notifications, projects/audits CRUD
- **Redmine API**: Project/issue integration for ticket creation from findings
- **Pinggy.io**: Tunnel service for exposing local aggregator during dev/deploy

### CI/CD
- No formal CI/CD pipeline visible. Deployment is manual via k3s scripts in `k8s/scripts/`
- Image build: `BUILD_V3_BASE_IMAGES.sh` / `.ps1` + `docker compose build`
- Deploy: `k8s/scripts/04-apply-manifests.sh`

---

## 3. SYSTEM ARCHITECTURE

### Microservices Overview

| Service | Language | Port | Responsibility |
|---------|----------|------|----------------|
| **v3-aggregator** | Python (FastAPI) | 8080 | API gateway, scan orchestration, KPI building, quality/drift |
| **v3-scanner-go** | Go (net/http) | 8081 | Web crawling, page analysis, headless rendering coordination |
| **v3-nlp-worker** | Python (polling) | — | Async NLP enrichment (readability, keywords, RGPD, SEO) |
| **v3-visual-regression** | Python (FastAPI) | 8083 | Screenshot capture, SSIM+zone visual diff, UX KPIs |
| **v3-browser-pool** | Python (FastAPI) | 8084 | Shared Playwright Chromium pool (15 concurrent) |
| **v3-cli** | Go (Cobra) | — | Dev CLI: build, deploy, scan, monitor |

### Communication Patterns

```
Frontend / API Client
    │ POST /scan
    ▼
┌────────────────────────────────────────────────────────────┐
│  v3-aggregator (:8080)                                     │
│  • Orchestrates scan lifecycle                             │
│  • Calls scanner, polls NLP progress                       │
│  • Calls visual regression for VRT KPIs                   │
│  • Builds KPI reports (kpi_builder.py)                     │
│  • Generates recommendations (classifier.py)               │
│  • Computes quality/drift artifacts                        │
└─────┬──────────────────────┬────────────────────┬──────────┘
      │ POST /scan            │                   │
      ▼                       ▼                   ▼
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ v3-scanner-go│   │ v3-nlp-worker    │   │ v3-visual-       │
│    (:8081)   │   │ (no port, polls) │   │ regression(:8083)│
│ • Crawl      │   │ • Read nlp_results│  │ • /screenshot    │
│ • Static     │   │   IS NULL        │   │ • /compare       │
│ • Headless   │   │ • Per-row commit │   │ • /ux-kpis       │
│ • Forms      │   │ • FOR UPDATE SKIP│   │ • /browser-compat│
└──────┬───────┘   └──────┬───────────┘   └────────┬─────────┘
       │                  │                         │
       │          ┌───────┴──────────┐              │
       │          │  Shared DB       │              │
       └─────────►│  PostgreSQL 16   │◄─────────────┘
                  │  snapflow_v3     │
                  └──────────────────┘
```

### Service Ownership (No Overlap)

| Data | Owner | Reads | Writes |
|------|-------|-------|--------|
| `scan_pages` rows (crawl + static metrics) | Scanner | Scanner, NLP (for HTML), Aggregator (for report) | Scanner |
| `scan_pages.metrics` (JSONB) | Scanner | Aggregator | Scanner |
| `scan_pages.nlp_results` (JSONB) | NLP Worker | Aggregator | NLP Worker |
| `scan_summaries` domain KPIs | Scanner | Aggregator | Scanner |
| `form_fuzz_results` | Scanner | Aggregator | Scanner |
| `scan_kpi_outputs` (canonical KPI) | Aggregator | Aggregator, Frontend (via API) | Aggregator |
| `scan_state` | Aggregator | Aggregator | Aggregator |
| `visual_screenshots` | Visual Regression | Visual Regression | Visual Regression |

### Scan Lifecycle State Machine

```
┌─────────┐    POST /scan     ┌─────────┐    scanner     ┌─────────┐
│ PENDING │ ────────────────► │ RUNNING │ ───► returns ──► │ NLP_    │
│         │                  │         │                  │ PROCE-  │
└─────────┘                  └─────────┘                  │ SSING   │
                                                          └────┬────┘
                               ┌───────────────────────────────┤
                               │                               │
                          ┌────▼────┐                   ┌──────▼──────┐
                          │ COMPLETE│ ◄──────────────── │ NLP done or │
                          │         │                   │ timeout     │
                          └─────────┘                   │ (nlp_partiel│
                                                        │  =true)     │
                                                        └─────────────┘
                          ┌─────────┐
                          │ FAILED  │ (scanner unreachable, DB error)
                          └─────────┘
```

Valid transitions: `PENDING → RUNNING → NLP_PROCESSING → COMPLETE | FAILED`

### Data Ownership Boundary
- **Supabase** (cloud DB): Frontend auth, user management, projects CRUD, audit metadata, notifications, schedules, Redmine cache
- **VPS PostgreSQL** (k3s, `snapflow_v3`): All scan data — `scan_pages`, `scan_summaries`, `form_fuzz_results`, `scan_kpi_outputs`, `scan_state`, `visual_screenshots`

### Redis Usage
- Redis is deployed in k8s infra (10Gi, 512MB max) but not actively wired into the current microservice data flow. It exists in the k8s manifest but no service reads/writes it at runtime.

### KEDA Autoscaling
- **Scanner**: KEDA ScaledObject — CPU trigger at 75% utilization, HPA 1→5 replicas
- **NLP Worker**: 1→4 replicas (polling-based, no CPU trigger visible)
- **Aggregator**: HPA 1→3 replicas at 70% CPU
- **Visual Regression**: 1→3 replicas
- All use 15-30s poll intervals

### Frontend-to-Backend Flow
1. User logs into React SPA → Supabase Auth
2. Frontend calls `POST /scan` on aggregator (via HTTP to k3s ingress)
3. Aggregator orchestrates microservices
4. Frontend polls `GET /scan/{id}/status` every few seconds
5. On complete, frontend fetches `GET /scan/{id}/kpis/top` for dashboard, `GET /scan/{id}/kpis` for full report
6. Supabase edge function `fetch-audit-api` bridges the call when frontend needs to go through Supabase

---

## 4. DIRECTORY STRUCTURE

### `SnapFlow/` (Root)

| Path | Contains |
|------|----------|
| `AGENTS.md` | This file |
| `CODEBASE_ANALYSIS.md` | Previous comprehensive analysis |
| `ULTRAREVIEW.md` | Code audit framework (6-pass review) |
| `plan.md` | V3 KPI migration plan (8 phases) |
| `PFE_Internship_Report_SnapFlow.md` | Internship report |
| `MICROSERVICES_DEEP_DIVE.md` | Architecture deep-dive (this is the canonical doc) |
| `BUILD_BASE_IMAGE.sh` | Base Docker image build script (Bash) |
| `BUILD_BASE_IMAGE.ps1` | Base Docker image build script (PowerShell) |
| `raw_ec_response.json` | Fixture file for EC response |
| `scan_d0a8fa632c29-result.json` | Sample scan result fixture |
| `Front-Snap/` | React frontend SPA |
| `V3-Microservices/` | All backend microservices + Docker + DB |
| `k8s/` | Kubernetes deployment manifests |
| `pytest-cache-files-*/` | Pytest cache dirs (can be ignored) |

### `Front-Snap/` (React Frontend)

| Path | Purpose |
|------|---------|
| `src/main.tsx` | Entry point |
| `src/App.tsx` | Route definitions (React Router), query client, auth wrapper |
| `src/index.css` | Tailwind directives + custom CSS |
| `src/pages/Auth.tsx` | Login/signup (Supabase auth) |
| `src/pages/Overview.tsx` | Dashboard stats |
| `src/pages/AdminProjects.tsx` | Project CRUD |
| `src/pages/AdminUsers.tsx` | User management |
| `src/pages/ProjectDetail.tsx` | Project detail + generate audit |
| `src/pages/AuditReport.tsx` | **Core audit viewer** — 6 tabs |
| `src/pages/ReportsPage.tsx` | Completed audits list |
| `src/pages/ActivityReport.tsx` | Redmine issues dashboard |
| `src/pages/ReportSchedules.tsx` | Cron job scheduling |
| `src/pages/FormTesterPage.tsx` | Form test workflow |
| `src/pages/AssistantPage.tsx` | AI chat assistant |
| `src/pages/NotificationsPage.tsx` | Notifications center |
| `src/lib/auditMapper.ts` | **Critical**: Normalizes API → audit display format |
| `src/lib/normalizeAuditReport.ts` | Validates/normalizes report data |
| `src/lib/generateAuditPdf.tsx` | PDF generation via @react-pdf/renderer |
| `src/services/auditService.ts` | Generate, poll, complete audits |
| `src/services/authService.ts` | User CRUD |
| `src/services/redmineService.ts` | Redmine API integration |
| `src/hooks/useAuth.tsx` | Auth context provider |
| `src/hooks/useAsyncAuditPoll.ts` | Polls audit job every 15s |
| `src/hooks/useRealtimeNotifications.ts` | Supabase real-time listener |
| `src/components/audit/TabResume.tsx` | Executive summary tab |
| `src/components/audit/TabDetails.tsx` | All findings by axis (with edit mode) |
| `src/components/audit/TabSommaire.tsx` | Axis overview (list/cards) |
| `src/components/audit/TabTableau.tsx` | Data table view |
| `src/components/audit/TabSimulateur.tsx` | AI improvement simulation |
| `src/components/audit/TabTickets.tsx` | Redmine ticket creation |
| `src/components/audit/KpiCard.tsx` | Individual finding card |
| `src/components/pdf/AuditDocument.tsx` | React-PDF document (11 pages) |
| `src/components/pdf/theme.ts` | 4 PDF themes (Slate, Mineral, Sand, Steel) |
| `src/integrations/supabase/client.ts` | Supabase client init |
| `src/integrations/supabase/types.ts` | Generated DB types |
| `supabase/migrations/` | SQL migrations (7 files) |
| `supabase/config.toml` | Supabase project config |

### `V3-Microservices/`

| Path | Contains |
|------|----------|
| `docker-compose.yml` | Full stack orchestration (6 services) |
| `run.sh` / `run.ps1` | Stack launcher (build → up) |
| `db/init.sql` | PostgreSQL schema bootstrap |
| `docker/python-base/Dockerfile.fastapi` | Base image: `snapflow/v3-python-fastapi-base` |
| `docker/python-base/Dockerfile.heavy` | Base image: `snapflow/v3-python-heavy-base` |
| `v3-aggregator/main.py` | FastAPI app (~3600 lines) — all endpoints |
| `v3-aggregator/kpi_builder.py` | KPI-centric report builder (~2000 lines) |
| `v3-aggregator/classifier.py` | Recommendation engine (~1500 lines) |
| `v3-aggregator/tests/` | 8 test files |
| `v3-scanner-go/main.go` | Go HTTP server + crawl orchestrator |
| `v3-scanner-go/db/db.go` | PostgreSQL operations |
| `v3-scanner-go/analyzers/seo/seo.go` | SEO analysis |
| `v3-scanner-go/analyzers/security/security.go` | Security analysis |
| `v3-scanner-go/analyzers/tech/tech.go` | Tech stack detection |
| `v3-scanner-go/analyzers/performance/performance.go` | Headless browser + Core Web Vitals |
| `v3-scanner-go/analyzers/privacy/privacy.go` | RGPD/privacy analysis |
| `v3-scanner-go/analyzers/ux/ux.go` | UX analysis |
| `v3-scanner-go/analyzers/functional/functional.go` | Functional analysis |
| `v3-scanner-go/analyzers/formbrowser/formbrowser.go` | Form discovery via browser |
| `v3-scanner-go/analyzers/formfuzzer/formfuzzer.go` | Form fuzzing engine |
| `v3-scanner-go/analyzers/browserutil/browserutil.go` | Shared browser utilities |
| `v3-scanner-go/browserpool/client.go` | Browser pool HTTP client |
| `v3-scanner-go/Dockerfile` | Multi-stage Go build → Alpine |
| `v3-nlp-worker/main.py` | NLP pipeline (~3000 lines) |
| `v3-nlp-worker/tests/` | 4 test files |
| `v3-visual-regression/main.py` | Visual regression API |
| `v3-visual-regression/services/image_comparator.py` | SSIM + LPIPS comparison |
| `v3-visual-regression/services/zone_comparator.py` | 5-zone weighted regression |
| `v3-visual-regression/services/ux_kpis.py` | Visual complexity, CTA, first impression |
| `v3-browser-pool/main.py` | Browser pool API |
| `v3-browser-pool/pool.py` | Playwright pool management |
| `v3-cli/` | Go CLI (Cobra + Bubbletea) |
| `BUILD_V3_BASE_IMAGES.sh` | PowerShell base image builder |
| `BUILD_V3_BASE_IMAGES.ps1` | Bash base image builder |
| `azure-deploy.sh` | Azure deployment script |
| `azure-env.sh` | Azure environment config |
| `azure-smoke-test.sh` | Azure smoke test |
| `test_form_on_site.py` | Form testing utility |

### `k8s/`

| Path | Contains |
|------|----------|
| `scripts/00-first-deploy.sh` | Deploy orchestrator |
| `scripts/01-bootstrap-node.sh` | System prep |
| `scripts/02-install-k3s-server.sh` | k3s install |
| `scripts/03-install-operators.sh` | Helm: ingress-nginx, cert-manager, KEDA, Prometheus |
| `scripts/04-apply-manifests.sh` | Apply all YAMLs in order |
| `scripts/05-run-migrations.sh` | DB init via PgBouncer |
| `scripts/06-smoke-test.sh` | Validation |
| `scripts/07-build-and-import-images.sh` | Build + import to k3s |
| `00-bootstrap/namespaces.yaml` | snapflow-infra + snapflow-prod namespaces |
| `01-infra/postgres/` | StatefulSet, Service, Prometheus exporter |
| `01-infra/pgbouncer/` | Deployment, ConfigMap, Service |
| `01-infra/redis/` | Deployment, PVC, Service |
| `02-services/aggregator/` | Deployment + Service |
| `02-services/scanner/` | Deployment + Service |
| `02-services/nlp-worker/` | Deployment + Service |
| `02-services/visual-regression/` | Deployment + Service |
| `02-services/browserless/` | Deployment + Service (external image) |
| `02-services/frontend/` | Deployment + Service |
| `03-autoscaling/` | HPAs + KEDA ScaledObjects |
| `04-networking/` | Ingress, ClusterIssuer, NetworkPolicies |
| `05-resilience/` | PodDisruptionBudgets |
| `06-monitoring/` | ServiceMonitors + PrometheusRules |
| `07-secrets/` | Placeholder for snapflow-secrets.yaml |

---

## 5. KPI SYSTEM (CRITICAL — DO NOT BREAK)

### The 9 Audit Axes

| # | Axis Slug | French Name | Description |
|---|-----------|-------------|-------------|
| 1 | `TECHNIQUE` | Audit Technique | CMS version, modules, server, language, CVE |
| 2 | `SECURITY` | Sécurité | SSL, HTTP headers, cookies, SQLi, admin exposure, JS CVEs |
| 3 | `FONCTIONNEL` | Audit Fonctionnel | Forms, links, buttons, search, features |
| 4 | `PERFORMANCE` | Performance | Core Web Vitals, mobile speed, images, cache, console errors |
| 5 | `SEO` | SEO | Alt tags, meta, sitemap, robots, dup content, headings, AI readiness |
| 6 | `UX_UI` | UX/UI | Audience targeting, social sharing, ergonomics, nav, mobile-friendly |
| 7 | `CONTENU` | Contenu | Freshness, thin content, key pages, cannibalization, CTAs, diversity |
| 8 | `RGPD` | RGPD/Conformité | Cookie consent, privacy policy, data retention, user rights |
| 9 | `ECO_INDEX` | Eco-Index | Ecological impact score |

### All KPIs by Axis (With Exact Slugs)

**TECHNIQUE** (5 KPIs):
- `tech_cms_version` — CMS/Framework Version
- `tech_modules_versions` — Installed Modules Versions
- `tech_server_version` — Server/Language Version
- `tech_programming_language` — Programming Language
- `tech_cve_check` — Code Verification (CVE Check)

**SECURITY** (12 KPIs):
- `sec_ssl` — SSL Certificate Validity
- `sec_http_headers` — HTTP Security Headers
- `sec_session_cookies` — Session Cookie Management
- `sec_sqli_ddos` — SQL Injection/DDoS Signals
- `sec_admin_exposed` — Exposed Admin Pages
- `sec_sensitive_files` — Exposed Sensitive Files
- `sec_robots_disclosure` — robots.txt Info Disclosure
- `sec_error_pages` — Custom Error Pages
- `sec_brute_force` — Brute Force Protection
- `sec_file_upload` — File Upload Control
- `sec_js_deps` — Vulnerable JS Dependencies (CVE)
- `sec_service_exposure` — Network Service Exposure

**FONCTIONNEL** (5 KPIs):
- `func_forms` — Form Functionality
- `func_links` — Link Functionality
- `func_buttons` — Button Functionality
- `func_features` — General Features
- `func_search` — Internal Search Engine

**PERFORMANCE** (7 KPIs):
- `perf_desktop_speed` — Desktop Load Time (LCP, FCP, CLS)
- `perf_mobile_speed` — Mobile Load Time
- `perf_image_optim` — Image Optimization
- `perf_cache` — Cache Management
- `perf_compression` — HTTP Compression
- `perf_console_errors` — JavaScript Console Errors
- `eco_index_score` — Ecological Impact Score

**SEO** (13 KPIs):
- `seo_alt_tags` — Image ALT Tags
- `seo_meta_tags` — META Tags (Title, Description)
- `seo_sitemap` — XML Sitemap
- `seo_robots_txt` — robots.txt File
- `seo_duplication` — Duplicate Content Rate
- `seo_multi_browser` — Multi-Browser Compatibility
- `seo_url_structure` — URL Structure Cleanliness
- `seo_heading_structure` — H1-H6 Hierarchy
- `seo_internal_linking` — Internal Link Quality
- `seo_external_linking` — External Link Coverage
- `seo_h1_quality` — H1 Quality (NLP)
- `seo_meta_nlp` — Meta Description Quality (NLP)
- `seo_ai_readiness` — AI Readiness (llms.txt)

**UX_UI** (5 KPIs):
- `ux_audience_targeting` — Content Targeting
- `ux_social_sharing` — Social Sharing Tags
- `ux_design_ergonomics` — Design & Ergonomics
- `ux_navigation` — Navigation Structure
- `ux_mobile_friendly` — Mobile-Friendly

**CONTENU** (7 KPIs):
- `content_freshness` — Content Freshness
- `content_thin` — Thin Content Detection
- `content_key_pages` — Key Pages Identification
- `content_cannibalization` — Keyword Cannibalization
- `content_missing_cta` — Missing CTAs
- `content_broken_structure` — Broken Content Structure
- `content_lexical_diversity` — Lexical Diversity

**RGPD** (9 KPIs):
- `rgpd_cookie_consent` — Cookie Consent Banner
- `rgpd_privacy_policy` — Privacy Policy
- `rgpd_data_retention` — Data Retention Duration
- `rgpd_minimization` — Data Minimization
- `rgpd_legal_notice` — Legal Notice
- `rgpd_user_rights` — Data Subject Rights
- `rgpd_declared_purpose` — Declared Processing Purpose
- `rgpd_rights_coverage` — GDPR Rights Coverage
- `rgpd_pre_consent_trackers` — Pre-Consent Trackers

**ECO_INDEX** (1 KPI):
- `eco_index_score` — Ecological Impact Score

### JSON Schema Contract (Every KPI Must Have These 9 Fields)

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

### VALID/PARTIAL/MISSING Validation Gate

Runs in `kpi_builder.py` function `_normalize_kpi_object(coalesced, kpi_id, ...)`:

- **VALID**: All 9 required fields present, status ∈ {passing, failing, warning, not_available}, severity nullable per rule
- **PARTIAL**: Some fields missing but status is parseable → default values filled in, logged as low-confidence
- **MISSING**: Core evidence not available → KPI excluded from report, counted in `not_evaluated_kpis`

### Field Normalizer (`_normalize_kpi_object` in `kpi_builder.py`)

Normalizes:
- `status`: coerces any value to `{passing, failing, warning, not_available}` (legacy values like `not_applicable`, `partial` → `not_available`)
- `severity`: `critical=3, high=2, medium=1, low=1` weight map applied during scoring
- `pages_affected`: ensures int, defaults to 0
- `pages_affected_urls`: ensures list, deduplicates
- `constat`: French string, generated by `_generate_constat()` family of functions

### Severity Weights

Applied in scoring engine within `kpi_builder.py`:
- `critical` × 3
- `major` / `high` × 2
- `minor` / `medium` / `low` × 1

### Scoring Engine

Quality score formula (in `_build_kpi_quality_drift_artifact`):

$$Q = 100 - failure\_rate - 0.4 \cdot warning\_rate - 0.3 \cdot (100 - coverage) - 0.5 \cdot critical\_rate$$

Clamped to [0, 100].

**Status thresholds**:
- `good`: score ≥ 80
- `watch`: score 60–79
- `at_risk`: score < 60

### Locked Aggregator Output Format

The canonical KPI payload (persisted to `scan_kpi_outputs.kpi_json`) has this shape:

```json
{
  "kpi_mode": "new",
  "scan_id": "scan_xxx",
  "domain": "example.com",
  "axes": {
    "SECURITY": { "score": 75, "label": "Sécurité", "icon": "🔒",
      "findings": [ { ...9-field KPI... }, ... ],
      "passing_kpis": [ { ...9-field KPI... } ]
    },
    ...
  },
  "domain_analysis": { ... },
  "site_metrics": { ... },
  "summary": { "total_kpis": 200, "passed_kpis": 180, ... },
  "top_level_kpis": { "health_status": "passing|warning|failing", ... },
  "quality_drift_artifact": { ... },
  "generated_at": "ISO8601"
}
```

### Evidence Contract

Each KPI's `data` field must contain evidence-specific keys depending on KPI type:
- **Concrete evidence** (`_KPI_META[1] = "concrete"`): `raw_value`, `url`, `screenshot_url`
- **Aggregate evidence** (`_KPI_META[1] = "aggregate"`): `summary`, `page_count`, `percentage`
- **NLP evidence**: `keyword`, `readability_score`, `page_type`
- Evidence quality is tracked in `_KPI_META` as `_KPI_META[kpi_name] = (kpi_id, confidence, evidence_quality)`

---

## 6. MICROSERVICE DETAILS

### 6.1 v3-scanner-go

**Location**: `V3-Microservices/v3-scanner-go/`
**Entry point**: `main.go` — `func main()` starts HTTP server on `PORT` (default 8081)
**Input**: `POST /scan` with `ScanRequestPayload {ScanID, URL, Domains, MaxPages, HeadlessConcurrency}`
**Output**: Writes to DB — `scan_pages` rows with metrics, `scan_summaries` domain KPIs, `form_fuzz_results`

**Pipeline (10 phases in order)**:
1. Pre-fetch: SSL check, sitemap/robots probe, homepage fetch
2. Domain analyzers: tech → security + privacy + functional (parallel)
3. Colly crawl: async collector with `SCANNER_PARALLELISM` (default 150)
4. DB sync: wait for async insert workers
5. Cloudflare fallback: if 0 pages, seed from prefetch HTML
6. Form discovery + fuzzing: `formfuzzer.Run()`, `formbrowser.AnalyzeWithBrowser()`
7. Headless sampling: hybrid strategy (homepage + worst-SEO + stride fill)
8. Cloudflare backfill: replace synthetic data with rendered analysis
9. Mobile tests: up to 3 URLs via `performance.RunHeadlessPool`
10. Final aggregation: compute SEO/UX summaries, persist telemetry

**Key struct**: `FinalReport` — contains all domain-level results, SEO/UX summaries, broken links, headless results, form fuzzer summary, scan telemetry

**Known fixed bugs**:
- 403 false positives: Cloudflare/anti-bot pages now detected via `isCloudflareChallenge()`, fallback to headless
- Inverted KPI statuses: Fixed by normalizing `Passed` boolean semantics across all analyzers
- PDF parsing crash: `rsc.io/pdf` errors wrapped in try-catch in privacy analyzer

**Known limitations**:
- High `SCANNER_PARALLELISM` increases anti-bot triggering
- Headless phase is slowest section
- Very protected targets yield limited crawl breadth

**Deployment**: Docker multi-stage build → Alpine 3.19, k3s deployment with HPA 1→5

### 6.2 v3-nlp-worker

**Location**: `V3-Microservices/v3-nlp-worker/main.py`
**Entry point**: `main()` — infinite polling loop
**Input**: Reads `scan_pages` WHERE `nlp_results IS NULL`
**Output**: Writes `nlp_results` JSONB per page

**Pipeline per page**:
1. Extract text: `extract_text_main_content_first()` (progressive fallback)
2. Analyze content: `analyze_content()` → readability, keywords, typo density
3. Classify page: `classify_page_type()`, `classify_audience_segment()`
4. Extract dates: `extract_dates_and_classify()` (JSON-LD → meta → HTTP headers)
5. Analyze RGPD: `analyze_rgpd_text()` (strong signal check)
6. Build SEO KPIs: `check_h1_quality()`, `check_heading_hierarchy()`, `check_title_quality()`, etc.
7. Build content KPIs: `compute_keyword_prominence()`, `compute_stuffing_index_v2()`, `compute_lsi_score()`, etc.
8. Build RGPD KPIs: `compute_rights_coverage()`, `check_dpo_contact()`, `audit_third_party_scripts()`, `check_pre_consent_tracking()`
9. Persist to DB (per-row commit)

**Known fixed bugs**:
- French stopword ordering: NLTK stopwords now combined with English + Arabic (set union)
- RGPD slug-only matching: Fixed by adding content-based strong signal detection (`_has_strong_rgpd_signal`)
- SPA shell false negatives: Explicit `status=not_evaluated` with reason `spa_shell_not_hydrated`

**Known limitations**:
- spaCy and language-tool-python are optional — gracefully degrade if missing
- Heavy pages increase cycle duration
- `POLL_INTERVAL` default 3s

**Deployment**: Python Docker, no exposed port, 1→4 k3s replicas

### 6.3 v3-aggregator

**Location**: `V3-Microservices/v3-aggregator/`
**Entry points**: `main.py` — FastAPI `app` on port 8080
**Key modules**: `kpi_builder.py` (~2000 lines), `classifier.py` (~1500 lines)

**Endpoints** (10 total):
- `GET /health`
- `POST /scan` — async, returns scan_id
- `POST /scan/sync` — blocking, returns full report
- `GET /scan/{scan_id}/status`
- `GET /scan/{scan_id}/result`
- `GET /scan/{scan_id}/recommendations`
- `GET /scan/{scan_id}/kpis` (canonical mode `new`)
- `GET /scan/{scan_id}/kpis/top`
- `GET /scan/{scan_id}/kpis/quality`
- `GET /scan/{scan_id}/kpi` (alias for `/kpis`)

**Key functions**:
- `run_scanner(scan_id, url, ...)` — calls scanner with fallback routing
- `build_report(scan_id)` — assembles final report from DB
- `build_kpi_centric_report(report)` — transforms raw report → KPI axes
- `_build_normalized_kpis(report, context)` — enforces 9-field schema per KPI
- `_build_top_level_kpis(kpi_report)` — extracts health_status, passed/failed counts
- `_build_kpi_quality_drift_artifact(...)` — quality score + drift deltas
- `_load_previous_quality_drift_artifact(scan_url)` — loads prior scan by URL
- `build_recommendations()` (from `classifier.py`) — severity/effort scoring + roadmap
- `evaluate_footer_rgpd_alignment(...)` — visual regression for RGPD
- `evaluate_multi_browser_compatibility(...)` — cross-browser check

**Known fixed bugs**:
- Copy-paste aggregator errors: KPI axis configs deduplicated and verified
- Math overflows in quality score: Clamped to [0, 100]
- NLP completion timeout: `nlp_partiel=true` flag instead of hard failure

**Known limitations**:
- Sync endpoint keeps client connection open for long durations
- If scanner unreachable, scan fails early
- Daily drift report (Phase 5) not yet implemented
- Root-cause categorization (Phase 5) not yet implemented

**Deployment**: Python FastAPI, port 8080, 1→3 k3s replicas (HPA at 70% CPU)

### 6.4 v3-visual-regression

**Location**: `V3-Microservices/v3-visual-regression/`
**Entry point**: `main.py` — FastAPI on port 8083
**Key files**: `services/image_comparator.py`, `services/zone_comparator.py`, `services/ux_kpis.py`

**Endpoints**:
- `GET /health`
- `POST /screenshot` — capture batch screenshots, persist to DB
- `POST /compare` — SSIM + zone-based visual regression
- `POST /ux-kpis` — visual complexity, CTA prominence, first impression score
- `POST /browser-compat` — Chromium vs WebKit diff

**Scoring details**:
- Visual regression: fused score = (zone_norm × 0.45 + ssim_delta × 0.25 + phash_norm × 0.20 + lpips_norm × 0.10), threshold 0.22
- UX first impression: 0.30·aboveFold + 0.35·cta + 0.20·hierarchy + 0.15·(1−complexity)

**Deployment**: Python Docker, port 8083, 1→3 k3s replicas

### 6.5 v3-browser-pool

**Location**: `V3-Microservices/v3-browser-pool/`
**Entry point**: `main.py` — FastAPI on port 8084
**Endpoints**: `/health`, `/render`, `/screenshot`, `/batch-screenshot`
**Pool config**: 15 concurrent, recycle after 50 pages, 30s default timeout
**Coverage modes**: `viewport_only`, `full_page`, `segmented` (>15000px pages)

### 6.6 v3-cli

**Location**: `V3-Microservices/v3-cli/`
**Entry point**: `cmd/root.go` — Cobra command
**Commands**: `scan` (trigger + watch), `monitor` (service health), `build` (Go cross-compile), `deploy` (pinggy tunnel)
**Config**: `.snapflow.yaml`

---

## 7. DATA MODELS

### VPS PostgreSQL (`snapflow_v3`)

#### `scan_pages`
| Column | Type | Constraints | Owner | Description |
|--------|------|-------------|-------|-------------|
| `id` | SERIAL | PK | Scanner | Auto-increment |
| `scan_id` | VARCHAR(64) | NOT NULL | Scanner | Groups pages from one scan |
| `domain` | VARCHAR(255) | NOT NULL | Scanner | Target domain |
| `url` | TEXT | NOT NULL | Scanner | Full page URL |
| `html` | TEXT | — | Scanner | Legacy compatibility HTML |
| `raw_html` | TEXT | — | Scanner | Static crawler HTML |
| `rendered_html` | TEXT | — | Scanner | Headless-hydrated DOM |
| `metrics` | JSONB | DEFAULT '{}' | Scanner | Per-page KPIs |
| `nlp_results` | JSONB | DEFAULT NULL | NLP Worker | NLP enrichment (NULL=pending) |
| `created_at` | TIMESTAMP | DEFAULT NOW() | — | Creation timestamp |
| **Indexes**: `uq_scan_url UNIQUE(scan_id, url)`, `idx_nlp_pending ON id WHERE nlp_results IS NULL`, `idx_scan_domain ON (scan_id, domain)` |

#### `scan_summaries`
| Column | Type | Constraints | Owner | Description |
|--------|------|-------------|-------|-------------|
| `scan_id` | VARCHAR(64) | PK | Scanner | Foreign key |
| `domain` | VARCHAR(255) | NOT NULL | Scanner | Target domain |
| `domain_security` | JSONB | DEFAULT '{}' | Scanner | Security KPIs |
| `domain_tech` | JSONB | DEFAULT '{}' | Scanner | Tech stack |
| `domain_privacy` | JSONB | DEFAULT '{}' | Scanner | Privacy/RGPD |
| `domain_functional` | JSONB | DEFAULT '{}' | Scanner | Functional KPIs |
| `image_compression` | JSONB | — | Scanner | Image optimization |
| `broken_links_summary` | JSONB | — | Scanner | Broken links |
| `seo_kpi_extended` | JSONB | — | Scanner | SEO extended KPIs |
| `form_fuzzer_summary` | JSONB | — | Scanner | Form fuzzer results |
| `created_at` | TIMESTAMP | DEFAULT NOW() | — | Creation timestamp |
| **Relationship**: 1-to-many with `scan_pages` via `scan_id` |

#### `form_fuzz_results`
| Column | Type | Constraints | Owner |
|--------|------|-------------|-------|
| `id` | BIGSERIAL | PK | Scanner |
| `scan_id` | VARCHAR(64) | NOT NULL | Scanner |
| `page_url` | TEXT | NOT NULL | Scanner |
| `action_url` | TEXT | NOT NULL | Scanner |
| `form_id` | TEXT | NOT NULL | Scanner |
| `test_type` | VARCHAR(32) | NOT NULL | Scanner |
| `payload` | JSONB | DEFAULT '{}' | Scanner |
| `response_type` | VARCHAR(32) | DEFAULT 'error' | Scanner |
| `status_code` | INTEGER | DEFAULT 0 | Scanner |
| `anomaly` | BOOLEAN | DEFAULT FALSE | Scanner |
| `anomaly_reason` | TEXT | — | Scanner |
| `duration_ms` | BIGINT | DEFAULT 0 | Scanner |
| `error` | TEXT | — | Scanner |
| `created_at` | TIMESTAMP | DEFAULT NOW() | — |
| **Index**: `idx_form_fuzz_scan (scan_id, page_url, form_id, test_type, created_at)` |

#### `scan_kpi_outputs`
| Column | Type | Constraints | Owner |
|--------|------|-------------|-------|
| `scan_id` | VARCHAR(64) | PK | Aggregator |
| `scan_url` | TEXT | — | Aggregator |
| `kpi_json` | JSONB | DEFAULT '{}' | Aggregator |
| `top_level_kpis` | JSONB | DEFAULT '{}' | Aggregator |
| `quality_drift_artifact` | JSONB | DEFAULT '{}' | Aggregator |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | — |

#### `scan_state`
| Column | Type | Constraints | Owner |
|--------|------|-------------|-------|
| `scan_id` | VARCHAR(64) | PK | Aggregator |
| `state_json` | JSONB | DEFAULT '{}' | Aggregator |
| `updated_at` | TIMESTAMP | DEFAULT NOW() | — |

#### `visual_screenshots`
| Column | Type | Constraints | Owner |
|--------|------|-------------|-------|
| `id` | SERIAL | PK | Visual Regression |
| `scan_id` | VARCHAR(64) | NOT NULL | Visual Regression |
| `url` | TEXT | NOT NULL | Visual Regression |
| `screenshot` | BYTEA | — | Visual Regression |
| `created_at` | TIMESTAMP | DEFAULT NOW() | — |
| **Unique**: `(scan_id, url)` |

### Supabase (Cloud)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | Client projects | `id`, `site_name`, `url`, `redmine_url`, `logo_url`, `created_at` |
| `audits` | Audit records | `id`, `project_id`, `status`, `report_data` (JSONB), `job_id`, `error_message` |
| `project_assignments` | Many-to-many users↔projects | `project_id`, `user_id` |
| `profiles` | User profiles | `id`, `email`, `full_name` |
| `user_roles` | Role-based access | `user_id`, `role` (admin\|charge_de_projet) |
| `activity_reports` | Redmine issue snapshots | `project_id`, `report_data`, `filters`, `ticket_count` |
| `notifications` | Real-time notifications | `user_id`, `title`, `message`, `category`, `is_read` |
| `report_schedules` | Cron audit schedules | `project_id`, `frequency`, `next_run_at`, `is_active` |
| `trial_usage` | Free trial tracking | `email` |
| `redmine_account_cache` | Redmine data cache | `user_id`, `redmine_data` |

---

## 8. API CONTRACTS

### Aggregator (Public API)

#### `POST /scan`
```
Request:  {"url": "https://example.com", "max_pages": 150, "headless_concurrency": 3,
           "enable_visual_regression": false, "visual_baseline_scan_id": null}
Response: {"scan_id": "scan_<uuid>", "status": "pending"}
Errors:   422 (invalid URL), 500 (DB error)
```

#### `POST /scan/sync`
```
Request:  Same as /scan
Response: Full AuditReport JSON (blocking, may take minutes)
Errors:   422, 500, 504 (timeout)
```

#### `GET /scan/{scan_id}/status`
```
Response: {"scan_id": "...", "status": "pending|running|nlp_processing|complete|failed",
           "url": "...", "pages_crawled": 150, "pages_nlp_done": 120,
           "kpi_mode": "new", "elapsed_seconds": 45.2, "error": null}
Errors:   404 (unknown scan_id)
```

#### `GET /scan/{scan_id}/result`
```
Response: Full aggregated report JSON (only when status=complete)
Errors:   404, 409 (not complete yet)
```

#### `GET /scan/{scan_id}/recommendations`
```
Response: {"domain": "...", "summary": {"total": 50, "bugs": 10, ...},
           "bugs": [...], "recommendations": [...], "compliance": [...],
           "roadmap": {"immediate": [], "this_sprint": [], "this_quarter": [], "backlog": []},
           "quick_wins": [...], "audit_coverage": [...], "passing_kpis": [...]}
```

#### `GET /scan/{scan_id}/kpis`
```
Response: {"kpi_mode": "new", "scan_id": "...", "axes": {...}, "top_level_kpis": {...}, 
           "quality_drift_artifact": {...}, "generated_at": "ISO8601"}
```

#### `GET /scan/{scan_id}/kpis/top`
```
Response: {"scan_id": "...", "kpi_mode": "new",
           "top_level_kpis": {"health_status": "passing|warning|failing", "headline": "...",
           "key_points": [...], "pages_scanned": 150, "total_kpis": 200,
           "passed_kpis": 180, "warning_kpis": 15, "failed_kpis": 5,
           "not_evaluated_kpis": 0, "critical_kpis": 1, "high_kpis": 4,
           "medium_kpis": 10, "low_kpis": 20}}
```

#### `GET /scan/{scan_id}/kpis/quality`
```
Response: {"scan_id": "...", "kpi_mode": "new",
           "quality_drift_artifact": {"quality_score": 78.5, "quality_status": "good|watch|at_risk",
           "trend": "improving|stable|regressing", "deltas": {...},
           "health_status_changed": false}}
```

#### `GET /scan/{scan_id}/kpi` (alias)
Same as `/kpis` — preserved for backward compatibility.

### Scanner (Internal)

#### `POST /scan`
```
Request:  {"scan_id": "scan_xxx", "url": "https://...", "domains": ["example.com"],
           "max_pages": 100, "headless_concurrency": 4}
Response: {"scan_id": "...", "status": "ok"} (synchronous — returns when crawl completes)
Errors:   400 (invalid params), 500 (internal error)
```

#### `GET /health`
```
Response: {"status": "ok"} or 503 if unhealthy
```

### Visual Regression (Internal)

#### `POST /screenshot`
Captures screenshots for given URLs, persists to `visual_screenshots`.

#### `POST /compare`
```
Input: baseline_scan_id, new_scan_id, URL list
Output: per-page comparison with SSIM score, zone scores, fused regression score, severity
```

#### `POST /ux-kpis`
```
Input: URL
Output: visual_complexity_score (0-100), cta_prominence_score (0-100), 
        first_impression_score (0-100)
```

### Browser Pool (Internal)

#### `POST /render`
```
Input: URL
Output: rendered HTML, FCP, LCP, CLS, DOM node count, HTTP requests, transfer size,
        asset breakdown, overflow detection, console errors
```

#### `POST /screenshot`
Captures single-page screenshot (PNG, base64).

---

## 9. NLP & ML COMPONENTS

### Models in Use

| Model | Service | Purpose |
|-------|---------|---------|
| NLTK `stopwords` (french, english, arabic) | NLP Worker | Stopword removal in `analyze_content()` |
| NLTK `SnowballStemmer` (French, English) | NLP Worker | Stemming in `_stem_token()` |
| spaCy `fr_core_news_sm` | NLP Worker | NER for protected entities (optional, lazy-loaded in `_load_spacy_model()`) |
| language-tool-python (French) | NLP Worker | Grammar/spell checking (optional, lazy-loaded in `_load_language_tool_fr()`) |
| `textstat` library | NLP Worker | Flesch-Kincaid, SMOG, Gunning Fog readability (for English) |
| Kandel-Moles formula | NLP Worker | French readability (207 − 1.015·ASL − 73.6·ASyll) |
| LPIPS (perceptual loss) | Visual Regression | Deep learning-based image comparison (optional, `VISUAL_LPIPS_ENABLED`) |
| SSIM (scikit-image) | Visual Regression | Structural similarity index for visual diff |
| pHash | Visual Regression | Perceptual hash for image comparison |
| Canny edge detection (OpenCV) | Visual Regression | Edge density for visual complexity scoring |

### French NLP Pipeline

1. **Text extraction**: BeautifulSoup with aggressive boilerplate removal (`_prune_non_content_nodes`)
2. **Stopword removal**: NLTK FR/EN/AR stopwords union
3. **Stemming**: `SnowballStemmer('french')` for FR, `SnowballStemmer('english')` for EN
4. **Readability**: Kandel-Moles formula for French, Flesch for English, N/A for Arabic
5. **Keyword density**: Count of stemmed words after stopword/semantic noise removal, divided by total word count × 100
6. **Typo detection**: French → Language-Tool (+ spaCy NER for protected entities), non-French → `MIN_DICT_FR_EN_AR` fallback
7. **RGPD matching**: `_normalize_for_rgpd_match()` normalizes Unicode (FR accents, Arabic variants, diacritics), then matches against 16+ RGPD keywords across FR/EN/AR
8. **LSI scoring**: Matches keywords against `TOPIC_GLOSSARY` (credit, assur, invest, epargn, bank)
9. **CMP detection**: Scans HTML for known CMP signatures (OneTrust, Didomi, CookieBot, TarteAuCitron)

### Visual Regression Service
- **SSIM**: scikit-image `structural_similarity`
- **Perceptual hashing**: imagehash library
- **LPIPS**: PyTorch-based (optional, `VISUAL_LPIPS_ENABLED`)
- **Zone diffing**: 5 semantic zones (header 30%, hero 25%, content 15%, footer 5%, cta 25%)
- **Fused score**: `zone_norm×0.45 + ssim_delta×0.25 + phash_norm×0.20 + lpips_norm×0.10`

### Form Tester Module
- Located in `v3-scanner-go/analyzers/formfuzzer/`
- Workflow: extract forms via `formfuzzer.ExtractForms()` → fuzz via `formfuzzer.Run()` (Playwright-based via go-rod)
- Config via env vars: `FORM_FUZZ_CONCURRENCY`, `FORM_FUZZ_TIMEOUT_SEC`, etc.
- Approval gate: `ALLOW_FORM_FUZZER_PROD=false` blocks in production; `ENABLE_MODAL_FORM_DETECTION` controls Layer 5 modal detection
- Frontend workflow builder: `Front-Snap/src/hooks/useFormWorkflowBuilder.ts`

---

## 10. FRONTEND & SUPABASE

### React Frontend Structure

**Routing** (defined in `App.tsx`):
- `/auth` → Auth page (login/signup/confirm)
- `/app` → AppLayout (protected)
  - `/` → Overview dashboard
  - `/projects` → Project list
  - `/projects/:id` → Project detail
  - `/projects/:id/activity` → Redmine activity
  - `/reports` → Completed audits
  - `/schedules` → Cron job schedules
  - `/notifications` → Notifications
  - `/assistant` → AI chat
  - `/workflows` → Workflow builder
  - `/workflows/form-tester` → Form tester
  - `/users` → User admin
- `/audit/:id/view` → Audit report viewer

**Key pages**:
- `AuditReport.tsx`: 6-tab viewer (Resume, Sommaire, Details, Tableau, Simulateur, Tickets) with edit mode
- `auditMapper.ts`: Normalizes API responses → display format; handles axis aliasing (e.g. "TECHNIQUE" → "TECHNIQUE", "CMS" → "TECHNIQUE")
- `auditReadUtils.ts`: Safe reading with `normalizeAuditForRead()`, `getAuditScoreFromAny()`

### Supabase Tables (Frontend Direct Access)

The frontend reads/writes these directly via Supabase client:
- `projects` — CRUD
- `audits` — read/write audit metadata and `report_data`
- `project_assignments` — user-project associations
- `profiles` — user profiles
- `user_roles` — role lookup
- `notifications` — real-time read/mark
- `report_schedules` — CRUD cron configs
- `activity_reports` — read/write issue snapshots

### Auth Flow
1. Supabase Auth handles login/signup (email + password)
2. `AuthProvider` context (`useAuth.tsx`) manages session, user, role, admin status
3. `user_roles` table maps `user_id` → `role` (admin|charge_de_projet)
4. `AppLayout` redirects unauthenticated users to `/auth`

### PDF Report Generation
- Uses `@react-pdf/renderer` v4.3.2
- `generateAuditPdf()` in `src/lib/generateAuditPdf.tsx`:
  1. Fetches client logo from `project.logo_url`
  2. Renders `AuditDocument` (11 pages: Cover, TOC, Executive Summary, KPI Grid, Axis pages, Recommendations, Roadmap, Conclusion, Annexe, Back Cover)
  3. 4 themes: Slate (default), Mineral, Sand, Steel (`theme.ts`)
  4. Converts to blob and triggers download
- Theme picker: `PdfThemePickerModal.tsx`

### Client Logo Detection
- `projects.logo_url` column stores logo URL
- `generateAuditPdf.tsx` fetches logo as base64 blob before rendering cover page
- Falls back to gradient background if no logo

---

## 11. INFRASTRUCTURE

### OVH VPS Specs
- **vCores**: 12
- **RAM**: 48 GB
- **OS**: Ubuntu/Debian (k3s-optimized via `01-bootstrap-node.sh`)

### k3s Single-Node Setup

**Namespaces**:
- `snapflow-infra` — PostgreSQL, PgBouncer, Redis
- `snapflow-prod` — All 6 microservices + frontend

**Service Deployments** (from `k8s/02-services/`):
| Service | Replicas | Port | Image |
|---------|----------|------|-------|
| aggregator | 1→3 (HPA 70% CPU) | 8080 | `snapflow/v3-aggregator:latest` |
| scanner | 1→5 (KEDA CPU 75%) | 8081 | `snapflow/v3-scanner-go:latest` |
| nlp-worker | 1→4 | — | `snapflow/v3-nlp-worker:latest` |
| visual-regression | 1→3 | 8083 | `snapflow/v3-visual-regression:latest` |
| browserless | 1 | 3000 | `ghcr.io/browserless/chromium` |
| frontend | 1 | 3000 | `snapflow/frontend:latest` |

**Autoscaling** (`k8s/03-autoscaling/`):
- `hpa-aggregator.yaml`: CPU 70%, min 1, max 3
- `keda-scanner.yaml`: CPU 75%, min 1, max 5
- `keda-nlp.yaml`: min 1, max 4

### PgBouncer
- Mode: transaction pooling
- Max connections: 200
- Config: `k8s/01-infra/pgbouncer/configmap.yaml`

### Redis
- Max memory: 512MB
- Persistent storage: 10Gi PVC
- **Note**: Redis is deployed but not actively used by any microservice in the current codebase

### Secrets Management
- `k8s/07-secrets/snapflow-secrets.yaml` — placeholder (DO NOT COMMIT real secrets)
- Manual replacement required for: `db_host`, `db_port`, `db_name`, `db_user`, `db_pass`, `scanner_api_url`, `visual_regression_api_url`
- Ingress hosts: placeholder `api.yourdomain.com`, `app.yourdomain.com`
- ClusterIssuer email: placeholder `devops@yourdomain.com`

### Environment Variables (All Services)

| Variable | Default | Services |
|----------|---------|----------|
| `DB_HOST` | localhost | All |
| `DB_PORT` | 5432 | All |
| `DB_NAME` | snapflow_v3 | All |
| `DB_USER` | snapflow | All |
| `DB_PASS` | snapflow | All |
| `PORT` | 8081 | Scanner |
| `SCANNER_API_URL` | http://scanner:8081 | Aggregator |
| `VISUAL_REGRESSION_API_URL` | http://v3-visual-regression:8083 | Aggregator |
| `BROWSER_POOL_URL` | http://v3-browser-pool:8084 | Scanner, Visual Regression |
| `SCANNER_TIMEOUT` | 600s | Scanner |
| `SCANNER_PARALLELISM` | 150 | Scanner |
| `HEADLESS_SAMPLE_RATIO` | 0.80 | Scanner |
| `POLL_INTERVAL` | 3s | NLP Worker |
| `CHROME_NO_SANDBOX` | (auto) | Scanner, Browser Pool, Visual Regression |
| `ENABLE_FORM_FUZZER` | true | Scanner |
| `ENABLE_PORT_SCAN` | false | Scanner |
| `VISUAL_REGRESSION_ENABLED` | true | Visual Regression |
| `APP_ENV` / `SNAPFLOW_ENV` | dev | Scanner |

---

## 12. CODING CONVENTIONS

### Go Code Style

- **Package structure**: `analyzers/<name>/<name>.go` — one package per analyzer
- **Error handling**: Early return with wrapped errors. No panics in production paths.
- **Config loading**: `envBool()`, `envInt()`, `envFloat64()` helpers in `main.go`
- **Struct naming**: PascalCase exports, camelCase unexports
- **Constants**: PascalCase exported constants for configuration defaults
- **Testing**: `go test ./...` from service root; test files co-located in analyzer packages
- **HTTP handlers**: Standard `net/http` with `w.WriteHeader()` + `json.NewEncoder(w).Encode()`

### Python Code Style

- **Service entry**: FastAPI app in `main.py` (aggregator, visual regression, browser pool)
- **NLP worker**: Polling loop in `main()` with `get_db_connection()` + `process_pending_pages()`
- **KPI builder**: `kpi_builder.py` with `_KPI_META`, `_KPI_BUSINESS_IMPACT`, `_KPI_TICKET_TEAM` global dictionaries
- **Classifier**: `classifier.py` with `_severity_rank()`, `score_effort()` helpers
- **Imports**: Standard library first, then third-party, then local
- **Error handling**: `try/except` with logging; per-row isolation in NLP worker
- **Testing**: `pytest` with psycopg2 stubs (`sys.modules.setdefault("psycopg2", psycopg2_stub)`)
- **DB access**: Raw SQL via `psycopg2`, no ORM

### TypeScript/React Patterns

- **Components**: Functional components with hooks
- **State**: React Query (TanStack) for server state, Context for auth/theme
- **Routing**: React Router v6 with `<Outlet>` in `AppLayout`
- **Styling**: Tailwind CSS with custom `@layer utilities` classes
- **API calls**: Supabase client direct access + edge functions for audit bridging
- **Types**: Zod schemas for form validation, TypeScript interfaces for data models

### How to Add a New KPI (Full Flow)

1. **Scanner**: Add detection logic in the appropriate analyzer (`seo.go`, `security.go`, etc.)
2. **Scanner**: Add field to the analyzer's `*Result` struct and populate in `Analyze()` function
3. **NLP Worker**: If NLP-related, add extraction function in `main.py` and include in `nlp_results` payload
4. **Aggregator**: Add KPI entry to `_KPI_META` dictionary in `kpi_builder.py` with `(kpi_id, confidence, evidence_quality)`
5. **Aggregator**: Add to `_KPI_BUSINESS_IMPACT` with French business impact text
6. **Aggregator**: Add to `_KPI_TICKET_TEAM` if applicable
7. **Aggregator**: Implement `_build_<kpi_name>()` function to read evidence and produce 9-field KPI object
8. **Aggregator**: Register in the appropriate axis builder function in `kpi_builder.py`
9. **Classifier**: Add recommendation/action mapping in `classifier.py` if actionable
10. **Frontend**: Ensure `auditMapper.ts` axis aliases handle any new axis labels

### Git Branching Strategy
(Not explicitly visible in workspace — no `.git` data available)

### Environment Variable Naming
- `UPPER_SNAKE_CASE` for all env vars
- Service-specific prefixes: `SCANNER_*`, `FORM_FUZZ_*`, `BROWSER_POOL_*`
- Shared DB vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`

---

## 13. KNOWN BUGS & FIXED ISSUES

### 403 False Positives (Scanner)
- **Symptom**: Cloudflare/anti-bot pages detected as real content, producing 0-page crawls
- **Fix**: `isCloudflareChallenge()` in `main.go` checks body + headers for challenge markers
- **Fallback**: Cloudflare fallback phases (Phase 5 and 8 in scanner pipeline) seed from prefetch HTML and retry with headless
- **Do not regress**: Always check `isCloudflareChallenge()` before treating empty crawl as valid

### Inverted KPI Statuses
- **Symptom**: Some KPIs showed `passing` when they should be `failing` and vice versa
- **Fix**: Normalized `Passed` boolean semantics across all Go analyzers; aggregator `_normalize_kpi_object()` coerces status values
- **Do not regress**: Never invert `Passed` meaning — `true` = good/passing, `false` = bad/failing

### Math Overflows
- **Symptom**: Quality score exceeded 100 or went negative
- **Fix**: Clamp to [0, 100] in `_build_kpi_quality_drift_artifact()`
- **Do not regress**: Always clamp scoring formulas

### Copy-Paste Aggregator Errors
- **Symptom**: Some KPI axis configs in `kpi_builder.py` had duplicated or misconfigured entries due to copy-paste
- **Fix**: Deduplicated axis configurations; each KPI appears in exactly one axis
- **Do not regress**: Verify KPI uniqueness when adding new KPIs

### French Stopword Ordering
- **Symptom**: NLP stopword removal was order-dependent, causing inconsistent keyword extraction
- **Fix**: Combined NLTK FR/EN/AR stopwords via set union (`set(stopwords.words("french") | stopwords.words("english") | stopwords.words("arabic"))`)
- **Do not regress**: Always use set union, never ordered list concatenation

### RGPD Slug-Only Matching
- **Symptom**: RGPD/privacy detection only matched URL slugs (`/privacy`, `/rgpd`), missing content-based signals
- **Fix**: Added `_has_strong_rgpd_signal()` — requires ≥2 RGPD keywords within 200-word window
- **Do not regress**: Always use content analysis in addition to URL matching

### Non-Hydrated SPA Shell False Negatives
- **Symptom**: SPA pages with no rendered HTML produced misleading thin-content KPIs
- **Fix**: NLP worker writes `status=not_evaluated` with `reason=spa_shell_not_hydrated`
- **Do not regress**: Always check for SPA markers + missing rendered HTML before content analysis

### NLP Completion Timeout Hard Failure
- **Symptom**: Aggregator would fail the entire scan if NLP hadn't finished
- **Fix**: `nlp_partiel=true` flag — scan completes with partial NLP, KPIs decorated with warning
- **Do not regress**: Never make NLP completion a hard gate for scan completion

### Stub psycopg2 in Tests
- Pattern across 3 test files: `sys.modules.setdefault("psycopg2", psycopg2_stub)`
- This is intentional — tests run without a real DB connection
- Files: `test_kpi_centric_report.py`, `test_form_fuzzer_kpi.py`, `test_recommendations_real_scan_fixture.py`

---

## 14. CURRENT PRIORITIES & TODO

### Incomplete / Stubbed Features

| Feature | Location | Status |
|---------|----------|--------|
| Daily drift report artifact | `v3-aggregator/main.py` (Phase 5) | Not implemented |
| Root-cause categorization by category | `v3-aggregator/main.py` (Phase 5) | Not implemented |
| Legacy cleanup (Phase 8) | Multiple files | Partially done — feature flags may remain |
| `v3-cli` `build` command | `cmd/build.go` | Stub (delegated to TUI) |
| `v3-cli` `deploy` command | `cmd/deploy.go` | Stub (Pinggy tunnel) |
| `v3-cli` `monitor` command | `cmd/monitor.go` | Stub |
| Redis usage | Infrastructure | Deployed but not wired to any service |

### TODOs & FIXMEs in Code

No explicit `TODO`/`FIXME` comments found in Go/Python source code (all cleaned up during migration). Implicit gaps:
- `plan.md` Phase 5: "Add daily drift report artifact (JSON + Markdown summary)" — not done
- `plan.md` Phase 5: "Tag root causes by category: SPA hydration, boilerplate extraction, consent-runtime, security semantics, other" — not done
- `plan.md` Phase 6: Monitoring review gate — not started
- `plan.md` Phase 8: "Remove remaining legacy-only helper code and stale constants" — partially done
- Fixture file `raw_ec_response.json` mentioned in aggregator tests but may be missing (blocked baseline tests)

### Features in Config But Not Fully Wired

- Azure heartbeat: `WEBSITE_SITE_NAME` + `HEARTBEAT_INTERVAL_SECONDS` — exists in aggregator but deployment target TBD
- Port scanning: `ENABLE_PORT_SCAN=false` by default — intentionally disabled for safety
- Form fuzzer production block: `ALLOW_FORM_FUZZER_PROD=false` — blocks fuzzing in prod env
- k8s Redis: Deployed but no consumer

### Next Logical Implementation Steps

1. Implement daily drift report JSON + Markdown summary
2. Implement root-cause categorization pipeline
3. Remove remaining legacy feature flags and dead code
4. Wire Redis into NLP worker for result caching or queue management
5. Implement monitoring review gate (Phase 6)
6. Run 14-day/50-scan monitoring cycle (Phase 6)
7. Complete CLI commands (build, deploy, monitor)

---

## 15. RULES FOR FUTURE SESSIONS

### CRITICAL: Never Break the KPI Data Contract

Every KPI must have exactly these 9 fields:
```json
{"constat", "info", "impact", "pages_affected", "pages_affected_urls",
 "status", "type", "severity", "data"}
```
- `severity` MUST be `null` when `status` is `passing`
- `status` MUST be one of: `passing`, `failing`, `warning`, `not_available`
- Do NOT introduce new status values

### CRITICAL: Never Write to the Wrong PostgreSQL Instance

- **Supabase** (cloud): Frontend data only — `projects`, `audits`, `profiles`, `notifications`, `user_roles`, `project_assignments`, `report_schedules`, `activity_reports`, `redmine_account_cache`
- **VPS PostgreSQL** (k3s, `snapflow_v3`): Scan data only — `scan_pages`, `scan_summaries`, `form_fuzz_results`, `scan_kpi_outputs`, `scan_state`, `visual_screenshots`
- Never mix the two. Aggregator uses VPS DB. Frontend uses Supabase.

### CRITICAL: Always Run Validation Gate Before Aggregation

The function `_normalize_kpi_object()` in `kpi_builder.py` must be called for every KPI before it enters the final report. This enforces VALID/PARTIAL/MISSING classification.

### Service Ownership Rules (Inviolable)

| Action | Allowed Services |
|--------|-----------------|
| Write `scan_pages` rows | Scanner |
| Write `scan_pages.nlp_results` | NLP Worker |
| Write `scan_summaries` | Scanner |
| Write `form_fuzz_results` | Scanner |
| Write `scan_kpi_outputs` | Aggregator |
| Write `scan_state` | Aggregator |
| Write `visual_screenshots` | Visual Regression |
| Write Supabase tables | Frontend (via Supabase client) |

### Invariant Rules

1. **Scanner must write at least one `scan_pages` row** for meaningful downstream processing. If 0 pages, use Cloudflare fallback.
2. **NLP worker only processes rows** where HTML exists AND `nlp_results IS NULL`.
3. **Aggregator completion does not require full NLP completion** — use `nlp_partiel=true` flag.
4. **KPI endpoints are canonical in `new` mode only** — never reintroduce legacy branching.
5. **Visual regression is optional** — disabled mode returns 503 semantics.
6. **`html_source` and `evidence_provenance`** are critical for interpreting KPI confidence.
7. **Never invert `Passed` semantics** — `true` = good/passing throughout the codebase.
8. **Always clamp quality scores** to [0, 100].
9. **Passing KPIs must not display risk wording** in the frontend (per user preference — `isRiskPassingFinding()` in audit mapper).
10. **All scan lifecycle transitions** must go through: PENDING → RUNNING → NLP_PROCESSING → COMPLETE/FAILED

### Testing Rules

- **Scanner**: `cd V3-Microservices/v3-scanner-go && go test ./...`
- **NLP Worker**: `cd V3-Microservices/v3-nlp-worker && python -m pytest tests -q`
- **Aggregator**: `cd V3-Microservices/v3-aggregator && python -m pytest tests -q`
- **End-to-end**: `cd V3-Microservices && ./run.sh` then test `/scan/{id}/kpis/top`
- Tests use stubbed psycopg2 — no real DB needed for unit tests
- Baseline fixtures must be frozen real scan snapshots

### Deployment Order (k3s)

```bash
./01-bootstrap-node.sh && ./02-install-k3s-server.sh
./03-install-operators.sh
# MANUALLY: Replace secrets in k8s/07-secrets/
./07-build-and-import-images.sh
./04-apply-manifests.sh && ./05-run-migrations.sh
./06-smoke-test.sh
```

### Docker Build Order

```bash
./BUILD_V3_BASE_IMAGES.sh [--no-cache] [--rebuildbase]
docker compose build [--no-cache]
docker compose up -d
```

### File Edit Cautions

- `kpi_builder.py` (~2000 lines) — the most sensitive file. Changes here affect every audit report.
- `classifier.py` (~1500 lines) — affects recommendations and roadmap. Test thoroughly.
- `main.py` (aggregator, ~3600 lines) — orchestrates entire scan lifecycle.
- `main.py` (NLP worker, ~3000 lines) — NLP pipeline. Per-row error isolation critical.
- `main.go` (scanner) — 10-phase pipeline. Phase ordering must not change.
- `auditMapper.ts` — frontend normalization. Axis aliases must match aggregator output.
- `db/init.sql` — schema changes must be backward-compatible (services have idempotent `ensure` logic).

---

*End of AGENTS.md — complete project bible for SnapFlow V3.*
