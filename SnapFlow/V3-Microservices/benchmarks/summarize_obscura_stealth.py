"""Generate the stealth follow-up report from observations, not expectations."""
from collections import defaultdict
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'output/playwright/obscura-study/stealth-clean'
REPORT = ROOT/'docs/audits/2026-10-02-kpi-evidence/OBSCURA_STEALTH_STUDY.md'
studies = []
for folder in sorted(OUT.glob('round-*')):
    data = json.loads((folder/'study.json').read_text(encoding='utf-8'))
    studies.append((folder.name.split('-', 2)[2], data))
groups = defaultdict(list)
for variant, data in studies:
    groups[variant].append(data)


def span(values):
    return f'{min(values):.2f}–{max(values):.2f}'


lines = ['# Obscura stealth follow-up', '', 'Date: 2026-10-03', '',
    '## Test scope and build distinction', '',
    'Two fresh-container rounds, reversing engine order in round two. Each engine has 2 CPUs and 2 GiB RAM. '
    'Each round acquires six known fixtures at concurrency four, then example.com, Medianet and BIAT with a '
    '10-second navigation timeout and a separately bounded whole-page operation. Cleanup can add elapsed time. '
    'This tests the three earlier targets, not broad web compatibility or end-to-end scan performance.', '',
    'Initial diagnostic runs tested five variants with verbose logging: Chromium; pinned Obscura Docker image normal; that image with `--stealth`; official '
    'v0.2.3 render+stealth binaries with `--stealth`; the same full stealth with `OBSCURA_BLOCK_TRACKERS=0`. '
    'The standard Dockerfile enables `render` without the TLS-stealth feature. Startup logs distinguish '
    '`tracker blocking` from `TLS fingerprint impersonation + tracker blocking`. The latter banner describes '
    'the compiled feature. The `unfiltered` variant name means the setting was requested, not that all resource '
    'paths honored it; the controlled probe below establishes the remaining filter defect. '
    'Those verbose runs produced excessive logs and are retained only as diagnostics. The resource/timing '
    'tables below use two clean non-verbose rounds of Chromium, full stealth and unfiltered full stealth.', '',
    'Release archive SHA256: `1283fff4b781eca438294ae1ba4bf986b63d7628097150a3910ed8f3e3e2142e`. '
    'This hash is locally recorded provenance, not a checksum verified against an upstream checksum asset. '
    'Image IDs and redacted server logs are saved with the results. Playwright 1.58.0 is the study client; '
    'production still uses 1.44.0, so production-version acceptance remains outstanding.', '',
    '## Observed resource use and acquisition', '',
    'Peak working set is sampled every 200 ms, subtracting inactive file cache. Chromium totals include '
    'a small Python TCP relay; the shared driver is outside both measured engines.', '',
    '| Variant | Fixture successes | Fixture batch seconds | Fixture peak MiB | Live peak MiB | Live successes |',
    '|---|---:|---:|---:|---:|---:|']
for variant, rows in groups.items():
    fixture = [d['phases']['fixtures_c4'] for d in rows]
    live = [d['phases']['live'] for d in rows]
    success = sum(r['status']=='success' for d in rows for r in d['rows'] if r['phase']=='live')
    count = sum(r['phase']=='live' for d in rows for r in d['rows'])
    lines.append(f"| {variant} | {sum(p['successful_pages'] for p in fixture)}/{sum(p['pages'] for p in fixture)} | "
        f"{span([p['wall_seconds'] for p in fixture])} | {span([p['working_set_peak_mib'] for p in fixture])} | "
        f"{span([p['working_set_peak_mib'] for p in live])} | {success}/{count} |")
lines += ['', '## Matched live visits', '', '| Variant | Site | Successes | Total seconds |', '|---|---|---:|---:|']
for variant, rows in groups.items():
    sites = defaultdict(list)
    for data in rows:
        for row in data['rows']:
            if row['phase']=='live':
                sites[urlparse(row['url']).hostname].append(row)
    for site, visits in sites.items():
        lines.append(f"| {variant} | {site} | {sum(r['status']=='success' for r in visits)}/{len(visits)} | "
                     f"{span([r['elapsed_ms']/1000 for r in visits])} |")
lines += ['', '## Confirmed tracker-filtering defect', '',
    'A controlled tracker hostname was mapped to the local fixture server inside Docker; no analytics '
    'requests were sent to the public service. The fixture separately loads a classic external script and '
    'makes a scripted cross-origin fetch, recording both received requests and executed DOM markers.', '',
    '| Mode | Classic script requests received | Scripted fetch requests received | Script marker | Fetch marker |',
    '|---|---:|---:|---|---|']
for mode in ['normal', 'stealth', 'stealth-unfiltered']:
    file = OUT/'tracker-probe'/f'{mode}.json'
    if file.exists():
        row = json.loads(file.read_text(encoding='utf-8'))
        lines.append(f"| {mode} | {row['classic_script_requests']} | {row['scripted_fetch_requests']} | "
                     f"{row['marker']} | {row['fetch_marker']} |")
lines += ['',
    '`OBSCURA_BLOCK_TRACKERS=0` restored the scripted fetch but did not restore the classic external script. '
    'The v0.2.3 context constructor and context fork unconditionally set `ObscuraHttpClient.block_trackers=true` '
    'when stealth is enabled, while the separate `StealthHttpClient` reads the environment override. '
    'This is a concrete split in filtering configuration, supported by the source and controlled observations. '
    'It must be corrected across all resource paths before stealth can supply unfiltered audit evidence. '
    'The audit must not interpret a filtered absence of a tracker as a passing observation. '
    'This defect does not establish the root cause of the BIAT/Medianet rendering stalls.', '',
    '## Fresh-process native CLI probes', '',
    'Unfiltered full stealth fetched the original Medianet response (149,932 bytes, about 5.44 seconds) '
    'and BIAT response (159,911 bytes, about 3.42 seconds). These captures establish main-response access '
    'for those requests; they do not establish complete rendered content or subresource success.', '',
    'Medianet native Markdown failed at its 10-second navigation deadline but succeeded with a 30-second '
    'budget in about 18.07 seconds total (54,704 bytes). BIAT native Markdown was still running when the '
    'outer process budget expired at approximately 20 and 40 seconds for the two attempts. These fresh CLI '
    'probes bypass Playwright/CDP, so the observed BIAT rendering stall is not solely a Playwright wait-event issue. '
    'A precise resource-loading/runtime cause remains unproven. The longer Medianet budget is diagnostic '
    'evidence, not a matched speed result or a reason to extend every scan page.', '',
    '## NLP replay', '',
    'Replay uses the actual worker main-content extractor, base content analyzer, page classifier, H1 and meta '
    'checks on saved DOM, with separately captured shadow text. It has no database writes. NLTK corpora are '
    'checked locally and downloads suppressed; optional spaCy, LanguageTool and semantic models are explicitly '
    'disabled. This is preliminary input parity, not full multilingual/optional-model or KPI/report acceptance.']
if (OUT/'nlp-replay.json').exists():
    nlp = json.loads((OUT/'nlp-replay.json').read_text(encoding='utf-8'))
    lines += ['', '| Variant | Paired successes with Chromium | Identical selected NLP fields | Missing candidate captures |',
              '|---|---:|---:|---:|']
    for variant in groups:
        if variant=='chromium':
            continue
        paired = [r for r in nlp['comparisons'] if r['variant']==variant]
        comparable = [r for r in paired if 'differing_fields' in r]
        lines.append(f"| {variant} | {len(comparable)} | {sum(r['differing_fields']==[] for r in comparable)} | "
                     f"{sum(r['status']!='success' for r in paired)} |")
    differences = [{'variant':r['variant'], 'round':r['round'], 'url':r['url'], 'fields':r['differing_fields']}
                   for r in nlp['comparisons'] if r.get('differing_fields')]
    lines += ['', 'Paired differences: '+('none in these selected fields.' if not differences else
              '`'+json.dumps(differences,ensure_ascii=False)+'`'), '',
              'Markdown is rendered to text and analyzed separately without synthesizing missing metadata. '
              'Its word-count differences and metadata/H1 results are saved in `nlp-replay.json`. '
              'The earlier hidden-text, boilerplate, table and shadow-root limitations remain acquisition/input work.']
lines += ['', '## Decision and next work', '',
    'The user-selected target remains Obscura primary content acquisition with Chromium after repeated failures, '
    'conditional on evidence and NLP acceptance. These measurements determine which build and mode can be '
    'promoted; lower RAM alone cannot compensate for missing pages. No production defaults or deployment were changed.', '',
    '1. Verify failures with fresh-process navigation and native CLI before attributing them to anti-bot detection or CDP. '
    'Distinguish upstream response, resource loading, engine/runtime compatibility and extraction readiness.',
    '2. Fix the confirmed split tracker-filtering configuration in a pinned Obscura build or validate an upstream '
    'fix. Repeat the classic-script and scripted-fetch probe before any stealth audit pilot. The environment '
    'setting alone is insufficient in v0.2.3. Keep unfiltered original-response evidence and directly scheduled '
    'Chromium observations for security/consent checks during validation.',
    '3. Finish the shared recursive frontier and revision-aware evidence handoff, then add bounded Obscura-first routing '
    'with per-page attempts and origin-level repeated-failure routing as specified in `REPLAN.md`.',
    '4. Validate production SDK/image, multilingual/model NLP and known expected KPI findings. Measure full scan '
    'duration including Chromium recovery work before changing engine defaults.', '',
    '## Reproduction and primary sources', '',
    '`python V3-Microservices/benchmarks/prepare_obscura_stealth.py`; build '
    '`V3-Microservices/benchmarks/obscura-stealth.Dockerfile` from the workspace root as '
    '`snapflow/obscura-stealth:v0.2.3-study`; run `run_obscura_stealth_study.py`, '
    '`compare_obscura_nlp.py` and `summarize_obscura_stealth.py`. Clean command: '
    '`python V3-Microservices/benchmarks/run_obscura_stealth_study.py --output-folder stealth-clean '
    '--variants chromium obscura-full-stealth obscura-full-stealth-unfiltered`. Results: '
    '`output/playwright/obscura-study/stealth-clean/`; initial diagnostics and native probes are under `stealth/`. '
    'The CDP token stays in ignored `benchmarks/obscura.env`.', '',
    '[Versioned Dockerfile](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/Dockerfile), '
    '[stealth build flag handling](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-cli/src/main.rs), '
    '[tracker-blocking configuration](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-net/src/wreq_client.rs), '
    '[context constructor/fork override](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-browser/src/context.rs), '
    '[plain HTTP client filter](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-net/src/client.rs).', '']
REPORT.write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'studies':len(studies), 'report':str(REPORT)}), flush=True)
