"""Offline, output-first audit probes. Does not change application behavior.

Run from any directory: python path/to/reproduce.py
Writes results.json beside this script. Synthetic inputs are explicitly labelled;
production builder functions are called with DB and HTTP access replaced.
"""
import ast
from collections import Counter
from contextlib import ExitStack
from copy import deepcopy
import csv
import hashlib
import json
from pathlib import Path
import socket
import sys
from unittest.mock import patch
from urllib.request import Request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT / "V3-Microservices/v3-aggregator"))
import main as aggregator
from kpi_builder import build_kpi_centric_report


def flatten(report):
    return {
        kpi["kpi_id"]: kpi
        for axis in report["axes"].values()
        for kpi in axis.values()
        if isinstance(kpi, dict) and "kpi_id" in kpi
    }


def describe(report):
    kpis = flatten(report)
    return {
        "pages_scanned": report["pages_scanned"],
        "status_counts": dict(Counter(k["status"] for k in kpis.values())),
        "kpis": {
            key: {
                "status": k["status"],
                "quality": k["evidence"].get("data_quality"),
                "confidence": k.get("confidence"),
                "pages_checked": k["evidence"].get("pages_checked"),
                "constat": k.get("constat"),
            }
            for key, k in kpis.items()
        },
    }


def aggregate_rows(rows, summary):
    class Cursor:
        def execute(self, *args):
            pass

        def fetchall(self):
            return deepcopy(rows)

        def fetchone(self):
            return deepcopy(summary)

        def close(self):
            pass

    class Connection:
        def cursor(self, **kwargs):
            return Cursor()

        def close(self):
            pass

    with ExitStack() as stack:
        stack.enter_context(patch.object(aggregator, "get_db", return_value=Connection()))
        stack.enter_context(patch.object(aggregator, "get_scan_entry", return_value={"url": "https://example.test/"}))
        stack.enter_context(patch.object(aggregator, "_load_form_fuzzer_table_stats", return_value={}))
        report = aggregator.build_report("offline-evidence-audit", {
            "footer_rgpd_alignment": {"status": "not_evaluated", "reason": "offline_fixture"},
            "multi_browser_compatibility": {"status": "not_available", "reason": "offline_fixture"},
        })
    return report, build_kpi_centric_report(report)


def nlp_probes():
    # Load only the exact production AST nodes under examination. Importing the
    # full NLP module would trigger NLTK downloads and optional model imports.
    path = ROOT / "V3-Microservices/v3-nlp-worker/main.py"
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    worker = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "process_pending_pages")
    assignment = next(n for n in ast.walk(worker) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "raw_base_html" for t in n.targets))
    raw = '<div id="__next"></div>'
    rendered = "<main>" + "Meaningful content " * 60 + "</main>"
    namespace = {"row": {"html": rendered, "raw_html": raw, "rendered_html": rendered}, "raw_html": raw}
    exec(compile(ast.Module(body=[assignment], type_ignores=[]), str(path), "exec"), namespace)

    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "check_llms_txt")
    calls = []

    class Response:
        status = 200
        headers = {"Content-Type": "text/html"}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, limit):
            return b"<!doctype html><html><body>Page not found</body></html>"

    def html_response(*args, **kwargs):
        calls.append("http")
        return Response()

    llms_ns = {"_llms_cache": {}, "Request": Request, "urlopen": html_response}
    exec(compile(ast.Module(body=[fn], type_ignores=[]), str(path), "exec"), llms_ns)
    soft404 = llms_ns["check_llms_txt"]("https://example.test")
    llms_ns["_llms_cache"].clear()

    def failed_response(*args, **kwargs):
        calls.append("timeout")
        raise TimeoutError("synthetic timeout")

    llms_ns["urlopen"] = failed_response
    failed = llms_ns["check_llms_txt"]("https://example.test")
    llms_ns["urlopen"] = html_response
    count_before = len(calls)
    retry = llms_ns["check_llms_txt"]("https://example.test")
    return {
        "raw_source": {"selected_rendered_html_as_raw": namespace["raw_base_html"] == rendered, "actual_raw_html": raw},
        "llms_html_soft404": soft404,
        "llms_error_cache": {"first": failed, "next_call": retry, "additional_http_calls": len(calls) - count_before},
    }


def run():
    results = {"scope": "Offline synthetic evidence audit; not production prevalence or scan-time measurement."}
    results["source_sha256"] = {
        path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
        for path in [
            "V3-Microservices/v3-aggregator/main.py",
            "V3-Microservices/v3-aggregator/kpi_builder.py",
            "V3-Microservices/v3-nlp-worker/main.py",
            "V3-Microservices/v3-scanner-go/db/db.go",
            "Front-Snap/src/lib/auditMapper.ts",
            "raw_ec_response.json",
        ]
    }
    summary = {"domain": "example.test", "domain_security": {}, "domain_tech": {}}
    row = {"url": "https://example.test/", "metrics": {}, "nlp_results": None}
    for name, nlp in [
        ("nlp_pending", None),
        ("nlp_explicitly_skipped", {"status": "not_evaluated", "reason": "spa_shell_not_hydrated"}),
    ]:
        raw_report, kpi_report = aggregate_rows([{**row, "nlp_results": nlp}], summary)
        results[name] = describe(kpi_report)
        results[name]["nlp_not_evaluated_pages"] = raw_report["site_metrics"]["content"]["nlp_not_evaluated_pages"]

    minimal = {"scan_id": "synthetic-zero", "domain": "https://example.test/", "pages_scanned": 0, "domain_analysis": {}, "site_metrics": {}}
    results["zero_page_builder"] = describe(build_kpi_centric_report(minimal))

    try:
        aggregate_rows([row], None)
    except Exception as exc:
        results["missing_summary"] = {"exception": type(exc).__name__, "message": str(exc)}

    evaluated = {"status": "evaluated", "word_count": 120, "seo_kpis": {"ai_raw_content": {
        "raw_content_visible": True, "raw_content_word_count": 120,
        "raw_content_source": "main", "rendered_content_used": False,
    }}}
    try:
        aggregate_rows([{**row, "nlp_results": evaluated}], summary)
    except Exception as exc:
        results["partial_nlp_missing_llms_url"] = {"exception": type(exc).__name__, "message": str(exc)}
    evaluated["seo_kpis"]["llms_txt"] = {"llms_url": "https://example.test/llms.txt", "llms_txt_present": False}
    measured = {**row, "nlp_results": evaluated}
    pending = [{**row, "url": f"https://example.test/page-{i}"} for i in range(1, 10)]
    for name, rows in [("one_measured_of_one", [measured]), ("one_measured_of_ten", [measured] + pending)]:
        _, kpi_report = aggregate_rows(rows, summary)
        kpi = flatten(kpi_report)["ai_raw_content_visible"]
        results[name] = {"status": kpi["status"], "evidence": kpi["evidence"], "constat": kpi["constat"]}

    results["nlp_probes"] = nlp_probes()
    probe = results["nlp_probes"]["llms_html_soft404"]
    llms_report = deepcopy(minimal)
    llms_report["pages_scanned"] = 1
    llms_report["site_metrics"] = {"seo": {"ai_friendly_kpis": {
        "llms_txt_present_pages": int(probe["llms_txt_present"]),
        "llms_rows": [{"page_url": row["url"], **probe}],
    }}}
    results["llms_soft404_final_kpi"] = flatten(build_kpi_centric_report(llms_report))["ai_llms_txt"]

    fixture = json.loads((ROOT / "raw_ec_response.json").read_text(encoding="utf-8-sig"))
    results["repository_fixture_baseline"] = describe(build_kpi_centric_report(fixture))
    fixture["site_metrics"].pop("content", None)
    fixture["site_metrics"]["seo"].pop("nlp_seo_meta_kpi", None)
    fixture["site_metrics"]["seo"].pop("nlp_seo_h1_kpi", None)
    results["repository_fixture_nlp_aggregates_removed"] = describe(build_kpi_centric_report(fixture))
    return results


if __name__ == "__main__":
    # Catch accidental real network access in any dependency, including DB.
    with patch.object(socket.socket, "connect", side_effect=RuntimeError("Network disabled for offline audit")):
        output = run()
    (HERE / "results.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    cases = ["repository_fixture_baseline", "repository_fixture_nlp_aggregates_removed", "nlp_pending", "nlp_explicitly_skipped", "zero_page_builder"]
    with (HERE / "kpi-matrix.csv").open("w", encoding="utf-8", newline="") as stream:
        columns = ["kpi_id"] + [f"{case}_{field}" for case in cases for field in ("status", "quality", "pages_checked")]
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for kpi_id in sorted(output[cases[0]]["kpis"]):
            writer.writerow({"kpi_id": kpi_id, **{
                f"{case}_{field}": output[case]["kpis"][kpi_id][field]
                for case in cases for field in ("status", "quality", "pages_checked")
            }})
    for name in ("nlp_pending", "nlp_explicitly_skipped", "zero_page_builder"):
        print(name, output[name]["status_counts"])
    print("missing_summary", output.get("missing_summary"))
    print("llms_soft404_final_kpi", output["llms_soft404_final_kpi"]["status"])
    print("Wrote", HERE / "results.json")
