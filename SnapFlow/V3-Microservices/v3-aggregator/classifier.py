from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlparse


def score_effort(scope: str, affected_count: int, fix_complexity: str) -> str:
    if scope == "DOMAIN":
        return "LOW"
    if scope == "PAGE" and affected_count <= 3:
        return "LOW"
    if scope == "SITEWIDE" and fix_complexity == "template":
        return "MEDIUM"
    if scope == "PAGE" and affected_count > 20:
        return "HIGH"
    return "MEDIUM"


def _severity_rank(severity: str) -> int:
    ranks = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    return ranks.get(severity, 0)


def _extract_domain(url_or_domain: str) -> str:
    if not url_or_domain:
        return ""
    parsed = urlparse(url_or_domain)
    if parsed.netloc:
        return parsed.netloc
    return url_or_domain.replace("https://", "").replace("http://", "").split("/")[0]


def _now_iso_from_scan(scan_meta: Optional[dict]) -> str:
    if scan_meta and scan_meta.get("started_at"):
        ts = float(scan_meta["started_at"])
        return datetime.fromtimestamp(ts, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _mk_finding(
    *,
    finding_id: str,
    title: str,
    finding_type: str,
    severity: str,
    scope: str,
    description: str,
    impact: str,
    fix: str,
    source_kpi: str,
    affected_count: int,
    fix_complexity: str,
    example_urls: Optional[list] = None,
) -> dict:
    urls = list(dict.fromkeys(example_urls or []))[:5]
    return {
        "id": finding_id,
        "title": title[:60],
        "type": finding_type,
        "severity": severity,
        "scope": scope,
        "description": description,
        "impact": impact,
        "effort": score_effort(scope, int(affected_count or 0), fix_complexity),
        "affected_count": int(affected_count or 0),
        "example_urls": urls if scope != "DOMAIN" else [],
        "fix": fix,
        "source_kpi": source_kpi,
    }


def _sort_findings(findings: list[dict]) -> list[dict]:
    return sorted(
        findings,
        key=lambda f: (-_severity_rank(f.get("severity", "")), f.get("id", "")),
    )


def _build_roadmap_items(findings: list[dict]) -> dict:
    roadmap = {
        "immediate": [],
        "this_sprint": [],
        "this_quarter": [],
        "backlog": [],
    }
    for f in findings:
        item = {
            "id": f["id"],
            "title": f["title"],
            "type": f["type"],
            "severity": f["severity"],
            "effort": f["effort"],
        }
        sev = f.get("severity")
        if sev == "CRITICAL":
            roadmap["immediate"].append(item)
        elif sev == "HIGH":
            roadmap["this_sprint"].append(item)
        elif sev == "MEDIUM":
            roadmap["this_quarter"].append(item)
        elif sev == "LOW":
            roadmap["backlog"].append(item)
        else:
            roadmap["backlog"].append(item)

    # Requested ordering policy: severity DESC first, then stable id.
    # Buckets are already severity-homogeneous; sorting by id keeps determinism.
    for key in roadmap:
        roadmap[key] = sorted(roadmap[key], key=lambda i: i["id"])
    return roadmap


def _build_issue_url_index(report: dict) -> dict:
    """Build issue_text.lower() → [example_urls] from issues.ux and issues.seo."""
    index: dict[str, list[str]] = {}
    for section in ("ux", "seo"):
        for item in (report.get("issues") or {}).get(section) or []:
            if not isinstance(item, dict):
                continue
            text = (item.get("issue") or "").lower()
            urls = item.get("example_urls") or []
            if text and urls:
                index[text] = [u for u in urls if u][:5]
    return index


def _find_urls_by_keywords(index: dict, *keywords: str) -> list[str]:
    """Return example_urls from the first index entry matching any keyword."""
    kws = [k.lower() for k in keywords]
    for text, urls in index.items():
        if any(kw in text for kw in kws):
            return urls
    return []


def _get_path_value(data: dict, path: str) -> Any:
    cur: Any = data
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _format_evidence_value(value: Any) -> str:
    if value is None:
        return "None"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, str)):
        return str(value)
    if isinstance(value, list):
        if not value:
            return "[]"
        sample = ", ".join(str(x) for x in value[:3])
        suffix = "..." if len(value) > 3 else ""
        return f"list(len={len(value)}): [{sample}{suffix}]"
    if isinstance(value, dict):
        keys = list(value.keys())
        sample = ", ".join(keys[:5])
        suffix = "..." if len(keys) > 5 else ""
        return f"dict(keys=[{sample}{suffix}])"
    return str(value)


def _build_finding_evidence(report: dict, finding: dict) -> list[str]:
    source_kpi = finding.get("source_kpi", "")
    source_value = _get_path_value(report, source_kpi) if source_kpi else None

    evidence = []
    if source_kpi:
        evidence.append(f"source_kpi: {source_kpi}")
        evidence.append(f"observed_value: {_format_evidence_value(source_value)}")
    else:
        evidence.append("source_kpi: unavailable")

    evidence.append(f"affected_count: {int(finding.get('affected_count') or 0)}")

    example_urls = finding.get("example_urls") or []
    if example_urls:
        evidence.append(f"example_urls: {', '.join(example_urls[:3])}{'...' if len(example_urls) > 3 else ''}")

    return evidence


def _build_audit_coverage(report: dict, all_findings: list[dict]) -> list[dict]:
    not_available = {
        x.get("id"): x.get("reason", "Not available")
        for x in (report.get("not_available_kpis") or [])
        if isinstance(x, dict) and x.get("id")
    }

    finding_by_source = {}
    for f in all_findings:
        src = f.get("source_kpi")
        if src:
            finding_by_source.setdefault(src, []).append(f)

    # Requested business checklist + available measurable paths.
    checklist = [
        ("cms_framework_version", "Version CMS/Framework", "domain_analysis.cms_kpi.cms_version", None),
        ("installed_modules_version", "Version modules installes", "domain_analysis.cms_kpi.module_versions", None),
        ("programming_language_version", "Version langage de programmation", "domain_analysis.cms_kpi.server_version", None),
        ("code_review", "Verification du code", None, None),
        ("ssl", "SSL", "domain_analysis.security.ssl", None),
        ("http_security_headers", "Securite des En-tetes HTTP", "domain_analysis.security.missing_headers", None),
        ("session_management", "Gestion des Sessions", "domain_analysis.cookie_kpi.missing_cookie_flag_count", None),
        ("sqli_ddos", "SQL injection et DDoS", "domain_analysis.vulnerability_kpi", None),
        ("forms", "Les formulaires", "domain_analysis.functional_kpi.total_forms", None),
        ("links", "Liens", "site_metrics.seo.broken_link_kpi", None),
        ("buttons", "Boutons", "site_metrics.performance.button_kpi.pages_with_nonfunc_buttons", None),
        ("features", "Fonctionnalites", "domain_analysis.functional_kpi", None),
        ("internal_search", "Fonctionnement du moteur de recherche interne", "domain_analysis.functional_kpi.has_search", None),
        ("error_404", "Erreur 404", "site_metrics.seo.broken_link_kpi.broken_link_count", None),
        ("desktop_load_time", "Temps de chargement desktop", "site_metrics.performance.avg_lcp_ms", None),
        ("mobile_load_time", "Temps de chargement mobile", "site_metrics.performance.mobile_kpi.lcp_ms", None),
        ("image_optimization", "Optimisation des images", "image_compression.compression_rate_pct", None),
        ("cache_management", "Gestion de cache", "domain_analysis.security.has_cache", None),
        ("compression_usage", "Utilisation de compression", "site_metrics.performance.html_compression_applied", None),
        ("alt_tags", "Balise Alts", "site_metrics.seo.images_missing_alt", None),
        ("meta_tags", "Balises META", "site_metrics.seo.pages_missing_meta_desc", None),
        ("sitemap", "Sitemap", "site_metrics.seo.has_sitemap", None),
        ("robots_txt", "Robot Txt", "site_metrics.seo.has_robots_txt", None),
        ("duplicate_content", "Duplication de contenu", "site_metrics.seo.duplicate_content_kpi.duplicate_content_rate_pct", None),
        ("multiplatform_compat", "Compatibilite multiplateforme", "site_metrics.seo.multi_browser_compatibility", "seo_multi_browser_compatibility"),
        ("url_structure", "Structure des URLs", "site_metrics.seo.node_style_url_count", None),
        ("content_structure_hn", "Structure du contenu (Hn)", "site_metrics.seo.pages_with_bad_h1", None),
        ("internal_linking", "Linking Interne", "site_metrics.ux.pages_missing_contextual_links", None),
        ("external_linking", "Linking externe", "site_metrics.seo.total_external_links", None),
        ("targeting", "Ciblage", "site_metrics.content.cannibalized_keywords", None),
        ("content_quality", "Pertinence, qualite, originalite et interet", "site_metrics.content.typo_detection", None),
        ("update_frequency", "Periodicite de mise a jour", "site_metrics.content.news_page_count", None),
        ("social_sharing", "Partage social", "site_metrics.seo.social_sharing_kpi", None),
        ("mesh", "Maillage", "site_metrics.ux.pages_missing_contextual_links", None),
        ("ergonomics_design", "Ergonomie et design", "site_metrics.ux", None),
        ("navigation_customer_journey", "Structure, navigation et parcours client", "domain_analysis.functional_kpi", None),
        ("conversion_funnel", "Tunnel de conversion", "site_metrics.ux.pages_with_conversion_funnels", None),
        ("mobile_friendly", "Mobile Friendly", "site_metrics.performance.mobile_kpi", None),
        ("eco_score", "Score ecologique et impact climatique du site", "site_metrics.performance.avg_eco_index", None),
        ("ux", "UX", "site_metrics.ux", None),
        ("prototype", "Prototype", None, None),
        ("ai_mockup_tool", "Outil IA de creation de maquettes", None, None),
    ]

    rows = []
    for control_id, label, path, not_available_id in checklist:
        if not_available_id and not_available_id in not_available:
            rows.append({
                "id": control_id,
                "label": label,
                "status": "not_available",
                "evidence": [not_available[not_available_id]],
            })
            continue

        value = _get_path_value(report, path) if path else None
        related_findings = []
        if path:
            for src, findings in finding_by_source.items():
                if src == path or src.startswith(path) or path.startswith(src):
                    related_findings.extend(findings)

        if value is None:
            status = "not_measured"
            evidence = ["No KPI value available in raw report for this control."]
        else:
            status = "covered"
            evidence = [f"{path}: {_format_evidence_value(value)}"]

        if related_findings:
            finding_ids = sorted({f["id"] for f in related_findings})
            evidence.append(f"related_findings: {', '.join(finding_ids)}")

        rows.append({
            "id": control_id,
            "label": label,
            "status": status,
            "evidence": evidence,
        })

    return rows


def _build_passing_kpis(report: dict, active_finding_ids: set) -> list:
    """
    Returns every KPI that was monitored but did NOT trigger a finding — i.e. it passed.
    Each entry: { id, label, source_kpi, observed_value, status="pass", evidence }
    """
    sm = report.get("site_metrics") or {}
    da = report.get("domain_analysis") or {}
    seo = sm.get("seo") or {}
    ux = sm.get("ux") or {}
    perf = sm.get("performance") or {}
    content = sm.get("content") or {}
    sec = da.get("security") or {}
    cms_kpi = da.get("cms_kpi") or {}
    privacy_kpi = da.get("privacy_kpi") or {}
    cookie_kpi = da.get("cookie_kpi") or {}
    functional_kpi = da.get("functional_kpi") or {}
    img_stats = report.get("image_compression") or {}
    mobile_kpi = perf.get("mobile_kpi") or {}

    passing: list[dict] = []

    def _add(kpi_id: str, label: str, source_kpi: str, value: Any,
             guarded_by: str = None, extra_evidence: list = None) -> None:
        """Add a passing KPI entry unless its guardian finding is active."""
        if guarded_by and guarded_by in active_finding_ids:
            return
        val_str = _format_evidence_value(value)
        ev = [f"{source_kpi}: {val_str}"]
        if extra_evidence:
            ev.extend(extra_evidence)
        passing.append({
            "id": kpi_id,
            "label": label,
            "source_kpi": source_kpi,
            "observed_value": val_str,
            "status": "pass",
            "evidence": ev,
        })

    # ── SECURITY ──────────────────────────────────────────────────────────
    ssl = sec.get("ssl") or {}
    if ssl.get("valid"):
        _add("ssl_valid", "SSL valide",
             "domain_analysis.security.ssl.valid", True,
             guarded_by="ssl_invalid_or_expired",
             extra_evidence=[
                 f"issuer: {ssl.get('issuer', '?')}",
                 f"expires: {ssl.get('expiry', '?')}",
                 f"protocol: {ssl.get('protocol', '?')}",
             ])

    exposed_paths = (da.get("exposed_path_kpi") or {}).get("exposed_paths") or []
    if not exposed_paths:
        _add("no_exposed_paths", "Aucun chemin sensible exposé",
             "domain_analysis.exposed_path_kpi.exposed_paths", "none",
             guarded_by="exposed_sensitive_paths")

    if not cms_kpi.get("cms_version_eol", False):
        _add("cms_not_eol", "CMS non en fin de vie",
             "domain_analysis.cms_kpi.cms_version_eol", False,
             guarded_by="cms_version_eol",
             extra_evidence=[f"cms_detected: {cms_kpi.get('cms_detected') or 'N/A'}"])

    server_tech = (cms_kpi.get("server_tech") or "").strip()
    server_version = (cms_kpi.get("server_version") or "").strip()
    if server_tech or server_version:
        display = f"{server_tech}/{server_version}" if server_tech and server_version else (server_tech or server_version)
        _add("server_tech_detected", f"Technologie serveur détectée : {display}",
             "domain_analysis.cms_kpi.server_version", display,
             extra_evidence=[f"domain_analysis.cms_kpi.server_tech: {server_tech or 'unknown'}"])

    if sec.get("has_cache", False):
        _add("cache_enabled", "Cache HTTP activé",
             "domain_analysis.security.has_cache", True)

    if not (sec.get("missing_headers") or []):
        _add("security_headers_ok", "En-têtes de sécurité complets",
             "domain_analysis.security.missing_headers", [],
             guarded_by="missing_security_headers")

    # ── SEO ───────────────────────────────────────────────────────────────
    if seo.get("has_sitemap"):
        _add("has_sitemap", "Sitemap XML présent",
             "site_metrics.seo.has_sitemap", True)

    if seo.get("has_robots_txt"):
        _add("has_robots_txt", "robots.txt présent",
             "site_metrics.seo.has_robots_txt", True)

    if int(seo.get("pages_missing_meta_desc") or 0) == 0:
        _add("meta_descriptions_complete", "Meta descriptions complètes (0 manquantes)",
             "site_metrics.seo.pages_missing_meta_desc", 0,
             guarded_by="missing_meta_description")

    if int(seo.get("pages_missing_title") or 0) == 0:
        _add("page_titles_complete", "Balises title complètes (0 manquantes)",
             "site_metrics.seo.pages_missing_title", 0,
             guarded_by="missing_page_title")

    if int(seo.get("images_missing_alt") or 0) == 0:
        _add("alt_tags_complete", "Balises ALT images complètes (0 manquantes)",
             "site_metrics.seo.images_missing_alt", 0,
             guarded_by="images_missing_alt_text")

    if int(seo.get("pages_with_bad_h1") or 0) == 0:
        _add("h1_structure_correct", "Structure H1 correcte sur toutes les pages",
             "site_metrics.seo.pages_with_bad_h1", 0,
             guarded_by="missing_h1_non_homepage")

    if int(seo.get("node_style_url_count") or 0) == 0:
        _add("clean_url_structure", "Structure URLs propre (0 URLs node/query)",
             "site_metrics.seo.node_style_url_count", 0,
             guarded_by="node_style_urls")

    dup_kpi = seo.get("duplicate_content_kpi") or {}
    dup_rate = float(dup_kpi.get("duplicate_content_rate_pct") or 0.0)
    if dup_rate <= 10.0:
        _add("low_duplicate_content", f"Contenu dupliqué faible ({dup_rate:.1f}%)",
             "site_metrics.seo.duplicate_content_kpi.duplicate_content_rate_pct",
             dup_rate, guarded_by="duplicate_content_high_rate")

    avg_score = float(seo.get("avg_score") or 0.0)
    if avg_score >= 80:
        _add("high_seo_score", f"Score SEO moyen élevé ({avg_score:.1f}/100)",
             "site_metrics.seo.avg_score", avg_score)

    total_internal = int(seo.get("total_internal_links") or 0)
    if total_internal > 0:
        _add("internal_links_present", f"{total_internal} liens internes détectés",
             "site_metrics.seo.total_internal_links", total_internal)

    unique_domains = int(seo.get("unique_external_domains") or 0)
    if unique_domains > 0:
        _add("external_domains_ok", f"{unique_domains} domaines externes référencés",
             "site_metrics.seo.unique_external_domains", unique_domains)

    social_kpi = seo.get("social_sharing_kpi") or {}
    if bool(social_kpi.get("passed", False)):
        social_pages = int(social_kpi.get("pages_with_social_sharing") or 0)
        social_score = float(social_kpi.get("avg_social_sharing_score") or 0.0)
        _add("social_sharing_coverage_ok", "Couverture partage social satisfaisante",
             "site_metrics.seo.social_sharing_kpi", social_score,
             guarded_by="low_social_sharing_coverage",
             extra_evidence=[
                 f"pages_with_social_sharing: {social_pages}",
                 f"avg_social_sharing_score: {social_score:.1f}",
             ])

    without_lazy = int(seo.get("pages_without_lazy_loading") or 0)
    pages_scanned_local = int(report.get("pages_scanned") or 1)
    lazy_ratio = without_lazy / max(pages_scanned_local, 1)
    if lazy_ratio <= 0.30:
        _add("lazy_loading_adequate", f"Lazy loading suffisant ({without_lazy} pages sans)",
             "site_metrics.seo.pages_without_lazy_loading", without_lazy,
             guarded_by="lazy_loading_missing_high_ratio")

    # ── PERFORMANCE ────────────────────────────────────────────────────────
    console_kpi = perf.get("console_error_kpi") or {}
    if int(console_kpi.get("homepage_console_error_count") or 0) == 0:
        _add("no_console_errors", "Aucune erreur console (homepage)",
             "site_metrics.performance.console_error_kpi.homepage_console_error_count",
             0, guarded_by="homepage_console_errors")

    if int(perf.get("gateway_timeout_count") or 0) == 0:
        _add("no_504_timeouts", "Aucun timeout 504 Gateway",
             "site_metrics.performance.gateway_timeout_count",
             0, guarded_by="gateway_timeouts_504")

    avg_lcp = perf.get("avg_lcp_ms")
    if avg_lcp is not None and float(avg_lcp) > 0:
        _add("avg_lcp_measured", f"LCP moyen mesuré : {float(avg_lcp):.0f} ms",
             "site_metrics.performance.avg_lcp_ms", float(avg_lcp))

    eco = float(perf.get("avg_eco_index") or 0.0)
    if eco > 0:
        _add("eco_index", f"Eco-Index moyen : {eco:.1f}/100",
             "site_metrics.performance.avg_eco_index", eco)

    total_kb = float(perf.get("total_resource_size_kb") or 0)
    if 0 < total_kb <= 5000:
        _add("acceptable_page_weight", f"Poids ressources acceptable ({total_kb/1000:.1f} Mo)",
             "site_metrics.performance.total_resource_size_kb", total_kb,
             guarded_by="heavy_page_weight")

    avg_fcp = perf.get("avg_fcp_ms")
    if avg_fcp is not None and float(avg_fcp) > 0 and float(avg_fcp) <= 3000:
        _add("avg_fcp_ok", f"FCP moyen OK ({float(avg_fcp):.0f} ms)",
             "site_metrics.performance.avg_fcp_ms", float(avg_fcp),
             guarded_by="avg_fcp_over_3s")

    if not (perf.get("button_kpi") or {}).get("pages_with_nonfunc_buttons"):
        _add("buttons_ok", "Tous les boutons sont fonctionnels",
             "site_metrics.performance.button_kpi.pages_with_nonfunc_buttons", 0,
             guarded_by="non_functional_buttons")

    if bool(perf.get("html_compression_applied", False)):
        _add("compression_enabled", "Compression HTTP activée (gzip/brotli)",
             "site_metrics.performance.html_compression_applied", True,
             guarded_by="http_compression_disabled")

    # Mobile KPIs (only when available)
    if mobile_kpi.get("available", False) or mobile_kpi.get("lcp_ms") is not None:
        m_lcp = mobile_kpi.get("lcp_ms")
        if m_lcp is not None and 0 < float(m_lcp) <= 4000:
            _add("mobile_lcp_ok", f"LCP mobile OK ({float(m_lcp):.0f} ms)",
                 "site_metrics.performance.mobile_kpi.lcp_ms", float(m_lcp),
                 guarded_by="mobile_lcp_over_4s")
        m_cls = mobile_kpi.get("cls")
        if m_cls is not None and float(m_cls) <= 0.25:
            _add("mobile_cls_ok", f"CLS mobile OK ({float(m_cls):.3f})",
                 "site_metrics.performance.mobile_kpi.cls", float(m_cls),
                 guarded_by="mobile_cls_over_025")

    # ── CONTENT ────────────────────────────────────────────────────────────
    freshness = content.get("freshness_kpi") or {}
    latest = freshness.get("latest_pub_date")
    if freshness.get("passed") and latest:
        _add("content_fresh", f"Contenu frais (dernière publication : {latest})",
             "site_metrics.content.freshness_kpi", latest)

    sampled = int(img_stats.get("sampled_images") or 0)
    unopt = int(img_stats.get("unoptimised_count") or 0)
    if sampled > 0:
        unopt_rate = (unopt / sampled) * 100
        if unopt_rate <= 20.0:
            _add("images_well_optimised", f"Images bien optimisées ({100-unopt_rate:.1f}% OK)",
                 "image_compression.unoptimised_count",
                 f"{unopt}/{sampled} non optimisées ({unopt_rate:.1f}%)",
                 guarded_by="unoptimised_images_over_20pct")

    # ── UX ─────────────────────────────────────────────────────────────────
    if int(ux.get("pages_with_low_text_density") or 0) == 0:
        _add("good_text_density", "Densité textuelle satisfaisante (0 pages faibles)",
             "site_metrics.ux.pages_with_low_text_density", 0,
             guarded_by="low_text_density_pages")

    if int(ux.get("pages_missing_contextual_links") or 0) == 0:
        _add("contextual_links_ok", "Maillage contextuel interne complet",
             "site_metrics.ux.pages_missing_contextual_links", 0,
             guarded_by="missing_contextual_internal_links")

    if int((ux.get("raw_ip_link_kpi") or {}).get("total_raw_ip_links") or 0) == 0:
        _add("no_raw_ip_links", "Aucun lien vers adresse IP brute",
             "site_metrics.ux.raw_ip_link_kpi.total_raw_ip_links", 0,
             guarded_by="raw_ip_links_present")

    # ── COMPLIANCE / PRIVACY ───────────────────────────────────────────────
    if privacy_kpi.get("has_privacy_policy"):
        _add("privacy_policy_present", "Politique de confidentialité présente",
             "domain_analysis.privacy_kpi.has_privacy_policy", True,
             guarded_by="missing_privacy_policy")

    if privacy_kpi.get("has_legal_notice"):
        _add("legal_notice_present", "Mentions légales présentes",
             "domain_analysis.privacy_kpi.has_legal_notice", True,
             guarded_by="missing_legal_notice")

    if privacy_kpi.get("has_consent_checkbox"):
        _add("consent_checkbox_present", "Case à cocher de consentement détectée",
             "domain_analysis.privacy_kpi.has_consent_checkbox", True)

    if privacy_kpi.get("has_cookie_policy"):
        _add("cookie_policy_present", "Page politique cookies présente",
             "domain_analysis.privacy_kpi.has_cookie_policy", True,
             guarded_by="missing_cookie_policy")

    if privacy_kpi.get("has_security_policy"):
        _add("security_policy_present", "Politique de sécurité présente",
             "domain_analysis.privacy_kpi.has_security_policy", True,
             guarded_by="missing_security_policy")

    if privacy_kpi.get("has_information_rights"):
        _add("information_rights_present", "Droits des personnes documentés",
             "domain_analysis.privacy_kpi.has_information_rights", True,
             guarded_by="missing_information_rights")

    if privacy_kpi.get("has_declared_purpose"):
        _add("declared_purpose_present", "Finalité du traitement déclarée",
             "domain_analysis.privacy_kpi.has_declared_purpose", True,
             guarded_by="missing_declared_purpose")

    if int(cookie_kpi.get("missing_cookie_flag_count") or 0) == 0:
        _add("cookie_flags_ok", "Tous les cookies ont HttpOnly/Secure",
             "domain_analysis.cookie_kpi.missing_cookie_flag_count", 0,
             guarded_by="missing_cookie_security_flags")

    # ── FUNCTIONAL ─────────────────────────────────────────────────────────
    if functional_kpi.get("has_login"):
        _add("login_present", "Espace connexion/login détecté",
             "domain_analysis.functional_kpi.has_login", True)

    if functional_kpi.get("has_contact"):
        _add("contact_present", "Page / formulaire contact détecté",
             "domain_analysis.functional_kpi.has_contact", True)

    if functional_kpi.get("has_newsletter"):
        _add("newsletter_present", "Formulaire newsletter détecté",
             "domain_analysis.functional_kpi.has_newsletter", True)

    if functional_kpi.get("has_cart"):
        _add("cart_present", "Panier e-commerce détecté",
             "domain_analysis.functional_kpi.has_cart", True)

    if functional_kpi.get("has_rdv"):
        _add("rdv_present", "Module prise de rendez-vous détecté",
             "domain_analysis.functional_kpi.has_rdv", True)

    return passing


def classify_report(report: dict) -> dict:
    findings: list[dict] = []

    pages_scanned = int(report.get("pages_scanned") or 0)
    domain_analysis = report.get("domain_analysis") or {}
    site_metrics = report.get("site_metrics") or {}

    sec = domain_analysis.get("security") or {}
    cookie_kpi = domain_analysis.get("cookie_kpi") or {}
    exposed_kpi = domain_analysis.get("exposed_path_kpi") or {}
    cms_kpi = domain_analysis.get("cms_kpi") or {}
    privacy_kpi = domain_analysis.get("privacy_kpi") or {}
    vulnerability_kpi = domain_analysis.get("vulnerability_kpi") or {}

    seo = site_metrics.get("seo") or {}
    ux = site_metrics.get("ux") or {}
    perf = site_metrics.get("performance") or {}
    content = site_metrics.get("content") or {}

    scan_domain = _extract_domain(report.get("domain", ""))
    homepage = report.get("domain", "")
    issue_url_index = _build_issue_url_index(report)

    # BUG — SSL invalid or expired
    ssl_data = sec.get("ssl") or {}
    ssl_valid = ssl_data.get("valid")  # None means the SSL probe did not run
    if ssl_valid is None:
        # SSL data absent — cannot confirm validity; flag as unverified rather than passing
        findings.append(_mk_finding(
            finding_id="ssl_non_evalue",
            title="SSL non vérifié — sonde échouée ou données absentes",
            finding_type="BUG",
            severity="HIGH",
            scope="DOMAIN",
            description="La validité du certificat SSL n'a pas pu être vérifiée lors de ce scan.",
            impact="Un SSL invalide ou absent expose les utilisateurs à des risques de sécurité. Sans vérification, ce risque ne peut pas être écarté.",
            fix="Relancer le scan ou vérifier manuellement le certificat SSL du domaine.",
            source_kpi="domain_analysis.security.ssl.valid",
            affected_count=1,
            fix_complexity="config",
        ))
    elif not ssl_valid:
        findings.append(_mk_finding(
            finding_id="ssl_invalid_or_expired",
            title="Certificat SSL invalide ou expiré",
            finding_type="BUG",
            severity="CRITICAL",
            scope="DOMAIN",
            description="Le certificat SSL du domaine est invalide, expiré ou absent.",
            impact="Risque de sécurité élevé et perte de confiance des utilisateurs.",
            fix="Renouveler et déployer un certificat TLS valide sur le domaine.",
            source_kpi="domain_analysis.security.ssl.valid",
            affected_count=1,
            fix_complexity="config",
        ))

    # BUG — missing HTTP security headers
    missing_headers = (sec.get("missing_headers") or [])
    if missing_headers:
        hdrs = ", ".join(missing_headers[:4])
        sev = "HIGH" if len(missing_headers) >= 3 else "MEDIUM"
        findings.append(_mk_finding(
            finding_id="missing_security_headers",
            title="En-têtes de sécurité HTTP manquants",
            finding_type="BUG",
            severity=sev,
            scope="DOMAIN",
            description=f"{len(missing_headers)} en-tête(s) HTTP de sécurité absents : {hdrs}{'...' if len(missing_headers) > 4 else ''}.",
            impact="Surface d'attaque accrue (XSS, clickjacking, MIME sniffing, CSRF).",
            fix="Configurer les en-têtes manquants au niveau serveur ou reverse-proxy (nginx/Apache/CDN).",
            source_kpi="domain_analysis.security.missing_headers",
            affected_count=len(missing_headers),
            fix_complexity="config",
        ))

    # BUG — exposed sensitive paths
    exposed_paths = exposed_kpi.get("exposed_paths") or []
    if exposed_paths:
        findings.append(_mk_finding(
            finding_id="exposed_sensitive_paths",
            title="Chemins sensibles exposés",
            finding_type="BUG",
            severity="CRITICAL",
            scope="DOMAIN",
            description=f"{len(exposed_paths)} chemin(s) sensible(s) sont accessibles publiquement.",
            impact="Exposition potentielle de secrets et surface d'attaque accrue.",
            fix="Bloquer l'accès public à ces chemins au niveau serveur/proxy.",
            source_kpi="domain_analysis.exposed_path_kpi.exposed_paths",
            affected_count=len(exposed_paths),
            fix_complexity="config",
        ))

    # BUG — vulnerability signals (SQLi / XSS / DDoS)
    sqli_vulns = int(vulnerability_kpi.get("sqli_vulnerable_count") or 0)
    xss_vulns = int(vulnerability_kpi.get("xss_vulnerable_count") or 0)
    ddos_signals = int(vulnerability_kpi.get("ddos_signal_count") or 0)
    total_vuln_signals = sqli_vulns + xss_vulns + ddos_signals
    if total_vuln_signals > 0:
        findings.append(_mk_finding(
            finding_id="injection_or_ddos_signals",
            title="Signaux SQLi/XSS/DDoS détectés",
            finding_type="BUG",
            severity="HIGH",
            scope="DOMAIN",
            description=f"{total_vuln_signals} signal(s) de vulnérabilité (SQLi/XSS/DDoS) ont été détectés.",
            impact="Exposition potentielle à des compromissions applicatives et indisponibilité de service.",
            fix="Analyser les endpoints signalés, corriger la validation d'entrées, renforcer WAF/rate-limit et rejouer les tests de sécurité.",
            source_kpi="domain_analysis.vulnerability_kpi",
            affected_count=total_vuln_signals,
            fix_complexity="code",
        ))

    # BUG — CMS EOL
    cms_eol = cms_kpi.get("cms_version_eol")  # True | False | None
    cms_name = cms_kpi.get("cms_detected") or "CMS"
    cms_ver = cms_kpi.get("cms_version") or "version inconnue"
    if cms_eol is True:
        findings.append(_mk_finding(
            finding_id="cms_version_eol",
            title="Version CMS en fin de vie",
            finding_type="BUG",
            severity="CRITICAL",
            scope="DOMAIN",
            description=f"{cms_name} {cms_ver} est en fin de vie.",
            impact="Absence de correctifs de sécurité, risque de compromission élevé.",
            fix="Planifier une montée de version vers une release maintenue.",
            source_kpi="domain_analysis.cms_kpi.cms_version_eol",
            affected_count=1,
            fix_complexity="code",
        ))
    elif cms_eol is None and cms_kpi.get("cms_detected"):
        # [5.6] CMS was identified but the version check didn't run (probe failed or
        # version not detectable). Signal this gap rather than silently passing.
        findings.append(_mk_finding(
            finding_id="cms_eol_non_verifie",
            title="EOL CMS non vérifié — version indétectable",
            finding_type="BUG",
            severity="MEDIUM",
            scope="DOMAIN",
            description=f"{cms_name} détecté mais la version n\'a pas pu être identifiée. Le statut EOL est inconnu.",
            impact="Un CMS EOL non détecté peut être vulnérable sans le savoir.",
            fix="Vérifier manuellement la version du CMS et son statut de maintenance.",
            source_kpi="domain_analysis.cms_kpi.cms_version_eol",
            affected_count=1,
            fix_complexity="config",
        ))

    # BUG — broken links
    broken = seo.get("broken_link_kpi") or {}
    broken_count = int(broken.get("broken_link_count") or 0)
    if broken_count > 0:
        broken_urls = []
        for b in (broken.get("broken_links") or []):
            if isinstance(b, dict):
                broken_urls.append(b.get("found_on") or b.get("url") or "")
        findings.append(_mk_finding(
            finding_id="broken_links",
            title="Liens cassés détectés",
            finding_type="BUG",
            severity="HIGH",
            scope="SITEWIDE",
            description=f"{broken_count} lien(s) interne(s) ou externe(s) renvoient 4xx/5xx.",
            impact="Dégrade l'expérience utilisateur et le crawl SEO.",
            fix="Corriger, rediriger ou supprimer les liens cassés identifiés.",
            source_kpi="site_metrics.seo.broken_link_kpi",
            affected_count=broken_count,
            fix_complexity="redirect",
            example_urls=broken_urls,
        ))

    # BUG — console errors on homepage
    console_kpi = perf.get("console_error_kpi") or {}
    homepage_console_errors = int(console_kpi.get("homepage_console_error_count") or 0)
    if homepage_console_errors > 0:
        findings.append(_mk_finding(
            finding_id="homepage_console_errors",
            title="Erreurs console sur la page d'accueil",
            finding_type="BUG",
            severity="HIGH",
            scope="PAGE",
            description=f"{homepage_console_errors} erreur(s) console détectée(s) sur la page d'accueil.",
            impact="Peut casser des interactions critiques et nuire aux conversions.",
            fix="Corriger les exceptions JavaScript et dépendances manquantes côté front.",
            source_kpi="site_metrics.performance.console_error_kpi.homepage_console_error_count",
            affected_count=homepage_console_errors,
            fix_complexity="code",
            example_urls=[homepage] if homepage else [],
        ))

    # BUG — non-functional buttons
    button_kpi = perf.get("button_kpi") or {}
    nonfunc_pages = int(button_kpi.get("pages_with_nonfunc_buttons") or 0)
    if nonfunc_pages > 0:
        findings.append(_mk_finding(
            finding_id="non_functional_buttons",
            title="Boutons non fonctionnels",
            finding_type="BUG",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"Des boutons non fonctionnels existent sur {nonfunc_pages} page(s).",
            impact="Risque d'abandon du parcours utilisateur et baisse de conversion.",
            fix="Rendre chaque action cliquable opérationnelle ou retirer les faux boutons.",
            source_kpi="site_metrics.performance.button_kpi.pages_with_nonfunc_buttons",
            affected_count=nonfunc_pages,
            fix_complexity="code",
        ))

    # BUG — 504 gateway timeouts
    gateway_timeouts = int(perf.get("gateway_timeout_count") or 0)
    if gateway_timeouts > 0:
        findings.append(_mk_finding(
            finding_id="gateway_timeouts_504",
            title="Timeouts 504 détectés",
            finding_type="BUG",
            severity="HIGH",
            scope="SITEWIDE",
            description=f"{gateway_timeouts} réponse(s) 504 ont été observées durant le scan.",
            impact="Interrompt l'accès aux pages et nuit à l'indexation.",
            fix="Stabiliser les timeouts backend/upstream et renforcer la capacité serveur.",
            source_kpi="site_metrics.performance.gateway_timeout_count",
            affected_count=gateway_timeouts,
            fix_complexity="config",
        ))

    # RECOMMENDATION — heavy total page weight
    total_resource_kb = float(perf.get("total_resource_size_kb") or 0)
    if total_resource_kb > 5000:
        severity_weight = "HIGH" if total_resource_kb > 20000 else "MEDIUM"
        findings.append(_mk_finding(
            finding_id="heavy_page_weight",
            title="Poids total des ressources excessif",
            finding_type="RECOMMENDATION",
            severity=severity_weight,
            scope="DOMAIN",
            description=f"Le poids total des ressources chargées est de {total_resource_kb/1000:.1f} Mo, bien au-delà du seuil recommandé (< 5 Mo).",
            impact="Temps de chargement accru, mauvaise expérience sur mobile et pénalité Core Web Vitals.",
            fix="Auditer les images lourdes, JS non utilisé et CSS inutile via les outils de perf. Activer le lazy-loading et le tree-shaking.",
            source_kpi="site_metrics.performance.total_resource_size_kb",
            affected_count=1,
            fix_complexity="code",
        ))

    # RECOMMENDATION — HTTP compression disabled
    # [A2] Only fire when html_compression_applied is explicitly False.
    # Missing field (None) means scanner didn't measure it — not that compression is off.
    html_compression = perf.get("html_compression_applied")
    if html_compression is False:
        findings.append(_mk_finding(
            finding_id="http_compression_disabled",
            title="Compression HTTP non activée",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="DOMAIN",
            description="La compression HTTP (gzip/brotli) n'est pas appliquée sur les réponses du serveur.",
            impact="Taille des transferts accrue — ralentit la navigation et la perception de performance.",
            fix="Activer gzip ou brotli dans la configuration serveur (nginx/Apache/CDN).",
            source_kpi="site_metrics.performance.html_compression_applied",
            affected_count=1,
            fix_complexity="config",
        ))

    # COMPLIANCE — missing cookie HttpOnly/Secure
    missing_cookie_flags = int(cookie_kpi.get("missing_cookie_flag_count") or 0)
    if missing_cookie_flags > 0:
        findings.append(_mk_finding(
            finding_id="missing_cookie_security_flags",
            title="Cookies sans flags de sécurité",
            finding_type="COMPLIANCE",
            severity="CRITICAL",
            scope="DOMAIN",
            description=f"{missing_cookie_flags} cookie(s) sans HttpOnly/Secure ont été détectés.",
            impact="Non-conformité sécurité/confidentialité et risque d'exploitation.",
            fix="Ajouter systématiquement HttpOnly et Secure sur les cookies concernés.",
            source_kpi="domain_analysis.cookie_kpi.missing_cookie_flag_count",
            affected_count=missing_cookie_flags,
            fix_complexity="config",
        ))

    # COMPLIANCE — no cookie consent banner
    # [A3] If consent is None, scanner didn't probe this — emit non_evalue notice instead of CRITICAL.
    # Previously: None → has_banner=False → fires CRITICAL finding with zero evidence.
    consent = privacy_kpi.get("cookie_consent")
    if consent is None:
        findings.append(_mk_finding(
            finding_id="cookie_consent_non_evalue",
            title="Consentement cookies non vérifié",
            finding_type="BUG",
            severity="LOW",
            scope="DOMAIN",
            description="La sonde de détection du bandeau de consentement n'a pas renvoyé de résultat.",
            impact="Impossible de confirmer ou infirmer la présence d'un CMP.",
            fix="Vérifier que le scanner a bien accès à la page d'accueil et rélancer le scan.",
            source_kpi="domain_analysis.privacy_kpi.cookie_consent",
            affected_count=0,
            fix_complexity="config",
        ))
    else:
        has_banner = False
        if isinstance(consent, dict):
            # Primary: read the unified cmp_present field injected by main.py (Issue 6 fix).
            # Fallback: check legacy fields for backwards compatibility.
            if "cmp_present" in consent:
                has_banner = bool(consent["cmp_present"])
            else:
                has_banner = bool(
                    consent.get("has_banner")
                    or consent.get("present")
                    or consent.get("detected")
                    or consent.get("cmp_nlp_detected")
                )
        else:
            has_banner = bool(consent)
        if not has_banner:
            findings.append(_mk_finding(
                finding_id="missing_cookie_consent_banner",
                title="Bandeau consentement cookies absent",
                finding_type="COMPLIANCE",
                severity="CRITICAL",
                scope="DOMAIN",
                description="Aucun bandeau de consentement cookies n'a été détecté.",
                impact="Risque réglementaire RGPD/ePrivacy immédiat.",
                fix="Déployer une CMP avec consentement explicite avant dépôt de traceurs.",
                source_kpi="domain_analysis.privacy_kpi.cookie_consent",
                affected_count=1,
                fix_complexity="config",
            ))

    # COMPLIANCE — no privacy policy
    if not bool(privacy_kpi.get("has_privacy_policy")):
        findings.append(_mk_finding(
            finding_id="missing_privacy_policy",
            title="Politique de confidentialité absente",
            finding_type="COMPLIANCE",
            severity="CRITICAL",
            scope="DOMAIN",
            description="Le site ne présente pas de page de politique de confidentialité.",
            impact="Exposition à un risque légal et réputationnel élevé.",
            fix="Publier une politique de confidentialité complète et accessible.",
            source_kpi="domain_analysis.privacy_kpi.has_privacy_policy",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — NLP-derived RGPD findings: only fire when NLP actually ran.
    # If nlp_partiel is True, content fields are 0 because NLP timed out — not because
    # the site truly lacks these declarations. Guard all content-based RGPD checks.
    nlp_ran = not report.get("nlp_partiel", False)

    # COMPLIANCE — no data retention declaration
    retention_pages = int(content.get("rgpd_retention_signal_pages") or 0)
    if nlp_ran and retention_pages == 0:
        findings.append(_mk_finding(
            finding_id="missing_data_retention_declaration",
            title="Durée de conservation non déclarée",
            finding_type="COMPLIANCE",
            severity="HIGH",
            scope="DOMAIN",
            description="Aucune mention claire de durée de conservation des données n'a été trouvée.",
            impact="Risque de non-conformité RGPD sur la transparence du traitement.",
            fix="Ajouter les durées de conservation par finalité dans la politique RGPD.",
            source_kpi="site_metrics.content.rgpd_retention_signal_pages",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — no data minimization declaration
    minim_pages = int(content.get("rgpd_minimization_signal_pages") or 0)
    if nlp_ran and minim_pages == 0:
        findings.append(_mk_finding(
            finding_id="missing_data_minimization_declaration",
            title="Minimisation des données non déclarée",
            finding_type="COMPLIANCE",
            severity="HIGH",
            scope="DOMAIN",
            description="Aucune mention explicite de minimisation des données n'a été détectée.",
            impact="Risque de non-conformité RGPD sur le principe de minimisation.",
            fix="Documenter la minimisation des données collectées par finalité.",
            source_kpi="site_metrics.content.rgpd_minimization_signal_pages",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — no legal notice
    if not bool(privacy_kpi.get("has_legal_notice")):
        findings.append(_mk_finding(
            finding_id="missing_legal_notice",
            title="Mentions légales absentes",
            finding_type="COMPLIANCE",
            severity="HIGH",
            scope="DOMAIN",
            description="Aucune page de mentions légales n'a été trouvée.",
            impact="Risque réglementaire et manque de transparence juridique.",
            fix="Ajouter une page de mentions légales complète et facilement accessible.",
            source_kpi="domain_analysis.privacy_kpi.has_legal_notice",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — no security policy (PSSI)
    if not bool(privacy_kpi.get("has_security_policy")):
        findings.append(_mk_finding(
            finding_id="missing_security_policy",
            title="Politique de sécurité absente",
            finding_type="COMPLIANCE",
            severity="MEDIUM",
            scope="DOMAIN",
            description="Aucune politique de sécurité (PSSI) n'a été détectée.",
            impact="Affaiblit la gouvernance sécurité et la conformité documentaire.",
            fix="Publier une politique de sécurité adaptée aux traitements réalisés.",
            source_kpi="domain_analysis.privacy_kpi.has_security_policy",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — no cookie policy
    if not bool(privacy_kpi.get("has_cookie_policy")):
        findings.append(_mk_finding(
            finding_id="missing_cookie_policy",
            title="Politique cookies absente",
            finding_type="COMPLIANCE",
            severity="MEDIUM",
            scope="DOMAIN",
            description="Aucune page dédiée à la politique cookies n'a été détectée.",
            impact="Risque de non-conformité ePrivacy et manque de transparence envers les utilisateurs.",
            fix="Créer et lier une page de politique cookies accessible depuis le bandeau de consentement.",
            source_kpi="domain_analysis.privacy_kpi.has_cookie_policy",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — no information rights (RGPD Art.13/14)
    if not bool(privacy_kpi.get("has_information_rights")):
        findings.append(_mk_finding(
            finding_id="missing_information_rights",
            title="Droits des personnes non mentionnés",
            finding_type="COMPLIANCE",
            severity="HIGH",
            scope="DOMAIN",
            description="Aucune mention des droits RGPD (accès, rectification, opposition, effacement) n'a été détectée.",
            impact="Non-conformité RGPD Art.13/14 sur l'information des personnes concernées.",
            fix="Documenter explicitement les droits des personnes dans la politique de confidentialité.",
            source_kpi="domain_analysis.privacy_kpi.has_information_rights",
            affected_count=1,
            fix_complexity="content",
        ))

    # COMPLIANCE — no declared purpose
    if not bool(privacy_kpi.get("has_declared_purpose")):
        findings.append(_mk_finding(
            finding_id="missing_declared_purpose",
            title="Finalité du traitement non déclarée",
            finding_type="COMPLIANCE",
            severity="MEDIUM",
            scope="DOMAIN",
            description="La finalité du traitement des données n'est pas explicitement mentionnée.",
            impact="Risque de non-conformité sur la base légale et la transparence RGPD.",
            fix="Préciser la finalité de chaque collecte de données personnelles.",
            source_kpi="domain_analysis.privacy_kpi.has_declared_purpose",
            affected_count=1,
            fix_complexity="content",
        ))

    # RECOMMENDATION — missing meta description >20% or <20%
    missing_meta = int(seo.get("pages_missing_meta_desc") or 0)
    if pages_scanned > 0 and missing_meta > 0:
        ratio = missing_meta / max(pages_scanned, 1)
        sev = "HIGH" if ratio > 0.20 else "MEDIUM"
        findings.append(_mk_finding(
            finding_id="missing_meta_description",
            title="Meta descriptions manquantes",
            finding_type="RECOMMENDATION",
            severity=sev,
            scope="SITEWIDE",
            description=f"{missing_meta} page(s) n'ont pas de meta description.",
            impact="Réduit la qualité des extraits SEO et le taux de clic SERP.",
            fix="Compléter les meta descriptions au niveau template/CMS et contenu.",
            source_kpi="site_metrics.seo.pages_missing_meta_desc",
            affected_count=missing_meta,
            fix_complexity="template",
        ))

    # RECOMMENDATION — node-style URLs present
    node_style_count = int(seo.get("node_style_url_count") or 0)
    if node_style_count > 0:
        findings.append(_mk_finding(
            finding_id="node_style_urls",
            title="URLs de type node détectées",
            finding_type="RECOMMENDATION",
            severity="HIGH",
            scope="SITEWIDE",
            description=f"{node_style_count} URL(s) de type /node/<id> ou ?q= ont été détectées.",
            impact="Structure d'URL peu SEO-friendly et maintenance plus complexe.",
            fix="Mettre en place des URLs propres et redirections permanentes.",
            source_kpi="site_metrics.seo.node_style_url_count",
            affected_count=node_style_count,
            fix_complexity="redirect",
        ))

    # RECOMMENDATION — social sharing coverage
    # [A8] Only fire when passed is explicitly False — missing data defaults to True,
    # which would suppress this finding even when the scanner never ran the check.
    social_kpi = seo.get("social_sharing_kpi") or {}
    social_pages = int(social_kpi.get("pages_with_social_sharing") or 0)
    social_passed = social_kpi.get("passed")  # None = not measured
    if pages_scanned > 0 and social_passed is False:
        findings.append(_mk_finding(
            finding_id="low_social_sharing_coverage",
            title="Partage social insuffisant",
            finding_type="RECOMMENDATION",
            severity="LOW",
            scope="SITEWIDE",
            description=f"Le partage social est présent sur {social_pages}/{pages_scanned} pages, sous le seuil attendu.",
            impact="Réduit la découvrabilité des contenus et les opportunités de diffusion organique.",
            fix="Ajouter les métadonnées OpenGraph/Twitter et des boutons de partage sur les templates de contenu.",
            source_kpi="site_metrics.seo.social_sharing_kpi",
            affected_count=max(1, pages_scanned - social_pages),
            fix_complexity="template",
        ))

    # RECOMMENDATION — duplicate content rate >10%
    dup_kpi = seo.get("duplicate_content_kpi") or {}
    dup_rate = float(dup_kpi.get("duplicate_content_rate_pct") or 0.0)
    dup_count = int(dup_kpi.get("duplicate_page_count") or 0)
    if dup_rate > 10.0:
        findings.append(_mk_finding(
            finding_id="duplicate_content_high_rate",
            title="Taux de contenu dupliqué élevé",
            finding_type="RECOMMENDATION",
            severity="HIGH",
            scope="SITEWIDE",
            description=f"Le taux de duplication atteint {dup_rate:.1f}% ({dup_count} pages).",
            impact="Risque de cannibalisation SEO et dilution de pertinence.",
            fix="Consolider, réécrire ou canonicaliser les pages dupliquées.",
            source_kpi="site_metrics.seo.duplicate_content_kpi.duplicate_content_rate_pct",
            affected_count=dup_count if dup_count > 0 else 1,
            fix_complexity="content",
        ))

    # RECOMMENDATION — images missing alt text
    missing_alt = int(seo.get("images_missing_alt") or 0)
    if missing_alt > 0:
        findings.append(_mk_finding(
            finding_id="images_missing_alt_text",
            title="Images sans texte alternatif",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{missing_alt} image(s) sont sans attribut alt.",
            impact="Accessibilité réduite et signal SEO dégradé.",
            fix="Renseigner des attributs alt descriptifs pour les images concernées.",
            source_kpi="site_metrics.seo.images_missing_alt",
            affected_count=missing_alt,
            fix_complexity="content",
        ))

    # RECOMMENDATION — no lazy loading (>30% pages)
    without_lazy = int(seo.get("pages_without_lazy_loading") or 0)
    if pages_scanned > 0 and without_lazy / max(pages_scanned, 1) > 0.30:
        findings.append(_mk_finding(
            finding_id="lazy_loading_missing_high_ratio",
            title="Lazy loading insuffisant",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{without_lazy} page(s) dépassent le seuil sans lazy loading.",
            impact="Temps de chargement plus élevé, surtout sur mobile.",
            fix="Activer loading=lazy via templates pour les images non critiques.",
            source_kpi="site_metrics.seo.pages_without_lazy_loading",
            affected_count=without_lazy,
            fix_complexity="template",
        ))

    # RECOMMENDATION — thin content pages (NLP <300 words)
    thin_pages = int(content.get("pages_thin_content_nlp") or 0)
    if thin_pages > 0:
        findings.append(_mk_finding(
            finding_id="thin_content_pages",
            title="Pages à contenu faible",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{thin_pages} page(s) ont moins de 300 mots (NLP).",
            impact="Réduit la profondeur éditoriale et la performance SEO.",
            fix="Enrichir les pages avec contenu utile, structuré et orienté intention.",
            source_kpi="site_metrics.content.pages_thin_content_nlp",
            affected_count=thin_pages,
            fix_complexity="content",
        ))

    # RECOMMENDATION — keyword stuffing detected
    stuffed_pages = int(content.get("pages_with_keyword_stuffing") or 0)
    if stuffed_pages > 0:
        findings.append(_mk_finding(
            finding_id="keyword_stuffing_detected",
            title="Keyword stuffing détecté",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{stuffed_pages} page(s) présentent un signal de sur-optimisation.",
            impact="Risque de pénalité SEO et baisse de lisibilité.",
            fix="Réécrire les contenus pour une densité naturelle des mots-clés.",
            source_kpi="site_metrics.content.pages_with_keyword_stuffing",
            affected_count=stuffed_pages,
            fix_complexity="content",
        ))

    # RECOMMENDATION — keyword cannibalization (>=5 pages)
    cannibalized = content.get("cannibalized_keywords") or []
    cannibalized_pages = sum(int(x.get("count") or 0) for x in cannibalized)
    if cannibalized_pages >= 5:
        # Use pages from the largest (most cannibalized) keyword as examples
        top_cannibal = max(cannibalized, key=lambda x: int(x.get("count") or 0), default={})
        cannibal_example_urls = (top_cannibal.get("pages") or [])[:5]
        findings.append(_mk_finding(
            finding_id="keyword_cannibalization",
            title="Cannibalisation de mots-clés",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{cannibalized_pages} occurrences de pages cannibalisées ont été détectées.",
            impact="Concurrence interne entre pages et dilution du positionnement.",
            fix="Regrouper les intentions proches et clarifier le ciblage par page.",
            source_kpi="site_metrics.content.cannibalized_keywords",
            affected_count=cannibalized_pages,
            fix_complexity="content",
            example_urls=cannibal_example_urls,
        ))

    # RECOMMENDATION — low text density pages
    low_text_pages = int(ux.get("pages_with_low_text_density") or 0)
    if low_text_pages > 0:
        findings.append(_mk_finding(
            finding_id="low_text_density_pages",
            title="Pages à faible densité textuelle",
            finding_type="RECOMMENDATION",
            severity="LOW",
            scope="SITEWIDE",
            description=f"{low_text_pages} page(s) ont une densité texte/HTML faible.",
            impact="Compréhension du contenu réduite pour utilisateurs et moteurs.",
            fix="Augmenter la clarté éditoriale sur les pages concernées.",
            source_kpi="site_metrics.ux.pages_with_low_text_density",
            affected_count=low_text_pages,
            fix_complexity="content",
        ))

    # RECOMMENDATION — no contextual internal links
    missing_contextual = int(ux.get("pages_missing_contextual_links") or 0)
    if missing_contextual > 0:
        findings.append(_mk_finding(
            finding_id="missing_contextual_internal_links",
            title="Maillage interne contextuel insuffisant",
            finding_type="RECOMMENDATION",
            severity="LOW",
            scope="SITEWIDE",
            description=f"{missing_contextual} page(s) manquent de liens internes contextuels.",
            impact="Navigation et distribution de popularité interne dégradées.",
            fix="Ajouter des liens internes contextuels dans le corps de page.",
            source_kpi="site_metrics.ux.pages_missing_contextual_links",
            affected_count=missing_contextual,
            fix_complexity="content",
        ))

    # RECOMMENDATION — missing H1 on non-homepage
    bad_h1_total = int(seo.get("pages_with_bad_h1") or 0)
    homepage_h1_missing = bool((seo.get("homepage_h1_kpi") or {}).get("homepage_h1_missing", False))
    non_home_bad_h1 = bad_h1_total - (1 if homepage_h1_missing and bad_h1_total > 0 else 0)
    if non_home_bad_h1 > 0:
        findings.append(_mk_finding(
            finding_id="missing_h1_non_homepage",
            title="H1 manquant hors page d'accueil",
            finding_type="RECOMMENDATION",
            severity="LOW",
            scope="SITEWIDE",
            description=f"{non_home_bad_h1} page(s) hors homepage ont un H1 invalide/manquant.",
            impact="Structure sémantique affaiblie pour SEO et accessibilité.",
            fix="Garantir un unique H1 pertinent sur chaque template de contenu.",
            source_kpi="site_metrics.seo.pages_with_bad_h1",
            affected_count=non_home_bad_h1,
            fix_complexity="template",
        ))

    # RECOMMENDATION — mobile LCP > 4s
    mobile_kpi = perf.get("mobile_kpi") or {}
    mobile_lcp = mobile_kpi.get("lcp_ms")
    if mobile_lcp is not None and float(mobile_lcp) > 4000:
        findings.append(_mk_finding(
            finding_id="mobile_lcp_over_4s",
            title="LCP mobile supérieur à 4s",
            finding_type="RECOMMENDATION",
            severity="HIGH",
            scope="PAGE",
            description=f"Le LCP mobile est mesuré à {float(mobile_lcp):.0f} ms.",
            impact="Dégrade l'expérience mobile et les signaux Core Web Vitals.",
            fix="Optimiser l'élément LCP (images/hero, priorisation réseau, cache).",
            source_kpi="site_metrics.performance.mobile_kpi.lcp_ms",
            affected_count=1,
            fix_complexity="template",
            example_urls=[homepage] if homepage else [],
        ))

    # RECOMMENDATION — mobile CLS > 0.25
    mobile_cls = mobile_kpi.get("cls")
    if mobile_cls is not None and float(mobile_cls) > 0.25:
        findings.append(_mk_finding(
            finding_id="mobile_cls_over_025",
            title="CLS mobile supérieur à 0.25",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="PAGE",
            description=f"Le CLS mobile est mesuré à {float(mobile_cls):.3f}.",
            impact="Instabilité visuelle mobile et frustration utilisateur.",
            fix="Réserver les espaces médias et stabiliser les blocs dynamiques.",
            source_kpi="site_metrics.performance.mobile_kpi.cls",
            affected_count=1,
            fix_complexity="template",
            example_urls=[homepage] if homepage else [],
        ))

    # RECOMMENDATION — avg FCP > 3s
    avg_fcp = perf.get("avg_fcp_ms")
    if avg_fcp is not None and float(avg_fcp) > 3000:
        findings.append(_mk_finding(
            finding_id="avg_fcp_over_3s",
            title="FCP moyen supérieur à 3s",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"Le FCP moyen est de {float(avg_fcp):.0f} ms.",
            impact="Temps de rendu initial lent et baisse de perception de performance.",
            fix="Réduire le blocage rendu (CSS/JS), optimiser cache et critical path.",
            source_kpi="site_metrics.performance.avg_fcp_ms",
            affected_count=max(1, pages_scanned),
            fix_complexity="template",
        ))

    # RECOMMENDATION — unoptimised images >20%
    img_stats = report.get("image_compression") or {}
    sampled_images = int(img_stats.get("sampled_images") or 0)
    unoptimised_count = int(img_stats.get("unoptimised_count") or 0)
    if sampled_images > 0:
        unoptimised_rate = (unoptimised_count / sampled_images) * 100.0
        if unoptimised_rate > 20.0:
            findings.append(_mk_finding(
                finding_id="unoptimised_images_over_20pct",
                title="Images non optimisées > 20%",
                finding_type="RECOMMENDATION",
                severity="MEDIUM",
                scope="SITEWIDE",
                description=f"{unoptimised_count}/{sampled_images} images non optimisées ({unoptimised_rate:.1f}%).",
                impact="Poids des pages accru et performance perçue dégradée.",
                fix="Compresser et convertir les images lourdes en formats modernes.",
                source_kpi="image_compression.unoptimised_count",
                affected_count=unoptimised_count,
                fix_complexity="content",
            ))

    # BUG — plain emails exposed
    plain_email_kpi = ux.get("plain_email_kpi") or {}
    plain_email_pages = int(plain_email_kpi.get("pages_with_plain_emails") or 0)
    if plain_email_pages > 0:
        email_example_urls = _find_urls_by_keywords(issue_url_index, "email", "mailto")
        findings.append(_mk_finding(
            finding_id="plain_emails_exposed",
            title="Emails en clair exposés",
            finding_type="BUG",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"Des emails en clair sont présents sur {plain_email_pages} page(s).",
            impact="Risque de scraping, spam et fuite d'informations de contact.",
            fix="Remplacer les emails visibles par des liens protégés ou formulaires sécurisés.",
            source_kpi="site_metrics.ux.plain_email_kpi.pages_with_plain_emails",
            affected_count=plain_email_pages,
            fix_complexity="content",
            example_urls=email_example_urls,
        ))

    # BUG — missing semantic <nav> element (menu_structure_kpi)
    menu_kpi = ux.get("menu_structure_kpi") or {}
    nav_issue_pages = int(menu_kpi.get("pages_with_menu_issues") or 0)
    if nav_issue_pages > 0:
        # evidence items look like "https://example.com/path: No <nav> element found"
        nav_evidence_items = menu_kpi.get("evidence") or []
        nav_example_urls = [e.split(": No ")[0].split(": ")[0] for e in nav_evidence_items[:5] if e.startswith("http")]
        findings.append(_mk_finding(
            finding_id="missing_nav_element",
            title="Élément <nav> sémantique manquant",
            finding_type="BUG",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{nav_issue_pages} page(s) n'utilisent pas de balise <nav> sémantique pour leur menu.",
            impact="Nuit à l'accessibilité (WCAG) et au crawl SEO — les moteurs ne peuvent pas identifier la structure de navigation.",
            fix="Envelopper les menus de navigation dans un élément HTML <nav> avec un aria-label descriptif.",
            source_kpi="site_metrics.ux.menu_structure_kpi.pages_with_menu_issues",
            affected_count=nav_issue_pages,
            fix_complexity="template",
            example_urls=nav_example_urls,
        ))

    # BUG — invisible / CSS-hidden links
    invisible_links = int(ux.get("total_invisible_links") or 0)
    if invisible_links > 100:
        findings.append(_mk_finding(
            finding_id="invisible_links_detected",
            title="Liens cachés en masse détectés",
            finding_type="BUG",
            severity="HIGH",
            scope="SITEWIDE",
            description=f"{invisible_links} lien(s) masqués via CSS ont été détectés sur le site.",
            impact="Signal black-hat SEO fort — peut entraîner une pénalité algorithmique Google et dégrade la confiance des moteurs.",
            fix="Supprimer ou rendre visibles les liens CSS-cachés. N'utiliser display:none/visibility:hidden que pour du contenu purement interactif.",
            source_kpi="site_metrics.ux.total_invisible_links",
            affected_count=invisible_links,
            fix_complexity="code",
        ))

    # BUG — raw IP links present
    raw_ip_kpi = ux.get("raw_ip_link_kpi") or {}
    raw_ip_links = int(raw_ip_kpi.get("total_raw_ip_links") or 0)
    raw_ip_pages = int(raw_ip_kpi.get("pages_with_raw_ip_links") or 0)
    if raw_ip_links > 0:
        findings.append(_mk_finding(
            finding_id="raw_ip_links_present",
            title="Liens vers IP brute détectés",
            finding_type="BUG",
            severity="LOW",
            scope="SITEWIDE",
            description=f"{raw_ip_links} lien(s) vers IP brute sur {raw_ip_pages} page(s).",
            impact="Confiance utilisateur réduite et maintenance DNS plus fragile.",
            fix="Remplacer les URLs IP par des domaines canoniques.",
            source_kpi="site_metrics.ux.raw_ip_link_kpi.total_raw_ip_links",
            affected_count=raw_ip_links,
            fix_complexity="redirect",
        ))

    # RECOMMENDATION — typos detected across pages
    typo_kpi = content.get("typo_detection") or {}
    pages_with_typos = int(typo_kpi.get("pages_with_typos") or 0)
    if pages_with_typos > 0:
        findings.append(_mk_finding(
            finding_id="typos_detected",
            title="Fautes détectées sur les contenus",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{pages_with_typos} page(s) contiennent des fautes ou termes non reconnus selon l'analyse NLP.",
            impact="Nuit à la crédibilité éditoriale, au taux de rebond et à la perception de qualité de marque.",
            fix="Relire et corriger les contenus identifiés. Utiliser un correcteur orthographique intégré au CMS.",
            source_kpi="site_metrics.content.typo_detection.pages_with_typos",
            affected_count=pages_with_typos,
            fix_complexity="content",
        ))

    # Additional mapped findings not in matrix (explicit mapping requested)
    missing_title = int(seo.get("pages_missing_title") or 0)
    if missing_title > 0:
        findings.append(_mk_finding(
            finding_id="missing_page_title",
            title="Titres de page manquants",
            finding_type="RECOMMENDATION",
            severity="MEDIUM",
            scope="SITEWIDE",
            description=f"{missing_title} page(s) n'ont pas de balise title.",
            impact="Affaiblit la compréhension SEO et le CTR dans les résultats.",
            fix="Compléter les balises title via modèle de page et contenus.",
            source_kpi="site_metrics.seo.pages_missing_title",
            affected_count=missing_title,
            fix_complexity="template",
        ))

    all_findings = _sort_findings(findings)

    for item in all_findings:
        item["evidence"] = _build_finding_evidence(report, item)

    bugs = [f for f in all_findings if f["type"] == "BUG"]
    recommendations = [f for f in all_findings if f["type"] == "RECOMMENDATION"]
    compliance = [f for f in all_findings if f["type"] == "COMPLIANCE"]

    quick_wins = [
        f for f in all_findings
        if f["type"] != "COMPLIANCE" and f["effort"] == "LOW" and f["severity"] in {"CRITICAL", "HIGH"}
    ]
    quick_wins = _sort_findings(quick_wins)[:5]

    summary = {
        "total": len(all_findings),
        "bugs": len(bugs),
        "recommendations": len(recommendations),
        "compliance": len(compliance),
        "critical": sum(1 for f in all_findings if f["severity"] == "CRITICAL"),
        "high": sum(1 for f in all_findings if f["severity"] == "HIGH"),
        "medium": sum(1 for f in all_findings if f["severity"] == "MEDIUM"),
        "low": sum(1 for f in all_findings if f["severity"] == "LOW"),
    }

    active_ids = {f["id"] for f in all_findings}
    passing_kpis = _build_passing_kpis(report, active_ids)

    return {
        "domain": scan_domain,
        "summary": summary,
        "quick_wins": quick_wins,
        "bugs": bugs,
        "recommendations": recommendations,
        "compliance": compliance,
        "roadmap": _build_roadmap_items(all_findings),
        "audit_coverage": _build_audit_coverage(report, all_findings),
        "passing_kpis": passing_kpis,
    }


def build_recommendations(
    scan_id: str,
    report_builder: Optional[Callable[[str], dict]] = None,
    scan_meta: Optional[dict] = None,
) -> dict:
    if report_builder is None:
        from main import build_report, scans  # pylint: disable=import-outside-toplevel
        report_builder = build_report
        scan_meta = scans.get(scan_id, {}) if scan_meta is None else scan_meta

    report = report_builder(scan_id)
    if not isinstance(report, dict) or report.get("error"):
        return {"scan_id": scan_id, "error": report.get("error", "report_unavailable")}

    # Inject nlp_partiel from scan entry so classify_report can gate NLP-derived findings
    if scan_meta and scan_meta.get("nlp_partiel"):
        report["nlp_partiel"] = True

    payload = classify_report(report)
    payload["scan_id"] = scan_id
    payload["generated_at"] = _now_iso_from_scan(scan_meta)
    if scan_meta and scan_meta.get("nlp_partiel"):
        payload["nlp_partiel"] = True
    return payload
