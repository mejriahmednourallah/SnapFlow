# Revised plan: acquire better evidence and keep it usable

Status: implementation authorized and in progress. Pinned Obscura repairs, matched production-SDK captures, packaged NLP replay, recursive scanner discovery and real PostgreSQL handoff/report checks have run. Full live-stack scan acceptance remains unfinished. See `OBSCURA_STUDY.md`, `OBSCURA_STEALTH_STUDY.md`, `NLP_ACCURACY_REVIEW.md`, `NLP_MODEL_STUDY.md` and `IMAGE_SPLIT.md`. Neither browser nor model defaults are promoted.

## Current execution checkpoint (2026-10-06)

Full local production Supabase import/deployment now passes: 63 source table
counts, preserved 12 user hashes, seven Auth/RLS checks, frontend/Edge six-page
audits, current hydrated/shadow evidence, scheduled/form jobs, Storage/Realtime/
local mail and ordered restart. Crash testing found and repaired the 300-second
NLP lease/wait race using a renewable 90-second lease. Docker-20 representative
builds require Buildx v0.17.1. Auxiliary Gemini compatibility was repaired;
packaged NLP, Chromium baseline and page defaults stay unchanged. Build cache
is zero after reclaiming 5.971 GB. See
[PRODUCTION_REHEARSAL_RESULTS.md](PRODUCTION_REHEARSAL_RESULTS.md) for measured
scope and remaining VPS, SMTP/cron, Obscura, accuracy and capacity gates.

Final platform checks pass for cold/warm database-ready notification delivery
and public email-confirmation link followed by password login. A cold socket
joined before PostgreSQL was ready (73 ms versus 2,209 ms), exposing a frontend
notification snapshot gap. The lifecycle correction and three focused
regressions pass; the frontend image has been rebuilt. No sleeps or notification
INSERT retries are used to turn the test green.

New deployment direction: rehearse the production self-hosted stack locally,
then build on the VPS. Both frontend and Supabase use `snapflow.medianet.space`.
Actual VPS output confirms Apache on 80/443 and failed webroot certificate
renewals. Public probing now confirms ACME requests reach frontend HTML instead
of the configured webroot. Preserve both certificate SANs and Wetty's global
proxy route. VPS Docker 20.10.24 compatibility is a separate rehearsal gate;
do not automatically upgrade/restart its daemon. See
[PRODUCTION_REHEARSAL_PLAN.md](PRODUCTION_REHEARSAL_PLAN.md) for the agreed
workflow, private import, Wetty-preserving cleanup and acceptance gates. This
is a plan update, not a completed production restore/deployment test.

Deployment decisions: keep separate audit PostgreSQL; use production self-hosted
Supabase for the VPS. The user permits SnapFlow/Supabase reset and removal of
ticketing, but Wetty must remain running with its dependencies unchanged.
Cloud database/users and credentials now require migration; old Storage files
are excluded. Actual read-only Cloud export includes 12 users and 27 function
sources in a verified encrypted private archive. Gemini/Redmine keys match Cloud;
Groq and the original Cloud 2Captcha value remain unresolved. Restore rehearsals,
provider/model compatibility and full VPS capacity remain pending. A Cloud export
does not make the tested CLI development stack a production deployment.

Latest implementation results and the commands to run on the VPS are in
[IMPLEMENTATION_VALIDATION.md](IMPLEMENTATION_VALIDATION.md). They supersede
earlier readiness, worker-concurrency and deployed-baseline assumptions.
The supplied VPS still runs old images/schema; these local fixes are not
claimed as deployed. The 30-minute scanner allowance stays in place.

User-added goal acceptance: test the existing preproduction scripts with
SnapFlow and Supabase together and provide the same tested Linux commands for
the VPS. See [PREPROD_DEPLOYMENT_PLAN.md](PREPROD_DEPLOYMENT_PLAN.md). Launch
must apply the tested reset/migration to the correct database and
prove frontend/Edge Function/container networking before capacity testing.
The user subsequently waived preproduction data retention: fresh/reset testing
is authorized. Cleanup must stay within this SnapFlow/Supabase environment;
verify reset/migration success and retain benchmark artifacts. Actual fresh
Supabase bootstrap and full/repeat SnapFlow launch now pass locally, including
the existing separate CUDA visual service. Six real Auth/API/RLS checks pass.
Two final browser/Edge audits each capture six rendered/current-NLP pages;
the second is observed waiting behind the first. Independent authored content
checks and persisted report reloads pass, including idle aggregator/NLP restart.
Missing API grants, client-linked seeding, explicit-port scope and unsupported
HEAD probing were corrected from real failures. The controlled admin-exposure
false alarm is removed and actual exposure regression cases still pass.
The local host is larger than the VPS: this does not certify 150/300/500-page
capacity, peak headroom, public late discovery, active crash recovery or
general final content-KPI accuracy. The visual CPU/CUDA architecture question
remains pending; no CPU-only visual promotion was made. Test phases end by
removing obsolete resources/build cache, retaining candidates and data volumes.

The user resumed the acquisition-first implementation goal. It remains active;
stop only for a material architectural decision. See
[ACQUISITION_CHECKPOINT.md](ACQUISITION_CHECKPOINT.md) for current changes,
independently reviewed errors, measurements, artifacts and acceptance limits.
This checkpoint supersedes earlier unbuilt/unwired statuses and storage counts.

| Work | Implemented and tested | Remaining acceptance |
|---|---|---|
| CPU images | FastAPI/NLP/browser bases, baseline worker, optional semantic image and actual Playwright 1.44 pool built; full local Compose/Supabase launches include healthy Form Executor and separate CUDA visual. | Full production queue/stack throughput and VPS capacity. |
| Obscura filtering/scheduling | Pinned render+stealth candidate built; classic/fetch flag consistency and preservation of completed boot scripts verified against actual SDK/DOM. | Live hydration/stalls and content fidelity; slow async still spends watchdog. |
| Content router | Shared whole-attempt deadline and actual-engine recovery pass. First failed-origin pages cost about 5.3 s versus 1.4 s direct Chromium; later origin bypass works. | Full-scan duration and resource cleanup; nonempty content still does not prove complete hydration. |
| Discovery | Recursive JS frontier and nested sitemap entries wired into partial static crawls; independent 100-page rendering limit removed. Real scanner/Colly/SQL capture expected six routes. | Actual production-browser breadth at requested page scope. |
| Freshness/ownership | Atomic publication, readiness-held pages and individual completed-page release; own measurement shadow capture, captured dates and revision-sensitive claims/publication. Packaged worker publishes six fresh SQL revisions, repeat cycle zero; ten real PG checks. | Full live workload, failure/restart recovery and independently reviewed source fidelity. |
| NLP accuracy | Thin-policy ownership and affected-URL union retained; homepage identity/schema classification fixed; declared-language spelling blocks and code exclusion remove inspected mixed-language false alarm. | Independently labelled site/KPI corpus, unsupported languages and provider availability evidence. |
| Model value | Source-refreshed optional MiniLM image retains exact passages in 9/9 controlled FR/EN/AR locations. Larger embedding replacement still unsupported; NLI remains a candidate with retention misses. | Final KPI benefit, false alarms/misses and queue cost on held-out sites. |
| Markdown | Cleaned, versioned additional projection; actual both-engine shadow/visibility fixture passes. | Live BIAT missing content still observed. Preserve HTML and metadata; no wholesale NLP input switch. |
| Report compatibility | Late SEO/UX summaries refresh from selected rendered observations; three actual PostgreSQL cursor-factory reload defects repaired. Actual database-backed content report preserves 73-KPI contract; combined local reports persist/reload through the actual browser and survive idle restart. | Whole-stack VPS duration, larger-site compatibility and active-crash acceptance. |

Current checks: all scanner Go packages pass; worker 155 passed/one skipped, aggregator
139 passed, browser pool 19 passed, real PostgreSQL checks ten passed.
Packaged Chromium, worker/real-SQL and report/real-SQL checks also pass.
The scanner browser-response adapter is explicit: fixture orchestration timing
is not a real full-stack scan baseline. See the checkpoint for exact scope.

No browser or model default is promoted. Canonical live captures still show
Obscura timeouts and missing BIAT content. Its sampled engine working-set peaks
were 103.6/144.7 MiB; client measurements include Chromium and cannot establish
a fair engine-only memory comparison. Similar NLP counts do not prove capture
completeness. The agent judges expected source evidence before rating outputs.

Next executable order:

1. Record the old deployed baseline on an identical target, then apply the
   non-destructive schema migration and validated local service changes.
   Readiness, streaming, late-frontier consumption, admission, browser recycling,
   bounded headless/mobile work and producer counts are implemented locally.
2. Diagnose remaining Obscura live hydration/stalls using the pinned candidate;
   its controlled NodeList reproduction passes. Repeat matched actual SDK
   captures and reviewed NLP after fixes, including Chromium recovery.
3. Validate the actual stack's recursive breadth and shared LanguageTool,
   latest-revision final reports, queue cost, CPU/RAM and total duration.
4. Apply the KPI-specific sequence below to independently labelled site evidence
   before deciding a default model, semantic verdict path or Markdown input.
5. Keep storage bounded while retaining compiler/candidate/rollback assets and
   data volumes. Latest scoped pruning reclaimed zero bytes; current layers were
   recently used. Earlier reclamation is historical, not a new space gain.

Shared-LanguageTool decision: warmed alternating trials measured 24.15 s for
one worker versus 22.90 s for two on 12 controlled pages. Worker-container memory
rose from roughly 433 MiB to 741 MiB, excluding the shared server. Start with
one; test two on the VPS. This small pilot neither establishes a meaningful
full-scan speed gain nor proves memory savings over embedded LanguageTool.
No embedding model or NLP verdict threshold changes follow from this trial.
Supported-language spelling-provider failures now retry through existing
revision-checked claims (three total attempts with delay; new observations first).
Policy exclusions and unsupported languages do not request retries. Reports
retain measurement availability instead of treating an unexecuted check as
zero typos; measured thin/stuffing defects remain reported.
The actual packaged worker/stopped-restarted LT/SQL recovery test passes for an
unchanged 337-word French observation at revision 1, including zero work on
immediate repeat cycles. This is outage/recovery proof, not full-stack capacity.

Further independent spelling review reproduced a root acquisition loss: the
old check submitted only the first 30 eligible paragraphs (600/800 words),
missing both authored typos in paragraphs 35 and 36. A warmed actual-provider
batching experiment checked all 800 words, found both, and took 4.64/5.35 s
versus the old 61.85/75.42 s. This is one controlled French case, not a universal
speed or accuracy claim. Source now checks all eligible paragraphs in bounded
20,000-character requests, without the old prefix/paragraph truncation.
Measured density/counts use checked input; short-policy exclusions remain.
Four new regressions pass, including suffixes beyond 100,000 characters and
provider failure between batches. Candidate-image FR/EN/AR and full-scan
validation remain next; local Docker approval review currently hit a usage
limit. No new model/default promotion follows from this experiment.
That local review-service limit subsequently cleared. The final source image
now passes five authored FR/EN/AR clean/late-typo cases using production HTML
extraction and a long English suffix case with all 60 expected occurrences.
No general site accuracy or full-scan speed claim follows.
The current HTML extractor usually flattens paragraphs: the 30-paragraph cap
reproduction and timing gain apply to line-separated spelling input. The
100,000-character suffix defect also affects the actual flattened HTML path;
the new regression follows that extraction path before spelling.

Promotion remains conditional: compare browser processes 4/2, page concurrency
8/4 and static requests 150/16/8 one variable at a time. Then request 150/300/500
pages on large enough sites with required cohosted services running. Require
reviewed useful evidence/current revisions, stable reports, no OOM/restart,
responsive applications and at least 1 GiB host available at repeated peaks.
DEFAULT_SCAN_MAX_PAGES is wired across entry points, but old fallback budgets
remain until acceptance justifies 500.

## NLP integration plan after the controlled testing phase

Work backward from each final verdict. Installing a larger model without an
evidence consumer cannot improve these KPIs.

| KPI / use | Next root correction or evidence integration | Acceptance before changing verdicts |
|---|---|---|
| `content_thin` | Producer ownership/language and report consistency implemented; distinct affected-page evidence/counts corrected. Existing heuristic values retained. Improve shadow capture and substantive-page labels next. | Nine existing-policy contract cases and matched saved-capture replay pass. Still require independently labelled real short/empty/boilerplate pages across FR/EN/AR before calibrating policy. |
| `content_lexical_diversity` and content quality | Keep the corrected TTR/MTLD units and real spelling providers; review names, repeated typos, mixed languages and provider execution. | Independently reviewed text and occurrence counts; actual JVM runtime; report-level evidence and existing contract preserved. |
| `content_freshness` | Reuse captured headers and structured published/modified dates; keep date provenance and resolve ambiguous footer/template dates. | Source-labelled date examples, no duplicate retrieval when capture exists, updated content revision reaches the report. |
| `seo_h1_quality`, `seo_meta_nlp` | Exact-span adapters implemented under existing KPI `data.related_passages`, separate from failing rows. Topic relevance does not decide factual or structural verdicts. | Nine controlled packaged-worker cases reach both final KPI adapters. Held-out site/template labels and full worker/scan cost still required. |
| `content_cannibalization` | Compare substantive cross-page topics and intent, deduplicate canonical aliases and distinguish translations or deliberately related pages. A shared dominant stem is insufficient. | Reviewed competing/non-competing page groups, concrete paired URLs and spans; false alarm/miss counts against the current grouping heuristic. |
| `content_key_pages`, `content_missing_cta`, `content_broken_structure` | Reuse semantic landmarks, visible action/heading evidence and page-type labels. Preserve captured Markdown as an additional projection, HTML/metadata/shadow content as distinct observations. | Independently labelled rendered pages; navigation/footer-only signals do not stand in for substantive page evidence. |
| Rights/retention text feeding RGPD KPIs | Record clause mention, affirmation, denial and qualification. Test mDeBERTa only on selected clauses in engineering shadow comparisons; verify literal dates/amounts/units and relevant conditions. | Agent-reviewed held-out sites, including retention paraphrases and explicit denials; no similarity-to-compliance conversion and no automatic model verdict promotion from the small corpus. |

Implementation order: continue matched site passage replay after the completed
thin-content ownership correction and H1/meta adapters; repair shadow capture
and spelling inputs before cross-page intent evaluation. Keep revision-aware
caching and one deduplicated inference batch
per page; test cache invalidation on content/query/model revision changes.
Only add clause verification if site-level labels justify its extra cost.
MiniLM remains the retrieval baseline and mDeBERTa a candidate; larger embedding
replacement is not supported by current evidence. The NLI experiments measure
a different task and cannot be compared directly with whole-body embedding
timings.

Promotion proof must include final KPI false positives/misses by language and
page type, measured producer execution/usable evidence counts, CPU/RAM, worker
queue time and full scan duration with Chromium recovery. These measurements
remain internal engineering evidence; no coverage-threshold UI is introduced.

## Confirmed direction and working constraints

- Work backward from the final KPI to the observations needed to justify it, then repair acquisition and data handling so those observations are actually collected.
- Increase scan breadth and measurement completeness. Higher compute is authorized in principle; no hardware, paid service, or capacity purchase is being made here.
- Preserve report compatibility and existing service ownership.
- Keep coverage diagnostics internal to engineering and validation. No new coverage-threshold display is planned.
- Retain the earlier same-scan-duration objective as a working constraint. Improve parallel scheduling and reuse to accommodate more useful work; benchmark this rather than promise it in advance.
- User-selected target architecture (2026-10-03): Obscura primary for discovery/content acquisition if stealth, content completeness and NLP comparisons support it; Chromium handles repeated acquisition failures and browser-specific measurements. Engine promotion remains conditional on those results, rather than on memory savings alone.
- Broader scans remain within the requested domains, page limit, and explicitly chosen scan budget. Broad collection does not imply submitting discovered forms or activating additional security probes.

The intended result is a scan that discovers more relevant pages, captures usable source and rendered observations, processes the latest content, and delivers accurate KPIs. Changing a verdict to unavailable does not satisfy this objective by itself.

## Newly identified acquisition restrictions

These observations describe checked-in source/configuration. They are not a confirmed explanation of a previous deployed scan.

| Restriction | Source | Consequence |
|---|---|---|
| Rendered recovery capped at 8 pages and 30 links in Compose | `V3-Microservices/docker-compose.yml:42-44` | The environment overrides the scanner's larger fallback defaults. Raising an unrelated max-pages value cannot remove this bottleneck. |
| Expanded rendered recovery requires a zero-page crawl and nonempty prefetch body | scanner `main.go:1446`, `1586` | A crawl returning one or several inadequate pages does not enter the same broad recovery path. |
| Recovery schedules links only from the initial rendered result | scanner `main.go:1648-1709` | Discovered child pages do not feed their newly found links back into this recovery queue. Deeper routes can remain undiscovered. |
| Sitemap is probed for presence; its body is not used as a crawl frontier in the inspected orchestrator | scanner `main.go:791-792`, `1393`, `1938-1939` | URLs available through sitemap indexes need an explicit discovery path. |
| Headless sampling has an absolute 100-page cap | scanner `main.go:452-468`, `2798-2800` | The current 80% default, including a 100% SPA ratio, cannot render every page of larger crawls. The older 35% comment is stale. |
| Rendered HTML persistence sits inside the successful-performance branch | scanner `main.go:2346-2367`; performance `performance.go:389-402` | Usable DOM can be discarded when FCP/LCP are unavailable. Rendering and performance measurement are incorrectly coupled at persistence. |
| Rendered-only discovered pages go through `InsertPage()` | scanner `main.go:1519-1521`; `db/db.go:171-178` | That insertion writes the rendered body into both `html` and `raw_html`, in addition to the raw-source selection defect already audited. |
| Existing NLP results are not associated with a source revision | scanner `db/db.go:398-409`; NLP `main.py:2176` | Rendering can improve a page after NLP has already analyzed or skipped it, with no automatic fresh analysis. |
| Optional Obscura service profile but enabled-by-default consumer flags | Compose `110-117`, `165-169` | Browser-pool can attempt to connect to an Obscura service that was not launched. Existing discovery code does fall back to Chromium on connection failure; the issue is readiness and avoidable failed attempts, not a total absence of fallback. |
| Obscura render fallback is triggered by navigation-result failure | browser pool `pool.py:1139-1154` | A SUCCESS result with unusable content or missing measurements is not automatically another-engine work. Diagnose content acquisition and measurement separately. |

Historical first local check: Docker's Linux engine was initially absent. Docker was subsequently made available and the isolated CDP/content/memory tests ran successfully; see the two Obscura studies. These local results do not establish the configuration or cause of failures in the user's previous deployment. The Kubernetes manifests inspected also lack the Compose browser-pool/Obscura wiring, so the actual deployment still needs identification before promotion.

## Approach selection

| Approach | Benefit | Cost / limitation |
|---|---|---|
| **Selected target: shared discovery queue and reliable evidence, with Obscura primary content acquisition and Chromium after repeated failures** | Uses measured lower memory to collect more pages, preserves engine provenance, and stops spending repeated Obscura attempts on incompatible routes. | Must validate stealth build, unfiltered evidence, NLP parity and total duration before changing defaults. Chromium remains scheduled directly for measurements requiring it. |
| Retain Chromium primary during validation | Preserves the current acquisition baseline while comparing evidence from the candidate engine. | Lower measured content throughput per MiB on the earlier fixtures; this is the current runtime, not the intended final architecture. |
| Raise concurrency and page caps only | Small configuration change that may improve volume. | Existing data-loss and stale-analysis paths would remain; contention may increase measurement failures. |

## Sprint 1: preserve every useful captured observation

Start with the defect that loses evidence already paid for.

1. Persist a valid captured DOM independently of the availability of FCP/LCP. Store render outcome and performance outcome separately. Preserve browser failures and genuine error responses as observations rather than treating them as successful content.
2. Keep original response HTML, rendered DOM, and extracted/shadow text distinct. Capture the navigation response body and headers when available during the same browser visit. A rendered-only result must not overwrite or masquerade as original HTML.
3. Refresh applicable SEO/UX page analysis when improved rendered content arrives, while preserving checks that intentionally examine the original response. Recompute affected aggregates from the selected observations instead of leaving old static summaries in place.
4. Reuse the captured headers, DOM, links, forms, and request timeline across analyzers. Remove duplicate `Last-Modified` requests and repeated equivalent retrievals where the required observation is already present.

Proof: a rendered page with missing performance timings still reaches NLP with its content; a SPA's original shell remains distinguishable from its hydrated DOM; rendered-discovery insertion preserves that distinction; an updated title/H1 is reflected by the intended rendered-content checks.

This sprint changes acquisition and persistence behavior, without adding a user-facing coverage feature or altering KPI pass thresholds.

## Sprint 2: make the initial discovery genuinely broad

Within the existing scan lifecycle, unify discovered URLs from static anchors, sitemap indexes/URL sets, and rendered links into a deduplicated frontier. Expand child discoveries recursively until the requested scope is exhausted or its explicit budget is reached.

1. Normalize URL identities carefully, preserving meaningful query routes and respecting the existing domain perimeter. Track each discovery source.
2. Feed rendered links into discovery even when static crawling returns some pages. Replace the zero-pages-only trigger with specific acquisition evidence: missing rendered routes, unresolved shells, blocked fetches, and pending discovered URLs.
3. Read sitemap URL entries and nested indexes within bounded fetch, depth, size, and page budgets. Do not rely solely on checking that a sitemap exists.
4. Prioritize distinct page types and routes needed by KPIs: home, content, product/service, contact, privacy/legal, search, and language variants where present. Preserve breadth when repetitive navigation or query variants dominate.
5. Replace the disconnected 8-page recovery and 100-page rendering limits with an explicit per-scan acquisition budget. Render the pages whose required observations need a browser, and complete missing measurements within that budget. Static acquisition remains useful for original-response evidence even on fully rendered scans.

Proof: a site whose homepage exposes one route, whose child exposes another, and whose sitemap exposes another is traversed through all three sources; a partially successful static crawl still discovers its JS-only section; duplicate aliases do not consume the budget; test whether the chosen page limit can actually be collected.

## Sprint 3: make collected evidence reach NLP exactly when useful

1. Let the scanner own a page-content revision and readiness metadata. Let NLP own the revision it analyzed and its results. The scanner should not write another service's `nlp_results` field.
2. Queue analysis when suitable content is ready. For render-planned pages, coordinate readiness to avoid repeatedly analyzing temporary shells; static-ready pages may proceed independently.
3. When materially improved content arrives, analyze the new revision. Publish results only if they match the revision analyzed, preventing a stale worker from overwriting newer results.
4. Correct worker claim/transaction semantics so per-page commits cannot release claims for a fetched batch still awaiting analysis. Use a bounded, recoverable claim mechanism and explicit multi-worker tests.
5. Make final aggregation consume compatible page/analysis revisions. Keep incomplete observations visible internally and direct remaining work to the acquisition/analysis stage that can resolve it before the scan deadline.

Proof: a delayed hydration replaces an earlier skipped/shell analysis; two workers do not process the same claimed revision; a slow old analysis cannot overwrite a newer revision; a failed worker does not strand the page; unchanged content does not trigger repeated work.

No additional distributed queue service is assumed necessary. First evaluate what the existing PostgreSQL ownership and transactions can support.

## Sprint 4: diagnose Obscura and use extra compute where it helps

Run this runtime investigation alongside the preceding work once a Docker/deployed stack is available.

1. Identify the actual deployed stack and requested engine settings. Verify the optional profile, service DNS, CDP endpoint resolution, advertised websocket rewriting, connection, context creation, navigation, and extraction separately.
2. Compare Chromium and Obscura on the same target pages, page budget, and observations. Record useful pages/routes recovered, rendered-content completeness, request errors, measurement availability, and time spent. A configured flag is not proof that a browser actually ran.
3. Make disabled/absent engines avoid known-useless connection attempts. For an engine that is connected but produces unusable content, diagnose hydration/challenge/content readiness and route a bounded alternate attempt when justified.
4. Preserve the distinction between usable DOM and real performance measurements; improving content collection must not invent CWV values.
5. Tune concurrent browser work, browser processes, memory limits, and NLP workers against actual CPU/RAM and queue pressure. The current 24/48 session settings are configuration values, not demonstrated safe throughput for the active hardware.

Decision criterion: promote Obscura to the primary content engine only when the selected build captures the required content and produces acceptable NLP results at the requested duration. Memory and fixture speed benefits are already measured; compatibility, semantic fidelity and the fallback cost still need proof. The earlier optional-specialist recommendation is superseded by the user's conditional Obscura-first direction.

### Stealth validation and primary-engine routing

The v0.2.3 Dockerfile enables rendering without the TLS-stealth build feature. Testing `--stealth` on that image alone is insufficient to assess full TLS impersonation. Compare the existing pinned image in normal/stealth mode with the official render+stealth binary in default and unfiltered modes, and with Chromium under the same limits. Preserve release/image hashes and startup logs that identify the active transport.

Default full stealth blocks trackers. The controlled v0.2.3 probe proved that `OBSCURA_BLOCK_TRACKERS=0` restores scripted fetch but still suppresses a classic external script. The context constructor and fork force the plain HTTP client's blocklist on, while the separate stealth transport honors the setting. Fix this split configuration in a pinned build, or validate an upstream correction, before promoting stealth audit acquisition. Retest both classic scripts and fetch/XHR, plus CSS/modules/iframes and consent/network evidence. An environment flag alone is not proof of unfiltered evidence. Keep default tracker-blocking mode as a diagnostic comparison only.

Current stealth findings (2026-10-03): both full-stealth modes captured all 12 fixture pages across two clean runs, using about 37 MiB sampled peak working set at concurrency four versus Chromium's 124 MiB. All 28 successfully paired base-NLP replays matched the selected fields, with optional models disabled. Each stealth mode missed four of six live visits; both BIAT and Medianet timed out in both runs, whereas Chromium acquired them. Fresh native unfiltered-stealth fetches recovered original HTML from both sites. Medianet Markdown worked with a longer budget (~18 seconds total); BIAT Markdown still stalled under 20/40-second outer limits. Thus primary-engine promotion is not accepted yet: fix filtering and diagnose rendering/runtime issues, then validate production NLP and fallback-inclusive duration. No broader NLP or end-to-end acceptance is claimed.

Immediate next implementation order: (1) correct and pin the inconsistent tracker-filter configuration, with constructor/fork and resource-path proof; (2) isolate the BIAT/Medianet rendering bottleneck with fresh-process resource/runtime traces and bounded script/module work; (3) repeat matched acquisition/NLP using the actual production SDK/image and representative FR/EN/AR pages; (4) implement and validate the acquisition-only Obscura-first router below; (5) finish recursive discovery, revision publication and full-scan comparison. The existing `auto` rendering path starts with Chromium and falls back to Obscura, so it needs an explicit content-routing change; do not reverse measurement routing globally. The root-cause work comes before repeated-failure routing, which manages residual incompatibility rather than substituting for fixing it.

Routing proposal, with initial values to be validated rather than treated as final performance tuning:

1. Collect each content page with Obscura using a bounded per-page budget. A usable page requires suitable DOM/text/routes for its intended checks; HTTP success alone does not establish hydration or completeness.
2. For a recoverable isolated failure, permit one fresh-context Obscura retry only if enough scan budget remains. Deterministic unsupported commands and unavailable engines go directly to Chromium; do not repeat a known failing operation.
3. Two consecutive failed attempts for a URL route to Chromium. Three acquisition failures among the latest five distinct URLs of an origin route the remaining pending content pages of that origin to Chromium for this scan. Store failure categories and both engines' observations; do not combine different documents into one unlabeled result.
4. Limit in-flight probes for an origin so concurrent pages do not each repeat the same failed pair before routing changes. A bounded later probe may reassess compatibility; it must not delay pending evidence collection.
5. Chromium is scheduled directly for validated CWV, mobile/network emulation and visual comparisons. Those are planned measurements, not failures attributed to Obscura.
6. Deduplicate by scan/page/content revision so engine recovery does not create duplicate rows or stale NLP publications. Reuse captured source, DOM, links and structured text during the existing visit.

NLP promotion proof: compare matched extracted content, headings, language/metadata, privacy/rights text, page classification, readability, keyword density and resulting KPI findings across FR/EN/AR, hydration, shadow roots and representative live pages. Base worker replay is useful preliminary evidence; optional language/semantic models and end-to-end report tests must also be validated in the production image. Markdown remains an additional cleaned projection; raw/rendered HTML and observation metadata remain available to checks that need them. The replay also showed that naively rendering Markdown back to HTML and passing it through the existing HTML extractor changes selected text/word counts and keywords; specify the text input and keep metadata/shadow evidence explicitly before any input switch.

## Sprint 5: prove broader scans and accurate KPI results

Construct known sites/fixtures with static pages, delayed hydration, nested rendered routes, sitemap-only URLs, multiple languages, redirects, cookie banners, and independently unavailable performance measurements. Verify the expected URL set and evidence fields before checking final KPI decisions.

Then perform matched live scans with identical scope and comparable load. Compare:

- Expected relevant pages/routes actually captured, and why any were missed.
- Pages with usable original and/or rendered evidence for the checks they require.
- Fresh NLP results matching the collected revision.
- Correct expected findings, missed findings, and false alarms.
- End-to-end duration and phase timing, CPU, memory, queue wait, duplicate work, and useful work per browser visit.

These measurements are acceptance evidence for engineers. They do not introduce a coverage threshold into the client report. Existing report status/shape compatibility remains a regression requirement; increasing measured coverage must not be achieved by relabelling missing evidence as success.

## Decisions and remaining uncertainties

- User decision (2026-10-03, image build follow-up): split NLP/browser CPU images
  from the visual/GPU image. FastAPI/NLP bases and the CPU NLP worker now build,
  and offline language/passage checks pass. The optional CPU semantic image also
  builds; matched site/scan and browser/form acceptance remain open. The earlier low-disk obstruction is historical;
  no successful VHD compaction is claimed. See `IMAGE_SPLIT.md`.

- User decision: fix acquisition sturdiness and data management first; spend more compute to obtain broader real evidence.
- User decision: continue tracing backward from each KPI's needs.
- User decision (2026-10-03): explicitly measure Obscura's memory footprint and test its native Markdown dump before choosing its role. Evaluate Markdown as a later NLP projection while preserving original and rendered evidence.
- User decision (2026-10-03, follow-up): test stealth before drawing engine conclusions; prefer Obscura primary with Chromium handling sufficiently repeated failures if acquisition/NLP results are good enough. This supersedes the earlier optional-only target while preserving evidence and duration requirements.
- Proposed first implementation slice: Sprint 1 plus the page-revision coordination needed to ensure recovered DOM reaches NLP. This has a directly identified cause and testable result before expanding discovery volume.
- Proposed architecture: improve the existing scanner, browser pool, PostgreSQL handoff, and NLP worker; no new paid service or general workflow platform.
- Working assumption: the earlier scan-duration objective still applies. An actual baseline and available resource capacity have not yet been measured.
- Unverified: why Obscura failed in the user's prior deployment; this requires a running stack and comparative traces.
- Deferred from the previous ordering: output-level evidence gates and denominator corrections remain correctness work, but they are not the strategy for obtaining better coverage.

The earlier audit remains the defect record. This document supersedes its implementation priorities.
