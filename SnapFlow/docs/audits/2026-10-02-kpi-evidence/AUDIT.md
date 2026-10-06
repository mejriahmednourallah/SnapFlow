# SnapFlow: reverse audit from KPI claims to evidence

Date: 2026-10-02. Scope confirmed by the user: investigate the full audit pipeline, starting from the KPI output and tracing backward to evidence. Preserve scan duration and report compatibility; resource usage may shift. This is a diagnostic pass, not an implementation or deployment.

## Method and boundaries

For each probe, follow: final KPI claim -> verdict/quality rules -> aggregate counters and rows -> producer evidence. The matrix exercises all 73 KPI outputs against missing and partial evidence. It is not a complete semantic validation of all 73 detectors.

- Executed the actual `build_report()` and `build_kpi_centric_report()` functions with isolated database rows and pre-supplied enrichment results.
- Compared the repository's `raw_ec_response.json` fixture with a copy whose NLP aggregates were removed. The original fixture was not modified; it is a stored snapshot, not a new live scan.
- Executed selected production NLP AST nodes with controlled inputs to avoid the full module's downloads/model initialization.
- Blocked real socket connections in the saved reproducer. No live target, production database, or deployment was touched.
- Reviewed scanner persistence and frontend mapping to trace producer and consumer boundaries.
- Ran the existing aggregator suite: **110 passed, 2 deprecation warnings**. The focused KPI suite also passed: **45 passed**. No timing or accuracy improvement has been measured.

Reproduce from the repository root:

```powershell
python docs/audits/2026-10-02-kpi-evidence/reproduce.py
```

Artifacts: `results.json` contains observations and production-source SHA-256 hashes; `kpi-matrix.csv` compares verdict, quality, and claimed pages checked for every output KPI; `reproduce.py` regenerates them. The script records current behavior, rather than declaring the defects acceptable.

## P1-01: missing evidence becomes definite passes and failures

**Reproduced through the production aggregator and final builder.** A synthetic one-page scan with an explicitly skipped NLP result still produces `passing / VALID` for `seo_meta_nlp`, `content_thin`, `content_missing_cta`, and other content KPIs. The skipped count is correctly recorded as one upstream, but it does not gate these verdicts. Pending NLP also produces passes, while its `nlp_not_evaluated_pages` count remains zero.

The same synthetic scan has empty domain-security evidence: `sec_http_headers` becomes `passing / VALID / high confidence`, and `perf_compression` becomes `failing / VALID`. These are absence-of-measurement cases, not observations that headers are safe or compression is absent.

Across all 73 outputs, that synthetic fixture yields 30 passing, 17 failing, 2 warning, and 24 not evaluated. These totals characterize this deliberately incomplete fixture; they are not production error rates. Removing content/NLP aggregates from the stored 15-page fixture also leaves several affected KPIs passing with VALID evidence.

Reverse trace:

- Final status constructors use absent counters as zero or absent booleans as false: `kpi_builder.py:4434`, `4960`, `5223`, `5546`.
- `_build_contract_evidence()` initializes quality as VALID (`2694`). The meta-NLP branch explicitly returns passing when its issue count is zero and forces at least one checked page (`2732-2753`).
- `_issue_requires_rows()` requires rows for failing/warning states, not passing states (`1626`). This is insufficient without separate proof that a successful measurement ran.
- `_build_curated_evidence_digest()` accepts generated summary lines or URLs as meaningful proof (`2240`). Default-derived lines can therefore survive the final gate.
- `main.py:3141-3145` skips unevaluated NLP, but publishes zero-filled NLP/content aggregates at `3751-3765` and `3891-3949`.
- The frontend accepts backend statuses and has no general downgrade for these VALID-looking passes: `auditMapper.ts:2158-2188`, `1424-1428`. This is a source trace, not a browser acceptance test.

Required property: an empty issue list can support a pass only when the relevant check actually ran over an explicit, applicable scope. Missing, pending, skipped, and failed measurement must remain distinct from observed zero defects. Positive evidence does not require a defect row; it requires execution and coverage evidence.

Expected runtime implication of correcting this gate: existing metadata and counters can support the decision without additional crawling. CPU/memory and elapsed-time impact still need measurement.

## P1-02: unmeasured pages are presented as measured problem pages

**Reproduced end to end inside the aggregator.** For `ai_raw_content_visible`, one measured page with visible raw content produces passing, 100% coverage, VALID. Add nine crawled pages whose NLP is pending, retaining exactly the same one measurement: output becomes warning, 10% coverage, **10 pages checked, 9 affected, execution completed, VALID**.

This is not merely a conservative threshold. The output claims nine affected pages and completed measurement without their evidence, and interprets the result as JavaScript dependence.

Reverse trace:

- `kpi_builder.py:5268-5275` divides the measured positive count by total pages scanned and uses that total as checked pages.
- `5366` infers affected pages from the difference.
- `3442-3454` promotes evidence to VALID when even one raw-content row exists.
- `main.py:3355-3367` only constructs these measurement rows from available NLP results.

Required property: report measured positives, measured negatives, and unmeasured pages separately. Do not silently declare the full site passing from a tiny positive sample either. Apply the same denominator audit to other AI/NLP percentages.

## P1-03: rendered content is attributed to the original HTML response

**Production assignment reproduced; downstream KPI dependency traced.** `ai_raw_content_visible` should describe the original HTTP response. The scanner preserves it in `raw_html`, but `UpdatePageHTML()` puts the rendered DOM in both `rendered_html` and compatibility `html` (`db/db.go:398-409`).

The NLP worker selects `row.get("html") or raw_html` for `raw_base_html` (`main.py:2218`). With an empty SPA shell in `raw_html` and populated rendered DOM in `html`, the audit confirms that rendered content is selected as raw content. This feeds `raw_content_word_count`, `raw_content_visible`, and rendered-use comparisons, then the aggregate AI-readiness KPI.

Required property: source labels must follow the actual source. Preserve a deliberate compatibility fallback for older rows without original HTML, while avoiding any claim that a rendered-only fallback is verified raw HTML.

Expected runtime implication: selecting the correct existing source does not require additional browser work.

## P1-04: an HTML soft-404 passes the llms.txt KPI

**Reproduced from the production NLP function through the final KPI builder.** An HTTP 200 response with `Content-Type: text/html` and an HTML “Page not found” body produces `llms_txt_present=true`, `parse_status=parsed`. The final `ai_llms_txt` KPI is **passing / VALID**.

Reverse trace: `kpi_builder.py:5284` uses the positive presence count; `main.py:3379-3402` consumes the producer result; NLP `check_llms_txt()` sets presence solely from HTTP status (`1012`) and considers any non-comment line useful, including HTML.

Required property: validate the returned representation and exclude clear HTML/error shells before making a positive file-presence claim. Use conservative checks on the body already fetched; do not impose an invented strict syntax standard or fetch an additional page.

## P2-05: llms.txt failures and successes remain cached across scans

**Reproduced for a transient timeout.** After the first mocked timeout, a second call for the same domain returns the cached timeout with zero new HTTP calls, despite a replacement HTTP handler being available. The process-global cache has no scan boundary, expiry, or eviction (`nlp/main.py:280`, `985-986`, `1021`). The code also caches successes, so later site changes are not observed during the worker's lifetime.

Required property: reuse one domain-level probe within an appropriate scan/time window, while avoiding permanent reuse of a transient failure or old success. Any retry policy must remain bounded by the agreed scan-duration budget; retrying per page would be a regression.

## P2-06: zero-page reports invent one scanned page

**Reproduced at the final builder boundary.** Input `pages_scanned=0` becomes output `pages_scanned=1`, alongside 34 passes, 13 failures, 2 warnings, and 24 not evaluated for the deliberately empty input.

`kpi_builder.py:5827` uses `... or 1`; `_derive_pages_checked()` similarly forces one for many scopes (`2648-2661`). A guard for division by zero must not change the reported observation count. Production frequency is not established, and scanner fallback may prevent some zero-page paths.

## P2-07: incomplete stored evidence can crash report generation

**Two isolated cases reproduced using the actual `build_report()`:**

1. Page rows exist but their scan summary is absent: `UnboundLocalError` on `raw_sec` (`main.py:3531`). That variable is only assigned inside the summary-present branch (`2503`).
2. A partial evaluated NLP payload contains `seo_kpis` but omits `llms_txt.llms_url`: `NameError` on undefined `base_domain` (`3382`). Normal current worker output usually supplies this URL; this is a partial/older-data resilience defect, not proof that every scan crashes.

Required property: incomplete evidence must produce an explicit incomplete/error outcome, not an incidental Python exception or fabricated default findings.

## Throughput and freshness risks traced in source

These are separate from the seven reproduced accuracy/robustness findings above.

### R1: duplicate network work during NLP processing

The worker requests `Last-Modified` at `nlp/main.py:2224`; `extract_dates_and_classify()` requests it again at `1746`, invoked at `2291`. A previous isolated execution of the actual functions recorded `SELECT -> HEAD -> HEAD -> rollback` before an intentional stop. The saved script currently covers the accuracy probes, not that orchestration probe.

The comment saying the first call occurs before the transaction is incorrect: the batch SELECT with row locks has already executed. Reuse the existing observation, or make a bounded fallback only when needed. Do not assume a per-request time saving translates directly into equal end-to-end scan savings, because phases overlap.

### R2: per-page commits release the remaining batch's locks

`nlp/main.py:2174-2182` locks/fetches up to 20 pending rows. Commits at `2264` or `2464` release the transaction's locks while the Python loop still holds the rest of the fetched batch. Another worker can claim those remaining rows; the first worker does not re-check ownership or whether they already have results. Rollback releases the batch locks too.

This is a code-level concurrency defect with a clear interleaving, but no concurrent PostgreSQL reproduction was run. It can waste work and permit stale overwrites. A correction needs explicit claim/commit semantics and a real multi-worker test; increasing replicas is not a correction.

### R3: later rendered evidence does not invalidate earlier NLP

The scanner updates HTML after initial insertion (`db/db.go:398-409`; callers in `main.go:1524`, `2364`). Neither that update nor the insert conflict path clears/revisions existing `nlp_results`. NLP only selects rows with NULL results (`nlp/main.py:2176`). A page analyzed or explicitly skipped before rendering can therefore retain that older result after better evidence arrives.

`count_pages()` counts any non-NULL NLP result as done (`aggregator/main.py:693`), including skipped results. The completion check at `4081-4087` can consequently report no partial NLP even when every page was skipped. Terminal work and successfully evaluated work need distinct coverage accounting.

This timing scenario was source-traced, not reproduced with concurrent services. A fix must bound reprocessing and preserve the scan deadline rather than unconditionally analyze every page twice.

## What the tests and schema currently guarantee

The 110 passing aggregator tests establish existing regression coverage, not detector accuracy. Missing-evidence positive verdicts and partial-scan coverage remain uncovered by those tests. Some NLP tests (`tests/test_phase_o.py:8`) inline older implementations, while others import real production functions; the entire suite should not be described as copied tests.

The current application emits a richer v2 KPI shape, 73 KPIs, and `not_evaluated`, already consumed by the frontend. The project bible describes an older nine-field boundary and inventory. Future fixes should preserve the actual API/consumer contract and add focused regression assertions; they should not revert the application to the older description or introduce a new status vocabulary.

## Recommended next investigation/fix order

**Superseded by the user's acquisition-first direction.** See [REPLAN.md](REPLAN.md): broaden and strengthen evidence collection, repair lost/stale data, and allow more compute. The findings below remain valid, but output gates are no longer the first implementation priority. Coverage accounting is internal validation, not a new client-facing threshold feature.

1. **Evidence gates and coverage first:** P1-01/P1-02/P2-06 have the broadest impact on reported truth. Establish producer execution/measurement counts before altering pass thresholds.
2. **Evidence source correctness:** P1-03/P1-04 and bounded cache behavior. These can use existing bodies and metadata without new browser work.
3. **Orchestration and freshness:** resolve R1/R2/R3 with concurrency and lifecycle tests, then use recovered capacity only where measured evidence gaps justify it.

This order addresses the final decision rules, then the evidence feeding them, then the work scheduling that keeps evidence current. Exact implementation choices remain to be reviewed.

Acceptance should compare labelled expected findings (false positives, false negatives, correct unmeasured outcomes) and measured coverage against the same frozen cases. Then compare end-to-end duration on matched live scans, recording phase time, CPU, memory, and browser work under equivalent load. Do not use the existing quality score as an accuracy target: it penalizes website failures, so detecting a real defect can lower that score while improving detector accuracy.

No production fixes, live accuracy claim, or unchanged-latency claim are included in this pass.
