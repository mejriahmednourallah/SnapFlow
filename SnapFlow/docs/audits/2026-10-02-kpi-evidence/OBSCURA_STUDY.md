# Obscura: memory, content throughput and Markdown study

## Current implementation update (2026-10-04)

The user-supplied VPS baseline still runs upstream Obscura latest, not the
pinned render+stealth candidate. The candidate passes an actual-SDK NodeList
constructor/prototype/query-selector fixture with no script errors. This
isolates the reported incompatibility but does not settle live hydration.
The launcher now defaults to Chromium and explicit --obscura aligns the profile
and feature flags. See [IMPLEMENTATION_VALIDATION.md](IMPLEMENTATION_VALIDATION.md)
for matched candidate/recovery commands and the remaining acceptance criteria.

The corrected render+stealth candidate is built and actual production SDK filtering/script fixtures pass. Live Medianet/BIAT stalls and missing BIAT content remain; primary promotion is not accepted. Shared discovery budgets and controlled real-engine Chromium recovery pass, with about 5.3 s initial recovery versus 1.4 s direct Chromium. Current live memory samples, detailed source judgement and limits are in [ACQUISITION_CHECKPOINT.md](ACQUISITION_CHECKPOINT.md). Earlier unbuilt-candidate and smaller-fixture figures below are historical measurements, not current live acceptance.

Date: 2026-10-03

Follow-up: the user requested full stealth validation before choosing the engine. See [the stealth study](OBSCURA_STEALTH_STUDY.md) and [updated plan](REPLAN.md). The original measurements below concern the pinned standard image; they must not be interpreted as a full TLS-stealth evaluation.

## Test conditions

Both engines ran in isolated Linux Docker containers on the same Docker network, each limited to 2 CPUs and 2 GiB RAM. The shared fixture server and Playwright client were outside the measured engine containers. Chromium includes a small Python TCP relay in its container totals. Memory is sampled every 200 ms using Docker cgroup counters; reported working set subtracts inactive file cache. These are sampled peaks, not kernel high-water marks.

Obscura is pinned to v0.2.3 image digest `475def3ddf1ec513b3d1bc36e8ad15f0d192538cb15f814c77215aa70c418ca2`. Playwright is 1.58.0, with its pinned Linux headless shell. The production browser-pool still pins Playwright 1.44.0; this is not production-version acceptance. No forms were submitted, no active security probes were run, and no production deployment or database was used.

Each fixture phase visits six known page types repeatedly: static, delayed hydration, fetched JSON, open shadow DOM, structured content and a 300-section page. Content readiness uses known markers instead of unconditional CWV observation waits. Each page is held for an equal additional 200 ms so concurrent resident pages can be sampled. Live pages use a 1-second settling interval. Obscura uses native `LP.getMarkdown`; Chromium evaluates exactly the same version-matched open-source converter.

## Resource and throughput observations

Ranges below are observed across fresh-container replicates. CPU seconds are estimated from sampled cumulative counters.

| Engine | Phase | Peak working set MiB | Peak anonymous MiB | Pages captured | Elapsed seconds | Useful pages/s |
|---|---|---|---|---|---|---|
| chromium | connected_idle | 63.44–63.75 | 56.76–56.91 | — | — | — |
| chromium | fixtures_c1 | 86.89–87.03 | 78.85–78.94 | 18/18, 18/18 | 12.62–12.99 | 1.39–1.43 |
| chromium | fixtures_c4 | 131.86–131.91 | 120.01–120.23 | 18/18, 18/18 | 7.54–7.93 | 2.27–2.39 |
| chromium | fixtures_c8 | 190.73–194.40 | 174.60–178.11 | 18/18, 18/18 | 5.48–7.38 | 2.44–3.29 |
| chromium | idle | 62.46–62.84 | 56.00–56.04 | — | — | — |
| obscura | connected_idle | 6.36–6.47 | 4.45–4.72 | — | — | — |
| obscura | fixtures_c1 | 20.25–21.02 | 18.37–18.46 | 18/18, 18/18 | 9.77–9.86 | 1.83–1.84 |
| obscura | fixtures_c4 | 39.07–40.10 | 35.74–36.94 | 18/18, 18/18 | 5.97–6.02 | 2.99–3.01 |
| obscura | fixtures_c8 | 62.76–65.33 | 59.39–61.38 | 18/18, 18/18 | 4.16–4.24 | 4.24–4.33 |
| obscura | idle | 6.36–6.47 | 4.45–4.45 | — | — | — |
| obscura-w4 | connected_idle | 23.01–23.10 | 19.61–19.88 | — | — | — |
| obscura-w4 | fixtures_c1 | 33.27–34.60 | 29.44–30.73 | 18/18, 18/18 | 10.12–10.63 | 1.69–1.78 |
| obscura-w4 | fixtures_c4 | 51.58–53.59 | 47.61–49.23 | 18/18, 18/18 | 6.54–7.19 | 2.50–2.75 |
| obscura-w4 | fixtures_c8 | 77.54–79.44 | 72.31–74.36 | 18/18, 18/18 | 4.53–7.85 | 2.29–3.98 |
| obscura-w4 | idle | 22.61–22.76 | 19.61–19.61 | — | — | — |

## Content-only page timing

Medians include context/page setup, content readiness, snapshot, Markdown export, the equal 200 ms sampling hold and bounded cleanup. They do not include queue wait.

| Engine | Fixture | Median total ms | Median navigation ms | Median readiness ms | Median Markdown export ms |
|---|---|---|---|---|---|
| chromium | /delayed | 1794.54 | 233.84 | 695.64 | 33.71 |
| chromium | /fetch | 1377.41 | 185.3 | 328.1 | 44.52 |
| chromium | /heavy | 1386.84 | 285.44 | 181.16 | 23.17 |
| chromium | /shadow | 1367.7 | 214.99 | 251.38 | 26.89 |
| chromium | /static | 1444.91 | 218.62 | 335.51 | 32.01 |
| chromium | /structured | 1327.65 | 164.72 | 194.39 | 14.19 |
| obscura | /delayed | 1456.79 | 56.44 | 705.41 | 72.44 |
| obscura | /fetch | 1171.65 | 61.5 | 244.2 | 87.06 |
| obscura | /heavy | 986.65 | 67.73 | 113.65 | 61.74 |
| obscura | /shadow | 957.65 | 74.48 | 186.96 | 76.03 |
| obscura | /static | 1205.14 | 53.69 | 170.16 | 112.04 |
| obscura | /structured | 828.23 | 78.26 | 105.27 | 50.59 |
| obscura-w4 | /delayed | 1528.12 | 81.16 | 707.03 | 85.22 |
| obscura-w4 | /fetch | 1470.8 | 87.0 | 642.13 | 101.34 |
| obscura-w4 | /heavy | 1064.13 | 74.81 | 131.28 | 52.11 |
| obscura-w4 | /shadow | 1446.59 | 97.9 | 379.3 | 74.45 |
| obscura-w4 | /static | 1426.88 | 62.47 | 152.94 | 159.18 |
| obscura-w4 | /structured | 1033.36 | 65.18 | 129.66 | 56.08 |

## Live pages

| Engine/run | URL | Outcome | Total seconds | Plain words |
|---|---|---|---|---|
| round-0-chromium | https://example.com/ | success | 1.75 | 135 |
| round-0-chromium | https://www.medianet.tn/ | success | 5.13 | 1857 |
| round-0-chromium | https://www.biat.com.tn/ | success | 6.50 | 1648 |
| round-0-obscura | https://example.com/ | success | 1.55 | 135 |
| round-0-obscura | https://www.medianet.tn/ | error | 12.04 | — |
| round-0-obscura | https://www.biat.com.tn/ | error | 16.65 | — |
| round-1-chromium | https://example.com/ | success | 1.68 | 135 |
| round-1-chromium | https://www.medianet.tn/ | success | 5.56 | 1857 |
| round-1-chromium | https://www.biat.com.tn/ | success | 4.92 | 1648 |
| round-1-obscura | https://example.com/ | success | 1.61 | 135 |
| round-1-obscura | https://www.medianet.tn/ | error | 12.04 | — |
| round-1-obscura | https://www.biat.com.tn/ | error | 14.54 | — |

## Navigation diagnostics

Four fresh-process probes compared `domcontentloaded` with `commit` on BIAT and Medianet, using an 8-second navigation budget followed by a separately bounded DOM probe. All four navigation attempts timed out; no usable DOM was returned by the subsequent 4-second probe. Changing the wait state therefore did not resolve the observed problem within this budget.

Medianet server logs recorded a failed AddThis external-script fetch and a JavaScript `addEventListener` error involving a null element. These are leads for resource-loading and DOM/API compatibility investigation, not proof that either alone caused the timeout. BIAT logs did not identify a specific cause. JSON observations and server logs are preserved under `navigation-diagnostics/`.

## Markdown suitability

Native Markdown preserves headings, links, list entries, image alt text and table cell text in the known-content fixture. It excludes script contents and includes delayed-hydrated content. However it includes CSS-hidden text and navigation/footer boilerplate; its table output has no Markdown header separator, and the converter does not traverse open shadow roots. Relative URLs require the original page URL to interpret them. These findings were also reproduced through native `obscura fetch --dump markdown`.

Markdown is a DOM projection, not OCR. It cannot substitute for original HTML, metadata, headers, script/consent observations, network evidence or Chromium performance measurements. Exporting on the current page adds no second navigation. The same converter works in Chromium, so the format benefit does not require an engine migration.

## Recommended next steps

Measured conclusion: the one-worker Obscura content collector used roughly 3–4 times less peak working-set memory than Chromium on these fixtures, and fixture-batch duration was about 23–35% shorter when comparing the means of two fresh-container runs. All 108 fixture pages per primary engine were acquired. The four-worker Obscura variant used more memory and did not demonstrate a throughput gain with this single-CDP-client setup. This is a content-collection benefit, not a demonstrated full-scan speedup or broad site-compatibility result.

1. Judge an Obscura pilot by useful evidence retained per wall-clock second and per MiB, using the measurements above; do not assume the marketing idle footprint applies to a running scan.
2. Diagnose the BIAT/Medianet resource-loading and DOM/API failures, then validate a larger site corpus and the exact production browser-pool versions before increasing Obscura's role. Test CDP connection/worker distribution before raising worker counts. Retain Chromium for measurements and pages that require unsupported browser behavior.
3. Add a cleaned, structured text/Markdown projection captured during the existing visit: main-content selection, separately retained shadow text, resolved links, correct tables, and source URL/engine/time/hash/revision metadata. Keep raw HTML and rendered DOM alongside it. Benchmark NLP accuracy and runtime before changing the input contract.
4. Complete the scanner evidence/frontier and NLP freshness work already started. Reuse source, rendered DOM, text, links and measurements from each visit, then measure full scan duration. The fixture study is not end-to-end scan acceptance.

## Reproduction and artifacts

Build `V3-Microservices/benchmarks/obscura-study/Dockerfile` as `snapflow/obscura-study:pw1.58`, then run `python V3-Microservices/benchmarks/run_obscura_study.py --live --workers-study`. The token is read from the ignored `benchmarks/obscura.env`; it is never included in results. Raw observations, memory samples and `.html`/`.txt`/`.md` files are under `output/playwright/obscura-study/`.

Primary implementation references: [Obscura v0.2.3 Markdown converter](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-js/src/markdown.rs), [LP CDP method](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-cdp/src/domains/lp.rs), [Playwright headless shell](https://playwright.dev/python/docs/browsers#chromium-headless-shell).
