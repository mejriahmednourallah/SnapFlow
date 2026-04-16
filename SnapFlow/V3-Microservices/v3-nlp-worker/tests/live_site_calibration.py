"""
Live-site calibration harness for NLP content KPIs.

Usage:
  python tests/live_site_calibration.py --site biat

This script fetches curated public pages, runs the real NLP logic,
and evaluates broad expected outcomes for regression/fine-tuning.
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Ensure service package root is importable when run as a script from tests/.
SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import main as nlp


def _configure_runtime(enable_language_tool: bool) -> None:
    """Keep calibration deterministic and fast in CI/dev unless explicitly enabled."""
    if not enable_language_tool:
        nlp.language_tool_python = None
        nlp._LT_FR = None
        nlp._LT_LOAD_FAILED = True


@dataclass(frozen=True)
class PageExpectation:
    page_id: str
    url: str
    word_count_min: int = 50
    word_count_max: int | None = None
    page_type_allowed: tuple[str, ...] = ("landing", "other", "product", "faq")
    stuffing_flag_expected: bool | None = False
    content_type_forbidden: tuple[str, ...] = ("insufficient_content",)
    lexical_method_allowed: tuple[str, ...] = ("mtld", "ttr_short_text", "not_available")
    require_rgpd_signal: bool = False


SITE_PROFILES: dict[str, list[PageExpectation]] = {
    "biat": [
        PageExpectation(
            page_id="home",
            url="https://www.biat.com.tn/",
            word_count_min=120,
            page_type_allowed=("landing", "other"),
            stuffing_flag_expected=False,
            content_type_forbidden=("insufficient_content",),
        ),
        PageExpectation(
            page_id="presentation_generale",
            url="https://www.biat.com.tn/la-biat/presentation-generale",
            word_count_min=120,
            page_type_allowed=("other", "landing", "news"),
            stuffing_flag_expected=False,
            content_type_forbidden=("insufficient_content",),
        ),
        PageExpectation(
            page_id="cookie_policy",
            url="https://www.biat.com.tn/politique-de-gestion-des-cookies",
            word_count_min=150,
            page_type_allowed=("other", "landing", "faq", "news"),
            stuffing_flag_expected=False,
            content_type_forbidden=("insufficient_content",),
            require_rgpd_signal=True,
        ),
    ]
}


def fetch_html(url: str, timeout: int) -> str:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SnapFlow-NLP-Calibrator"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            return resp.read().decode("utf-8", "ignore")
    except (ssl.SSLCertVerificationError, urllib.error.URLError) as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        insecure_ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=timeout, context=insecure_ctx) as resp:
            return resp.read().decode("utf-8", "ignore")


def evaluate_page(expectation: PageExpectation, timeout: int = 25) -> dict[str, Any]:
    html = fetch_html(expectation.url, timeout=timeout)
    text = nlp.extract_text(html)
    analyzed = nlp.analyze_content(text)
    soup = nlp.BeautifulSoup(html, "html.parser")

    title_match = nlp._TITLE_RE.search(html)
    title_text = title_match.group(1).strip() if title_match else ""

    page_type = nlp.classify_page_type(
        expectation.url,
        title_text,
        text,
        soup=soup,
        schema_types=[],
    )

    stuffing = nlp.compute_stuffing_index_v2(
        text,
        analyzed.get("keyword_density", {}),
        analyzed.get("dominant_keyword") or "",
        page_type,
        nlp._find_hidden_text_fragments(soup),
        page_url=expectation.url,
    )

    lexical = nlp.compute_lexical_diversity(text)
    rgpd_signal = nlp.analyze_rgpd_text(expectation.url, text)

    return {
        "page_id": expectation.page_id,
        "url": expectation.url,
        "title": title_text,
        "word_count": int(analyzed.get("word_count", 0) or 0),
        "readability_grade": analyzed.get("readability_grade"),
        "content_type_hint": analyzed.get("content_type_hint"),
        "keyword_density_score": float(analyzed.get("keyword_density_score", 0.0) or 0.0),
        "dominant_keyword": analyzed.get("dominant_keyword"),
        "page_type": page_type,
        "stuffing_flag": bool(stuffing.get("stuffing_flag")),
        "stuffing_risk": stuffing.get("stuffing_risk"),
        "dominant_kw_density_pct": stuffing.get("dominant_kw_density_pct"),
        "hidden_keyword_hits": stuffing.get("hidden_keyword_hits"),
        "max_segment_ratio": stuffing.get("max_segment_ratio"),
        "total_occurrences": stuffing.get("total_occurrences"),
        "stuffing_reason": stuffing.get("decision_reason"),
        "lexical_method": lexical.get("method"),
        "lexical_diversity": lexical.get("mtld"),
        "rgpd_data_retention": bool(rgpd_signal.get("data_retention_mentioned")),
        "rgpd_data_minimization": bool(rgpd_signal.get("data_minimization_mentioned")),
    }


def evaluate_expectations(expectation: PageExpectation, result: dict[str, Any]) -> list[str]:
    failures: list[str] = []

    wc = result["word_count"]
    if wc < expectation.word_count_min:
        failures.append(f"word_count {wc} < min {expectation.word_count_min}")
    if expectation.word_count_max is not None and wc > expectation.word_count_max:
        failures.append(f"word_count {wc} > max {expectation.word_count_max}")

    if result["page_type"] not in expectation.page_type_allowed:
        failures.append(f"page_type {result['page_type']} not in {expectation.page_type_allowed}")

    if expectation.stuffing_flag_expected is not None and result["stuffing_flag"] != expectation.stuffing_flag_expected:
        failures.append(
            f"stuffing_flag {result['stuffing_flag']} != expected {expectation.stuffing_flag_expected}"
        )

    if result["content_type_hint"] in expectation.content_type_forbidden:
        failures.append(
            f"content_type_hint {result['content_type_hint']} in forbidden {expectation.content_type_forbidden}"
        )

    if result["lexical_method"] not in expectation.lexical_method_allowed:
        failures.append(
            f"lexical_method {result['lexical_method']} not in {expectation.lexical_method_allowed}"
        )

    if expectation.require_rgpd_signal:
        if not (result["rgpd_data_retention"] or result["rgpd_data_minimization"]):
            failures.append("expected RGPD signal (retention or minimization) not found")

    return failures


def run_profile(site: str, timeout: int = 25) -> dict[str, Any]:
    profile = SITE_PROFILES.get(site)
    if not profile:
        raise ValueError(f"Unknown site profile '{site}'. Available: {sorted(SITE_PROFILES.keys())}")

    page_reports: list[dict[str, Any]] = []
    total_failures = 0

    for expectation in profile:
        try:
            result = evaluate_page(expectation, timeout=timeout)
            failures = evaluate_expectations(expectation, result)
            total_failures += len(failures)
            page_reports.append({
                "page_id": expectation.page_id,
                "url": expectation.url,
                "ok": len(failures) == 0,
                "failures": failures,
                "result": result,
            })
        except Exception as exc:  # noqa: BLE001
            total_failures += 1
            page_reports.append(
                {
                    "page_id": expectation.page_id,
                    "url": expectation.url,
                    "ok": False,
                    "failures": [f"execution_error: {exc}"],
                    "result": None,
                }
            )

    return {
        "site": site,
        "pages_tested": len(profile),
        "failed_checks": total_failures,
        "pass": total_failures == 0,
        "pages": page_reports,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run live NLP KPI calibration profile")
    parser.add_argument("--site", default="biat", help=f"Profile name. Available: {', '.join(sorted(SITE_PROFILES.keys()))}")
    parser.add_argument("--timeout", type=int, default=25, help="HTTP timeout in seconds")
    parser.add_argument("--output", default="tests/live_site_calibration_report.json", help="Path to write JSON report")
    parser.add_argument(
        "--enable-language-tool",
        action="store_true",
        help="Enable LanguageTool typo detection (may download assets and run slower)",
    )
    args = parser.parse_args()

    _configure_runtime(enable_language_tool=args.enable_language_tool)

    report = run_profile(args.site, timeout=args.timeout)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
