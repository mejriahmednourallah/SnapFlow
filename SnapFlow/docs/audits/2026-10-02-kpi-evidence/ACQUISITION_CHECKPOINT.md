# Acquisition and NLP implementation checkpoint — 2026-10-04

The acquisition-first goal remains active. Current engine/model defaults are
unchanged. These results supersede earlier statements that the CPU browser base,
pinned Obscura correction and recursive discovery were unbuilt or unwired.

Latest phase: see [IMPLEMENTATION_VALIDATION.md](IMPLEMENTATION_VALIDATION.md)
for deployed-baseline gaps, readiness/streaming/late-frontier repairs, browser
recycling, durable admission, fair shared-LanguageTool trials and VPS commands.
Current checks are worker 155+one skipped, aggregator 139, browser 19, real PG
ten and all scanner Go packages passing. Older measurements below retain
their stated scope; none establish full-stack 500-page acceptance.

## Implemented and verified

| Change | What it fixes | Proof and practical limit |
|---|---|---|
| Pinned Obscura render+stealth build | Classic-script and fetch transports disagreed about tracker filtering | Actual production SDK: default stealth blocks both; unfiltered stealth permits both. Candidate `snapflow/obscura-fixed:v0.2.3`, manifest `843d9ae96bfa…`; upstream v0.2.3 commit and archive digest retained in `source.lock.json`. |
| Obscura incremental script scheduling | One slow asynchronous resource discarded completed classic scripts and inline boot code; error pages could execute as script | Before/after six-fixture DOM/event observations preserve completed boot and prevent 404 execution. Slow asynchronous navigation still spends the four-second watchdog; live compatibility is not solved. |
| Portable visible-text and shadow capture | Obscura innerText included body CSS and joined paragraphs; shadow text duplicated nested/slotted content or included hidden hosts | Actual Playwright 1.44 packaged pool: both engines pass known visibility, inline-boundary, nested-root and slotted-content assertions. Original scripts/HTML remain intact. Measurement visits now capture their own shadow observation too. |
| Shared discovery attempt budget | A ten-second navigation allowance did not bound later CDP extraction/cleanup | The wrapper bounds connection, queue, navigation, extraction and cleanup together. Controlled actual-engine recovery returns useful content within the total ten-second page budget. Server-side cancellation/resource release still needs workload proof. |
| Recursive scanner frontier | Partially successful static crawls omitted JavaScript children and sitemap-only routes | Real scanner, Colly and PostgreSQL collect the known six-route set: static page, nested sitemap entry, JS parent/child/grandchild and home. Browser responses are a declared adapter, so this is not browser performance acceptance. |
| Requested rendering scope | Independent hard 100-page limit truncated larger requested scans | Default cap follows collected/requested scope; an explicit operator `HEADLESS_MAX_PAGES` still applies. A 150-page selection fixture verifies the cap correction, not 150 live measured pages. |
| Atomic rendered publication | NLP could see a new DOM with old observation metadata | Discovery upsert and measurement update publish DOM plus matching evidence together; revision triggers include source, Last-Modified and shadow changes. Date-only HTTP clock changes do not queue new NLP work. |
| Late SEO/UX refresh | Headless DOM was stored after summary calculation, leaving findings based on older metadata | Phase order is retained. Selected page SEO/UX observations refresh and content summaries rebuild after later successful captures. Integration adds descriptions only during measurement and verifies zero stale missing-description summary/detail entries. |
| Measurement response handoff | `/render` dropped original response, headers and explicit measurement availability | Actual packaged Chromium endpoint retains navigation body/status/Last-Modified/shadow and availability. Scanner stores these as `rendered_response`; initial raw HTML remains separate. NLP uses the latest captured headers without another HEAD request. |
| Real database aggregator reloads | Three queries passed RealDictCursor as a cursor name, failing outside permissive test adapters | Correct `cursor_factory` calls reload scan state, canonical KPI payload and previous quality artifact against PostgreSQL. Actual report contract retains 73 KPIs in the fixture. |

The report still distinguishes missing CWV from useful content. A page with
captured DOM and unavailable timings is analyzed; unavailable timings are not
invented. No client coverage threshold was added.

## Independently reviewed NLP corrections

Source review of the canonical live homepages found two wrong classifications:
BIAT was contact because of contact widgets, and Medianet's localized root was
FAQ because of embedded question sections. Current identity/schema, route and
main-content classification makes both landing pages. Footer forms, hostname
words, query strings and nested article schema no longer define the page type.
Fourteen development regressions cover these triggers; six packaged captured
homepage replays confirm the correction. This is not a general accuracy score.

The multilingual example.com capture was declared English but analyzed using an
Arabic snippet. Valid words such as “domain”, “use” and “documentation” appeared
in typo samples. Its initial density was **0.5897**. The worker now honors the
declared document language and checks selected blocks against their declared
language dictionary. Code remains content evidence but is excluded from spelling.
Unsupported or unavailable dictionaries are explicitly unmeasured. The saved
English/French/Arabic blocks produce **0.0** typo density on both engine captures;
Russian, Chinese and Spanish blocks remain unmeasured. This is correction of an
inspected false alarm, not a claim that all multilingual text is error-free.

Previously corrected thin-content policy ownership, affected-URL union,
language-specific readability, Arabic alignment and lexical-diversity evidence
remain in place. The source-refreshed optional MiniLM image retains the expected
exact passages in **9/9** controlled FR/EN/AR location cases. Larger embeddings
remain unjustified by current evidence. NLI remains a verification candidate,
with documented retention contradictions; it does not decide production verdicts.

Actual packaged worker + real PostgreSQL: **six current revisions published**,
captured date preserved, original source separated from selected DOM, and a
repeat cycle processes **zero** pages. First cycle was **11.04 seconds** under
two-CPU/two-GB limits, including initialization; this is not steady-state page
timing or an end-to-end scan baseline. Real database-backed report construction
retains all six deliberately repetitive pages in content-quality evidence and
preserves the current canonical schema.

## Live Obscura comparison and decision

Two alternating rounds used example.com, canonical Medianet and BIAT targets,
the actual packaged Playwright 1.44 client, the corrected render+stealth binary,
and matching two-CPU/two-GB container limits. Old Medianet.tn redirects to a
different domain and was correctly blocked by the unchanged audit perimeter;
that observation is not an engine failure.

Before the later shared-budget correction, the canonical run recorded:

| Target | Chromium | Corrected unfiltered Obscura |
|---|---|---|
| example.com | 1.69–1.94 s, two successes | 1.72–1.80 s, two successes |
| Medianet canonical root | 4.50–6.75 s, two successes | One timeout; one success at 17.17 s, outside the intended ten-second allowance |
| BIAT root | 5.79–6.82 s, two successes | One timeout; one success at 10.04 s |

The BIAT source/DOM/Markdown review found news/banner/testimonial/figure content
absent from the Obscura projection. Visible text was 2,289 characters versus
4,718 for Chromium in that paired capture. Similar NLP counts do not disprove
this missing evidence: the existing extractor selects only part of each page.
**Do not promote Obscura or switch NLP to Markdown from these results.**

Sampled live Obscura engine working-set peaks were **103.6/144.7 MiB**. The client
peaked at **230.9/240.5 MiB** and includes Python, Playwright and Chromium for
both visit types. These are container samples, not engine-only RSS or a fair
Chromium process comparison. Earlier smaller local-fixture measurements remain
historical and must not replace the live values.

After the shared-budget fix, controlled slow-script recovery with real engines
cost **5.30–5.35 s** for the first three routed pages versus **1.40–1.49 s** for
direct Chromium. The fourth distinct failed-origin page bypassed Obscura and
took about **1.40 s**. All four recovered the independently specified ready DOM
inside ten seconds. This proves bounded recovery, not preservation of full-scan
duration or resolution of the remaining engine compatibility defect.

## Checks, storage and evidence files

- All Go packages pass. Worker: **148 passed, one skipped**. Aggregator:
  **132 passed**. Browser pool: **17 passed**. Real PostgreSQL handoff: **7 passed**.
- Actual packaged Chromium response/shadow probe passes. Actual worker/real-SQL
  handoff and actual host aggregator/real-SQL report/reload probes pass.
- Obsolete filter-only image removed; six obsolete cache snapshots reclaimed
  about **572 MB**. Current candidate/compiler cache retained for continued root
  investigation. Nine image tags, three stopped containers and all four volumes
  remain. Docker cache after cleanup: **8.264 GB**, with **5.72 GB reclaimable**.
  Host C: had **8,645,791,744 bytes available before this targeted cache cleanup**;
  no equivalent host-space recovery or VHD compaction is inferred.

Evidence: [scanner integration](../../../output/scanner-acquisition-integration.json),
[packaged worker handoff](../../../output/nlp-accuracy-study/scanner-worker-handoff.json),
[real content report](../../../output/nlp-accuracy-study/scanner-content-report.json),
[packaged browser response](../../../output/playwright/production-discovery.json),
[live NLP replay](../../../output/nlp-accuracy-study/production-live-nlp.json),
[live engine resources](../../../output/playwright/obscura-study/production-canonical-clean/resource-summary.json),
[recovery](../../../output/playwright/obscura-study/production-recovery/round-0/recovery.json),
[cache cleanup](../../../output/docker-filter-cache-cleanup.log).

## Next implementation and acceptance

1. Propagate the total scan deadline into headless/mobile work; record selected,
   attempted, useful DOM and actually measured counts separately. Current
   headless coverage telemetry still counts selected URLs. Keep this internal.
2. Continue Obscura live hydration/runtime diagnosis, including incomplete-content
   success, modules/styles and missing response bodies. Repeat matched captures
   after fixes, without letting retries substitute for acquisition repair.
3. Complete render readiness coordination to avoid early shell NLP and repeated
   work. Validate live discovery and measurement-image/form-executor behavior.
4. Independently label site/KPI/language cases, including hidden-by-stylesheet
   content and unsupported spelling blocks. Monolingual provider absence and
   partial spelling scope must not become assumed accuracy.
5. Run the actual full stack with equal domains/page scope; measure queue time,
   end-to-end duration including Chromium recovery, CPU/RAM and final KPI errors.
   Only then decide defaults or a model/input change.

No deployment, full-scan acceptance, broad website accuracy score or engine/model
promotion is claimed. The next steps remain authorized under the active goal.
