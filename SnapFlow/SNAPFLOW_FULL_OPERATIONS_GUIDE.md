# SnapFlow Full Architecture, Deployment, CI/CD, Microservices, And Operations Guide

> Generated: 2026-07-03  
> Repository root used for evidence: `SnapFlow/`  
> Scope: Front-Snap React SPA, Supabase Edge Functions, V3 microservices, Docker Compose, Kubernetes/k3s deployment, CI/CD, Redmine activity reporting, form testing, and operational commands.

---

## 0. Evidence Policy

This document is written from repository evidence, not guesses.

Evidence sources used:

- `AGENTS.md`
- `MICROSERVICES_COMPLETE_ANALYSIS.md`
- `Front-Snap/package.json`
- `Front-Snap/src/services/redmineService.ts`
- `Front-Snap/src/hooks/useRedmineIssues.ts`
- `Front-Snap/src/pages/ActivityReport.tsx`
- `Front-Snap/supabase/functions/fetch-redmine/index.ts`
- `Front-Snap/supabase/functions/fetch-audit-api/index.ts`
- `Front-Snap/supabase/functions/form-tester-ai-status/index.ts`
- `Front-Snap/supabase/functions/form-workflows-edit/index.ts`
- `Front-Snap/supabase/functions/form-workflows-suggest/index.ts`
- `V3-Microservices/docker-compose.yml`
- `V3-Microservices/run.ps1`
- `k8s/scripts/00-first-deploy.sh`
- `k8s/scripts/04-apply-manifests.sh`
- `k8s/scripts/06-smoke-test.sh`
- `k8s/scripts/07-build-and-import-images.sh`
- `../.github/workflows/ci.yml`
- `../.github/workflows/security.yml`
- `../.github/workflows/containers.yml`
- `../.github/workflows/manifests.yml`
- `../.github/workflows/nightly-deep.yml`
- `CI_CD_TRIVY_REMEDIATION.md`

If something is not proven by these files, it is marked as:

```text
Not evidenced in repository.
```

---

## 1. What SnapFlow Is

SnapFlow is a website audit and digital compliance SaaS platform. It crawls client websites, analyzes them across audit domains, enriches pages with NLP and visual regression data, and produces French-language reports and project dashboards.

The product combines:

- A React frontend for internal users and project/report workflows.
- Supabase Auth, database tables, storage, and Edge Functions.
- A V3 microservice backend for crawling, analysis, KPI generation, screenshots, browser rendering, and form testing.
- Redmine integration for activity reports, project/ticket synchronization, and ticket creation.
- Docker Compose for local microservice execution.
- Kubernetes/k3s manifests and scripts for pre-production style deployment.
- GitHub Actions CI/CD workflows for tests, dependency/security scans, container scans, manifests validation, and nightly deep checks.

Primary users evidenced in the repo:

- `admin`
- `charge_de_projet`
- `testeur`
- `rapporteur`
- External/client report viewers are referenced conceptually in docs and report flows, but exact external-user authorization behavior should be confirmed against production settings.

---

## 2. Repository Layout

```text
SnapFlow/
  AGENTS.md
  MICROSERVICES_COMPLETE_ANALYSIS.md
  CI_CD_TRIVY_REMEDIATION.md
  Front-Snap/
    src/
    supabase/
      functions/
      migrations/
    package.json
    Dockerfile
  V3-Microservices/
    docker-compose.yml
    run.sh
    run.ps1
    db/init.sql
    v3-aggregator/
    v3-scanner-go/
    v3-nlp-worker/
    v3-visual-regression/
    v3-browser-pool/
    v3-form-executor/
    v3-cli/
  k8s/
    scripts/
    00-bootstrap/
    01-infra/
    02-services/
    03-autoscaling/
    04-networking/
    05-resilience/
    06-monitoring/
    07-secrets/
```

The GitHub Actions workflows are in the parent repository directory:

```text
../.github/workflows/
  ci.yml
  security.yml
  containers.yml
  manifests.yml
  nightly-deep.yml
```

---

## 3. High-Level Architecture

```text
User
  |
  v
Front-Snap React SPA
  |
  | Supabase client
  v
Supabase
  - Auth
  - PostgreSQL tables for projects, audits, roles, reports, schedules
  - Storage for artifacts/logos
  - Edge Functions
      - fetch-audit-api
      - poll-audit-job
      - fetch-redmine
      - form-workflows*
      - form-executions*
      - ai-assistant
      - scheduled reports/workflows
  |
  | HTTP bridge through Edge Functions
  v
V3 Aggregator (:8080)
  |
  | calls
  v
V3 Scanner Go (:8081)  ---> PostgreSQL snapflow_v3
  |
  | uses
  v
V3 Browser Pool (:8084)

V3 NLP Worker
  - polls PostgreSQL snapflow_v3
  - enriches scan_pages.nlp_results

V3 Visual Regression (:8083)
  - screenshot capture
  - visual diffs
  - UX KPIs

V3 Form Executor (:8085, Docker Compose profile form-tester)
  - polls Supabase PostgreSQL queue
  - executes approved form-testing scenarios
  - stores artifacts in Supabase Storage
```

There are two main databases:

- Supabase PostgreSQL: product data, users, projects, audit records, Redmine caches, form workflow queues, schedules.
- V3 PostgreSQL `snapflow_v3`: crawl pages, summaries, NLP results, KPI outputs, screenshots, scan lifecycle state.

---

## 4. Core Data Ownership Rules

These ownership boundaries are important because the services are intentionally separated.

| Data | Owner | Writes |
|---|---|---|
| `scan_pages` crawl rows | `v3-scanner-go` | Scanner |
| `scan_pages.metrics` | `v3-scanner-go` | Scanner |
| `scan_pages.nlp_results` | `v3-nlp-worker` | NLP worker |
| `scan_summaries` | `v3-scanner-go` | Scanner |
| `form_fuzz_results` | `v3-scanner-go` | Scanner |
| `scan_kpi_outputs` | `v3-aggregator` | Aggregator |
| `scan_state` | `v3-aggregator` | Aggregator |
| `visual_screenshots` | `v3-visual-regression` | Visual regression |
| Supabase project/report/user tables | Frontend and Edge Functions | Supabase client/functions |

Practical rule: do not make the frontend write directly into V3 scan tables, and do not make scanner/NLP services write into Supabase product tables.

---

## 5. Main Product Flows

### 5.1 Audit Generation Flow

```text
User selects project / URL
  |
  v
Front-Snap creates or updates an audit record in Supabase
  |
  v
Supabase Edge Function fetch-audit-api
  |
  | reads SCANNER_BASE_URL or AUDIT_API_URL
  v
v3-aggregator POST /scan
  |
  v
Aggregator creates scan_id and scan_state=pending
  |
  v
Aggregator calls v3-scanner-go POST /scan
  |
  v
Scanner crawls site, analyzes pages/forms/security/performance, writes PostgreSQL rows
  |
  v
NLP worker enriches rows asynchronously
  |
  v
Aggregator builds canonical KPI report
  |
  v
Frontend polls via poll-audit-job and stores/display report data
```

The `fetch-audit-api` function uses:

```text
SCANNER_BASE_URL
AUDIT_API_URL
SCANNER_ASYNC_TIMEOUT_MS
```

Evidence: `Front-Snap/supabase/functions/fetch-audit-api/index.ts`.

### 5.2 Site Data Pulled By The Scanner

The scanner pulls data from the target website:

- SSL/TLS signals
- `sitemap.xml`
- `robots.txt`
- homepage HTML
- crawled page HTML
- raw and rendered HTML
- links
- forms
- buttons/features/search signals
- security headers and cookies
- SEO metadata and headings
- performance/headless browser metrics
- mobile samples
- image/compression information
- form fuzzer results

The scanner writes raw page and summary data into the V3 PostgreSQL database. The aggregator later converts those raw signals into KPI reports.

### 5.3 Redmine Activity Reporting Flow

```text
Project has redmine_url or URL containing /projects/<identifier>
  |
  v
Frontend extracts Redmine project identifier
  |
  v
Frontend calls fetch-redmine Edge Function
  |
  v
fetch-redmine calls Redmine API at https://maintenance.medianet.tn
  |
  v
Issues, statuses, trackers, project details, users are returned to frontend
  |
  v
Activity dashboard / PDF export uses those fields
```

The current Redmine base URL is hardcoded:

```ts
const REDMINE_BASE = "https://maintenance.medianet.tn";
```

The Redmine API key is read from:

```text
REDMINE_API_KEY
```

Evidence: `Front-Snap/supabase/functions/fetch-redmine/index.ts`.

The frontend issue type is:

```ts
interface RedmineIssue {
  id: number;
  subject: string;
  description?: string;
  status: { id: number; name: string };
  tracker: { id: number; name: string };
  priority: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  author: { id: number; name: string };
  created_on: string;
  updated_on: string;
  done_ratio: number;
  estimated_hours?: number;
  spent_hours?: number;
}
```

Activity reports can use:

- ticket ID
- subject
- description
- status
- tracker/type
- priority
- assigned person
- author
- created date
- updated date
- done ratio
- estimated hours
- spent hours

### 5.4 Redmine Functions Available

The `fetch-redmine` Edge Function supports these evidenced request types:

- `projects`
- `users`
- `import_redmine_user`
- `issues`
- `trackers`
- `issue_statuses`
- `search_issues`
- `create_issue`
- `project_detail`
- `documents`
- `sync_homepages`
- `sync_account_projects_bulk`
- `get_cached_redmine_projects_for_user`
- `sync_my_account_projects`
- `my_redmine_projects_for_import`
- `import_my_redmine_projects`
- `sync_my_redmine_projects`
- `sync_account_projects_for_user`
- `issue_detail`

### 5.5 Activity PDF Export

Evidence from `ActivityReport.tsx`:

- The project is loaded from Supabase.
- Redmine identifier is derived from `project.redmine_url || project.url`.
- Issues are loaded through `useRedmineIssues` and `fetchAllIssuesPaginated`.
- Filter options are loaded from Redmine statuses and trackers.
- Existing snapshots are loaded from `activity_reports`.
- Perimeter blocks are loaded from `project_perimeter_blocks`.
- PDF export passes:
  - project
  - issues
  - total issue count
  - filters
  - selected labels
  - project perimeter blocks
  - date range

The activity PDF should therefore be treated as a composition of:

- SnapFlow project metadata
- Redmine issue data
- optional configured perimeter blocks
- frontend PDF templates

It should not hardcode example manual tickets unless the project actually has those tickets in Redmine.

### 5.6 Form Tester Flow

The form tester has frontend workflow builder pages and Supabase Edge Functions for detection, suggestions, editing, execution, approvals, and schedules.

Evidenced functions include:

- `form-workflows`
- `form-workflows-detect`
- `form-workflows-suggest`
- `form-workflows-edit`
- `form-workflows-approve`
- `form-workflows-execute`
- `form-executions`
- `form-execution-control`
- `form-test-campaigns`
- `form-workflow-schedules`
- `execute-scheduled-form-workflows`
- `form-tester-ai-status`

AI provider configuration evidenced in the form tester functions:

```text
FORM_TESTER_AI_PROVIDER=openai_compatible
FORM_TESTER_AI_API_KEY
FORM_TESTER_AI_BASE_URL
FORM_TESTER_AI_MODEL=flash-v4
```

Gemini fallback/default configuration:

```text
GEMINI_API_KEY
FORM_TESTER_GEMINI_MODEL=gemini-2.0-flash
```

The OpenAI-compatible default base URL in the current code is:

```text
https://api.deepseek.com/v1/chat/completions
```

Evidence: `form-tester-ai-status`, `form-workflows-edit`, and `form-workflows-suggest`.

---

## 6. V3 Microservices

### 6.1 v3-aggregator

Location:

```text
V3-Microservices/v3-aggregator/
```

Runtime:

```text
Python 3.11
FastAPI
Port 8080
```

Role:

- Public API gateway for the V3 scan system.
- Creates scan IDs and lifecycle state.
- Calls the scanner.
- Waits for or tolerates partial NLP completion.
- Calls visual regression when relevant.
- Builds canonical KPI JSON.
- Persists KPI outputs.
- Exposes recommendations and KPI summary endpoints.

Important endpoints from the project docs:

```text
GET  /health
POST /scan
POST /scan/sync
GET  /scan/{scan_id}/status
GET  /scan/{scan_id}/result
GET  /scan/{scan_id}/recommendations
GET  /scan/{scan_id}/kpis
GET  /scan/{scan_id}/kpis/top
GET  /scan/{scan_id}/kpis/quality
GET  /scan/{scan_id}/kpi
```

Important environment variables:

```text
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASS
DB_SSL_MODE
SCANNER_API_URL
VISUAL_REGRESSION_API_URL
BROWSER_POOL_URL
DEFAULT_HEADLESS_CONCURRENCY
MAX_HEADLESS_CONCURRENCY
```

Local run:

```bash
cd V3-Microservices/v3-aggregator
pip install -r requirements.txt
DB_HOST=localhost python main.py
```

Tests:

```bash
cd V3-Microservices/v3-aggregator
python -m pytest tests -q
```

### 6.2 v3-scanner-go

Location:

```text
V3-Microservices/v3-scanner-go/
```

Runtime:

```text
Go
Port 8081
```

Role:

- Acquisition engine.
- Crawls target sites.
- Runs static and runtime analyzers.
- Discovers and fuzzes forms.
- Uses the browser pool for rendered analysis.
- Writes page and summary data into V3 PostgreSQL.

Endpoints:

```text
GET  /health
POST /scan
```

Scanner pipeline from project docs:

1. Pre-fetch: SSL, sitemap, robots, homepage.
2. Domain analyzers: technology, security, privacy, functional.
3. Colly crawl.
4. DB sync.
5. Cloudflare fallback.
6. Form discovery and fuzzing.
7. Headless sampling.
8. Cloudflare backfill.
9. Mobile tests.
10. Final aggregation.

Important environment variables from docs and compose:

```text
PORT
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASS
DB_SSL_MODE
CHROME_NO_SANDBOX
BROWSER_POOL_URL
BROWSER_POOL_TIMEOUT_MS
SCANNER_PARALLELISM
HEADLESS_SAMPLE_RATIO
SCANNER_REQUEST_TIMEOUT_SEC
RENDERED_DISCOVERY_MAX_PAGES
ENABLE_OBSCURA_PARALLEL_DISCOVERY
ENABLE_PORT_SCAN
PORT_SCAN_TIMEOUT_MS
PORT_SCAN_PORTS
ENABLE_FORM_FUZZER
ALLOW_FORM_FUZZER_PROD
```

Build and run:

```bash
cd V3-Microservices/v3-scanner-go
go build -o v3-scanner-go .
DB_HOST=localhost DB_PORT=5432 ./v3-scanner-go
```

Tests:

```bash
cd V3-Microservices/v3-scanner-go
go test ./...
```

### 6.3 v3-nlp-worker

Location:

```text
V3-Microservices/v3-nlp-worker/
```

Runtime:

```text
Python 3.11
No public HTTP port
Polling worker
```

Role:

- Polls `scan_pages` rows where `nlp_results IS NULL`.
- Extracts text from raw/rendered HTML.
- Performs content, readability, SEO, RGPD, page type, keyword, freshness, and CTA analysis.
- Writes `nlp_results` JSONB back into the V3 PostgreSQL database.

Important environment variables:

```text
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASS
POLL_INTERVAL
SPACY_FR_MODEL
```

Run:

```bash
cd V3-Microservices/v3-nlp-worker
pip install -r requirements.txt
DB_HOST=localhost python main.py
```

Tests:

```bash
cd V3-Microservices/v3-nlp-worker
python -m pytest tests -q
```

### 6.4 v3-visual-regression

Location:

```text
V3-Microservices/v3-visual-regression/
```

Runtime:

```text
Python 3.11
FastAPI
Port 8083
```

Role:

- Captures screenshots.
- Compares baseline and new scans.
- Computes visual/UX KPIs.
- Supports browser compatibility checks.

Endpoints from docs:

```text
GET  /health
POST /screenshot
POST /compare
POST /ux-kpis
POST /browser-compat
```

Important environment variables:

```text
DATABASE_URL
VISUAL_REGRESSION_ENABLED
CHROME_NO_SANDBOX
BROWSER_POOL_URL
VISUAL_SCREENSHOT_MAX_CONCURRENCY
SCREENSHOT_WAIT_UNTIL
SCREENSHOT_SETTLE_MS
SCREENSHOT_LOAD_STATE_TIMEOUT_MS
```

Run:

```bash
cd V3-Microservices/v3-visual-regression
pip install -r requirements.txt
DATABASE_URL=postgresql://snapflow:snapflow@localhost:5432/snapflow_v3 python main.py
```

Tests:

```bash
cd V3-Microservices/v3-visual-regression
python -m pytest tests/ -v
```

### 6.5 v3-browser-pool

Location:

```text
V3-Microservices/v3-browser-pool/
```

Runtime:

```text
Python 3.11
FastAPI + Playwright
Port 8084
```

Role:

- Provides shared Chromium rendering capacity.
- Reduces duplicated browser startup cost across scanner and visual regression.
- Supports rendered HTML, screenshots, and rendered discovery.

Endpoints from docs:

```text
GET  /health
POST /render
POST /screenshot
POST /batch-screenshot
POST /discover-rendered
```

Important environment variables from compose:

```text
CHROME_NO_SANDBOX
BROWSER_POOL_CONCURRENCY
BROWSER_POOL_RECYCLE_AFTER
BROWSER_POOL_DEFAULT_TIMEOUT_MS
BROWSER_POOL_ACQUIRE_TIMEOUT_S
BROWSER_POOL_SCREENSHOT_WAIT_UNTIL
BROWSER_POOL_SCREENSHOT_SETTLE_MS
BROWSER_POOL_SCREENSHOT_LOAD_STATE_TIMEOUT_MS
BROWSER_POOL_RENDER_WAIT_UNTIL
BROWSER_POOL_RENDER_SETTLE_MS
ENABLE_OBSCURA_DISCOVERY
OBSCURA_RENDER_ENABLED
OBSCURA_MAX_SESSIONS
OBSCURA_DISCOVERY_CONCURRENCY
OBSCURA_RENDER_FALLBACK_CONCURRENCY
ENABLE_OBSCURA_FORM_EXECUTION
ENABLE_OBSCURA_FORM_FUZZING
OBSCURA_CDP_URL
```

Run:

```bash
cd V3-Microservices/v3-browser-pool
pip install -r requirements.txt
python main.py
```

Health:

```bash
curl -s http://localhost:8084/health | jq
```

### 6.6 v3-form-executor

Location:

```text
V3-Microservices/v3-form-executor/
```

Runtime:

```text
Python 3.11
Port 8085 in Docker Compose
Docker Compose profile: form-tester
```

Role:

- Executes queued form-testing scenarios.
- Queue lives in Supabase PostgreSQL, not the V3 scan database.
- Uses Playwright.
- Stores artifacts in Supabase Storage or local artifact volume depending on deployment.

Important environment variables from compose:

```text
FORM_EXECUTOR_DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
FORM_EXECUTOR_ARTIFACT_BUCKET
FORM_EXECUTOR_CONCURRENCY
FORM_EXECUTOR_ARTIFACT_RETENTION_DAYS
FORM_EXECUTOR_ARTIFACT_CLEANUP_INTERVAL_SECONDS
FORM_EXECUTOR_POLL_INTERVAL
FORM_EXECUTOR_TIMEOUT_MS
FORM_EXECUTOR_TIMEOUT_MAX_MS
FORM_EXECUTOR_NODE_TIMEOUT_MS
FORM_EXECUTOR_NAVIGATION_TIMEOUT_MS
FORM_EXECUTOR_SETTLE_MS
FORM_EXECUTOR_HEADLESS
CHROME_NO_SANDBOX
FORM_EXECUTOR_2CAPTCHA_API_KEY
FORM_EXECUTOR_CAPTCHA_TIMEOUT_S
FORM_EXECUTOR_CAPTCHA_POLL_INTERVAL_S
```

Run with Docker Compose:

```bash
cd V3-Microservices
docker compose --profile form-tester up -d v3-form-executor
```

Tests:

```bash
cd V3-Microservices/v3-form-executor
python -m pytest tests/ -v
```

### 6.7 v3-cli

Location:

```text
V3-Microservices/v3-cli/
```

Runtime:

```text
Go
Cobra / Bubbletea according to project docs
```

Commands documented in repo:

```bash
v3-cli scan --url https://example.com --max-pages 50
v3-cli monitor
v3-cli build
v3-cli deploy
```

---

## 7. V3 PostgreSQL Schema

Database:

```text
snapflow_v3
```

Schema bootstrap:

```text
V3-Microservices/db/init.sql
```

Core tables documented in project analysis:

### 7.1 `scan_pages`

Purpose:

- Stores crawled page data.
- One row per scan/page URL.
- Used by scanner, NLP worker, and aggregator.

Key columns:

```text
id
scan_id
domain
url
html
raw_html
rendered_html
metrics
nlp_results
created_at
```

Important index:

```sql
CREATE INDEX IF NOT EXISTS idx_nlp_pending
    ON scan_pages (id) WHERE nlp_results IS NULL;
```

### 7.2 `scan_summaries`

Purpose:

- Stores domain-level scanner summary data.

Key columns:

```text
scan_id
domain
domain_security
domain_tech
domain_privacy
domain_functional
image_compression
broken_links_summary
seo_kpi_extended
form_fuzzer_summary
scan_telemetry
created_at
```

### 7.3 `form_fuzz_results`

Purpose:

- Stores per-form fuzzing/test records created by scanner form fuzzing.

Key columns:

```text
scan_id
page_url
action_url
form_id
test_type
payload
response_type
status_code
anomaly
anomaly_reason
duration_ms
error
created_at
```

### 7.4 `scan_kpi_outputs`

Purpose:

- Stores canonical KPI output from aggregator.

Key columns:

```text
scan_id
scan_url
kpi_json
top_level_kpis
quality_drift_artifact
updated_at
```

### 7.5 `scan_state`

Purpose:

- Stores scan lifecycle state JSON.

Key columns:

```text
scan_id
state_json
updated_at
```

### 7.6 `visual_screenshots`

Purpose:

- Stores screenshots captured by visual regression.

Key columns:

```text
scan_id
url
screenshot
created_at
```

---

## 8. KPI Contract

The KPI report is the stable contract between backend and frontend.

Every KPI is normalized to a 9-field object:

```json
{
  "constat": "French-language finding statement",
  "info": "technical information or summary",
  "impact": "business/user impact",
  "pages_affected": 0,
  "pages_affected_urls": ["https://example.com/page"],
  "status": "passing | failing | warning | not_available",
  "type": "bug | recommendation | compliance",
  "severity": "critical | high | medium | low | null",
  "data": {}
}
```

Rules:

- Passing KPI: `severity` must be `null`.
- Failing or warning KPI: `severity` must be set.
- Missing evidence should not become a fake pass.
- Quality score is clamped to `[0, 100]`.
- Passing KPIs must not display risk wording in frontend.

Audit axes:

| Axis | Meaning |
|---|---|
| `TECHNIQUE` | Technical/CMS/server |
| `SECURITY` | Security |
| `FONCTIONNEL` | Functional |
| `PERFORMANCE` | Performance |
| `SEO` | SEO |
| `UX_UI` | UX/UI |
| `CONTENU` | Content |
| `RGPD` | GDPR/RGPD compliance |
| `ECO_INDEX` | Ecological impact |

---

## 9. Front-Snap Frontend

Location:

```text
Front-Snap/
```

Runtime:

```text
React 18
Vite 5
TypeScript
Tailwind CSS
Supabase JS
TanStack Query
React Router
@react-pdf/renderer
```

Package scripts:

```bash
npm run dev
npm run build
npm run build:dev
npm run lint
npm run preview
npm test
npm run test:watch
npm run check:mojibake
npm run logo:sites
```

Local frontend run:

```bash
cd Front-Snap
npm install
npm run dev
```

Production build:

```bash
cd Front-Snap
npm run build
```

Tests:

```bash
cd Front-Snap
npm test
```

Type check:

```bash
cd Front-Snap
npx tsc --noEmit
```

Mojibake check:

```bash
cd Front-Snap
npm run check:mojibake
```

Main frontend areas documented in the repo:

- authentication
- overview dashboard
- projects
- audit report viewer
- activity reports
- scheduled reports
- notifications
- assistant
- form tester workflows
- user administration

---

## 10. Supabase

Supabase is used for:

- Auth
- user roles
- projects
- audit metadata and report storage
- activity reports
- schedules
- notifications
- Redmine account/project cache
- form workflow storage/queueing
- Edge Functions

Tables listed in project docs include:

```text
projects
audits
project_assignments
profiles
user_roles
activity_reports
notifications
report_schedules
trial_usage
redmine_account_cache
```

Additional form tester tables are evidenced by function names and code paths, but the exact table list should be verified from migrations before documenting as schema-level truth.

### 10.1 Local Supabase

Documented local command:

```bash
cd Front-Snap
./scripts/local-supabase-preprod.sh
```

Documented local services:

```text
Supabase Studio: http://localhost:54323
PostgreSQL:      localhost:54322
API:             http://localhost:54321
Inbucket:        http://localhost:54324
```

Seed local admin:

```bash
cd Front-Snap
node scripts/seed-local-admin.mjs
```

Deploy edge functions:

```bash
cd Front-Snap
supabase functions deploy fetch-audit-api
supabase functions deploy poll-audit-job
supabase functions deploy fetch-redmine
```

Set audit API secrets:

```bash
cd Front-Snap
supabase secrets set SCANNER_BASE_URL=https://your-aggregator-url.example
```

Set Redmine secret:

```bash
cd Front-Snap
supabase secrets set REDMINE_API_KEY=your-redmine-api-key
```

Set form tester AI secrets for OpenAI-compatible mode:

```bash
cd Front-Snap
supabase secrets set FORM_TESTER_AI_PROVIDER=openai_compatible
supabase secrets set FORM_TESTER_AI_API_KEY=your-provider-key
supabase secrets set FORM_TESTER_AI_BASE_URL=https://your-provider.example/v1/chat/completions
supabase secrets set FORM_TESTER_AI_MODEL=flash-v4
```

Set form tester AI secrets for Gemini mode:

```bash
cd Front-Snap
supabase secrets set GEMINI_API_KEY=your-gemini-key
supabase secrets set FORM_TESTER_GEMINI_MODEL=gemini-2.0-flash
```

Apply migrations:

```bash
cd Front-Snap
supabase db push
```

---

## 11. Docker Compose Local Backend Stack

Compose file:

```text
V3-Microservices/docker-compose.yml
```

Services evidenced in compose:

| Service | Purpose | Port |
|---|---|---|
| `db` | PostgreSQL 16 | 5432 |
| `scanner` | Go scanner | 8081 |
| `nlp-worker` | NLP worker | none |
| `aggregator` | API gateway | 8080 |
| `v3-browser-pool` | Playwright pool | 8084 |
| `v3-form-executor` | Form execution worker | 8085 |
| `obscura` | Optional stealth browser profile | no host port evidenced |
| `v3-visual-regression` | Visual regression API | 8083 |

PowerShell launcher:

```powershell
cd V3-Microservices
.\run.ps1
```

PowerShell launcher options:

```powershell
.\run.ps1 -NoCacheBuild
.\run.ps1 -Down
.\run.ps1 -RebuildBase
.\run.ps1 -NoObscura
```

Bash launcher documented in project docs:

```bash
cd V3-Microservices
./run.sh
./run.sh --down --no-cache
./run.sh --local
./run.sh --no-obscura
./run.sh --rebuild-base --no-cache
```

Manual Compose commands:

```bash
cd V3-Microservices
docker compose up -d
docker compose ps
docker compose logs -f aggregator
docker compose logs -f scanner
docker compose logs -f nlp-worker
```

Start form executor profile:

```bash
cd V3-Microservices
docker compose --profile form-tester up -d v3-form-executor
```

Health checks:

```bash
curl -s http://localhost:8080/health | jq
curl -s http://localhost:8081/health | jq
curl -s http://localhost:8083/health | jq
curl -s http://localhost:8084/health | jq
curl -s http://localhost:8085/health | jq
```

Sync scan smoke test:

```bash
curl -s -X POST http://localhost:8080/scan/sync \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","max_pages":5,"headless_concurrency":2}' | jq
```

Async scan smoke test:

```bash
SCAN_ID=$(curl -s -X POST http://localhost:8080/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","max_pages":5,"headless_concurrency":2}' | jq -r '.scan_id')

curl -s "http://localhost:8080/scan/${SCAN_ID}/status" | jq
curl -s "http://localhost:8080/scan/${SCAN_ID}/kpis/top" | jq
```

Connect to V3 PostgreSQL:

```bash
docker exec -it v3-microservices-db-1 psql -U snapflow -d snapflow_v3
```

Useful queries:

```sql
SELECT scan_id, state_json, updated_at
FROM scan_state
ORDER BY updated_at DESC
LIMIT 5;

SELECT scan_id, COUNT(*)
FROM scan_pages
GROUP BY scan_id
ORDER BY COUNT(*) DESC;

SELECT scan_id, COUNT(*)
FROM scan_pages
WHERE nlp_results IS NULL
GROUP BY scan_id;

SELECT scan_id, kpi_json->'top_level_kpis'->>'health_status'
FROM scan_kpi_outputs
ORDER BY updated_at DESC
LIMIT 5;
```

---

## 12. Kubernetes / k3s Deployment

Location:

```text
k8s/
```

Deployment target documented in repo:

```text
single-node k3s pre-prod
```

Namespaces:

```text
snapflow-infra
snapflow-prod
```

Infra components:

- PostgreSQL
- PgBouncer
- Redis

Application services:

- browserless
- scanner
- aggregator
- nlp-worker
- visual-regression
- frontend

No `v3-form-executor` Kubernetes service was listed in `k8s/02-services` during local inspection. It exists in Docker Compose. Kubernetes deployment for form executor is therefore:

```text
Not evidenced in repository.
```

### 12.1 First Deployment Script

Script:

```text
k8s/scripts/00-first-deploy.sh
```

Check prerequisites:

```bash
cd k8s/scripts
./00-first-deploy.sh --check-only
```

Execute full deployment:

```bash
cd k8s/scripts
TAG=latest ./00-first-deploy.sh --execute
```

The script validates:

- `bash`
- `kubectl`
- `docker`
- `helm`
- required script files
- `V3-Microservices/db/init.sql`
- `k8s/01-infra/postgres/secret.yaml`
- `k8s/07-secrets/snapflow-secrets.yaml`
- shell script syntax
- placeholder secrets

Then, in execute mode, it runs:

```bash
01-bootstrap-node.sh
02-install-k3s-server.sh
03-install-operators.sh
07-build-and-import-images.sh
04-apply-manifests.sh
05-run-migrations.sh
06-smoke-test.sh
```

### 12.2 Secrets

Required secret files:

```text
k8s/01-infra/postgres/secret.yaml
k8s/07-secrets/snapflow-secrets.yaml
```

If `snapflow-secrets.yaml` is missing, `00-first-deploy.sh` copies it from:

```text
k8s/07-secrets/snapflow-secrets.yaml.example
```

Then you must replace placeholders before deployment.

### 12.3 Build And Import Images

Script:

```text
k8s/scripts/07-build-and-import-images.sh
```

Run:

```bash
cd k8s/scripts
TAG=latest ./07-build-and-import-images.sh
```

Images built:

```text
snapflow/v3-scanner-go:${TAG}
snapflow/v3-aggregator:${TAG}
snapflow/v3-nlp-worker:${TAG}
snapflow/v3-visual-regression:${TAG}
snapflow/v3-frontend:${TAG}
```

Frontend build args used by the script:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Images are imported into k3s containerd using:

```bash
docker save ... | sudo k3s ctr images import -
```

### 12.4 Applying Manifests

Script:

```text
k8s/scripts/04-apply-manifests.sh
```

Run:

```bash
cd k8s/scripts
./04-apply-manifests.sh
```

Apply order:

1. Bootstrap namespaces.
2. PostgreSQL secret.
3. App secrets.
4. PostgreSQL configmap/statefulset/service.
5. Redis PVC/deployment/service.
6. PgBouncer configmap/deployment/service.
7. Wait for infra readiness.
8. Browserless.
9. Scanner.
10. Aggregator.
11. NLP worker.
12. Visual regression.
13. Frontend.
14. Autoscaling.
15. Resilience.
16. Monitoring.

Important note from the script:

```text
Networking manifests were not applied by default (no-ingress mode).
Apply manually later from k8s/04-networking.
```

Apply networking manually when ready:

```bash
kubectl apply -f k8s/04-networking
```

### 12.5 Smoke Test

Script:

```text
k8s/scripts/06-smoke-test.sh
```

Run:

```bash
cd k8s/scripts
./06-smoke-test.sh
```

It checks:

```bash
kubectl get pods -n snapflow-infra
kubectl get pods -n snapflow-prod
kubectl get hpa -n snapflow-prod
kubectl get scaledobjects -n snapflow-prod
kubectl exec -n snapflow-prod deploy/browserless -- curl -s http://localhost:3000/health
```

Aggregator in-cluster health:

```bash
kubectl run curl-test --image=curlimages/curl:8.10.1 --restart=Never -n snapflow-prod --rm -i -- \
  curl -fsS http://v3-aggregator.snapflow-prod.svc.cluster.local/health
```

Port-forward hint:

```bash
kubectl port-forward svc/v3-aggregator -n snapflow-prod 8080:80
curl -s http://127.0.0.1:8080/health
```

End-to-end API test hint:

```bash
curl -s -X POST http://127.0.0.1:8080/scan \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","max_pages":20,"headless_concurrency":2}'
```

---

## 13. CI/CD

The existing workflows live in:

```text
../.github/workflows/
```

The current strategy is split into several workflows:

| Workflow | File | Purpose |
|---|---|---|
| SnapFlow CI | `ci.yml` | Main test/build pipeline |
| SnapFlow Security | `security.yml` | Secrets, CodeQL, dependency audit, Trivy filesystem |
| SnapFlow Containers | `containers.yml` | Docker image build and Trivy image scan |
| SnapFlow Manifests | `manifests.yml` | Kubernetes/config/script validation |
| SnapFlow Nightly Deep | `nightly-deep.yml` | deeper scheduled tests/scans |

### 13.1 SnapFlow CI

Workflow:

```text
../.github/workflows/ci.yml
```

Manual inputs:

```text
scope = full | frontend | backend | quick
run_security = true | false
run_build = true | false
```

Triggers:

- manual dispatch
- pull requests
- pushes to `main`, `master`, `develop`

Pinned runtime versions in workflow:

```text
NODE_VERSION=24
PYTHON_VERSION=3.11
GO_VERSION=1.25.8
```

Main stages evidenced:

- Detect changed areas.
- Frontend smoke:
  - `npm ci`
  - `npx tsc --noEmit`
  - `npm run lint` with `continue-on-error`
  - `npm run build`
- Frontend grouped tests:
  - audit/reporting tests
  - form workflow tests
  - project sync tests
- Full frontend Vitest for full scope.
- Go tests.
- Python tests.
- Lightweight security checks.
- Pipeline summary.

Run manually:

```bash
gh workflow run "SnapFlow CI" -f scope=full -f run_security=true -f run_build=true
```

### 13.2 SnapFlow Security

Workflow:

```text
../.github/workflows/security.yml
```

Manual input:

```text
fail_on_severity=HIGH,CRITICAL
```

Triggers:

- manual dispatch
- nightly schedule
- pull requests touching code/dependency/security files
- pushes to `main`, `master`, `develop`

Jobs:

- Gitleaks secrets scan.
- CodeQL for JavaScript/TypeScript, Python, Go.
- dependency audit:
  - frontend npm: `npm audit --audit-level=high`
  - Python services: `pip-audit`
  - Go services: `govulncheck`
- Trivy filesystem scan:
  - pinned image `aquasec/trivy:0.72.0`
  - table output in logs
  - SARIF artifact
  - JSON artifact
  - step summary table

Run:

```bash
gh workflow run "SnapFlow Security" -f fail_on_severity=HIGH,CRITICAL
```

### 13.3 SnapFlow Containers

Workflow:

```text
../.github/workflows/containers.yml
```

Manual input:

```text
image = all | frontend | scanner | aggregator | nlp-worker | visual-regression | form-executor | browser-pool
```

Triggers:

- manual dispatch
- nightly schedule
- pull requests touching Docker/dependency files
- pushes to `main`, `master`, `develop`

Jobs:

- Detect image changes.
- Build needed base images.
- Build selected images.
- Run Trivy image scan with:
  - pinned image `aquasec/trivy:0.72.0`
  - table output
  - SARIF artifact
  - JSON artifact
  - step summary table

Run all image scans:

```bash
gh workflow run "SnapFlow Containers" -f image=all
```

Run one image scan:

```bash
gh workflow run "SnapFlow Containers" -f image=frontend
gh workflow run "SnapFlow Containers" -f image=scanner
gh workflow run "SnapFlow Containers" -f image=aggregator
```

### 13.4 SnapFlow Manifests

Workflow:

```text
../.github/workflows/manifests.yml
```

Triggers:

- manual dispatch
- nightly schedule
- pull requests touching manifests/scripts/compose
- pushes to `main`, `master`, `develop`

Jobs:

- Kubernetes schema validation with `kubeconform`.
- Trivy config scan over `SnapFlow/k8s` and `SnapFlow/V3-Microservices`.
- Bash syntax validation for all `.sh` files.
- PowerShell syntax validation for all `.ps1` files.

Run:

```bash
gh workflow run "SnapFlow Manifests"
```

### 13.5 SnapFlow Nightly Deep

Workflow:

```text
../.github/workflows/nightly-deep.yml
```

Manual input:

```text
run_dast=true|false
```

Jobs:

- Full frontend suite:
  - `npm ci`
  - `npx tsc --noEmit`
  - `npm run lint` warning-only
  - `npm test`
  - `npm run build`
- Live project sync integration with Supabase test secrets.
- Full container scan for all images.
- Optional OWASP ZAP baseline against frontend preview.

Run:

```bash
gh workflow run "SnapFlow Nightly Deep" -f run_dast=false
```

---

## 14. Trivy Remediation Workflow

Reference:

```text
CI_CD_TRIVY_REMEDIATION.md
```

Find failed security runs:

```bash
gh run list --workflow "SnapFlow Security"
gh run list --workflow "SnapFlow Containers"
gh run list --workflow "SnapFlow Manifests"
```

Inspect failed logs:

```bash
gh run view <run-id> --log-failed
```

Download artifacts:

```bash
gh run download <run-id>
```

Rerun workflow:

```bash
gh workflow run "SnapFlow Security" -f fail_on_severity=HIGH,CRITICAL
gh workflow run "SnapFlow Containers" -f image=all
gh workflow run "SnapFlow Manifests"
```

Safe remediation policy:

- Docker: bump base images within same major/minor where possible.
- npm: patch/minor updates only.
- Python: patch/minor requirement bumps only.
- Go: patch/minor module bumps only.
- `.trivyignore`: only for verified false positives or accepted risk.
- No API, UI, schema, deployment behavior, or runtime logic changes for Trivy-only remediation.

For `.trivyignore`, include:

```text
CVE ID
affected path or image
reason
review/expiry note
owner if known
```

---

## 15. Scheduled Reports And Cron-Like Operations

The `execute-scheduled-reports` function supports scheduled report types evidenced in code:

```text
audit
activity
mystery_visit
```

Frequency values evidenced:

```text
once
daily
weekly
biweekly
monthly
```

For activity reports, the scheduled function:

- loads project data
- extracts Redmine identifier from `redmine_url || url`
- calls `fetch-redmine`
- saves report snapshot into `activity_reports`
- logs issue count

The exact deployment trigger mechanism for scheduled Supabase Edge Functions should be confirmed from Supabase config/migrations if needed.

---

## 16. Operational Runbooks

### 16.1 Start Local Frontend Against Local Supabase

```bash
cd Front-Snap
./scripts/local-supabase-preprod.sh
node scripts/seed-local-admin.mjs
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

### 16.2 Start Local V3 Backend Stack

PowerShell:

```powershell
cd V3-Microservices
.\run.ps1
```

Bash:

```bash
cd V3-Microservices
./run.sh
```

### 16.3 Start Backend With Clean Rebuild

PowerShell:

```powershell
cd V3-Microservices
.\run.ps1 -Down -NoCacheBuild
```

Bash:

```bash
cd V3-Microservices
./run.sh --down --no-cache
```

### 16.4 Check Backend Health

```bash
curl -s http://localhost:8080/health | jq
curl -s http://localhost:8081/health | jq
curl -s http://localhost:8083/health | jq
curl -s http://localhost:8084/health | jq
```

### 16.5 Run Full Frontend Validation Locally

```bash
cd Front-Snap
npm ci
npx tsc --noEmit
npm test
npm run build
npm run check:mojibake
```

### 16.6 Run Backend Tests Locally

Aggregator:

```bash
cd V3-Microservices/v3-aggregator
python -m pytest tests -q
```

NLP worker:

```bash
cd V3-Microservices/v3-nlp-worker
python -m pytest tests -q
```

Scanner:

```bash
cd V3-Microservices/v3-scanner-go
go test ./...
```

Visual regression:

```bash
cd V3-Microservices/v3-visual-regression
python -m pytest tests/ -v
```

Form executor:

```bash
cd V3-Microservices/v3-form-executor
python -m pytest tests/ -v
```

### 16.7 Deploy To k3s Pre-Production

```bash
cd k8s/scripts
./00-first-deploy.sh --check-only
TAG=latest ./00-first-deploy.sh --execute
```

If networking/ingress should be enabled:

```bash
kubectl apply -f ../04-networking
```

### 16.8 Verify k3s Deployment

```bash
cd k8s/scripts
./06-smoke-test.sh
```

Manual:

```bash
kubectl get pods -n snapflow-infra
kubectl get pods -n snapflow-prod
kubectl get hpa -n snapflow-prod
kubectl get scaledobjects -n snapflow-prod
```

### 16.9 Debug Aggregator In Kubernetes

```bash
kubectl logs -n snapflow-prod deploy/v3-aggregator --tail=200
kubectl port-forward svc/v3-aggregator -n snapflow-prod 8080:80
curl -s http://127.0.0.1:8080/health
```

### 16.10 Debug Scanner In Docker Compose

```bash
cd V3-Microservices
docker compose ps
docker compose logs --tail=200 scanner
docker compose logs --tail=200 aggregator
docker compose logs --tail=200 v3-browser-pool
```

### 16.11 Debug Redmine Fetching

Checklist:

1. Confirm project has `redmine_url` or URL with `/projects/<identifier>`.
2. Confirm Supabase secret:

```bash
cd Front-Snap
supabase secrets set REDMINE_API_KEY=your-redmine-api-key
```

3. Confirm user is authenticated; `fetch-redmine` rejects unauthenticated calls except constrained service-role cron paths.
4. Confirm Redmine issue status/tracker filters are not excluding everything.
5. Confirm `fetchAllIssuesPaginated` is not stopped by duplicate issue IDs or empty pages.

### 16.12 Debug Activity PDF Export

Known classes of failure from recent work:

- React PDF error: invalid string child outside `<Text>`.
- React PDF error: invalid border width.
- Missing Dialog description warning from Radix is an accessibility warning, not necessarily the PDF-blocking error.

Local validation:

```bash
cd Front-Snap
npm test -- activityPdf
npx tsc --noEmit
npm run build
```

If export fails in browser:

1. Open browser console.
2. Look for logs from `PdfExportModal` and `ActivityDocument`.
3. Capture the exact exception message.
4. Check whether the failing style value is `undefined`, especially `borderWidth`, `borderTopWidth`, `borderRightWidth`, `borderBottomWidth`, or `borderLeftWidth`.
5. Check for empty-string children directly inside non-`Text` React-PDF components.

---

## 17. Security And Secrets

Secrets evidenced:

```text
REDMINE_API_KEY
SCANNER_BASE_URL
AUDIT_API_URL
SCANNER_ASYNC_TIMEOUT_MS
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
FORM_TESTER_AI_PROVIDER
FORM_TESTER_AI_API_KEY
FORM_TESTER_AI_BASE_URL
FORM_TESTER_AI_MODEL
GEMINI_API_KEY
FORM_TESTER_GEMINI_MODEL
FORM_EXECUTOR_DATABASE_URL
FORM_EXECUTOR_SUPABASE_URL
FORM_EXECUTOR_ARTIFACT_BUCKET
FORM_EXECUTOR_2CAPTCHA_API_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SNAPFLOW_SUPABASE_URL
SNAPFLOW_SUPABASE_PUBLISHABLE_KEY
SNAPFLOW_TEST_USER_EMAIL
SNAPFLOW_TEST_USER_PASSWORD
```

Do not commit real secrets into:

```text
k8s/07-secrets/snapflow-secrets.yaml
k8s/01-infra/postgres/secret.yaml
.env
Supabase config files
```

Use:

```bash
supabase secrets set KEY=value
```

or Kubernetes Secrets for cluster runtime.

---

## 18. What Data Comes From Where

### 18.1 Data Entered In SnapFlow

Evidenced categories:

- project site name
- project URL
- Redmine URL
- logo URL
- user roles
- report schedules
- audit records
- activity report snapshots
- perimeter blocks
- form workflow definitions
- form workflow schedules

Exact Supabase schema should be verified from migrations before publishing a database reference table.

### 18.2 Data Pulled From Client Website

Pulled by scanner/browser services:

- page HTML
- rendered HTML
- forms
- links
- buttons/features/search signals
- security headers
- cookies
- SSL information
- robots/sitemap
- performance metrics
- mobile metrics
- screenshots
- visual regression artifacts
- image/compression signals

### 18.3 Data Pulled From Redmine

Pulled by `fetch-redmine`:

- projects
- users
- issues
- issue statuses
- trackers
- project detail
- documents
- issue details

Issue fields consumed by frontend:

- ID
- subject
- description
- status
- tracker/type
- priority
- assigned person
- author
- created date
- updated date
- done ratio
- estimated hours
- spent hours

### 18.4 Data Created By SnapFlow

Created by application logic:

- audit report records
- generated KPI outputs
- recommendations
- quality/drift artifacts
- PDF exports
- activity report snapshots
- notifications
- form workflow execution results
- form test artifacts

---

## 19. Known Gaps And Questions For You

These are not safe to claim without your confirmation or additional repository evidence.

1. Production domain names for frontend/API ingress.
   - Not evidenced in repository.

2. Exact production Supabase project reference.
   - Not evidenced in repository.

3. Whether Redmine base URL should remain hardcoded to `https://maintenance.medianet.tn` or become configurable.
   - Current code hardcodes it.

4. Whether Kubernetes should include `v3-form-executor`.
   - Docker Compose includes it; `k8s/02-services` did not show a form executor deployment.

5. Exact report distribution model for external clients.
   - Reports exist; exact client access policy should be verified.

6. Whether Redis is intentionally reserved for future use or actively used elsewhere.
   - It is deployed in k8s, but active runtime use was not evidenced in the inspected files.

7. Exact Supabase table schema for all form tester tables.
   - Function names prove the feature; schema should be confirmed from migrations before documenting columns.

8. Production deployment promotion flow after CI.
   - Current evidence shows CI/security/build validation, not an automated production deploy pipeline.

---

## 20. Minimum Command Cheat Sheet

Frontend:

```bash
cd Front-Snap
npm ci
npx tsc --noEmit
npm test
npm run build
npm run dev
```

Local Supabase:

```bash
cd Front-Snap
./scripts/local-supabase-preprod.sh
node scripts/seed-local-admin.mjs
```

Supabase secrets:

```bash
cd Front-Snap
supabase secrets set SCANNER_BASE_URL=https://your-aggregator-url.example
supabase secrets set REDMINE_API_KEY=your-redmine-key
supabase secrets set FORM_TESTER_AI_PROVIDER=openai_compatible
supabase secrets set FORM_TESTER_AI_API_KEY=your-ai-key
supabase secrets set FORM_TESTER_AI_BASE_URL=https://your-provider.example/v1/chat/completions
supabase secrets set FORM_TESTER_AI_MODEL=flash-v4
```

Backend stack:

```bash
cd V3-Microservices
./run.sh
docker compose ps
```

PowerShell backend stack:

```powershell
cd V3-Microservices
.\run.ps1
```

Backend health:

```bash
curl -s http://localhost:8080/health | jq
curl -s http://localhost:8081/health | jq
curl -s http://localhost:8083/health | jq
curl -s http://localhost:8084/health | jq
```

k3s deploy:

```bash
cd k8s/scripts
./00-first-deploy.sh --check-only
TAG=latest ./00-first-deploy.sh --execute
./06-smoke-test.sh
```

GitHub Actions:

```bash
gh workflow run "SnapFlow CI" -f scope=full -f run_security=true -f run_build=true
gh workflow run "SnapFlow Security" -f fail_on_severity=HIGH,CRITICAL
gh workflow run "SnapFlow Containers" -f image=all
gh workflow run "SnapFlow Manifests"
gh workflow run "SnapFlow Nightly Deep" -f run_dast=false
```

Inspect failed CI:

```bash
gh run list --workflow "SnapFlow Security"
gh run view <run-id> --log-failed
gh run download <run-id>
```

---

## 21. Maintenance Principles

1. Respect service ownership.
   - Scanner writes crawl data.
   - NLP writes NLP results.
   - Aggregator writes KPI outputs and scan state.
   - Visual regression writes screenshot/visual artifacts.
   - Supabase owns product/user/project/report metadata.

2. Keep KPI contract stable.
   - Do not break the 9-field KPI object.
   - Do not invert `passing` semantics.
   - Do not display risk wording for passing KPIs.

3. Keep Redmine data factual.
   - Use real ticket IDs, subjects, statuses, trackers, priorities, and dates.
   - Do not hardcode manual-report ticket examples.

4. Keep activity perimeter dynamic.
   - Render perimeter only when configured and ready.
   - Omit it when incomplete.

5. Keep CI security fixes low-risk.
   - Patch/minor dependency updates only unless separately reviewed.
   - Use `.trivyignore` only with reason and expiry/review note.

6. Keep docs honest.
   - If the repo does not prove it, mark it as unknown or ask for confirmation.

---

*End of SnapFlow full operations guide.*
