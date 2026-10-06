# Obscura stealth follow-up

Date: 2026-10-03

## Test scope and build distinction

Two fresh-container rounds, reversing engine order in round two. Each engine has 2 CPUs and 2 GiB RAM. Each round acquires six known fixtures at concurrency four, then example.com, Medianet and BIAT with a 10-second navigation timeout and a separately bounded whole-page operation. Cleanup can add elapsed time. This tests the three earlier targets, not broad web compatibility or end-to-end scan performance.

Initial diagnostic runs tested five variants with verbose logging: Chromium; pinned Obscura Docker image normal; that image with `--stealth`; official v0.2.3 render+stealth binaries with `--stealth`; the same full stealth with `OBSCURA_BLOCK_TRACKERS=0`. The standard Dockerfile enables `render` without the TLS-stealth feature. Startup logs distinguish `tracker blocking` from `TLS fingerprint impersonation + tracker blocking`. The latter banner describes the compiled feature. The `unfiltered` variant name means the setting was requested, not that all resource paths honored it; the controlled probe below establishes the remaining filter defect. Those verbose runs produced excessive logs and are retained only as diagnostics. The resource/timing tables below use two clean non-verbose rounds of Chromium, full stealth and unfiltered full stealth.

Release archive SHA256: `1283fff4b781eca438294ae1ba4bf986b63d7628097150a3910ed8f3e3e2142e`. This hash is locally recorded provenance, not a checksum verified against an upstream checksum asset. Image IDs and redacted server logs are saved with the results. Playwright 1.58.0 is the study client; production still uses 1.44.0, so production-version acceptance remains outstanding.

## Observed resource use and acquisition

Peak working set is sampled every 200 ms, subtracting inactive file cache. Chromium totals include a small Python TCP relay; the shared driver is outside both measured engines.

| Variant | Fixture successes | Fixture batch seconds | Fixture peak MiB | Live peak MiB | Live successes |
|---|---:|---:|---:|---:|---:|
| chromium | 12/12 | 2.46–2.52 | 123.96–124.16 | 177.36–182.34 | 6/6 |
| obscura-full-stealth | 12/12 | 2.28–2.69 | 36.88–37.19 | 91.62–99.21 | 2/6 |
| obscura-full-stealth-unfiltered | 12/12 | 1.91–2.42 | 37.30–37.34 | 85.61–96.46 | 2/6 |

## Matched live visits

| Variant | Site | Successes | Total seconds |
|---|---|---:|---:|
| chromium | example.com | 2/2 | 1.67–1.89 |
| chromium | www.medianet.tn | 2/2 | 5.16–6.91 |
| chromium | www.biat.com.tn | 2/2 | 5.45–6.73 |
| obscura-full-stealth | example.com | 2/2 | 1.83–2.08 |
| obscura-full-stealth | www.medianet.tn | 0/2 | 11.65–11.90 |
| obscura-full-stealth | www.biat.com.tn | 0/2 | 12.06–12.09 |
| obscura-full-stealth-unfiltered | example.com | 2/2 | 1.75–1.80 |
| obscura-full-stealth-unfiltered | www.medianet.tn | 0/2 | 10.89–11.59 |
| obscura-full-stealth-unfiltered | www.biat.com.tn | 0/2 | 12.05–12.07 |

## Confirmed tracker-filtering defect

A controlled tracker hostname was mapped to the local fixture server inside Docker; no analytics requests were sent to the public service. The fixture separately loads a classic external script and makes a scripted cross-origin fetch, recording both received requests and executed DOM markers.

| Mode | Classic script requests received | Scripted fetch requests received | Script marker | Fetch marker |
|---|---:|---:|---|---|
| normal | 1 | 1 | TRACKER_EXECUTED | FETCH_EXECUTED |
| stealth | 0 | 0 | NOT_EXECUTED | NOT_EXECUTED |
| stealth-unfiltered | 0 | 1 | NOT_EXECUTED | FETCH_EXECUTED |

`OBSCURA_BLOCK_TRACKERS=0` restored the scripted fetch but did not restore the classic external script. The v0.2.3 context constructor and context fork unconditionally set `ObscuraHttpClient.block_trackers=true` when stealth is enabled, while the separate `StealthHttpClient` reads the environment override. This is a concrete split in filtering configuration, supported by the source and controlled observations. It must be corrected across all resource paths before stealth can supply unfiltered audit evidence. The audit must not interpret a filtered absence of a tracker as a passing observation. This defect does not establish the root cause of the BIAT/Medianet rendering stalls.

## Fresh-process native CLI probes

Unfiltered full stealth fetched the original Medianet response (149,932 bytes, about 5.44 seconds) and BIAT response (159,911 bytes, about 3.42 seconds). These captures establish main-response access for those requests; they do not establish complete rendered content or subresource success.

Medianet native Markdown failed at its 10-second navigation deadline but succeeded with a 30-second budget in about 18.07 seconds total (54,704 bytes). BIAT native Markdown was still running when the outer process budget expired at approximately 20 and 40 seconds for the two attempts. These fresh CLI probes bypass Playwright/CDP, so the observed BIAT rendering stall is not solely a Playwright wait-event issue. A precise resource-loading/runtime cause remains unproven. The longer Medianet budget is diagnostic evidence, not a matched speed result or a reason to extend every scan page.

## NLP replay

Replay uses the actual worker main-content extractor, base content analyzer, page classifier, H1 and meta checks on saved DOM, with separately captured shadow text. It has no database writes. NLTK corpora are checked locally and downloads suppressed; optional spaCy, LanguageTool and semantic models are explicitly disabled. This is preliminary input parity, not full multilingual/optional-model or KPI/report acceptance.

| Variant | Paired successes with Chromium | Identical selected NLP fields | Missing candidate captures |
|---|---:|---:|---:|
| obscura-full-stealth | 14 | 14 | 4 |
| obscura-full-stealth-unfiltered | 14 | 14 | 4 |

Paired differences: none in these selected fields.

Markdown is rendered to text and analyzed separately without synthesizing missing metadata. Its word-count differences and metadata/H1 results are saved in `nlp-replay.json`. The earlier hidden-text, boilerplate, table and shadow-root limitations remain acquisition/input work.

## Decision and next work

The user-selected target remains Obscura primary content acquisition with Chromium after repeated failures, conditional on evidence and NLP acceptance. These measurements determine which build and mode can be promoted; lower RAM alone cannot compensate for missing pages. No production defaults or deployment were changed.

1. Verify failures with fresh-process navigation and native CLI before attributing them to anti-bot detection or CDP. Distinguish upstream response, resource loading, engine/runtime compatibility and extraction readiness.
2. Fix the confirmed split tracker-filtering configuration in a pinned Obscura build or validate an upstream fix. Repeat the classic-script and scripted-fetch probe before any stealth audit pilot. The environment setting alone is insufficient in v0.2.3. Keep unfiltered original-response evidence and directly scheduled Chromium observations for security/consent checks during validation.
3. Finish the shared recursive frontier and revision-aware evidence handoff, then add bounded Obscura-first routing with per-page attempts and origin-level repeated-failure routing as specified in `REPLAN.md`.
4. Validate production SDK/image, multilingual/model NLP and known expected KPI findings. Measure full scan duration including Chromium recovery work before changing engine defaults.

## Reproduction and primary sources

`python V3-Microservices/benchmarks/prepare_obscura_stealth.py`; build `V3-Microservices/benchmarks/obscura-stealth.Dockerfile` from the workspace root as `snapflow/obscura-stealth:v0.2.3-study`; run `run_obscura_stealth_study.py`, `compare_obscura_nlp.py` and `summarize_obscura_stealth.py`. Clean command: `python V3-Microservices/benchmarks/run_obscura_stealth_study.py --output-folder stealth-clean --variants chromium obscura-full-stealth obscura-full-stealth-unfiltered`. Results: `output/playwright/obscura-study/stealth-clean/`; initial diagnostics and native probes are under `stealth/`. The CDP token stays in ignored `benchmarks/obscura.env`.

[Versioned Dockerfile](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/Dockerfile), [stealth build flag handling](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-cli/src/main.rs), [tracker-blocking configuration](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-net/src/wreq_client.rs), [context constructor/fork override](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-browser/src/context.rs), [plain HTTP client filter](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-net/src/client.rs).
