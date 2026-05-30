"""Batch site scanner and aggregate reporter for SnapFlow.

This script:
- loads site targets from the Redmine dump or a plain URL list,
- excludes preprod and medianet targets by default,
- runs the existing aggregator /scan/sync endpoint for each site,
- stores raw per-site responses, and
- writes consolidated JSON and Markdown summaries.
"""

from __future__ import annotations

import argparse
import collections
import dataclasses
import datetime as dt
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_AGGREGATOR_URL = "http://localhost:8080"
DEFAULT_REDMINE_DUMP = Path(__file__).resolve().parent.parent / "Front-Snap" / "tmp" / "redmine_projects_full_dump.json"
DEFAULT_OUTPUT_ROOT = Path(__file__).resolve().parent / "batch_results"

EXCLUDE_HOST_PATTERNS = (
    re.compile(r"(^|\.)medianet\.tn$", re.IGNORECASE),
    re.compile(r"preprod", re.IGNORECASE),
    re.compile(r"maintenance\.medianet\.tn$", re.IGNORECASE),
    # catch single-label hosts or hostnames that contain 'maintenance'
    re.compile(r"\bmaintenance\b", re.IGNORECASE),
    re.compile(r"snapflowv2\.medianet\.tn$", re.IGNORECASE),
)



@dataclasses.dataclass(frozen=True)
class SiteTarget:
    url: str
    source: str
    identifier: str | None = None
    label: str | None = None


@dataclasses.dataclass
class SiteRun:
    target: SiteTarget
    skipped: bool = False
    skip_reason: str | None = None
    request_url: str | None = None
    response_path: str | None = None
    response: dict[str, Any] | None = None
    error: str | None = None
    scan_id: str | None = None
    status: str | None = None
    quality_score: float | None = None
    health_status: str | None = None


def _now_stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S")


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return text or "site"


def _ensure_http_scheme(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme:
        return url
    return f"https://{url.lstrip('/')}"


def _site_key(url: str) -> str:
    parsed = urlparse(_ensure_http_scheme(url))
    host = (parsed.netloc or parsed.path).split("@")[-1].split(":")[0].lower()
    return host or parsed.path.lower()


def _is_excluded_url(url: str) -> tuple[bool, str | None]:
    normalized = _ensure_http_scheme(url)
    parsed = urlparse(normalized)
    host = _site_key(normalized)
    candidate = f"{host}{parsed.path}".lower()
    for pattern in EXCLUDE_HOST_PATTERNS:
        if pattern.search(candidate) or pattern.search(host):
            return True, f"excluded_by_pattern:{pattern.pattern}"
    return False, None


def _load_json_file(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def _load_targets_from_redmine_dump(path: Path) -> list[SiteTarget]:
    payload = _load_json_file(path)
    if not isinstance(payload, list):
        raise ValueError(f"Expected a JSON array in {path}")

    targets: list[SiteTarget] = []
    seen: set[str] = set()
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        raw_url = entry.get("homepage") or entry.get("url") or entry.get("base_url")
        if not raw_url:
            identifier = entry.get("identifier")
            if identifier:
                raw_url = f"https://{identifier}"
        if not raw_url:
            continue
        url = _ensure_http_scheme(str(raw_url).strip())
        if url in seen:
            continue
        seen.add(url)
        targets.append(
            SiteTarget(
                url=url,
                source=str(path),
                identifier=str(entry.get("identifier")) if entry.get("identifier") else None,
                label=str(entry.get("name")) if entry.get("name") else None,
            )
        )
    return targets


def _load_targets_from_url_file(path: Path) -> list[SiteTarget]:
    targets: list[SiteTarget] = []
    seen: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#"):
            continue
        url = _ensure_http_scheme(raw)
        if url in seen:
            continue
        seen.add(url)
        targets.append(SiteTarget(url=url, source=str(path)))
    return targets


def _load_targets(source_path: Path) -> list[SiteTarget]:
    if source_path.suffix.lower() == ".json":
        return _load_targets_from_redmine_dump(source_path)
    return _load_targets_from_url_file(source_path)


def _post_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else str(exc)
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(str(exc.reason) if getattr(exc, "reason", None) else str(exc)) from exc


def _extract_quality_score(response: dict[str, Any]) -> float | None:
    if not isinstance(response, dict):
        return None
    quality = response.get("quality_drift_artifact")
    if isinstance(quality, dict):
        for key in ("quality_score", "score", "value"):
            candidate = quality.get(key)
            if isinstance(candidate, (int, float)):
                return float(candidate)
            if isinstance(candidate, str):
                try:
                    return float(candidate)
                except ValueError:
                    continue
    top_level = response.get("top_level_kpis")
    if isinstance(top_level, dict):
        for key in ("quality_score", "score"):
            candidate = top_level.get(key)
            if isinstance(candidate, (int, float)):
                return float(candidate)
    return None


def _extract_health_status(response: dict[str, Any]) -> str | None:
    if not isinstance(response, dict):
        return None
    for key in ("top_level_kpis", "summary", "quality_drift_artifact"):
        value = response.get(key)
        if isinstance(value, dict):
            for inner_key in ("health_status", "status", "quality_status"):
                status = value.get(inner_key)
                if isinstance(status, str) and status.strip():
                    return status.strip()
    status = response.get("status")
    return status.strip() if isinstance(status, str) and status.strip() else None


def _findings_from_axes(response: dict[str, Any]) -> list[dict[str, Any]]:
    axes = response.get("axes") if isinstance(response, dict) else None
    if not isinstance(axes, dict):
        return []
    flattened: list[dict[str, Any]] = []
    for axis_name, axis_block in axes.items():
        if not isinstance(axis_block, dict):
            continue
        for collection_name in ("findings", "passing_kpis"):
            items = axis_block.get(collection_name)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                row = dict(item)
                row.setdefault("axis", axis_name)
                row.setdefault("collection", collection_name)
                flattened.append(row)
    return flattened


def _finding_key(finding: dict[str, Any]) -> str:
    for key in ("kpi_id", "id", "slug", "name", "label", "info"):
        value = finding.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    axis = finding.get("axis")
    return str(axis or "unknown_kpi")


def _status_bucket(finding: dict[str, Any]) -> str:
    value = finding.get("status")
    if isinstance(value, str) and value.strip():
        return value.strip().lower()
    if finding.get("collection") == "passing_kpis":
        return "passing"
    return "unknown"


def _severity_bucket(finding: dict[str, Any]) -> str:
    value = finding.get("severity")
    if isinstance(value, str) and value.strip():
        return value.strip().lower()
    return "none"


def _run_single_site(aggregator_url: str, target: SiteTarget, max_pages: int, headless_concurrency: int, timeout: int, output_dir: Path) -> SiteRun:
    excluded, reason = _is_excluded_url(target.url)
    run = SiteRun(target=target, skipped=excluded, skip_reason=reason)
    if excluded:
        return run

    endpoint = f"{aggregator_url.rstrip('/')}/scan/sync"
    run.request_url = endpoint
    payload = {
        "url": target.url,
        "max_pages": max_pages,
        "headless_concurrency": headless_concurrency,
        "enable_visual_regression": False,
        "visual_baseline_scan_id": None,
    }

    response = _post_json(endpoint, payload, timeout=timeout)
    run.response = response
    run.scan_id = str(response.get("scan_id") or response.get("id") or "") or None
    run.status = str(response.get("status") or response.get("scan_status") or "") or None
    run.quality_score = _extract_quality_score(response)
    run.health_status = _extract_health_status(response)

    target_dir = output_dir / "raw"
    target_dir.mkdir(parents=True, exist_ok=True)
    fingerprint = hashlib.sha1(target.url.encode("utf-8")).hexdigest()[:10]
    name_bits = [_slugify(_site_key(target.url)), fingerprint]
    if run.scan_id:
        name_bits.append(run.scan_id)
    raw_path = target_dir / f"{'_'.join(name_bits)}.json"
    payload_to_save = {
        "target": dataclasses.asdict(target),
        "request": payload,
        "result": response,
    }
    raw_path.write_text(json.dumps(payload_to_save, ensure_ascii=False, indent=2), encoding="utf-8")
    run.response_path = str(raw_path)
    return run


def _aggregate_runs(runs: list[SiteRun]) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "counts": {
            "total_targets": len(runs),
            "tested": 0,
            "skipped": 0,
            "failed_requests": 0,
            "passing_sites": 0,
            "warning_sites": 0,
            "failing_sites": 0,
            "not_evaluated_sites": 0,
        },
        "quality": {
            "scores": [],
            "average": None,
            "minimum": None,
            "maximum": None,
        },
        "issues_by_kpi": [],
        "issues_by_axis": collections.Counter(),
        "severity_counts": collections.Counter(),
        "status_counts": collections.Counter(),
        "site_rows": [],
        "site_rankings": [],
    }

    issue_buckets: dict[str, dict[str, Any]] = {}

    for run in runs:
        row: dict[str, Any] = {
            "url": run.target.url,
            "source": run.target.source,
            "identifier": run.target.identifier,
            "label": run.target.label,
            "skipped": run.skipped,
            "skip_reason": run.skip_reason,
            "scan_id": run.scan_id,
            "status": run.status,
            "quality_score": run.quality_score,
            "health_status": run.health_status,
            "response_path": run.response_path,
            "error": run.error,
        }
        summary["site_rows"].append(row)

        if run.skipped:
            summary["counts"]["skipped"] += 1
            continue
        if run.error:
            summary["counts"]["failed_requests"] += 1
            continue

        summary["counts"]["tested"] += 1
        if run.quality_score is not None:
            summary["quality"]["scores"].append(run.quality_score)
        if run.response:
            flattened = _findings_from_axes(run.response)
            site_issue_count = 0
            for finding in flattened:
                status = _status_bucket(finding)
                severity = _severity_bucket(finding)
                axis = str(finding.get("axis") or "unknown_axis")
                kpi_key = _finding_key(finding)

                summary["status_counts"][status] += 1
                summary["severity_counts"][severity] += 1

                if status == "passing":
                    continue

                site_issue_count += 1
                summary["issues_by_axis"][axis] += 1
                bucket = issue_buckets.setdefault(
                    kpi_key,
                    {
                        "kpi": kpi_key,
                        "axis_counts": collections.Counter(),
                        "status_counts": collections.Counter(),
                        "severity_counts": collections.Counter(),
                        "occurrences": 0,
                        "affected_sites": set(),
                        "examples": [],
                    },
                )
                bucket["occurrences"] += 1
                bucket["axis_counts"][axis] += 1
                bucket["status_counts"][status] += 1
                bucket["severity_counts"][severity] += 1
                bucket["affected_sites"].add(run.target.url)
                if len(bucket["examples"]) < 3:
                    bucket["examples"].append(
                        {
                            "site": run.target.url,
                            "status": status,
                            "severity": severity,
                            "constat": finding.get("constat"),
                            "impact": finding.get("impact"),
                        }
                    )

            health = (run.health_status or "").lower()
            if health in {"passing", "good"}:
                summary["counts"]["passing_sites"] += 1
            elif health in {"warning", "watch"}:
                summary["counts"]["warning_sites"] += 1
            elif health in {"failing", "at_risk"}:
                summary["counts"]["failing_sites"] += 1
            else:
                if site_issue_count == 0:
                    summary["counts"]["not_evaluated_sites"] += 1
                else:
                    summary["counts"]["warning_sites"] += 1

    scores = summary["quality"]["scores"]
    if scores:
        summary["quality"]["average"] = round(sum(scores) / len(scores), 2)
        summary["quality"]["minimum"] = round(min(scores), 2)
        summary["quality"]["maximum"] = round(max(scores), 2)

    ranked_issues = []
    for bucket in issue_buckets.values():
        ranked_issues.append(
            {
                "kpi": bucket["kpi"],
                "occurrences": bucket["occurrences"],
                "affected_sites": sorted(bucket["affected_sites"]),
                "affected_site_count": len(bucket["affected_sites"]),
                "axis_counts": dict(bucket["axis_counts"]),
                "status_counts": dict(bucket["status_counts"]),
                "severity_counts": dict(bucket["severity_counts"]),
                "examples": bucket["examples"],
            }
        )

    ranked_issues.sort(key=lambda item: (-item["affected_site_count"], -item["occurrences"], item["kpi"]))
    summary["issues_by_kpi"] = ranked_issues
    summary["issues_by_axis"] = dict(summary["issues_by_axis"])
    summary["severity_counts"] = dict(summary["severity_counts"])
    summary["status_counts"] = dict(summary["status_counts"])
    summary["site_rankings"] = sorted(
        [row for row in summary["site_rows"] if not row["skipped"] and not row["error"]],
        key=lambda row: (-(row["quality_score"] if isinstance(row.get("quality_score"), (int, float)) else -1.0), row["url"]),
    )
    return summary


def _render_markdown_summary(manifest: dict[str, Any], aggregate: dict[str, Any]) -> str:
    counts = aggregate.get("counts", {})
    quality = aggregate.get("quality", {})
    lines = [
        f"# SnapFlow Batch Aggregate - {manifest['run_id']}",
        "",
        f"- Source: `{manifest['source']}`",
        f"- Aggregator: `{manifest['aggregator_url']}`",
        f"- Targets seen: {counts.get('total_targets', 0)}",
        f"- Tested: {counts.get('tested', 0)}",
        f"- Skipped: {counts.get('skipped', 0)}",
        f"- Failed requests: {counts.get('failed_requests', 0)}",
        f"- Passing sites: {counts.get('passing_sites', 0)}",
        f"- Warning sites: {counts.get('warning_sites', 0)}",
        f"- Failing sites: {counts.get('failing_sites', 0)}",
        f"- Not evaluated sites: {counts.get('not_evaluated_sites', 0)}",
        f"- Quality avg/min/max: {quality.get('average')}/{quality.get('minimum')}/{quality.get('maximum')}",
        "",
        "## Most Common Issues",
        "",
    ]
    top_issues = aggregate.get("issues_by_kpi", [])[:20]
    if not top_issues:
        lines.append("No recurring issues were found.")
    else:
        lines.append("| KPI | Sites affected | Occurrences |")
        lines.append("| --- | ---: | ---: |")
        for item in top_issues:
            lines.append(f"| {item['kpi']} | {item['affected_site_count']} | {item['occurrences']} |")
    lines.extend(["", "## Axis Hotspots", ""])
    axis_counts = aggregate.get("issues_by_axis", {})
    if not axis_counts:
        lines.append("No axis hotspots available.")
    else:
        lines.append("| Axis | Issue count |")
        lines.append("| --- | ---: |")
        for axis, count in sorted(axis_counts.items(), key=lambda item: (-item[1], item[0])):
            lines.append(f"| {axis} | {count} |")
    return "\n".join(lines) + "\n"


def _write_batch_outputs(output_dir: Path, runs: list[SiteRun], aggregate: dict[str, Any], config: dict[str, Any]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "run_id": config["run_id"],
        "created_at": config["created_at"],
        "aggregator_url": config["aggregator_url"],
        "source": config["source"],
        "filters": config["filters"],
        "limits": config["limits"],
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "results.json").write_text(
        json.dumps(
            {
                "manifest": manifest,
                "sites": [dataclasses.asdict(run) for run in runs],
                "aggregate": aggregate,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (output_dir / "aggregate.json").write_text(json.dumps(aggregate, ensure_ascii=False, indent=2), encoding="utf-8")
    (output_dir / "aggregate.md").write_text(_render_markdown_summary(manifest, aggregate), encoding="utf-8")


def _build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run SnapFlow scans across many sites and aggregate the results.")
    parser.add_argument("--source", type=Path, default=DEFAULT_REDMINE_DUMP, help="JSON dump or newline-separated URL file.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_ROOT, help="Directory for raw and aggregate outputs.")
    parser.add_argument("--aggregator-url", default=DEFAULT_AGGREGATOR_URL, help="Aggregator base URL.")
    parser.add_argument("--max-pages", type=int, default=150, help="Max pages per site scan.")
    parser.add_argument("--headless-concurrency", type=int, default=3, help="Headless concurrency per scan.")
    parser.add_argument("--timeout", type=int, default=7200, help="HTTP timeout in seconds for each scan.")
    parser.add_argument("--limit", type=int, default=0, help="Optional limit on the number of allowed targets.")
    parser.add_argument("--dry-run", action="store_true", help="Print targets only; do not run scans.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_argument_parser()
    args = parser.parse_args(argv)

    source_path = args.source.expanduser().resolve()
    if not source_path.exists():
        raise SystemExit(f"Source file not found: {source_path}")

    targets = _load_targets(source_path)
    selected: list[SiteTarget] = []
    skipped: list[dict[str, Any]] = []
    for target in targets:
        excluded, reason = _is_excluded_url(target.url)
        if excluded:
            skipped.append({"url": target.url, "reason": reason})
            continue
        selected.append(target)
        if args.limit and len(selected) >= args.limit:
            break

    run_id = f"batch_{_now_stamp()}"
    output_dir = args.output_dir.expanduser().resolve() / run_id
    config = {
        "run_id": run_id,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "aggregator_url": args.aggregator_url,
        "source": str(source_path),
        "filters": {
            "exclude_patterns": [pattern.pattern for pattern in EXCLUDE_HOST_PATTERNS],
            "dry_run": args.dry_run,
        },
        "limits": {
            "max_pages": args.max_pages,
            "headless_concurrency": args.headless_concurrency,
            "timeout": args.timeout,
            "requested_limit": args.limit or None,
            "selected_targets": len(selected),
            "skipped_targets": len(skipped),
        },
    }

    if args.dry_run:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "dry_run.json").write_text(
            json.dumps(
                {
                    "manifest": config,
                    "selected": [dataclasses.asdict(target) for target in selected],
                    "skipped": skipped,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"Dry run: {len(selected)} targets selected, {len(skipped)} skipped")
        print(output_dir)
        return 0

    runs: list[SiteRun] = []
    for index, target in enumerate(selected, start=1):
        print(f"[{index}/{len(selected)}] scanning {target.url}")
        try:
            run = _run_single_site(
                aggregator_url=args.aggregator_url,
                target=target,
                max_pages=args.max_pages,
                headless_concurrency=args.headless_concurrency,
                timeout=args.timeout,
                output_dir=output_dir,
            )
        except Exception as exc:
            run = SiteRun(target=target, error=str(exc))
        runs.append(run)
        time.sleep(0.1)

    aggregate = _aggregate_runs(runs)
    aggregate["skipped_targets"] = skipped
    aggregate["selected_targets"] = [dataclasses.asdict(target) for target in selected]

    _write_batch_outputs(output_dir, runs, aggregate, config)

    print(f"Saved batch results to {output_dir}")
    print(f"Tested: {aggregate['counts']['tested']} | Skipped: {aggregate['counts']['skipped']} | Failures: {aggregate['counts']['failing_sites']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())