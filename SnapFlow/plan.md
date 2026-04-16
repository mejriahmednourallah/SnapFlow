# SnapFlow V3 KPI Modernization Plan (New-Only)

## Goal
Operate the canonical new KPI pipeline across scanner, NLP worker, and aggregator with production-grade quality/drift monitoring, then close out remaining legacy artifacts safely.

## Current Direction (2026-04-08)
- Canonical KPI API mode is now `new` only.
- Legacy mode branching has been removed from service entrypoints and KPI API response logic.
- Priority output is now the accurate top-level KPI block (`top_level_kpis`).

## Scope
- Scanner: static + runtime evidence, SPA hydration awareness.
- NLP Worker: improved content extraction and robust KPI support.
- Aggregator: canonical status/severity semantics and stable roadmap mapping.
- Governance: measurable quality/drift analysis after cutover.

## Definition of One Monitoring Cycle
Use one complete reporting cycle with production-like traffic:
- Minimum duration: 14 days.
- Minimum volume: 50 scans.
- Minimum diversity: at least 10 SPA-heavy domains and 10 non-SPA domains.

## Migration Principles
1. Keep one canonical API contract (`new`) and avoid reintroducing legacy branching.
2. Favor additive observability artifacts (quality/drift, trend reports) over contract churn.
3. Preserve backward compatibility only for stable endpoint aliases needed by consumers.
4. Every phase must have tests and acceptance criteria.

---

## Phase 0 - Prep and Baseline

### Tasks
- [ ] Create branch: `feature/kpi-dual-run-migration`.
- [ ] Freeze baseline fixtures (real scan snapshots) for scanner, NLP, and aggregator.
- [ ] Document current KPI schema and consumers.
- [x] Add feature flags in each service:
  - `KPI_DUAL_RUN_ENABLED`
  - `KPI_NEW_PATH_ENABLED`
  - `KPI_LEGACY_PATH_ENABLED`

### Files
- `V3-Microservices/v3-scanner-go/main.go`
- `V3-Microservices/v3-nlp-worker/main.py`
- `V3-Microservices/v3-aggregator/main.py`
- `V3-Microservices/v3-aggregator/tests/test_kpi_centric_report.py`

### Acceptance Criteria
- [ ] Baseline tests pass unchanged. (blocked by pre-existing missing fixture file `raw_ec_response.json` in aggregator tests)
- [x] Flags are wired and default to safe mode (legacy on, new off, dual-run off).

### Validation Evidence (Current)
- `v3-scanner-go`: `go test ./...` -> pass (`analyzers/formfuzzer`, `analyzers/performance`; others no test files).
- `v3-nlp-worker`: `pytest -q tests/test_phase_o.py tests/test_phase_l.py` -> 72 passed.
- `v3-aggregator`: `pytest -q tests/test_kpi_migration_flags.py` -> 6 passed.
- `v3-aggregator` runnable subset: 52 passed, 3 deselected, 22 subtests passed.

---

## Phase 1 - Data Model and Persistence for Dual Outputs

### Tasks
- [x] Add separate storage fields for legacy and new KPI payloads in DB (or nested JSON sections).
- [x] Keep raw and rendered HTML side by side (do not overwrite raw with rendered).
- [x] Add schema migration script with backward-compatible defaults. (implemented runtime DDL in aggregator startup for `scan_kpi_outputs`)
- [x] Add read adapters so old consumers keep working. (`/scan/{scan_id}/kpi` alias preserved; new `/scan/{scan_id}/kpis/top` added)

### Execution Update (2026-04-08)
- Added canonical KPI persistence table and upsert/read flow in aggregator:
  - `scan_kpi_outputs.scan_id`
  - `scan_kpi_outputs.kpi_json`
  - `scan_kpi_outputs.top_level_kpis`
- Added top-level KPI extraction from V2 summary and exposed endpoint:
  - `GET /scan/{scan_id}/kpis/top`
- Added scan page raw/rendered persistence split:
  - `scan_pages.raw_html` stores crawler raw response
  - `scan_pages.rendered_html` stores hydrated DOM output
  - NLP worker now prefers `rendered_html` then falls back to `html/raw_html`
- Removed legacy KPI mode branching from:
  - `v3-aggregator/main.py`
  - `v3-nlp-worker/main.py`
  - `v3-scanner-go/main.go`

### Files
- `V3-Microservices/db/init.sql`
- `V3-Microservices/v3-scanner-go/db/db.go`
- `V3-Microservices/v3-aggregator/main.py`

### Acceptance Criteria
- Existing scans still write/read successfully.
- Canonical new KPI payload and top-level KPI block are persisted per scan.

---

## Phase 2 - Scanner Dual Production (Legacy + New Evidence)

### Tasks
- [x] Keep current static scanner outputs unchanged as `legacy` path.
- [x] Add new runtime-aware evidence outputs as `new` path.
- [x] Ensure homepage/domain privacy checks consume runtime artifacts when available.
- [x] Keep headless sampling strategy for performance, but always run runtime probe required for domain privacy confidence.
- [x] Emit evidence provenance: `static`, `runtime`, or `mixed`.

### Files
- `V3-Microservices/v3-scanner-go/main.go`
- `V3-Microservices/v3-scanner-go/analyzers/privacy/privacy.go`
- `V3-Microservices/v3-scanner-go/analyzers/performance/performance.go`
- `V3-Microservices/v3-scanner-go/analyzers/security/security.go`

### Acceptance Criteria
- Scanner output contains two payloads or one payload with two namespaces:
  - `kpis_legacy`
  - `kpis_new`
- 401/403 paths are treated as protected access semantics in new path.

### Execution Update (2026-04-08)
- Scanner page persistence now stores both raw and rendered HTML evidence (`raw_html`, `rendered_html`) without losing crawler raw response.
- Homepage URL is always included in headless sampling, guaranteeing runtime probe availability for domain-level privacy refresh.
- Domain privacy summary is recomputed from rendered homepage HTML when available and persisted back to `scan_summaries`.
- Per-page evidence provenance is emitted in metrics (`static`, `runtime`, `mixed`) and aggregated by aggregator under `site_metrics.seo.evidence_provenance`.
- Validation evidence:
  - `v3-scanner-go`: `go test ./...` -> pass.
  - `v3-aggregator` expanded subset: 50 passed, 21 skipped, 22 subtests passed.

---

## Phase 3 - NLP Dual Production (Legacy + New Extraction)

### Tasks
- [x] Keep current `extract_text` result for legacy KPI calculation.
- [x] Add new extraction path based on main-content-first strategy.
- [x] Use rendered HTML when available for new path.
- [x] Add explicit `not_evaluated` for non-hydrated SPA shell where runtime content is unavailable.
- [x] Compute duplicate-content fingerprints from cleaned main content for new path.

### Files
- `V3-Microservices/v3-nlp-worker/main.py`
- `V3-Microservices/v3-nlp-worker/tests/test_phase_l.py`
- `V3-Microservices/v3-nlp-worker/tests/test_phase_o.py`

### Acceptance Criteria
- NLP worker writes both legacy and new KPI ingredients.
- Thin-content and duplicate-content false positives decrease on calibration fixtures.

### Execution Update (2026-04-08)
- NLP worker now runs `main_content_first` extraction and stores extraction metadata (`selected_source`, `legacy_word_count`, `main_word_count`, `runtime_html_available`).
- Legacy extraction behavior remains available via `extract_text` for backward consistency and drift comparison.
- Non-hydrated SPA shells now persist explicit `status: not_evaluated` payloads instead of ambiguous skip-only payloads.
- Content KPI payload now includes `main_content_fingerprint` (hash + cleaned word count) for duplicate-content confidence.
- Aggregator now excludes NLP pages marked `status=not_evaluated` from thin-content and other NLP quality counters, and exposes `content.nlp_not_evaluated_pages`.
- Validation evidence:
  - `v3-nlp-worker`: `pytest -q tests/test_phase_o.py tests/test_phase_l.py` -> 72 passed.
  - `v3-aggregator` subset: 7 passed, 21 skipped.
  - `v3-scanner-go`: `go test ./...` -> pass.

---

## Phase 4 - Aggregator Canonical Build and Mapping (New-Only)

### Tasks
- [x] Serve canonical KPI tree only in aggregator response (`new` mode).
- [x] Normalize status vocabulary in canonical path (`passing`, `failing`, `warning`, `not_evaluated`).
- [x] Ensure severity is null for `not_evaluated`.
- [x] Remove legacy KPI mode branching from runtime API logic.
- [x] Keep roadmap generation and recommendation flow aligned with canonical status semantics.

### Files
- `V3-Microservices/v3-aggregator/main.py`
- `V3-Microservices/v3-aggregator/tests/test_kpi_migration_flags.py`
- `V3-Microservices/v3-aggregator/tests/test_recommendations_classifier.py`

### Acceptance Criteria
- API returns canonical `new` payload only.
- Existing endpoint aliases required by clients remain functional.

---

## Phase 5 - Quality/Drift Monitoring and Reporting (New-Only)

### Tasks
- [x] Implement per-scan quality/drift artifact in new-only mode:
  - KPI coverage, distribution, and rates
  - quality score, status, and alerts
  - drift deltas against previous scan on same `scan_url`
- [x] Persist quality/drift artifact for each scan.
- [x] Expose persisted artifact via dedicated endpoint: `/scan/{scan_id}/kpis/quality`.
- [ ] Add daily drift report artifact (JSON + Markdown summary).
- [ ] Tag root causes by category: SPA hydration, boilerplate extraction, consent-runtime, security semantics, other.

### Files
- `V3-Microservices/v3-aggregator/main.py`
- `V3-Microservices/v3-aggregator/tests/test_kpi_migration_flags.py`
- `V3-Microservices/db/init.sql`

### Acceptance Criteria
- Per-scan `quality_drift_artifact` is generated and persisted for every canonical KPI build.
- `GET /scan/{scan_id}/kpis/quality` returns the persisted monitoring artifact.
- Daily aggregate report can be reviewed by engineering and product.

### Execution Update (2026-04-08)
- Implemented quality/drift artifact build and persistence in aggregator using `scan_kpi_outputs.quality_drift_artifact`.
- Added previous-scan comparison lookup by `scan_url` and index support for fast retrieval.
- Added contract tests for artifact presence in `/kpis` and dedicated `/kpis/quality` endpoint behavior.
- Validation evidence: `pytest -q tests/test_form_fuzzer_kpi.py tests/test_kpi_migration_flags.py tests/test_recommendations_real_scan_fixture.py tests/test_kpi_centric_report.py` -> pass.
- Remaining work in this phase: daily aggregate rollup/reporting and root-cause categorization pipeline.

---

## Phase 6 - Monitoring Review Gate (End of Cycle)

### Tasks
- [ ] Run end-of-cycle review over the full scan set.
- [ ] Approve stabilization only if thresholds pass:
  - quality coverage >= 95%
  - quality score trend is stable or improving
  - no unexplained spike in critical failing KPI counts
  - all unresolved critical items have an owner and ETA
- [ ] Produce final sign-off document.

### Files
- `plan.md` (append sign-off section)
- Optional generated report path under `V3-Microservices/tmp/`

### Acceptance Criteria
- Signed decision: `GO_STABLE` or `EXTEND_MONITORING`.

---

## Phase 7 - Post-Cutover Stabilization Window

### Tasks
- [x] Pin canonical mode to `new` across services.
- [ ] Monitor operational quality/drift artifacts daily during stabilization window (3-5 days).
- [ ] Keep rollback playbook ready at deployment level (not API dual mode).

### Acceptance Criteria
- Canonical new mode runs with no production incidents during stabilization window.
- Daily quality/drift review log is complete for the window.

---

## Phase 8 - Legacy Cleanup and Finalization

### Tasks
- [x] Remove legacy KPI mode branching from scanner, NLP worker, and aggregator runtime paths.
- [ ] Remove remaining legacy-only helper code and stale constants (if any).
- [ ] Remove obsolete feature flags and dead config paths related to legacy mode.
- [ ] Update tests to assert only canonical new schema and monitoring artifacts.
- [ ] Update docs and runbooks.

### Files (expected)
- `V3-Microservices/v3-aggregator/kpi_builder.py`
- `V3-Microservices/v3-aggregator/classifier.py`
- `V3-Microservices/v3-aggregator/main.py`
- `V3-Microservices/v3-scanner-go/main.go`
- `V3-Microservices/v3-nlp-worker/main.py`
- `V3-Microservices/db/init.sql`

### Acceptance Criteria
- No active runtime references to legacy KPI mode remain in code.
- Test suite passes on canonical new schema and quality/drift artifact contracts.

---

## Execution Checklist (Commands)

### Scanner
- `cd V3-Microservices/v3-scanner-go`
- `go test ./...`

### NLP Worker
- `cd V3-Microservices/v3-nlp-worker`
- `python -m pytest tests -q`

### Aggregator
- `cd V3-Microservices/v3-aggregator`
- `python -m pytest tests -q`

### End-to-End Smoke
- `cd V3-Microservices`
- `./run.sh` or `./run.ps1`
- Run one scan, verify `/scan/{scan_id}/kpis` and `/scan/{scan_id}/kpis/top` return canonical `new` mode payloads with `top_level_kpis`.

---

## RACI (Lightweight)
- Scanner owner: implement runtime evidence + SPA-safe behavior.
- NLP owner: implement extraction and duplicate-content improvements.
- Aggregator owner: canonical mapping, quality/drift artifacts, reporting.
- QA owner: fixture validation, drift sign-off matrix.
- Product/Compliance owner: approve stabilization and final closure.

---

## Tracking Template (Use Per Phase)
- Planned start:
- Planned end:
- Actual start:
- Actual end:
- Risks:
- Blockers:
- Validation evidence links:
- Decision:
