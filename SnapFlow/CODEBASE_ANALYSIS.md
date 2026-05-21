# SnapFlow Codebase Analysis - Validated Snapshot

**Date**: May 14, 2026  
**Scope**: Front-Snap, V3-Microservices, k8s  
**Status**: Aligned with current code and AGENTS.md

This document replaces the older analysis that still described stale routes, a single-database architecture, and no browser-pool service. The current codebase uses a dual-database model, a dedicated shared browser pool, and the canonical KPI API lives under `/scan/{scan_id}/kpis*`.

---

## 1. Frontend (Front-Snap)

### Purpose
React SPA for project management, audit launch, audit viewing, report export, schedules, notifications, assistant, and form workflows.

### Tech Stack
- React 18.3.1
- TypeScript 5.8.3
- Vite 5.4.19
- Tailwind CSS 3.4.17
- React Router DOM 6.30.1
- TanStack React Query 5.83.0
- Supabase JS 2.97.0
- @react-pdf/renderer 4.3.2
- Vitest 3.2.4 + jsdom 20.0.3

### Route Map

The router is defined in [Front-Snap/src/App.tsx](Front-Snap/src/App.tsx).

| Route | Purpose |
|---|---|
| `/` | Redirects to `/auth` |
| `/auth` | Authentication page |
| `/app` | Authenticated shell + overview |
| `/app/projects` | Project list |
| `/app/projects/:id` | Project shell |
| `/app/projects/:id/audits` | Project audit list |
| `/app/projects/:id/activity` | Redmine activity |
| `/app/reports` | Completed audits |
| `/app/schedules` | Report schedules |
| `/app/notifications` | Notifications |
| `/app/assistant` | AI assistant |
| `/app/workflows` | Workflow builder |
| `/app/workflows/form-tester` | Form tester |
| `/app/workflows/form-tester/:id` | Form tester builder |
| `/app/workflows/form-tester/:id/results` | Form tester results |
| `/app/users` | User admin |
| `/audit/:id` | Audit report viewer |
| `/audit/:id/view` | Audit report viewer alias |

Legacy routes redirect to the new layout, including `/dashboard`, `/admin`, `/admin/projects`, `/admin/users`, `/admin/schedules`, and `/schedules`.

### Core Frontend Contracts
- `src/lib/auditMapper.ts` normalizes API audit payloads, axis aliases, and passing KPI display rules.
- Passing KPIs must not show risk wording in the UI; the mapper strips that framing for passing findings.
- `src/lib/normalizeAuditReport.ts` validates and normalizes report payloads before rendering.
- `src/lib/generateAuditPdf.tsx` renders the audit PDF via `@react-pdf/renderer`.
- `src/hooks/useAsyncAuditPoll.ts` polls audit progress.
- `src/hooks/useRealtimeNotifications.ts` listens to Supabase realtime updates.

### Frontend Data Access
The frontend talks directly to Supabase for:
- `projects`
- `audits`
- `project_assignments`
- `profiles`
- `user_roles`
- `activity_reports`
- `notifications`
- `report_schedules`
- `trial_usage`
- `redmine_account_cache`

---

## 2. Backend Microservices

### Service Overview

| Service | Language | Port | Responsibility |
|---|---|---:|---|
| `v3-aggregator` | Python / FastAPI | 8080 | Orchestration, scan lifecycle, KPI building, recommendations, drift artifacts |
| `v3-scanner-go` | Go | 8081 | Crawling, static analyzers, headless sampling, form discovery/fuzzing |
| `v3-nlp-worker` | Python | none | Polls pending pages and writes NLP enrichment |
| `v3-visual-regression` | Python / FastAPI | 8083 | Screenshots, visual diffing, UX KPIs, browser-pool fallback |
| `v3-browser-pool` | Python / FastAPI | 8084 | Shared Playwright Chromium runtime |
| `v3-cli` | Go | none | Local developer CLI for build, monitor, deploy, scan |

### Scanner Responsibilities
The Go scanner writes crawl and analyzer data to the VPS database. It does not own final KPI aggregation.

### Aggregator Responsibilities
The aggregator owns the canonical KPI payload, top-level KPI summary, quality/drift artifact, and scan state persistence.

### NLP Worker Responsibilities
The NLP worker only processes rows where `scan_pages.nlp_results IS NULL` and writes the enriched NLP JSON back to the same row.

### Visual Regression Responsibilities
The visual regression service captures screenshots, stores them in `visual_screenshots`, and can use the shared browser pool when configured.

---

## 3. Browser Pool

The browser pool is a real service in the current codebase, not just a deployment note.

### Service Contract

Location: [V3-Microservices/v3-browser-pool/main.py](V3-Microservices/v3-browser-pool/main.py)

Endpoints:
- `GET /health`
- `POST /render`
- `POST /screenshot`
- `POST /batch-screenshot`

The service uses a shared Playwright Chromium pool with bounded concurrency, browser recycling, and per-job timeouts. The pool implementation is in [V3-Microservices/v3-browser-pool/pool.py](V3-Microservices/v3-browser-pool/pool.py).

### Runtime Settings
- `BROWSER_POOL_CONCURRENCY=15`
- `BROWSER_POOL_RECYCLE_AFTER=50`
- `BROWSER_POOL_DEFAULT_TIMEOUT_MS=30000`
- `BROWSER_POOL_ACQUIRE_TIMEOUT_S=8`
- `CHROME_NO_SANDBOX=true` in containerized runs

### Consumers
- The scanner performance analyzer can delegate render/screenshot work to the pool when `BROWSER_POOL_URL` is set and a local Chromium binary is unavailable.
- The visual regression service delegates screenshot capture to the pool when configured, and falls back to local Playwright if the pool is unavailable.

### Important Nuance
The browser pool is not a universal replacement for local Chromium in every path.
- Mobile CWV capture in the scanner still requires a local Chromium-based browser.
- `formbrowser` and `formfuzzer` still require a local Chromium-based browser.

### Environment Variables
- `BROWSER_POOL_URL=http://v3-browser-pool:8084`
- `BROWSER_POOL_TIMEOUT_MS=90000` for the scanner
- `BROWSER_POOL_TIMEOUT_MS=60000` default in the visual-regression client

---

## 4. Database Architecture

The codebase uses two database boundaries.

### Supabase Cloud
Used by the frontend for user-facing app data.

Tables commonly accessed from the frontend:
- `projects`
- `audits`
- `project_assignments`
- `profiles`
- `user_roles`
- `activity_reports`
- `notifications`
- `report_schedules`
- `trial_usage`
- `redmine_account_cache`

### VPS PostgreSQL (`snapflow_v3`)
Used by the microservices for scan execution and audit generation.

#### `scan_pages`
- Page-level crawl data
- Raw HTML, rendered HTML, metrics JSONB, NLP results JSONB
- Owned by the scanner, consumed by the NLP worker and aggregator

#### `scan_summaries`
- Domain-level rollups for security, tech, privacy, functional, image compression, broken links, SEO, and form fuzzing
- Owned by the scanner

#### `form_fuzz_results`
- Detailed form fuzzing records
- Owned by the scanner

#### `scan_kpi_outputs`
- Canonical KPI payload persisted by the aggregator
- Columns: `scan_id`, `scan_url`, `kpi_json`, `top_level_kpis`, `quality_drift_artifact`, `updated_at`

#### `scan_state`
- Aggregator scan lifecycle state persisted for restart resilience

#### `visual_screenshots`
- Screenshot storage owned by the visual regression service

### Ownership Summary
| Data | Owner |
|---|---|
| `scan_pages` | Scanner |
| `scan_pages.nlp_results` | NLP Worker |
| `scan_summaries` | Scanner |
| `form_fuzz_results` | Scanner |
| `scan_kpi_outputs` | Aggregator |
| `scan_state` | Aggregator |
| `visual_screenshots` | Visual Regression |

---

## 5. KPI Framework

### The 9 Audit Axes

The current axis model is the one from `AGENTS.md` and `kpi_builder.py`.

| Axis Slug | French Name |
|---|---|
| `TECHNIQUE` | Audit Technique |
| `SECURITY` | Securite |
| `FONCTIONNEL` | Audit Fonctionnel |
| `PERFORMANCE` | Performance |
| `SEO` | SEO |
| `UX_UI` | UX/UI |
| `CONTENU` | Contenu |
| `RGPD` | RGPD / Conformite |
| `ECO_INDEX` | Eco Index |

### Canonical KPI Schema

Every KPI must normalize to these fields:

```json
{
  "constat": "string",
  "info": "string",
  "impact": "string",
  "pages_affected": 0,
  "pages_affected_urls": ["url1", "url2"],
  "status": "passing | failing | warning | not_available",
  "type": "bug | recommendation | compliance",
  "severity": "critical | high | medium | low | null",
  "data": { "key": "value", "_raw": {} }
}
```

### Validation Rules
- `severity` must be `null` when `status` is `passing`
- `severity` must be set when `status` is `failing` or `warning`
- `pages_affected_urls` is always normalized to a list and deduplicated
- `data._raw` preserves unknown or migration fields

### Gate Behavior
`_normalize_kpi_object()` enforces the VALID / PARTIAL / MISSING gate before a KPI enters the final report.

### Canonical KPI Payload Shape
The aggregator persists a payload shaped like:

```json
{
  "kpi_mode": "new",
  "scan_id": "scan_xxx",
  "domain": "example.com",
  "axes": {},
  "domain_analysis": {},
  "site_metrics": {},
  "summary": {},
  "top_level_kpis": {},
  "quality_drift_artifact": {},
  "generated_at": "ISO8601"
}
```

---

## 6. Aggregator API

Location: [V3-Microservices/v3-aggregator/main.py](V3-Microservices/v3-aggregator/main.py)

### Endpoints
- `GET /health`
- `POST /scan`
- `POST /scan/sync`
- `GET /scan/{scan_id}/status`
- `GET /scan/{scan_id}/result`
- `GET /scan/{scan_id}/recommendations`
- `GET /scan/{scan_id}/kpis`
- `GET /scan/{scan_id}/kpis/top`
- `GET /scan/{scan_id}/kpis/quality`
- `GET /scan/{scan_id}/kpi` alias

### Behavioral Notes
- `/scan` starts asynchronously and returns a `scan_id`.
- `/scan/sync` blocks until the report is ready and returns the final report JSON.
- `/scan/{scan_id}/result` only returns when the scan is complete.
- `/scan/{scan_id}/kpis` is the canonical KPI endpoint and always runs in `kpi_mode: "new"`.
- `/scan/{scan_id}/kpis/top` and `/scan/{scan_id}/kpis/quality` return persisted top-level summary and quality/drift artifacts.

### Persistence
- `scan_state` is updated during lifecycle transitions.
- `scan_kpi_outputs` stores the canonical KPI JSON and drift artifact.

---

## 7. Scanner Pipeline

Location: [V3-Microservices/v3-scanner-go/main.go](V3-Microservices/v3-scanner-go/main.go)

### High-Level Flow
1. Pre-fetch checks: SSL, sitemap, robots, homepage
2. Domain analyzers: tech, security, privacy, functional
3. Colly crawl
4. DB sync and worker drain
5. Cloudflare fallback when crawl yields zero pages
6. Form discovery and fuzzing
7. Headless sampling and execution
8. Cloudflare backfill for seeded pages
9. Mobile performance tests
10. Final aggregation and telemetry persistence

### Outputs
- `scan_pages`
- `scan_summaries`
- `form_fuzz_results`

### Browser Pool Usage
- The performance analyzer can fall back to `v3-browser-pool` when local Chromium is unavailable and `BROWSER_POOL_URL` is set.
- The headless path still keeps a local-browser fallback path, so the pool is optional rather than mandatory.

### Current Caveats
- `formbrowser` and `formfuzzer` still require a local Chromium-based browser.
- Mobile CWV capture still requires local Chromium even when the pool is configured.

---

## 8. NLP Worker

Location: [V3-Microservices/v3-nlp-worker/main.py](V3-Microservices/v3-nlp-worker/main.py)

### Behavior
- Polls `scan_pages` rows where `nlp_results IS NULL`
- Extracts text from HTML with fallbacks
- Computes readability, keyword density, keyword extraction, page typing, date extraction, and RGPD-related signals
- Writes results back to `scan_pages.nlp_results`

### Notes
- The worker is polling-based and does not expose a public HTTP API.
- Optional NLP dependencies degrade gracefully if unavailable.

---

## 9. Visual Regression

Location: [V3-Microservices/v3-visual-regression/main.py](V3-Microservices/v3-visual-regression/main.py)

### Endpoints
- `GET /health`
- `POST /screenshot`
- `POST /compare`
- `POST /ux-kpis`
- `POST /browser-compat`

### Browser Pool Integration
[`V3-Microservices/v3-visual-regression/comparator.py`](V3-Microservices/v3-visual-regression/comparator.py) delegates screenshot capture to the shared browser pool when `BROWSER_POOL_URL` is set. If the pool call fails, it falls back to local Playwright.

### Storage
- Screenshots are stored in `visual_screenshots`

---

## 10. Infrastructure & Deployment

### Docker Compose
The local stack in [V3-Microservices/docker-compose.yml](V3-Microservices/docker-compose.yml) includes:
- PostgreSQL 16
- `v3-scanner-go`
- `v3-nlp-worker`
- `v3-aggregator`
- `v3-browser-pool`
- `v3-visual-regression`

### Key Environment Variables
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`
- `SCANNER_API_URL`
- `VISUAL_REGRESSION_API_URL`
- `BROWSER_POOL_URL`
- `BROWSER_POOL_TIMEOUT_MS`
- `CHROME_NO_SANDBOX`

### k8s Notes
- k3s manifests exist under `k8s/`
- Namespaces are split between infrastructure and production workloads
- The codebase still includes browserless deployment artifacts in k8s, but the current runtime browser-sharing path in code is `v3-browser-pool`

---

## 11. Key Files To Trust

- [Front-Snap/src/App.tsx](Front-Snap/src/App.tsx)
- [Front-Snap/src/lib/auditMapper.ts](Front-Snap/src/lib/auditMapper.ts)
- [V3-Microservices/v3-aggregator/main.py](V3-Microservices/v3-aggregator/main.py)
- [V3-Microservices/v3-aggregator/kpi_builder.py](V3-Microservices/v3-aggregator/kpi_builder.py)
- [V3-Microservices/v3-scanner-go/main.go](V3-Microservices/v3-scanner-go/main.go)
- [V3-Microservices/v3-scanner-go/browserpool/client.go](V3-Microservices/v3-scanner-go/browserpool/client.go)
- [V3-Microservices/v3-browser-pool/main.py](V3-Microservices/v3-browser-pool/main.py)
- [V3-Microservices/v3-browser-pool/pool.py](V3-Microservices/v3-browser-pool/pool.py)
- [V3-Microservices/v3-visual-regression/comparator.py](V3-Microservices/v3-visual-regression/comparator.py)
- [V3-Microservices/db/init.sql](V3-Microservices/db/init.sql)

---

## 12. Validation Summary

This version intentionally corrects the older analysis in the following ways:
- Removes the obsolete third axis and restores the current 9-axis model
- Replaces the old scan route naming with the current `/scan/{scan_id}/...` API
- Adds the missing `v3-browser-pool` service and its integration points
- Replaces the single-database assumption with the current Supabase + VPS PostgreSQL split
- Documents `scan_state`, `scan_kpi_outputs`, and `visual_screenshots`
- Documents the current 9-field KPI contract and normalization gate
