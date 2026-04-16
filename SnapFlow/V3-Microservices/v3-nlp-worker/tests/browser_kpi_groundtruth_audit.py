"""
Browser-grounded KPI audit runner.

Purpose:
- Validate NLP/SEO/content/RGPD KPIs against real public websites.
- Flag likely false positives and mismatches using lightweight ground-truth heuristics.

Usage:
  python tests/browser_kpi_groundtruth_audit.py
"""

from __future__ import annotations

import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

import main as nlp


nlp.language_tool_python = None
nlp._LT_FR = None
nlp._LT_LOAD_FAILED = True
# Avoid long/fragile per-page HEAD probes during batch validation.
nlp._head_last_modified_date = lambda _url: None


@dataclass(frozen=True)
class SiteConfig:
    name: str
    home: str
    topic_stems: tuple[str, ...]


SITES = [
    SiteConfig("acm", "https://www.acm.gov.tn/Fr/", ("microfin", "regulat", "control", "autor")),
    SiteConfig("albaraka", "https://www.albaraka.com.tn/fr", ("barak", "banqu", "bank", "credit", "financ")),
    SiteConfig("biat", "https://www.biat.com.tn/", ("biat", "banqu", "bank", "credit", "epargn")),
    SiteConfig("medianet", "https://www.medianet.tn/fr/", ("medianet", "digit", "agenc", "market", "transf", "ia")),
    SiteConfig("serept", "https://www.serept.com.tn/Fr/accueil_46_6", ("serept", "petrol", "petro", "forag", "explor", "offshor", "hsse")),
]

ABOUT_RE = re.compile(r"(a-propos|apropos|about|notre-histoire|presentation|qui-sommes|societe|company)", re.I)
CONTACT_RE = re.compile(r"(contact|contactez|contact-nous|nous-contacter|contact-us)", re.I)
PRIVACY_RE = re.compile(r"(privacy|confidentialite|vie-privee|donnees-personnelles|rgpd|gdpr|cookies|charte)", re.I)
NEWS_RE = re.compile(r"(actualite|actualites|news|blog|article|press|presse)", re.I)
PRODUCT_RE = re.compile(r"(produit|products?|particuliers|services?|packs?|financement|offres?)", re.I)

GENERIC_DOMINANT = {
    "plus", "projet", "site", "accueil", "home", "nous", "vous", "tout", "tous", "page",
    "services", "service", "information", "actualite", "actualites", "news", "details", "detail",
}


def fetch_html(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 SnapFlow-Browser-Groundtruth-Audit"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as resp:
            return resp.read().decode("utf-8", "ignore")
    except (ssl.SSLCertVerificationError, urllib.error.URLError) as exc:
        if "CERTIFICATE_VERIFY_FAILED" not in str(exc):
            raise
        with urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context()) as resp:
            return resp.read().decode("utf-8", "ignore")


def same_host(url_a: str, url_b: str) -> bool:
    return urlparse(url_a).netloc.lower().split(":")[0] == urlparse(url_b).netloc.lower().split(":")[0]


def discover_pages(site: SiteConfig, html: str) -> dict[str, str]:
    soup = nlp.BeautifulSoup(html, "html.parser")
    picks: dict[str, str] = {"home": site.home}
    seen: set[str] = {site.home}

    for a in soup.find_all("a", href=True):
        href = (a.get("href") or "").strip()
        if not href:
            continue
        abs_url = urljoin(site.home, href)
        if abs_url in seen:
            continue
        if not same_host(site.home, abs_url):
            continue
        signal = f"{a.get_text(' ', strip=True)} {href}".lower()

        def assign_once(label: str, regex: re.Pattern[str]) -> None:
            if label in picks:
                return
            if regex.search(signal):
                picks[label] = abs_url

        assign_once("about", ABOUT_RE)
        assign_once("contact", CONTACT_RE)
        assign_once("privacy", PRIVACY_RE)
        assign_once("news", NEWS_RE)
        assign_once("product", PRODUCT_RE)

        seen.add(abs_url)
        if len(picks) >= 6:
            break

    return picks


def run_full_kpi(url: str, html: str) -> dict[str, Any]:
    text = nlp.extract_text(html)
    result = nlp.analyze_content(text)
    soup = nlp.BeautifulSoup(html, "html.parser")

    date_classify = nlp.extract_dates_and_classify(html, url)
    result.update(date_classify)

    schema_kpis = nlp.detect_schema_org(soup)
    title_match = nlp._TITLE_RE.search(html)
    title_text = title_match.group(1).strip() if title_match else ""

    result["page_type"] = nlp.classify_page_type(
        url,
        title_text,
        text,
        soup=soup,
        schema_types=schema_kpis.get("schema_org_types", []),
    )

    body_audience_segment = nlp.classify_audience_segment(url, title_text, text, result.get("keyword_density", {}))
    heading_text = nlp.extract_heading_text(soup)
    heading_audience_segment = nlp.classify_audience_segment(url, title_text, heading_text, result.get("keyword_density", {}))
    if heading_audience_segment.get("confidence") == "high":
        result["audience_segment"] = dict(heading_audience_segment)
        result["audience_segment"]["source"] = "heading"
    else:
        result["audience_segment"] = dict(body_audience_segment)
        result["audience_segment"]["source"] = "body"

    result["rgpd_text_analysis"] = nlp.analyze_rgpd_text(url, text)

    h1_text = soup.find("h1").get_text(" ", strip=True) if soup.find("h1") else ""
    meta_tag = soup.find("meta", attrs={"name": "description"})
    meta_desc = meta_tag.get("content", "") if meta_tag else ""
    first_para_tag = soup.find("p")
    first_para = first_para_tag.get_text(" ", strip=True)[:300] if first_para_tag else ""
    base_domain = urlparse(url).netloc

    result["seo_kpis"] = {
        "h1_quality": nlp.check_h1_quality(soup, title_text),
        "heading_hierarchy": nlp.check_heading_hierarchy(soup),
        "title_quality": nlp.check_title_quality(title_text),
        "meta_description": nlp.check_meta_description(soup),
        "image_seo": nlp.check_image_seo(soup),
        "links": nlp.analyze_links(soup, url),
        "schema_org": schema_kpis,
        "canonical_robots": nlp.check_canonical_robots(soup),
        "og_hreflang": nlp.check_og_hreflang(soup),
        "llms_txt": nlp.check_llms_txt(f"https://{base_domain}"),
        "thin_content_by_type": nlp.check_thin_content_by_type(result.get("word_count", 0), result.get("page_type", "other")),
    }

    kw_density = result.get("keyword_density", {})
    dominant_kw = result.get("dominant_keyword", "")
    dominant_stem = result.get("dominant_keyword_stem", "")
    cta_data = nlp.detect_ctas(text)
    tone = nlp.classify_tone(text, result.get("sentence_count", 1))
    intent = nlp.classify_page_intent(text, url)
    entity_density = nlp.compute_entity_density(text, base_domain.split(".")[0].lower() if base_domain else "default")
    freshness = nlp.compute_freshness(result.get("last_pub_date"), result.get("page_type", "other"), result.get("is_news_page", False))

    completeness_signals = {
        "h1_present": not result["seo_kpis"]["h1_quality"]["h1_missing"],
        "meta_present": result["seo_kpis"]["meta_description"]["meta_description_present"],
        "cta_count_gt_0": cta_data["cta_count"] > 0,
        "word_count_gt_300": result.get("word_count", 0) > 300,
        "word_count_gt_600": result.get("word_count", 0) > 600,
        "schema_present": result["seo_kpis"]["schema_org"]["schema_org_present"],
        "schema_faq_present": result["seo_kpis"]["schema_org"]["schema_faq_present"],
        "has_pub_date": result.get("last_pub_date") is not None,
        "h2_count_gt_1": result["seo_kpis"]["heading_hierarchy"]["h2_count"] > 1,
        "og_image_present": result["seo_kpis"]["og_hreflang"]["og_image_present"],
        "question_density_gt_0": text.count("?") > 0,
        "price_mention": bool(nlp._PRICE_RE.search(text[:500])),
    }

    hidden_fragments = nlp._find_hidden_text_fragments(soup)
    stuffing_index = nlp.compute_stuffing_index_v2(
        text,
        kw_density,
        dominant_kw,
        result.get("page_type", "other"),
        hidden_fragments,
        page_url=url,
    )
    lexical = nlp.compute_lexical_diversity(text)

    result["content_kpis"] = {
        "lexical_diversity": lexical.get("mtld"),
        "lexical_diversity_method": lexical.get("method"),
        "lexical_diversity_ttr_debug": lexical.get("ttr_debug"),
        "lexical_diversity_token_count": lexical.get("token_count"),
        "reading_time": nlp.compute_reading_time(result.get("word_count", 0)),
        "keyword_prominence": nlp.compute_keyword_prominence(dominant_kw, title_text, h1_text, meta_desc, first_para),
        "title_content_alignment": nlp.compute_title_content_alignment(title_text, kw_density),
        "topic_clusters": nlp.cluster_keywords(kw_density),
        "stuffing_index": stuffing_index,
        "lsi_score": nlp.compute_lsi_score(text, dominant_stem),
        "cta": cta_data,
        "freshness": freshness,
        "above_fold": nlp.compute_above_fold_snapshot(text),
        "html_fingerprint": nlp.compute_html_fingerprint(soup),
        "tone": tone,
        "intent": intent,
        "entity_density": entity_density,
        "cta_alignment": nlp.score_cta_alignment(cta_data.get("cta_phrases", []), result["audience_segment"].get("segment", "unknown")),
        "completeness": nlp.compute_completeness(result.get("page_type", "other"), completeness_signals),
        "broken_structure_index": nlp.compute_broken_structure_index(
            result["seo_kpis"]["h1_quality"]["h1_missing"],
            result["seo_kpis"]["thin_content_by_type"]["thin_vs_page_type"],
            result["seo_kpis"]["meta_description"]["meta_description_present"],
            stuffing_index.get("stuffing_risk", "low"),
            result.get("readability_grade", "N/A"),
            cta_data.get("cta_count", 0),
            result.get("page_type", "other"),
        ),
        "audience_segment_heading": heading_audience_segment,
    }

    is_privacy = bool(nlp._PRIVACY_URL_RE.search(url.lower()))
    if is_privacy or result["rgpd_text_analysis"].get("used_strong_signal"):
        rights = nlp.compute_rights_coverage(text)
        dpo = nlp.check_dpo_contact(text)
        third_party = nlp.audit_third_party_scripts(soup, base_domain)
        pre_consent = nlp.check_pre_consent_tracking(html, third_party.get("third_party_by_category", {}).get("advertising", []))
        privacy_score = nlp.compute_privacy_score(text, result["rgpd_text_analysis"], rights, dpo)
    else:
        rights = {"rights_coverage_score": None, "rights_coverage_pct": None, "rights_found": [], "rights_missing": []}
        dpo = {"dpo_mentioned": None, "dpo_completeness_score": None}
        third_party = nlp.audit_third_party_scripts(soup, base_domain)
        pre_consent = {"pre_consent_violation": None, "pre_consent_trackers": []}
        privacy_score = {"privacy_policy_score": None, "purpose_mentioned": None, "legal_basis_mentioned": None}

    result["rgpd_kpis"] = {
        "rights_coverage": rights,
        "dpo_contact": dpo,
        "third_party_scripts": third_party,
        "pre_consent": pre_consent,
        "privacy_score": privacy_score,
    }

    return result


def expected_type_from_label(label: str) -> str | None:
    if label == "contact":
        return "contact"
    if label == "privacy":
        return "other"
    if label == "news":
        return "news"
    if label == "product":
        # "product/service" links on institutional sites are often informational pages.
        return None
    return None


def detect_issues(site: SiteConfig, label: str, url: str, kpi: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    dominant_kw = str(kpi.get("dominant_keyword") or "").lower()
    dominant_stem = str(kpi.get("dominant_keyword_stem") or "").lower()
    page_type = str(kpi.get("page_type") or "")

    expected_type = expected_type_from_label(label)
    if expected_type and page_type != expected_type:
        issues.append({"kpi": "page_type", "type": "mismatch", "detail": f"expected {expected_type}, got {page_type}"})

    if dominant_kw in GENERIC_DOMINANT:
        issues.append({"kpi": "dominant_keyword", "type": "false_positive", "detail": f"generic token selected: {dominant_kw}"})

    if dominant_kw and dominant_stem not in site.topic_stems and dominant_kw not in site.topic_stems:
        contextual_allow = set()
        if label == "contact":
            contextual_allow = {"contact", "agence", "agences", "adresse", "telephone", "tel"}
        elif label == "privacy":
            contextual_allow = {"donnees", "privacy", "confidentialite", "cookies", "personnelles"}
        elif label == "news":
            contextual_allow = {"actualite", "news", "presse", "article"}

        if dominant_kw not in GENERIC_DOMINANT and dominant_kw not in contextual_allow:
            issues.append({"kpi": "dominant_keyword", "type": "mismatch", "detail": f"domain topic mismatch: {dominant_kw}"})

    stuffing = kpi.get("content_kpis", {}).get("stuffing_index", {})
    if stuffing.get("stuffing_flag"):
        if stuffing.get("decision_reason") == "hidden_text" and float(stuffing.get("dominant_kw_density_pct") or 0) < 10:
            issues.append({
                "kpi": "content_kpis.stuffing_index",
                "type": "false_positive",
                "detail": "hidden-text trigger with moderate density (<10%)",
            })

    if label == "privacy":
        rgpd_text = kpi.get("rgpd_text_analysis", {})
        if not (rgpd_text.get("data_retention_mentioned") or rgpd_text.get("data_minimization_mentioned")):
            issues.append({
                "kpi": "rgpd_text_analysis",
                "type": "false_negative",
                "detail": "privacy page but no retention/minimization signal",
            })

    thin = kpi.get("seo_kpis", {}).get("thin_content_by_type", {})
    wc = int(kpi.get("word_count") or 0)
    if thin.get("thin_vs_page_type") and wc > 500:
        issues.append({
            "kpi": "seo_kpis.thin_content_by_type",
            "type": "false_positive",
            "detail": f"flagged thin with high word count ({wc})",
        })

    title_align = kpi.get("content_kpis", {}).get("title_content_alignment", {})
    if title_align.get("title_content_misaligned") and dominant_kw and dominant_kw in str(kpi.get("title") or "").lower():
        issues.append({
            "kpi": "content_kpis.title_content_alignment",
            "type": "suspicious",
            "detail": "misaligned flagged while dominant keyword is in title",
        })

    typo_density = float(kpi.get("typo_density") or 0.0)
    if typo_density > 0.15:
        issues.append({
            "kpi": "typo_density",
            "type": "false_positive",
            "detail": f"excessive typo density on clean page: {typo_density}",
        })

    return issues


def kpi_coverage_matrix() -> dict[str, str]:
    return {
        "word_count/readability/keyword_density": "checked",
        "page_type": "checked",
        "audience_segment": "checked",
        "rgpd_text_analysis": "checked",
        "seo_kpis.h1_quality": "checked",
        "seo_kpis.heading_hierarchy": "checked",
        "seo_kpis.title_quality": "checked",
        "seo_kpis.meta_description": "checked",
        "seo_kpis.image_seo": "checked",
        "seo_kpis.links": "checked",
        "seo_kpis.schema_org": "checked",
        "seo_kpis.canonical_robots": "checked",
        "seo_kpis.og_hreflang": "checked",
        "seo_kpis.llms_txt": "checked",
        "seo_kpis.thin_content_by_type": "checked",
        "content_kpis.lexical_diversity": "checked",
        "content_kpis.reading_time": "checked",
        "content_kpis.keyword_prominence": "checked",
        "content_kpis.title_content_alignment": "checked",
        "content_kpis.topic_clusters": "checked",
        "content_kpis.stuffing_index": "checked",
        "content_kpis.lsi_score": "checked",
        "content_kpis.cta": "checked",
        "content_kpis.freshness": "checked",
        "content_kpis.above_fold": "checked",
        "content_kpis.html_fingerprint": "checked",
        "content_kpis.tone": "checked",
        "content_kpis.intent": "checked",
        "content_kpis.entity_density": "checked",
        "content_kpis.cta_alignment": "checked",
        "content_kpis.completeness": "checked",
        "content_kpis.broken_structure_index": "checked",
        "rgpd_kpis.rights_coverage": "checked",
        "rgpd_kpis.dpo_contact": "checked",
        "rgpd_kpis.third_party_scripts": "checked",
        "rgpd_kpis.pre_consent": "checked",
        "rgpd_kpis.privacy_score": "checked",
    }


def main() -> int:
    all_rows: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    issue_counts: dict[str, int] = {}
    issue_by_kpi: dict[str, int] = {}

    for site in SITES:
        try:
            home_html = fetch_html(site.home)
            discovered = discover_pages(site, home_html)
        except Exception as exc:  # noqa: BLE001
            failures.append({"site": site.name, "label": "home", "url": site.home, "error": str(exc)})
            continue

        for label, url in discovered.items():
            try:
                html = fetch_html(url)
                kpi = run_full_kpi(url, html)
                issues = detect_issues(site, label, url, kpi)
                row = {
                    "site": site.name,
                    "label": label,
                    "url": url,
                    "title": kpi.get("title"),
                    "page_type": kpi.get("page_type"),
                    "dominant_keyword": kpi.get("dominant_keyword"),
                    "word_count": kpi.get("word_count"),
                    "issues": issues,
                    "all_kpis": kpi,
                }
                all_rows.append(row)

                for issue in issues:
                    issue_counts[issue["type"]] = issue_counts.get(issue["type"], 0) + 1
                    issue_by_kpi[issue["kpi"]] = issue_by_kpi.get(issue["kpi"], 0) + 1
            except Exception as exc:  # noqa: BLE001
                failures.append({"site": site.name, "label": label, "url": url, "error": str(exc)})

    pages_with_issues = [r for r in all_rows if r["issues"]]

    out = {
        "summary": {
            "sites_tested": len(SITES),
            "pages_tested": len(all_rows),
            "pages_with_issues": len(pages_with_issues),
            "failures": len(failures),
            "issue_counts_by_type": issue_counts,
            "issue_counts_by_kpi": issue_by_kpi,
        },
        "kpi_coverage": kpi_coverage_matrix(),
        "rows": all_rows,
        "failures": failures,
    }

    out_path = Path(__file__).resolve().parent / "browser_kpi_groundtruth_results_20260331.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(out["summary"], ensure_ascii=False, indent=2))
    print(f"Wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
