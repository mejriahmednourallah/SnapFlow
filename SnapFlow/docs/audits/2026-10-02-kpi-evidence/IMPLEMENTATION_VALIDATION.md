# Broader scans: implementation and deployment validation

Updated 2026-10-06. Implementation/testing is authorized; broader acceptance remains outstanding.

Production-style local Supabase import and combined deployment now pass, including
63 source table counts, preserved user hashes, real frontend/Edge audits,
rendered/current NLP, owned scheduled/form jobs, platform APIs and ordered restart.
Crash testing fixed a 300-second NLP claim/wait race using renewable 90-second
claims; PostgreSQL renewal/ownership checks pass. Docker-20 representative builds
pass with Buildx v0.17.1. Cache is zero after 5.971 GB reclamation. See
[PRODUCTION_REHEARSAL_RESULTS.md](PRODUCTION_REHEARSAL_RESULTS.md) for proof and
remaining VPS/capacity/provider/TLS boundaries. Historical storage counts below
describe earlier phases, not the current 23-container production rehearsal.
The VPS has not received these local changes. No 500-page or Obscura/model
default has passed full production acceptance.

Oct 6 Git-release checks on the staged source: NLP **155 passed, one skipped**;
aggregator **143 passed**; browser pool **20 passed**; all scanner Go packages
pass. Notification regressions **three passed** and cleanup scope/abort checks
**four passed**. Generated `output/`, browser sessions, private login files and
encrypted migration bundles are excluded from Git. A staged-content scan found
no matches for the 29 held private values or checked key/token formats; the
explicit local CLI development DSN is a documented non-secret default.

Oct 6 final checks: cold/warm Realtime delivery passes after the PostgreSQL
readiness event; signup verification link uses the public Auth route and enables
password login. The frontend refreshes its notification snapshot at readiness
and reconnect, rejects stale responses and clears logout data. Three regression
tests pass and the corrected image builds. The production fixture is running
again after the desktop restart; the earlier 2.533 GiB snapshot remains an idle
Oct 5 measurement, not a peak or VPS headroom result.

The user-authorized fresh Supabase bootstrap and full/repeat SnapFlow launcher
now pass locally with real Supabase and all nine SnapFlow services. Six real
Auth/PostgREST/RLS checks pass. Two corrected browser/Edge audits each capture
all six known routes with current rendered NLP, queue the second audit behind
the first, and persist identical reloaded reports. Authored FR/EN/AR markers,
hydration/fetch prose and nested shadow content were judged independently.
Completed reports survive idle aggregator/NLP restart; active crash recovery
and VPS capacity remain untested here.

Actual testing found and fixed missing Supabase API grants, a demo seeder missing
its required client, explicit-port domain normalization that restricted the
initial scan to one page, and unsupported HEAD being mistaken for admin/file
probe failures. GET confirmation on 405/501 fixes the controlled site's final
admin exposure false alarm without losing real exposure detection. The full
scanner suite passes after this correction; focused port checks also pass in
aggregator and browser. This is not acceptance of every final content KPI.

See [PREPROD_DEPLOYMENT_PLAN.md](PREPROD_DEPLOYMENT_PLAN.md) for reproducible
commands, exact artifacts, historical failures and limitations. Docker Desktop
provides eight CPUs/about 11.6 GiB, so these small local functional tests do not
prove 4-core/8-GB VPS throughput or the provisional 1-GiB headroom target.
CUDA visual remains separate; CPU NLP/browser images are preserved. Cleanup
removes obsolete test resources/build cache while retaining candidates,
rollback images, running Supabase and data volumes.
Final cleanup reclaimed another 1.336 GB after the correction builds and
verified zero build cache. The owned fixture and obsolete provider-test image
were removed; the generated demo URL was restored. Twenty-one required
SnapFlow/Supabase containers remain running. See `preprod-final-cleanup.json`.

Cloud migration preparation subsequently exported the actual healthy
`wagctsvpmnleqzqjhqjq` project read-only: PostgreSQL 17.6, 12 users, 31 public
tables, roles/schema/data and 27 function sources. Exported user count and
checksums pass; the encrypted archive and Windows-protected recovery key reside
outside Git/OneDrive. Gemini/Redmine secrets match Cloud; Groq and the differing
Cloud 2Captcha value remain unresolved. No import/restore acceptance is claimed.
The next VPS cleanup includes ticketing removal and explicitly protects running
Wetty and all its dependencies. Both PostgreSQL instances remain in the design.
See the deployment plan for precise scope and key-recovery limitations.

## Deployed baseline supplied by the user

At 16:52:39 UTC the VPS reported four CPUs, 7.6 GiB RAM, about 3 GiB available
and no swap. Ticketing's four containers were present (about 834 MiB at this
idle snapshot). This is available memory, not a three-GiB machine or a measured
scan peak. The output contains no identifiable Supabase containers; required
cohosted services still need to be present during capacity acceptance.

The running scanner allowed 1,800 seconds but the running aggregator used a
900-second HTTP timeout. Rendered discovery was capped independently at 100.
The database had raw/rendered HTML but no revision, readiness, claim columns or
revision trigger. The server ran the upstream Obscura `latest` image rather
than the pinned candidate. Existing volumes will not rerun init.sql.

The older scan's 47 enqueued / 42 scanned cannot be resolved retrospectively
from its aggregate counters. All 262 visible enqueue-failure messages were
duplicates. Neither those duplicates nor HTTP 200 establish missing pages or
complete rendered content.

## Changes implemented locally

| Change | Result | Verification |
|---|---|---|
| Readiness and per-page publication | Static/discovery rows wait for planned rendering. Each completed desktop capture becomes available to NLP before slower visits finish. Failures release static evidence with explicit acquisition provenance. | Real scanner/Colly/PostgreSQL integration holds a visit while another page becomes ready. Six expected routes survive. Browser responses in this test are a declared adapter. |
| Late frontier consumption | Late discovery enters the same deduplicated, bounded frontier even after the initial queue drains or was empty. | Regression tests exposed and repaired a loop-exit defect in the initial implementation. Meaningful query and trailing-slash routes remain distinct. |
| Crawl outcomes | Queue admission, request start, redirects, terminal HTTP outcomes and SQL storage are separate observations. Duplicate rejections are separate from enqueue errors. | Redirect/async-admission test. Per-URL outcomes and counts are persisted under scan telemetry for future 47/42 investigations. |
| Revision/schema migration | Existing data remains intact; changed observation inputs invalidate old NLP revisions and stale claim owners cannot overwrite replacements. | Ten real PostgreSQL tests including a populated legacy table and repeat migration. Explicit migration script uses one transaction, no reset. Historic backfill preserves old analyses; it does not certify their original accuracy. |
| Shared LanguageTool | One internal LT 6.8 HTTP server; cached clients have fixed FR/EN/AR languages. Remote clients do not launch per-worker Java. | Actual packaged NLP/HTTP server/PostgreSQL with alternating one/two worker trials. Startup-provider recovery and client isolation tests. |
| Spelling-provider recovery | Transient supported-language failures can be retried without an HTML revision change. Up to three total attempts, 30-second delay; fresh observations take priority. Unsupported/short-policy exclusions do not request retries. | Actual packaged worker with stopped/restarted LT 6.8 and real SQL: the unchanged 337-word page recovers at revision 1, with zero duplicate work. SQL tests verify delay and attempt cap. Supported failures are not counted as finished NLP; exhausted failures remain explicit in partial reports. |
| Content measurement truth | Unexecuted spelling is no longer a measured zero or a clean combined content verdict. Independently measured thin/stuffing failures remain reported. | Authored final-KPI failure cases; existing typo thresholds unchanged. Digest deduplication accepts nested missing-field markers while preserving its masking policy. |
| Spelling breadth and batching | Every eligible paragraph now reaches spelling, including text after 100,000 characters. Requests group paragraphs up to 20,000 characters; short-snippet policy remains. Density/checked counts use submitted eligible words. | Actual LT experiment finds two authored late typos missed by the old 30-paragraph cap and greatly reduces HTTP calls. Source regressions verify suffix retention, bounded request sizes and policy counts. The packaged candidate completes both combined six-page multilingual captures; held-out final typo-verdict and VPS throughput acceptance remain. |
| Durable audit admission | PostgreSQL FIFO, one running audit, pending jobs survive dispatcher restart; expired jobs fail without automatic replay. | Two concurrent real PG claimers and expired/stale-owner tests. A dispatcher can advance jobs created by another process. No Redis. |
| Aggregation | Current NLP revisions only; failed count queries and failed KPI writes cannot become successful empty/persisted reports. | Aggregator suite; six fresh packaged NLP publications, repeat cycle zero, persisted reload and previous-audit comparison; 73-KPI contract retained. |
| Browser lifecycle | A worker is recycled only when its own page leases are zero. Whole-attempt timeout includes extraction; cleanup releases contexts and slots. | Browser recycling/cancellation tests plus actual packaged Chromium DOM, shadow, metadata and Markdown capture. |
| Timing and defaults | Aggregator HTTP allowance 1,830 seconds; scanner allowance remains 1,800. Selected/dispatched/captured/measured counts differ. Default page budget can be configured across API, scanner, CLI and manual/scheduled Edge Functions. | Tests, Compose configuration and Bash syntax checks. Existing fallback budgets are retained until acceptance; explicit positive budgets override the default. |
| Engine selection | Launcher defaults to Chromium; explicit --obscura enables its profile and flags. Source preparation verifies the committed Obscura pin rather than resolving a floating release tag. | Pinned stealth candidate passes the NodeList reproduction. This does not establish live hydration fidelity. |

Current local checks: worker **155 passed, one skipped**; aggregator **139
passed**; browser **19 passed**; all scanner Go packages pass; real PostgreSQL
checks **ten passed**. CLI Go checks, Compose/Bash syntax and changed Edge
Function TypeScript syntax checks also pass; no Deno runtime acceptance is claimed.
The end-to-end ingestion fixture independently expects
six known URLs, captured dates, 251/252 selected words and preserved original
HTML; its final report verifies 73 canonical KPIs. It is not a full VPS scan.

Actual provider-outage injection also passes. With the study LT server stopped,
the worker publishes a partial spelling observation, zero checked words and a
supported FR provider failure; an immediate second cycle does no work. After
restarting LT, a new worker process checks the same 337-word page at the same
content/NLP revision 1 and an immediate repeat again does no work. Only this
owned fixture's retry clock is advanced for the test. The recovery visit takes
23.48 seconds after server restart, including cold-provider initialization; it
is not a warmed throughput result. Artifacts: `provider-fail.json` and
`provider-recover.json` in `output/nlp-accuracy-study`.

## Spelling coverage root cause and correction

Before execution, the agent authored a 40-paragraph French page with exactly
two `serviices` misspellings in paragraphs 35 and 36. The actual packaged old
path submitted only 600 of 800 words through 30 HTTP requests, returned no
errors and incorrectly labelled the check measured. A one-request batching
experiment submitted all 800 words and returned exactly both expected typo
occurrences. Warming the dictionary and alternating old/batch/batch/old gave:

| Path | Trial seconds | Submitted words | Requests | Expected typos found |
|---|---|---|---|---|
| Old capped paragraphs | 75.42, 61.85 | 600/800 | 30 | 0/2 |
| Batching experiment | 5.35, 4.64 | 800/800 | 1 | 2/2 |

Artifact: `output/nlp-accuracy-study/spelling-coverage.json`. This is an authored
miss detection and measured provider cost, not model agreement. It does not
prove general FR/EN/AR accuracy or a full-scan speed ratio.
The 30-paragraph reproduction supplies paragraph-preserving text directly to
spelling. The current HTML main-content extractor normally flattens paragraphs
with spaces, so that specific cap does not imply every 40-paragraph website
loses its last ten paragraphs. The 100,000-character truncation does apply to
flattened input; its suffix regression uses the production HTML extractor.
The batching timing gain is demonstrated for line-separated inputs only.

The production source now batches every eligible paragraph with preserved
paragraph separators, splits large requests at whitespace and removes both
the 30-paragraph and 100,000-character truncation. An unbroken token exceeding
the request size is preserved rather than split into invented words; any
provider rejection remains an explicit failed measurement. Density uses
checked eligible words; short-copy exclusions are counted separately. Models,
minimum-density guard and verdict thresholds are unchanged.
The 20,000-character size is our batching choice, not the LT server default.
The pinned [LT 6.8 HTTPServerConfig source](https://github.com/languagetool-org/languagetool/blob/v6.8/languagetool-server/src/main/java/org/languagetool/server/HTTPServerConfig.java)
defaults unset maxTextLength to Integer.MAX_VALUE; the committed server config
sets threads/queue/cache only. The local bound reduces individual request size.

The final batching rebuild was temporarily delayed. Docker monitoring was rejected because the
automatic approval review service exhausted its usage allowance, not because
the action was classified unsafe. The following checkpoint resolves that
packaging restriction; it does not claim a VPS deployment.

Later checkpoint: the review service became available and the source-only
candidate rebuild succeeded, retaining the previous provider-recovery image.
The final image manifest is `1efb4b3af2a2ac43e9f5a5bc47dc70b7b78aef72321a420b117306f05d7f6b65`.
Actual packaged Python 3.11/shared LT 6.8 checks now pass for five authored
FR/EN/AR clean/late-typo cases through production HTML extraction, plus a
long English suffix case. It submits all 18,020 words in eight
requests of at most 20,000 characters and finds exactly the 60 authored late
`paintngs` occurrences. The long spelling-only visit takes 5.87 seconds;
this is neither a before/after whole-worker benchmark nor full-scan speed.
Artifact: `output/nlp-accuracy-study/spelling-candidate.json`.
The earlier rebuild restriction is resolved; VPS deployment and combined-stack
capacity/accuracy acceptance remain pending.
The final image republishes all six known scanner fixture observations at
their current revisions in a 1.61-second warmed cycle, then processes zero on
repeat. Captured dates and selected word counts remain correct. Database-backed
aggregation/reload again passes the 73-KPI contract and six affected-page
expectations. These are controlled ingestion/report checks, not full deployment.

## Fair shared-LanguageTool pilot

The first 55.35 s / 26.78 s comparison was biased by a cold shared JVM. It is
superseded by warmed dictionaries and alternating layouts, using the same 12
controlled FR/EN/AR pages, a two-CPU worker-container allowance and a two-CPU
server allowance.

| Workers | Trial durations | Mean | Sampled worker-container peak |
|---|---|---|---|
| 1 | 23.64 s, 24.66 s | 24.15 s | 426.0–432.98 MiB |
| 2 | 21.42 s, 24.39 s | 22.90 s | 741.10–741.45 MiB |

Mean duration improved about 5.2%, with overlapping trial durations and about
71% more worker memory. Samples are cgroup memory.current at 100 ms, including
the probe and its spawned workers; they exclude the separate LanguageTool
server and the rest of the stack. A prior single server sample was about
708 MiB, not a measured full-stack peak. No shared-vs-embedded memory saving
has been established. Start with one worker; test two on the VPS before choosing
capacity settings. Outputs matched between layouts; that verifies concurrency
consistency, not independently judged model accuracy.

Artifacts: output/nlp-accuracy-study/shared-languagetool.json,
scanner-readiness-test.log, scanner-worker-handoff.json,
scanner-content-report.json; output/playwright/production-discovery.json and
obscura-study/nodelist-candidate.json. Study images were refreshed over existing
CPU dependency layers, not rebuilt heavy/CUDA images.

## Server commands after transferring the updated files

Run from the existing V3-Microservices directory. Run the first benchmark with
the existing images before replacement. Its evidence-schema query is omitted
because the supplied baseline lacks the columns.

```bash
COMPOSE=(docker compose --env-file .env.preprod -f docker-compose.preprod.yml)
SCAN_URL='https://www.albarakabank.com.tn/fr'
mkdir -p ../output/capacity-study
python3 benchmarks/benchmark_scan.py --url "$SCAN_URL" --pages 150 --headless 8 \
  --label deployed-before --probe-url http://127.0.0.1:3000 \
  --output ../output/capacity-study/deployed-before.json
```

Use the same chosen site for before/after comparisons; AlBaraka is the URL the
user supplied, not the UIB scan in the older log. A 150-page request is not
proof that the site exposes 150 useful pages. Do not overlap these benchmarks
with another audit. Do not restart services while an audit is active.

After that audit completes, prepare the CPU bases and candidate services, then
stop only the acquisition/admission workers for the migration. PostgreSQL and
application data remain in place. If image builds fail, keep the current stack.

```bash
bash BUILD_V3_BASE_IMAGES.sh --cpu-only
"${COMPOSE[@]}" build scanner nlp-worker aggregator v3-browser-pool languagetool
"${COMPOSE[@]}" stop aggregator scanner nlp-worker
bash scripts/apply-evidence-migration.sh
export ENABLE_OBSCURA_DISCOVERY=false OBSCURA_RENDER_ENABLED=false
export OBSCURA_ACQUISITION_ROUTER_ENABLED=false
"${COMPOSE[@]}" --profile obscura stop obscura
"${COMPOSE[@]}" up -d scanner nlp-worker aggregator v3-browser-pool languagetool
"${COMPOSE[@]}" ps
curl -fsS http://127.0.0.1:8080/health
```

Keep required SnapFlow/Supabase services present. Do not use the Supabase
bootstrap for benchmarking: its current normal path calls db reset even
without --clean. Existing Edge Functions can be served/deployed separately.
Do not remove ticketing here; record the user's planned removal in a later
matched comparison.

```bash
python3 benchmarks/benchmark_scan.py --url "$SCAN_URL" --pages 150 --headless 8 \
  --label candidate-one-worker --collect-db-evidence \
  --probe-url http://127.0.0.1:3000 \
  --output ../output/capacity-study/candidate-one-worker.json
```

The collector saves image identities, whitelisted effective settings, status
observations, duration, health latency, host available memory, container
resources/restarts/OOM state, report reload equality, telemetry and per-page
final revisions. Add --probe-url for the actual Supabase health route. Resource
samples can miss brief peaks; repeat trials and inspect host/container metrics.
The collector cannot independently certify useful content or automatically
promote defaults.

Then vary one setting per matched trial: NLP scale 1/2; browser processes 4/2;
page concurrency 8/4; static requests 150/16/8. Set the corresponding shell
variables and recreate only the affected service with Compose. Pass the same
page concurrency through --headless. Finish one audit before any recreation.
Use the winning evidence-preserving configuration for 150, 300 and 500-page
requests on sufficiently large sites, with repeated runs.

Acceptance still requires independently reviewed captured FR/EN/AR KPI
evidence, complete current revisions, no restarts/OOM, application
responsiveness and at least 1 GiB host memory available at repeated peaks.
Larger scans may take longer inside the existing scanner allowance. Set
DEFAULT_SCAN_MAX_PAGES=500 in Compose, CLI environment and Edge Function
environment only after this acceptance. Until then the old fallbacks remain.

For an explicit Obscura candidate comparison, prepare/build the locked source,
set OBSCURA_IMAGE=snapflow/obscura-fixed:v0.2.3 and use the obscura profile.
Do not compare the server's floating upstream latest to the patched candidate
as though they were the same binary. Include Chromium recovery and cleanup in
the measured duration, and judge saved content against expected source evidence.

```bash
python3 obscura/prepare_source.py
docker build -t snapflow/obscura-fixed:v0.2.3 obscura
export OBSCURA_IMAGE=snapflow/obscura-fixed:v0.2.3
export ENABLE_OBSCURA_DISCOVERY=true OBSCURA_RENDER_ENABLED=true
export OBSCURA_ACQUISITION_ROUTER_ENABLED=true
"${COMPOSE[@]}" --profile obscura up -d obscura scanner v3-browser-pool
```

Building this Rust candidate is substantially more expensive than the source
refresh used locally; prepare it before a scheduled test window. Preserve its
compiler cache and inspect host disk space before that build. Reuse identical
page sets and independently reviewed source captures for the comparison.

## Storage

Current candidates, rollback tags, optional model candidate and all four data
volumes are retained. A scoped dangling-image/24-hour non-compiler-cache prune
reclaimed **0 bytes** this phase; current cache entries were recently used.
This is not reported as disk-space improvement. Obsolete stopped test
containers were then inspected as stopped/mount-free and removed. A separate
local-build-context prune reclaimed **19.21 MB**. Twelve tagged images, two
test containers and four volumes remain; build cache is about 8.246 GB.
No volume prune, system reset or VHD compaction is part of acceptance.
After the final batching image refresh, a further dangling-image prune reclaimed
zero bytes and local-build-context pruning reclaimed 167.9 kB. Thirteen tagged
images now include the retained provider-recovery rollback; two test containers
and all four volumes remain. This is scoped test-cache cleanup, not a claim of
substantial reclaimed host space.
After the six production CPU builds, scoped local-context pruning reclaimed
198.4 MB (dangling-image prune: zero bytes). Compiler caches and all tagged
candidate/rollback images remain. The current subset has 19 images, three
running containers and six volumes; full Supabase/visual/frontend startup has
not occurred. Do not treat these storage counts as complete deployment.
