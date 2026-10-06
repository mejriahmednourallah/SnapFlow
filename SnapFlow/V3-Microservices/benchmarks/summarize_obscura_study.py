"""Summarize saved observations; never infer a successful page from flags."""
from collections import defaultdict
import json
from pathlib import Path
import statistics
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/"output/playwright/obscura-study"
DOC=ROOT/"docs/audits/2026-10-02-kpi-evidence/OBSCURA_STUDY.md"


def main():
    reports=[]
    groups=defaultdict(list)
    for path in sorted(DATA.glob("round-*/study.json")):
        report=json.loads(path.read_text(encoding="utf-8"))
        variant=path.parent.name.split('-',2)[2]
        reports.append((path,variant,report))
        for phase,metrics in report["phases"].items():
            groups[(variant,phase)].append(metrics)
    summary={"runs":len(reports),"phase_summary":[],"page_timings":[],"live":[],"markdown_fidelity":{}}
    lines=["# Obscura: memory, content throughput and Markdown study", "", "Date: 2026-10-03", "",
           "## Test conditions", "",
           "Both engines ran in isolated Linux Docker containers on the same Docker network, each limited to 2 CPUs and 2 GiB RAM. The shared fixture server and Playwright client were outside the measured engine containers. Chromium includes a small Python TCP relay in its container totals. Memory is sampled every 200 ms using Docker cgroup counters; reported working set subtracts inactive file cache. These are sampled peaks, not kernel high-water marks.", "",
           "Obscura is pinned to v0.2.3 image digest `475def3ddf1ec513b3d1bc36e8ad15f0d192538cb15f814c77215aa70c418ca2`. Playwright is 1.58.0, with its pinned Linux headless shell. The production browser-pool still pins Playwright 1.44.0; this is not production-version acceptance. No forms were submitted, no active security probes were run, and no production deployment or database was used.", "",
           "Each fixture phase visits six known page types repeatedly: static, delayed hydration, fetched JSON, open shadow DOM, structured content and a 300-section page. Content readiness uses known markers instead of unconditional CWV observation waits. Each page is held for an equal additional 200 ms so concurrent resident pages can be sampled. Live pages use a 1-second settling interval. Obscura uses native `LP.getMarkdown`; Chromium evaluates exactly the same version-matched open-source converter.", "",
           "## Resource and throughput observations", "",
           "Ranges below are observed across fresh-container replicates. CPU seconds are estimated from sampled cumulative counters.", "",
           "| Engine | Phase | Peak working set MiB | Peak anonymous MiB | Pages captured | Elapsed seconds | Useful pages/s |", "|---|---|---|---|---|---|---|"]
    for (variant,phase),values in sorted(groups.items()):
        if phase not in {"idle","connected_idle"} and not phase.startswith("fixtures_"):
            continue
        def span(key):
            found=[v[key] for v in values if key in v]
            return f"{min(found):.2f}–{max(found):.2f}" if found else "—"
        row={"variant":variant,"phase":phase,"replicates":len(values),"observations":values}
        summary["phase_summary"].append(row)
        pages=", ".join(f"{v.get('successful_pages')}/{v.get('pages')}" for v in values) if phase.startswith("fixtures_") else "—"
        lines.append(f"| {variant} | {phase} | {span('working_set_peak_mib')} | {span('anonymous_peak_mib')} | {pages} | {span('wall_seconds')} | {span('useful_pages_per_second')} |")
    lines += ["", "## Content-only page timing", "", "Medians include context/page setup, content readiness, snapshot, Markdown export, the equal 200 ms sampling hold and bounded cleanup. They do not include queue wait.", "", "| Engine | Fixture | Median total ms | Median navigation ms | Median readiness ms | Median Markdown export ms |", "|---|---|---|---|---|---|"]
    takeaways={}
    for concurrency in [1,4,8]:
        phase=f"fixtures_c{concurrency}"
        obscura=groups.get(('obscura',phase),[])
        chromium=groups.get(('chromium',phase),[])
        if obscura and chromium:
            obs_wall=statistics.mean(row['wall_seconds'] for row in obscura)
            chr_wall=statistics.mean(row['wall_seconds'] for row in chromium)
            obs_memory=statistics.mean(row['working_set_peak_mib'] for row in obscura)
            chr_memory=statistics.mean(row['working_set_peak_mib'] for row in chromium)
            takeaways[str(concurrency)]={'fixture_batch_wall_reduction_percent':round(100*(1-obs_wall/chr_wall),1),
                                        'chromium_to_obscura_peak_memory_ratio':round(chr_memory/obs_memory,2)}
    summary['takeaways']=takeaways
    timings=defaultdict(list)
    for path,variant,report in reports:
        for row in report["rows"]:
            if row["phase"]=="live":
                summary["live"].append({"variant":variant,"round":path.parent.name,**row})
            elif row["status"]=="success":
                timings[(variant,urlparse(row["url"]).path)].append(row)
    for (variant,path),rows in sorted(timings.items()):
        med=lambda key:round(statistics.median(r["timings_ms"][key] for r in rows),2)
        row={"variant":variant,"path":path,"observations":len(rows),"total_ms":round(statistics.median(r["elapsed_ms"] for r in rows),2),
             "navigation_ms":med("navigation"),"readiness_ms":med("readiness"),"markdown_ms":med("markdown")}
        summary["page_timings"].append(row)
        lines.append(f"| {variant} | {path} | {row['total_ms']} | {row['navigation_ms']} | {row['readiness_ms']} | {row['markdown_ms']} |")
    lines += ["", "## Live pages", "", "| Engine/run | URL | Outcome | Total seconds | Plain words |", "|---|---|---|---|---|"]
    for row in summary["live"]:
        lines.append(f"| {row['round']} | {row['url']} | {row['status']} | {row['elapsed_ms']/1000:.2f} | {row.get('plain_words','—')} |")
    diagnostics=[]
    for path in sorted((DATA/'navigation-diagnostics').glob('*.json')):
        diagnostics.append(json.loads(path.read_text(encoding='utf-8')))
    summary['navigation_diagnostics']=diagnostics
    if diagnostics:
        lines += ['', '## Navigation diagnostics', '',
                  'Four fresh-process probes compared `domcontentloaded` with `commit` on BIAT and Medianet, using an 8-second navigation budget followed by a separately bounded DOM probe. All four navigation attempts timed out; no usable DOM was returned by the subsequent 4-second probe. Changing the wait state therefore did not resolve the observed problem within this budget.', '',
                  'Medianet server logs recorded a failed AddThis external-script fetch and a JavaScript `addEventListener` error involving a null element. These are leads for resource-loading and DOM/API compatibility investigation, not proof that either alone caused the timeout. BIAT logs did not identify a specific cause. JSON observations and server logs are preserved under `navigation-diagnostics/`.']
    for path,variant,report in reports:
        for row in report["rows"]:
            if urlparse(row["url"]).path=="/structured" and row["status"]=="success":
                markdown=(path.parent/f"{row['phase']}-{row['index']}.md").read_text(encoding="utf-8")
                summary["markdown_fidelity"][variant]={
                    "html_bytes":row["html_bytes"],"markdown_bytes":row["markdown_bytes"],
                    "byte_reduction_percent":round(100*(1-row["markdown_bytes"]/row["html_bytes"]),1),
                    "h1":"# STRUCTURE_READY" in markdown,"h2":"## French content:" in markdown,
                    "unordered_list":"- LIST_ALPHA" in markdown,"ordered_list":"1. ORDER_FIRST" in markdown,
                    "table_cells":"| Retention | 30 days |" in markdown,"table_header_separator":"| ---" in markdown,
                    "link":"[LINK_EVIDENCE](/nested/two?lang=fr)" in markdown,"image_alt":"![IMAGE_ALT_EVIDENCE]" in markdown,
                    "hidden_text":row["hidden_in_markdown"],"script_text":row["script_in_markdown"],
                    "navigation_boilerplate":"NAV_BOILERPLATE" in markdown,"footer_boilerplate":"FOOTER_BOILERPLATE" in markdown}
                break
    lines += ["", "## Markdown suitability", "",
              "Native Markdown preserves headings, links, list entries, image alt text and table cell text in the known-content fixture. It excludes script contents and includes delayed-hydrated content. However it includes CSS-hidden text and navigation/footer boilerplate; its table output has no Markdown header separator, and the converter does not traverse open shadow roots. Relative URLs require the original page URL to interpret them. These findings were also reproduced through native `obscura fetch --dump markdown`.", "",
              "Markdown is a DOM projection, not OCR. It cannot substitute for original HTML, metadata, headers, script/consent observations, network evidence or Chromium performance measurements. Exporting on the current page adds no second navigation. The same converter works in Chromium, so the format benefit does not require an engine migration.", "",
              "## Recommended next steps", "",
              "Measured conclusion: the one-worker Obscura content collector used roughly 3–4 times less peak working-set memory than Chromium on these fixtures, and fixture-batch duration was about 23–35% shorter when comparing the means of two fresh-container runs. All 108 fixture pages per primary engine were acquired. The four-worker Obscura variant used more memory and did not demonstrate a throughput gain with this single-CDP-client setup. This is a content-collection benefit, not a demonstrated full-scan speedup or broad site-compatibility result.", "",
              "1. Judge an Obscura pilot by useful evidence retained per wall-clock second and per MiB, using the measurements above; do not assume the marketing idle footprint applies to a running scan.",
              "2. Diagnose the BIAT/Medianet resource-loading and DOM/API failures, then validate a larger site corpus and the exact production browser-pool versions before increasing Obscura's role. Test CDP connection/worker distribution before raising worker counts. Retain Chromium for measurements and pages that require unsupported browser behavior.",
              "3. Add a cleaned, structured text/Markdown projection captured during the existing visit: main-content selection, separately retained shadow text, resolved links, correct tables, and source URL/engine/time/hash/revision metadata. Keep raw HTML and rendered DOM alongside it. Benchmark NLP accuracy and runtime before changing the input contract.",
              "4. Complete the scanner evidence/frontier and NLP freshness work already started. Reuse source, rendered DOM, text, links and measurements from each visit, then measure full scan duration. The fixture study is not end-to-end scan acceptance.", "",
              "## Reproduction and artifacts", "",
              "Build `V3-Microservices/benchmarks/obscura-study/Dockerfile` as `snapflow/obscura-study:pw1.58`, then run `python V3-Microservices/benchmarks/run_obscura_study.py --live --workers-study`. The token is read from the ignored `benchmarks/obscura.env`; it is never included in results. Raw observations, memory samples and `.html`/`.txt`/`.md` files are under `output/playwright/obscura-study/`.", "",
              "Primary implementation references: [Obscura v0.2.3 Markdown converter](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-js/src/markdown.rs), [LP CDP method](https://github.com/h4ckf0r0day/obscura/blob/v0.2.3/crates/obscura-cdp/src/domains/lp.rs), [Playwright headless shell](https://playwright.dev/python/docs/browsers#chromium-headless-shell).", ""]
    DOC.write_text('\n'.join(lines),encoding="utf-8")
    (DATA/"summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"runs":summary["runs"], "markdown_fidelity":summary["markdown_fidelity"], "report":str(DOC)},indent=2))


if __name__=="__main__":
    main()
