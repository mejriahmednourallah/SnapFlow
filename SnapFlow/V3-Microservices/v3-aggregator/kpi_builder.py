"""
KPI-Centric Report Builder
Converts raw report data to axis/sub-axis/KPI structure
All output in French for easy client consumption
"""
from datetime import datetime
import re
from typing import Optional

def _privacy_framework(scan_url: str = "") -> dict:
    """Return jurisdiction-specific legal framework strings based on the site's TLD."""
    try:
        from urllib.parse import urlparse as _up
        tld = _up(scan_url).hostname or ""
        tld = tld.rstrip(".").rsplit(".", 1)[-1].lower()
    except Exception:
        tld = ""

    if tld == "tn":
        return {
            "data_law":          "Loi n°63-2004",
            "data_law_full":     "Loi tunisienne n°63-2004 relative à la protection des données personnelles",
            "supervisory_body":  "INPDP",
            "legal_notice_law":  "droit tunisien",
            "privacy_arts":      "Art.29/30 (Loi 63-2004)",
            "cookie_law":        "loi tunisienne n°63-2004",
            "consent_law":       "loi tunisienne n°63-2004",
        }
    # Default: EU RGPD + French LCEN (covers .fr, .eu and unknown TLDs)
    return {
        "data_law":          "RGPD",
        "data_law_full":     "RGPD (Règlement UE 2016/679)",
        "supervisory_body":  "CNIL",
        "legal_notice_law":  "loi LCEN",
        "privacy_arts":      "Art.13/14 RGPD",
        "cookie_law":        "ePrivacy/CNIL",
        "consent_law":       "ePrivacy/CNIL",
    }


def _safe_dict(val):
    """Safely convert to dict."""
    return val if isinstance(val, dict) else {}

def _safe_list(val):
    """Safely convert to list."""
    return val if isinstance(val, list) else []

def _safe_int(val):
    """Safely convert to int."""
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return 0

def _safe_float(val):
    """Safely convert to float."""
    try:
        return float(val or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _optional_float(val):
    """Return a float only for real numeric values; preserve missing as None."""
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _is_cache_friendly(cache_control: str, has_cache: bool) -> bool:
    cc = str(cache_control or "").lower()
    if not has_cache:
        return False
    if any(token in cc for token in ("no-store", "no-cache", "private")):
        return False
    return "max-age=" in cc or "s-maxage=" in cc or "public" in cc or "immutable" in cc or not cc


def _build_vuln_kpi(da: dict, domain_url: str) -> dict:
    """Build the SQL Injection/XSS/DDoS KPI entry with correct pages_affected.

    [A6/#8] pages_affected previously summed sqli+xss+ddos signal counts,
    meaning one page with SQLi+XSS would count as 2 affected pages.
    This helper uses affected_page_count (distinct pages) when available,
    or conservatively 1 if any signal was fired.
    """
    vk = _safe_dict(da.get('vulnerability_kpi', {}))
    sqli = int(vk.get('sqli_vulnerable_count', 0))
    xss = int(vk.get('xss_vulnerable_count', 0))
    ddos = int(vk.get('ddos_signal_count', 0))
    total_signals = sqli + xss + ddos
    return {
        "info": f"Signaux détectés: SQLi={sqli}, XSS={xss}, DDoS={ddos}",
        "impact": "Vulnérabilités d'injection = compromission applicative et perte de données critiques",
        "pages_affected": int(vk.get('affected_page_count') or 0) or (1 if total_signals > 0 else 0),
        "pages_affected_urls": _safe_list(vk.get('affected_page_urls', [])),
        "status": "failing" if total_signals > 0 else "passing",
        "type": "bug" if total_signals > 0 else None,
        "severity": "critical" if (sqli + xss) > 0 else ("high" if ddos > 0 else None),
        "data": vk,
    }

def _safe_bool(val):
    """Safely convert to bool."""
    return bool(val) if val is not None else False


def _resolve_mobile_kpi_status(mobile_kpi):
    """Single source of truth for mobile KPI status across all axes."""
    mobile = _safe_dict(mobile_kpi)
    if not _safe_bool(mobile.get("available")):
        return "not_available"
    if str(mobile.get("measurement_status") or "").lower() in {
        "core_web_vitals_unavailable",
        "navigation_error",
        "browser_error",
        "measurement_failed",
    }:
        return "not_available"

    passed = mobile.get("passed")

    lcp_ms = _optional_float(mobile.get("lcp_ms"))
    cls = _optional_float(mobile.get("cls"))
    fcp_ms = _optional_float(mobile.get("fcp_ms"))
    if lcp_ms is None or lcp_ms <= 0:
        return "not_available"
    if isinstance(passed, bool):
        return "passing" if passed else "failing"
    cls_value = cls if cls is not None else 0.0
    if lcp_ms > 2500 or cls_value > 0.1 or (fcp_ms > 0 and fcp_ms > 1800):
        return "failing"
    return "passing"


def _resolve_mobile_friendly_status(mobile_friendly_kpi):
    """Status resolver for UX mobile-friendly evidence (separate from perf)."""
    probe = _safe_dict(mobile_friendly_kpi)
    if not _safe_bool(probe.get("available")):
        return "not_available"

    passed = probe.get("passed")
    if isinstance(passed, bool):
        return "passing" if passed else "failing"

    return "failing" if _safe_int(probe.get("pages_with_mobile_overflow")) > 0 else "passing"


def _axis_is_security(axis_name):
    text = str(axis_name or "").lower()
    return "sécurité" in text or "security" in text


def _axis_is_compliance(axis_name):
    text = str(axis_name or "").lower()
    return "rgpd" in text or "gdpr" in text or "conform" in text


def _display_kpi_name(kpi_name, info):
    """Prefer explicit KPI title, then fallback to info prefix."""
    title = str(kpi_name or "").strip()
    if title:
        return title
    info_txt = str(info or "").strip()
    if ":" in info_txt:
        return info_txt.split(":", 1)[0].strip()
    return "KPI"


def _normalized_kpi_evidence(report, kpi_name):
    """Read evidence for a normalized KPI if available in report['kpis']."""
    for item in _safe_list(report.get("kpis")):
        if isinstance(item, dict) and item.get("kpi_name") == kpi_name:
            return _safe_dict(item.get("evidence"))
    return {}


def _to_absolute_urls(base_url, paths):
    """Convert relative paths to absolute URLs based on report domain."""
    base = (base_url or "").rstrip("/")
    out = []
    for p in _safe_list(paths):
        s = str(p or "").strip()
        if not s:
            continue
        if s.startswith("http://") or s.startswith("https://"):
            out.append(s)
            continue
        if s.startswith("/"):
            out.append(f"{base}{s}" if base else s)
            continue
        out.append(f"{base}/{s}" if base else s)
    return out


# ─── FRENCH KPI ENRICHMENT ENGINE (PHASE 1-3) ────────────────────────────────

def _summarize_list_french(items, key_name, max_items=3):
    """Summarize a list of items in French for constat. Returns string or None if empty."""
    if not items:
        return None
    items = items[:max_items] if len(items) > max_items else items
    if isinstance(items[0], dict):
        names = [str(item.get("name") or item.get("header") or item.get("title") or item) for item in items]
    else:
        names = [str(item) for item in items]
    if len(names) < len(items):
        return f"{', '.join(names)} et {len(items) - len(names)} autres"
    return ", ".join(names)


def _infer_severity_from_context(kpi_type, pages_affected, is_security=False):
    """Infer severity when status=failing but severity is null. All in French context."""
    pages = _safe_int(pages_affected)

    if kpi_type == "compliance":
        return "high" if pages > 0 else "medium"

    if kpi_type == "recommendation":
        return "medium" if pages > 10 else "low"

    if kpi_type != "bug":
        return "low"

    if pages <= 0:
        return "low"

    # Conservative mapping: avoid high severity from weak/isolated signals.
    if is_security:
        if pages >= 5:
            return "high"
        if pages >= 2:
            return "medium"
        return "low"

    if pages > 50:
        return "high"
    if pages >= 10:
        return "medium"
    return "low"


def _generate_constat_passing(kpi_name, data, info):
    """Generate French constat for passing KPI (status='passing'). Evidence-driven, no risk wording."""
    if not data:
        return f"{kpi_name}: vérification réussie sur les éléments disponibles. Aucune action requise."
    
    # Collect factual evidence from data
    evidence = []
    
    # CMS/Version information
    if "cms_name" in data and data.get("cms_name"):
        evidence.append(f"CMS {data['cms_name']}")
    if "cms_version" in data and data.get("cms_version"):
        evidence.append(f"version {data['cms_version']}")
    if "server_tech" in data and data.get("server_tech"):
        evidence.append(f"{data['server_tech']}")
    if "server_version" in data and data.get("server_version"):
        evidence.append(f"{data['server_version']}")
    
    # Security details (SSL, headers, etc.)
    if "valid" in data and data.get("valid") is True:
        evidence.append("certificat SSL valide")
    if "expiry" in data and data.get("expiry"):
        evidence.append(f"expire le {data['expiry']}")
    if "protocol" in data and data.get("protocol"):
        evidence.append(f"protocole {data['protocol']}")
    if "issuer" in data and data.get("issuer"):
        evidence.append(f"émis par {data['issuer']}")
    if "headers_present" in data:
        evidence.append(f"{data['headers_present']} en-têtes de sécurité configurés")
    
    # Cookie/Session management
    if "missing_count" in data and data.get("missing_count") == 0:
        evidence.append("aucun cookie dépourvu de flags Secure/HttpOnly")
    
    # CVE/Vulnerability counts
    if "critical" in data or "high" in data:
        critical = _safe_int(data.get("critical"))
        high = _safe_int(data.get("high"))
        if critical == 0 and high == 0:
            evidence.append("aucune CVE critique ou haute détectée")
    
    # Privacy/RGPD
    if "has_privacy_policy" in data and data.get("has_privacy_policy"):
        evidence.append("politique de confidentialité présente")
    if "has_legal_notice" in data and data.get("has_legal_notice"):
        evidence.append("mentions légales présentes")
    if "has_information_rights" in data and data.get("has_information_rights"):
        evidence.append("droits RGPD Art.13/14 mentionnés")
    
    if evidence:
        return f"{', '.join(evidence)}. Aucune action requise."
    return f"{kpi_name}: vérification réussie. Aucune action requise."


def _generate_constat_failing_bug(kpi_name, data, info, pages_affected, axis_name):
    """Generate French constat for failing bug KPI. User/security impact framing."""
    if not data:
        return f"{kpi_name}: défaut détecté. Correction requise."
    
    # Build technical detail + impact chain
    parts = []
    
    # Version/CVE issues
    if "critical" in data:
        critical = _safe_int(data.get("critical"))
        high = _safe_int(data.get("high"))
        if critical > 0:
            parts.append(f"{critical} vulnérabilité(s) critique(s) détectée(s)")
        if high > 0:
            parts.append(f"{high} vulnérabilité(s) haute(s) détectée(s)")
    
    # Missing security headers
    if "missing_headers" in data and data.get("missing_headers"):
        missing = _summarize_list_french(data["missing_headers"], "en-têtes manquants")
        if missing:
            parts.append(f"En-têtes manquants: {missing}")
    
    # Cookie/session flaws
    if "missing_count" in data and data.get("missing_count") > 0:
        missing = _summarize_list_french(data.get("cookies"), "cookies")
        if missing:
            parts.append(f"{data['missing_count']} cookie(s) dépourvu(s) de flags Secure/HttpOnly: {missing}")
    
    # SSL issues
    if "valid" in data and data.get("valid") is False:
        parts.append("Certificat SSL invalide ou expiré")
    
    # Admin exposure
    if "exposed" in data and data.get("exposed"):
        exposed = _summarize_list_french(data["exposed"], "pages")
        if exposed:
            parts.append(f"Pages admin exposées: {exposed}")
    
    detail = ". ".join(parts) if parts else f"{kpi_name}: bug ou recommandation détecté"
    if _axis_is_security(axis_name):
        impact = "Risque de sécurité avéré" if pages_affected > 0 else "Risque de sécurité potentiel"
        return f"{detail}. {impact}. Correction prioritaire recommandée."

    if pages_affected > 0:
        return f"{detail}. Affecte {pages_affected} page(s). Correction recommandée."
    return f"{detail}. Vérification manuelle recommandée."


def _generate_constat_failing_compliance(kpi_name, data, info, pages_affected, scan_url: str = ""):
    """Generate French constat for failing compliance KPI. Legal/regulatory risk framing."""
    if not data:
        return f"{kpi_name}: non-conformité détectée. Risque réglementaire."

    fw = _privacy_framework(scan_url)
    parts = []

    # Privacy-specific defects — use jurisdiction-aware citations
    if "has_privacy_policy" in data and not data.get("has_privacy_policy"):
        parts.append(f"Politique de confidentialité absente ({fw['privacy_arts']})")
    if "has_legal_notice" in data and not data.get("has_legal_notice"):
        parts.append(f"Mentions légales absentes ({fw['legal_notice_law']})")
    if "has_information_rights" in data and not data.get("has_information_rights"):
        parts.append(f"Droits des personnes non mentionnés (non-conformité {fw['privacy_arts']})")
    if "has_declared_purpose" in data and not data.get("has_declared_purpose"):
        parts.append("Finalité du traitement non déclarée")

    # Pre-consent violations
    if "pre_consent_violation_pages" in data:
        count = _safe_int(data.get("pre_consent_violation_pages", 0))
        if count > 0:
            parts.append(f"{count} page(s) avec trackers avant consentement (violation {fw['cookie_law']})")

    detail = ". ".join(parts) if parts else f"{kpi_name}: non-conformité détectée"
    risk = f"Affecte {pages_affected} page(s). " if pages_affected > 0 else ""
    return f"{detail}. {risk}Exposition à sanctions réglementaires. Correction prioritaire requise."


def _generate_constat_failing_recommendation(kpi_name, data, info, pages_affected):
    """Generate French constat for failing recommendation KPI. Optimization/opportunity framing."""
    if not data:
        return f"{kpi_name}: opportunité d'amélioration identifiée."
    
    parts = []
    
    # Broken buttons/links
    if "broken_buttons" in data or "total_nonfunc_buttons" in data:
        count = _safe_int(data.get("total_nonfunc_buttons", 0))
        if count > 0:
            parts.append(f"{count} bouton(s) non fonctionnel(s) affectant UX")
    
    # Missing metadata
    if "missing_count" in data:
        count = _safe_int(data.get("missing_count", 0))
        if count > 0:
            kpi_type = "titre" if "title" in kpi_name.lower() else "description"
            parts.append(f"{count} page(s) manquant {kpi_type} (impact SEO)")
    
    # Module/version updates
    if "module_count" in data:
        modules = _summarize_list_french(data.get("modules"), "modules")
        if modules:
            parts.append(f"Mise à jour disponible pour: {modules}")
    
    detail = ". ".join(parts) if parts else f"{kpi_name}: point d'optimisation identifié"
    impact = f"Affecte {pages_affected} page(s)." if pages_affected > 0 else "Impact limité."
    measurable = "Gain potentiel sur le SEO et la visibilité." if "title" in kpi_name.lower() or "alt" in kpi_name.lower() else "Gain potentiel sur l'expérience utilisateur."
    return f"{detail}. {impact} {measurable}"


def _generate_constat(kpi_obj, axis_name=None, kpi_name=None):
    """Main entry point: generate or enrich constat field on a KPI object (in-place)."""
    status = kpi_obj.get("status", "not_available")
    kpi_type = kpi_obj.get("type")
    data = _safe_dict(kpi_obj.get("data", {}))
    info = str(kpi_obj.get("info", "")).strip()
    display_name = _display_kpi_name(kpi_name, info)
    pages_affected = _safe_int(kpi_obj.get("pages_affected", 0))
    
    # Generate constat based on status and type
    if status == "passing":
        constat = _generate_constat_passing(display_name, data, info)
    elif status == "failing":
        if kpi_type == "bug":
            constat = _generate_constat_failing_bug(display_name, data, info, pages_affected, axis_name)
        elif kpi_type == "compliance":
            constat = _generate_constat_failing_compliance(display_name, data, info, pages_affected)
        elif kpi_type == "recommendation":
            constat = _generate_constat_failing_recommendation(display_name, data, info, pages_affected)
        else:
            constat = f"{display_name}: bug ou recommandation détecté. Vérification manuelle recommandée."
    elif status == "warning":
        if kpi_type == "bug":
            constat = _generate_constat_failing_bug(display_name, data, info, pages_affected, axis_name)
        elif kpi_type == "compliance":
            constat = _generate_constat_failing_compliance(display_name, data, info, pages_affected)
        else:
            constat = _generate_constat_failing_recommendation(display_name, data, info, pages_affected)
    else:
        constat = f"{display_name}: données insuffisantes pour conclure de façon fiable sur ce critère."
    
    return constat


def _normalize_kpi_object(kpi_obj, axis_name, kpi_name):
    """Enforce strict KPI schema: 9 required keys in order, migrate unknown keys to data._raw."""
    normalized = {}
    
    # 1. Add/generate constat (always first)
    normalized["constat"] = _generate_constat(kpi_obj, axis_name=axis_name, kpi_name=kpi_name)
    
    # 2-8. Standard fields in order
    for key in ["info", "impact", "pages_affected", "pages_affected_urls", "status", "type", "severity"]:
        if key in kpi_obj:
            normalized[key] = kpi_obj[key]
        else:
            # Fill with sensible defaults
            if key == "pages_affected":
                normalized[key] = 0
            elif key == "pages_affected_urls":
                normalized[key] = []
            elif key == "status":
                normalized[key] = "not_available"
            elif key in ["type", "severity"]:
                normalized[key] = None
            else:
                normalized[key] = ""
    
    # 9. Data (always last)
    normalized["data"] = _safe_dict(kpi_obj.get("data", {}))
    
    # Migrate unknown top-level keys into data._raw
    known_keys = {"constat", "info", "impact", "pages_affected", "pages_affected_urls", "status", "type", "severity", "data"}
    unknown = {k: v for k, v in kpi_obj.items() if k not in known_keys}
    if unknown:
        normalized["data"]["_raw"] = unknown
    
    # Normalization rules: status/type/severity consistency
    status = normalized.get("status")
    kpi_type = normalized.get("type")
    severity = normalized.get("severity")
    
    # Rule 1: passing => severity null and type null unless compliance KPI.
    if status == "passing":
        if normalized.get("type") != "compliance":
            normalized["type"] = None
        normalized["severity"] = None
    
    # Rule 2: failing with missing type/severity => infer
    if status == "failing":
        if kpi_type is None:
            if "cookie" in str(kpi_obj.get("info", "")).lower():
                kpi_type = "bug"
            elif "rgpd" in axis_name.lower() or "gdpr" in axis_name.lower():
                kpi_type = "compliance"
            else:
                kpi_type = "bug"
            normalized["type"] = kpi_type
        
        if severity is None:
            # [5.3] Always assign severity on failing KPIs — missing severity
            # causes them to be invisible in priority sorting and executive summary.
            severity = _infer_severity_from_context(
                kpi_type,
                normalized.get("pages_affected", 0),
                is_security="sécurité" in axis_name.lower()
            ) or "low"  # Fallback: never leave a failing KPI without severity.
            normalized["severity"] = severity
    
    # Rule 3: pages_affected_urls_note when pages_affected > 0 and URL list empty
    if normalized.get("pages_affected", 0) > 0 and not normalized.get("pages_affected_urls"):
        normalized["pages_affected_urls_note"] = "URLs non disponibles — agrégat calculé"
    
    return normalized


# ═══════════════════════════════════════════════════════════════════════════
# JSON V2 — KPI HELPERS LAYER
# All KPIs now use a 14-field standardised schema replacing the old V1 fields.
# ═══════════════════════════════════════════════════════════════════════════

# ── KPI Metadata Table ───────────────────────────────────────────────────────
# Maps KPI name → (kpi_id, confidence, evidence_quality)
_KPI_META = {
    # — Audit Technique —
    "Version CMS/Framework":              ("tech_cms_version",        "medium", "aggregate"),
    "Version Modules Installés":          ("tech_modules_versions",   "low",    "aggregate"),
    "Version serveur":                    ("tech_server_version",     "medium", "aggregate"),
    "Langage de Programmation":           ("tech_programming_language","low",    "aggregate"),
    "Vérification du Code":               ("tech_cve_check",          "high",   "aggregate"),
    # — Check Sécurité —
    "SSL":                                ("sec_ssl",                  "high",   "concrete"),
    "Sécurité des En-têtes HTTP":         ("sec_http_headers",        "high",   "concrete"),
    "Gestion des Sessions":               ("sec_session_cookies",     "high",   "concrete"),
    "SQL Injection et DDoS":              ("sec_sqli_ddos",           "high",   "concrete"),
    "Pages Admin Exposées":               ("sec_admin_exposed",       "high",   "concrete"),
    "Fichiers Sensibles Exposés":         ("sec_sensitive_files",     "high",   "concrete"),
    "Divulgation de Version CMS":         ("sec_version_disclosure",  "medium", "concrete"),
    "Robots.txt Info Disclosure":         ("sec_robots_disclosure",   "medium", "heuristic"),
    "Divulgation d'Information via robots.txt": ("sec_robots_disclosure", "medium", "heuristic"),
    "Pages d'Erreur Personnalisées":      ("sec_error_pages",         "medium", "heuristic"),
    "Fuite d'Information Page d'Erreur":  ("sec_error_pages",         "medium", "heuristic"),
    "Protection Brute Force":             ("sec_brute_force",         "medium", "heuristic"),
    "Protection Brute Force Login":       ("sec_brute_force",         "medium", "heuristic"),
    "Contrôle d'Extension Upload Fichier":("sec_file_upload",         "medium", "aggregate"),
    "Dépendances JS Vulnérables (CVE)":   ("sec_js_deps",             "high",   "aggregate"),
    "Exposition Services Reseau":         ("sec_service_exposure",    "high",   "concrete"),
    "Méthodes HTTP TRACE/TRACK":          ("sec_trace_track",         "high",   "concrete"),
    "Misconfiguration CORS":              ("sec_cors_misconfiguration","high",  "concrete"),
    "Mise en Cache":                      ("perf_cache",              "medium", "heuristic"),
    "Gestion de Cache":                   ("perf_cache",              "medium", "heuristic"),
    "Utilisation de Compression":         ("perf_compression",        "medium", "heuristic"),
    # — Audit Fonctionnel —
    "Les Formulaires":                    ("func_forms",              "high",   "concrete"),
    "Liens":                              ("func_links",              "high",   "concrete"),
    "Boutons":                            ("func_buttons",            "high",   "concrete"),
    "Fonctionnalités":                    ("func_features",           "medium", "aggregate"),
    "Fonctionnement du Moteur de Recherche Interne": ("func_search",  "medium", "heuristic"),
    # — Audit Performance —
    "Temps de Chargement Desktop":        ("perf_desktop_speed",      "high",   "aggregate"),
    "Performance Mobile":                 ("perf_mobile_speed",       "high",   "aggregate"),
    "Temps de Chargement Mobile":         ("perf_mobile_speed",       "high",   "aggregate"),
    "Images Optimisées":                  ("perf_image_optim",        "medium", "aggregate"),
    "Optimisation des Images":            ("perf_image_optim",        "medium", "aggregate"),
    "Erreurs Console JavaScript":         ("perf_console_errors",     "high",   "concrete"),
    # — SEO —
    "Balise Alts":                        ("seo_alt_tags",            "high",   "aggregate"),
    "Balises META":                       ("seo_meta_tags",           "high",   "aggregate"),
    "Sitemap":                            ("seo_sitemap",             "high",   "concrete"),
    "Robot Txt":                          ("seo_robots_txt",          "high",   "concrete"),
    "Duplication de Contenu":             ("seo_duplication",         "medium", "aggregate"),
    "Compatibilité Multiplateforme":      ("seo_multi_browser",       "low",    "not_evaluated"),
    "Structure des URLs":                 ("seo_url_structure",       "high",   "aggregate"),
    "Structure du Contenu (Hn)":          ("seo_heading_structure",   "high",   "aggregate"),
    "Linking Interne":                    ("seo_internal_linking",    "medium", "aggregate"),
    "Linking Externe":                    ("seo_external_linking",    "low",    "aggregate"),
    "Qualité H1 (NLP)":                   ("seo_h1_quality",          "medium", "aggregate"),
    "Méta Description (NLP)":             ("seo_meta_nlp",            "medium", "aggregate"),
    "AI Readiness (llms.txt)":            ("seo_ai_readiness",        "low",    "heuristic"),
    # — Audit UX/UI —
    "Ciblage":                            ("ux_audience_targeting",   "low",    "aggregate"),
    "Partage Social":                     ("ux_social_sharing",       "medium", "aggregate"),
    "Ergonomie et Design":                ("ux_design_ergonomics",    "medium", "aggregate"),
    "Structure, Navigation et Parcours Client": ("ux_navigation",     "medium", "heuristic"),
    "Mobile Friendly":                    ("ux_mobile_friendly",      "high",   "aggregate"),
    # — Contenu —
    "Fraîcheur du Contenu":               ("content_freshness",       "medium", "aggregate"),
    "Contenu Fin et Qualité":             ("content_thin",            "medium", "aggregate"),
    "Pages Clés":                         ("content_key_pages",       "low",    "aggregate"),
    "Cannabalisation de Mots-clés":       ("content_cannibalization", "medium", "aggregate"),
    "CTA Transactionnels Manquants":      ("content_missing_cta",     "medium", "aggregate"),
    "Structure Contenu Cassée":           ("content_broken_structure","medium", "aggregate"),
    "Diversité Lexicale":                 ("content_lexical_diversity","low",   "aggregate"),
    # — Eco Index —
    "Score Écologique et Impact Climatique": ("eco_index_score",      "medium", "aggregate"),
    # — RGPD —
    "Consentement Cookies":               ("rgpd_cookie_consent",     "low",    "heuristic"),
    "Politique de Confidentialité":       ("rgpd_privacy_policy",     "high",   "concrete"),
    "Durée de Conservation":              ("rgpd_data_retention",     "medium", "aggregate"),
    "Minimisation des Données":           ("rgpd_minimization",       "medium", "aggregate"),
    "Mentions Légales":                   ("rgpd_legal_notice",       "high",   "concrete"),
    "Droits des Personnes":               ("rgpd_user_rights",        "high",   "concrete"),
    "Finalité du Traitement":             ("rgpd_declared_purpose",   "high",   "concrete"),
    "Couverture des Droits RGPD":         ("rgpd_rights_coverage",    "medium", "aggregate"),
    "Trackers Avant Consentement":        ("rgpd_pre_consent_trackers","medium","aggregate"),
    "Score Politique de Confidentialité": ("rgpd_privacy_score",      "low",    "heuristic"),
}

_KPI_BUSINESS_IMPACT = {
    "tech_cms_version":         "Une version CMS obsolète ou en fin de vie augmente le risque d'exploitation de failles connues et complique la maintenance.",
    "tech_modules_versions":    "Des modules non mis à jour peuvent contenir des vulnérabilités corrigées dans les versions récentes.",
    "tech_server_version":      "L'exposition de la version serveur facilite le ciblage par des attaquants exploitant des CVEs spécifiques.",
    "tech_programming_language": "L'absence d'information sur le langage/Runtime complique la gestion des correctifs de sécurité et la priorisation des mises à jour.",
    "tech_cve_check":           "Des CVEs actifs exposent l'application à des attaques documentées pouvant compromettre données et disponibilité.",
    "sec_ssl":                  "Un certificat SSL invalide bloque l'accès pour certains navigateurs, nuit au référencement et expose les données en transit.",
    "sec_http_headers":         "Les en-têtes de sécurité manquants élargissent la surface d'attaque face aux injections, clickjacking et MIME sniffing.",
    "sec_session_cookies":      "Des cookies sans Secure/HttpOnly peuvent être volés ou interceptés, exposant les sessions utilisateurs.",
    "sec_sqli_ddos":            "Des injections SQL ou signaux DDoS peuvent conduire à une compromission applicative ou une indisponibilité du service.",
    "sec_admin_exposed":        "Les interfaces admin accessibles publiquement augmentent considérablement le risque de compromission.",
    "sec_sensitive_files":      "Des fichiers sensibles accessibles révèlent des informations critiques sur l'infrastructure ou les données.",
    "sec_robots_disclosure":    "Un robots.txt révélant des chemins internes aide les attaquants à cartographier l'application.",
    "sec_error_pages":          "Des pages d'erreur divulguant la stack technique facilitent l'exploitation ciblée.",
    "sec_brute_force":          "L'absence de protection brute force facilite la compromission des comptes par attaque par dictionnaire.",
    "sec_file_upload":          "Sans restriction d'upload, des fichiers malveillants peuvent être déposés et exécutés côté serveur.",
    "sec_js_deps":              "Des dépendances JS vulnérables exposent les utilisateurs à des attaques XSS ou au vol de données côté client.",
    "sec_service_exposure":     "Des ports ou services exposés publiquement facilitent les intrusions, l'énumération et l'exploitation de services non destinés à Internet.",
    "perf_cache":               "Un cache désactivé augmente la charge serveur, ralentit les temps de réponse et dégrade l'expérience utilisateur.",
    "perf_compression":         "Sans compression, les transferts sont plus lourds, la page se charge plus lentement et la consommation réseau augmente.",
    "func_forms":               "Des bugs sur les formulaires peuvent bloquer les conversions et frustrer les utilisateurs lors des soumissions.",
    "func_links":               "Des liens internes cassés détériorent l'expérience utilisateur, nuisent au crawl SEO et à la distribution du PageRank.",
    "func_buttons":             "Des boutons sans action réelle bloquent les parcours utilisateurs sur des pages clés de conversion.",
    "func_features":            "Des fonctionnalités manquantes (contact, recherche, panier) réduisent la complétude du service proposé.",
    "func_search":              "Un moteur de recherche interne défaillant oblige les utilisateurs à naviguer manuellement, augmentant le taux de rebond.",
    "perf_desktop_speed":       "Un temps de chargement élevé génère de l'abandon utilisateur, réduit les conversions et dégrade le positionnement SEO.",
    "perf_mobile_speed":        "Les performances mobiles insuffisantes pénalisent le référencement mobile-first et dégradent l'expérience pour 60%+ des visiteurs.",
    "perf_image_optim":         "Des images non optimisées alourdissent les pages, ralentissent le chargement et augmentent les coûts de bande passante.",
    "perf_console_errors":      "Des erreurs JavaScript visibles en console peuvent bloquer des fonctionnalités critiques pour certains utilisateurs.",
    "seo_alt_tags":             "Les images sans attribut ALT perdent leurs signaux SEO et dégradent l'accessibilité pour les utilisateurs malvoyants.",
    "seo_meta_tags":            "Des balises META absentes ou trop courtes réduisent le CTR dans les résultats de recherche et affaiblissent le contenu indexé.",
    "seo_sitemap":              "Un sitemap absent ralentit le crawl et peut entraîner une indexation incomplète des pages importantes.",
    "seo_robots_txt":           "Un robots.txt absent retire le contrôle sur les pages indexées, risquant l'exposition de pages non souhaitées.",
    "seo_duplication":          "Le contenu dupliqué crée de la compétition entre pages pour les mêmes mots-clés et dilue l'autorité SEO.",
    "seo_multi_browser":        "Une incompatibilité multi-navigateurs peut exclure une partie des utilisateurs selon leur environnement.",
    "seo_url_structure":        "Des URLs non normalisées (node/id) nuisent au SEO, à l'indexation et à la lisibilité pour les utilisateurs.",
    "seo_heading_structure":    "Une hiérarchie de titres incorrecte affaiblit les signaux sémantiques et la lisibilité du contenu.",
    "seo_internal_linking":     "Un maillage interne insuffisant réduit la distribution du PageRank et rend le crawl moins efficace.",
    "seo_external_linking":     "Les liens externes vers des sources de qualité renforcent l'autorité perçue du domaine.",
    "seo_h1_quality":           "Des H1 absents ou multiples affaiblissent le signal SEO principal de chaque page.",
    "seo_meta_nlp":             "Des meta descriptions générées par NLP manquantes diminuent la qualité des snippets dans les moteurs de recherche.",
    "seo_ai_readiness":         "L'absence de llms.txt réduit la découvrabilité du site dans les moteurs génératifs comme Perplexity ou SearchGPT.",
    "ux_audience_targeting":    "Un ciblage d'audience insuffisant peut entraîner un message inadapté aux visiteurs et une conversion diminuée.",
    "ux_social_sharing":        "L'absence de partage social limite l'acquisition organique et réduit la viralité du contenu.",
    "ux_design_ergonomics":     "Un design peu ergonomique ou un CLS élevé nuit à l'expérience utilisateur et pénalise les Core Web Vitals.",
    "ux_navigation":            "Une navigation confuse augmente le taux de rebond et empêche les utilisateurs d'atteindre leurs objectifs.",
    "ux_mobile_friendly":       "Un site non adapté aux mobiles perd une part significative de son audience et est pénalisé par Google Mobile-First.",
    "content_freshness":        "Un contenu vieillissant perd en pertinence SEO et réduit la confiance des visiteurs réguliers.",
    "content_thin":             "Le contenu insuffisant est mal classé par les moteurs de recherche et offre peu de valeur aux utilisateurs.",
    "content_key_pages":        "Des pages clés manquantes ou mal identifiées rendent la structure du site moins lisible et navigable.",
    "content_cannibalization":  "La cannibalisation de mots-clés crée une compétition interne entre pages et dilue les positions dans les SERP.",
    "content_missing_cta":      "Des pages transactionnelles sans CTA privent les visiteurs d'un chemin de conversion clair.",
    "content_broken_structure": "Une structure de contenu dégradée nuit à la lisibilité, au SEO sémantique et à la conversion.",
    "content_lexical_diversity":"Un vocabulaire répétitif peut signaler un contenu de faible valeur éditoriale aux algorithmes.",
    "eco_index_score":          "Un score écologique faible reflète des pages lourdes en ressources, augmentant l'empreinte carbone et les coûts serveur.",
    "rgpd_cookie_consent":      "L'absence de banneau de consentement peut violer la législation sur la protection des données et exposer à des sanctions.",
    "rgpd_privacy_policy":      "Sans politique de confidentialité, le site manque à ses obligations légales de transparence envers les utilisateurs.",
    "rgpd_data_retention":      "La durée de conservation non déclarée affaiblit la transparence des traitements et peut contrevenir à la réglementation applicable.",
    "rgpd_minimization":        "Sans mention de minimisation, le principe de collecte proportionnée n'est pas démontré aux visiteurs.",
    "rgpd_legal_notice":        "L'absence de mentions légales fragilise la crédibilité juridique du site et peut contrevenir à la législation locale.",
    "rgpd_user_rights":         "Si les droits des personnes ne sont pas mentionnés, les utilisateurs ne peuvent pas comprendre ni exercer leurs droits.",
    "rgpd_declared_purpose":    "La finalité du traitement non déclarée empêche les utilisateurs d'évaluer la légitimité de la collecte.",
    "rgpd_rights_coverage":     "Une couverture insuffisante des droits des personnes expose à des demandes de mise en conformité ou des plaintes.",
    "rgpd_pre_consent_trackers":"Le chargement de trackers avant consentement constitue une violation des règles de protection de la vie privée applicables.",
    "rgpd_privacy_score":       "Un score de politique de confidentialité faible indique une politique incomplète ou rédigée superficiellement.",
}

_KPI_TICKET_TEAM = {
    "sec_ssl": "infrastructure", "sec_http_headers": "infrastructure", "sec_session_cookies": "backend",
    "sec_sqli_ddos": "backend", "sec_admin_exposed": "infrastructure", "sec_sensitive_files": "infrastructure",
    "sec_robots_disclosure": "backend", "sec_error_pages": "backend", "sec_brute_force": "backend",
    "sec_file_upload": "backend", "sec_js_deps": "frontend", "sec_service_exposure": "infrastructure",
    "tech_cms_version": "infrastructure", "tech_modules_versions": "infrastructure",
    "tech_server_version": "infrastructure", "tech_programming_language": "infrastructure", "tech_cve_check": "infrastructure",
    "func_forms": "frontend", "func_links": "frontend", "func_buttons": "frontend",
    "func_features": "product", "func_search": "frontend",
    "perf_desktop_speed": "frontend", "perf_mobile_speed": "frontend",
    "perf_image_optim": "frontend", "perf_compression": "infrastructure", "perf_cache": "infrastructure",
    "perf_console_errors": "frontend",
    "seo_alt_tags": "content", "seo_meta_tags": "content", "seo_sitemap": "backend",
    "seo_robots_txt": "backend", "seo_duplication": "content", "seo_url_structure": "backend",
    "seo_heading_structure": "content", "seo_internal_linking": "content",
    "seo_h1_quality": "content", "seo_meta_nlp": "content", "seo_ai_readiness": "content",
    "content_freshness": "content", "content_thin": "content", "content_cannibalization": "content",
    "content_missing_cta": "content", "content_broken_structure": "content", "content_lexical_diversity": "content",
    "rgpd_cookie_consent": "legal", "rgpd_privacy_policy": "legal", "rgpd_data_retention": "legal",
    "rgpd_minimization": "legal", "rgpd_legal_notice": "legal", "rgpd_user_rights": "legal",
    "rgpd_declared_purpose": "legal", "rgpd_rights_coverage": "legal",
    "rgpd_pre_consent_trackers": "frontend", "rgpd_privacy_score": "legal",
    "eco_index_score": "frontend",
    "ux_audience_targeting": "content", "ux_social_sharing": "frontend",
    "ux_design_ergonomics": "frontend", "ux_navigation": "product", "ux_mobile_friendly": "frontend",
}


def _derive_scope(pages_scanned: int, affected_pages: int, sampled: bool = False) -> dict:
    """Build the V2 scope object."""
    ps = max(_safe_int(pages_scanned), 1)
    ap = _safe_int(affected_pages)
    return {
        "pages_scanned": ps,
        "affected_pages": ap,
        "affected_ratio": round(ap / ps, 3) if ps > 0 else 0.0,
        "sampled": sampled,
    }


def _build_evidence_examples(kpi_id: str, data: dict, domain_url: str) -> list:
    """Build concrete evidence.examples for ticketable KPIs. Returns empty list when not applicable."""
    examples = []
    d = _safe_dict(data)

    if kpi_id == "func_buttons":
        for btn in _safe_list(d.get("broken_buttons", []))[:10]:
            if not isinstance(btn, dict):
                continue
            examples.append({
                "url": btn.get("url") or domain_url,
                "selector": btn.get("selector") or btn.get("tag") or "button",
                "label": btn.get("label") or btn.get("text") or "N/A",
                "observed": btn.get("issue_type") or "Bouton sans action exploitable détectée",
                "expected": "Déclenchement d'une action réelle : navigation, ouverture de formulaire ou appel API",
            })

    elif kpi_id == "func_links":
        for link in _safe_list(d.get("broken_links", []))[:10]:
            if not isinstance(link, dict):
                continue
            examples.append({
                "url": link.get("found_on") or domain_url,
                "selector": "a[href]",
                "label": link.get("anchor_text") or link.get("url") or "N/A",
                "observed": f"HTTP {link.get('status_code', '?')} — {link.get('url', 'URL inconnue')}",
                "expected": "Réponse HTTP 200 ou redirection valide",
            })

    elif kpi_id == "sec_ssl":
        ssl = d
        if ssl:
            examples.append({
                "url": domain_url,
                "observed": (
                    f"Certificat invalide ou expiré" if ssl.get("valid") is False
                    else f"Certificat valide, expire le {ssl.get('expiry', 'N/A')}"
                ),
                "expected": "Certificat TLS valide, non expiré, émis par une autorité reconnue",
                "source": "ssl_probe",
            })

    elif kpi_id == "sec_http_headers":
        missing = _safe_list(d.get("missing_headers", []))
        for h in missing[:8]:
            examples.append({
                "url": domain_url,
                "observed": f"En-tête '{h}' absent de la réponse HTTP",
                "expected": f"En-tête '{h}' présent avec une valeur sécurisée",
                "source": "http_response_headers",
            })

    elif kpi_id == "sec_service_exposure":
        for svc in _safe_list(d.get("open_services", []))[:8]:
            if not isinstance(svc, dict):
                continue
            examples.append({
                "url": domain_url,
                "observed": f"Port {svc.get('port', '?')} ouvert ({svc.get('service', 'service inconnu')}, risque {svc.get('risk', 'non précisé')})",
                "expected": "Aucun service sensible ne doit être exposé publiquement sans justification et filtrage réseau strict",
                "source": "tcp_probe",
            })

    elif kpi_id == "sec_admin_exposed":
        exposed = _safe_list(d.get("exposed", []))
        for path in exposed[:8]:
            examples.append({
                "url": f"{domain_url.rstrip('/')}{path}",
                "observed": "Page admin accessible sans authentification (HTTP 200)",
                "expected": "Redirection vers une page de connexion ou réponse 403",
                "source": "headless_probe",
            })

    elif kpi_id == "sec_session_cookies":
        for ck in _safe_list(d.get("cookies", []))[:8]:
            name = ck.get("name", "cookie") if isinstance(ck, dict) else str(ck)
            flags_missing = []
            if isinstance(ck, dict):
                if not ck.get("secure"):
                    flags_missing.append("Secure")
                if not ck.get("httponly"):
                    flags_missing.append("HttpOnly")
            if flags_missing:
                examples.append({
                    "url": domain_url,
                    "observed": f"Cookie '{name}' manque les flags : {', '.join(flags_missing)}",
                    "expected": f"Cookie '{name}' avec Secure=true et HttpOnly=true",
                    "source": "http_response_cookies",
                })

    elif kpi_id == "perf_console_errors":
        for err in _safe_list(d.get("homepage_console_errors", []))[:8]:
            examples.append({
                "url": domain_url,
                "observed": str(err),
                "expected": "Aucune erreur JavaScript en console sur la page d'accueil",
                "source": "headless_console",
            })

    elif kpi_id == "rgpd_privacy_policy":
        examples.append({
            "url": domain_url,
            "observed": "Aucun lien vers une politique de confidentialité détecté",
            "expected": "Lien 'Politique de confidentialité' visible en pied de page ou formulaires",
            "source": "static_html",
        })

    elif kpi_id == "rgpd_legal_notice":
        examples.append({
            "url": domain_url,
            "observed": "Aucun lien vers des mentions légales détecté",
            "expected": "Lien 'Mentions légales' ou 'CGU' visible dans le pied de page",
            "source": "static_html",
        })

    return examples


def _build_evidence(kpi_id: str, evidence_quality: str, data: dict, domain_url: str) -> dict:
    """Builds the evidence block for a V2 KPI."""
    sources = {
        "concrete":      ["rendered_dom", "headless_probe"],
        "aggregate":     ["scanner_aggregation", "nlp"],
        "heuristic":     ["static_html"],
        "not_evaluated": [],
    }.get(evidence_quality, ["static_html"])

    # Specialised sources
    if kpi_id in ("sec_ssl",):
        sources = ["ssl_probe"]
    elif kpi_id in ("sec_http_headers", "sec_session_cookies"):
        sources = ["http_response_headers"]
    elif kpi_id in ("perf_console_errors",):
        sources = ["headless_console"]
    elif kpi_id in ("rgpd_cookie_consent",):
        sources = ["static_html", "nlp_cmp_detection"]
    elif kpi_id in ("seo_sitemap", "seo_robots_txt"):
        sources = ["http_probe"]
    elif kpi_id in ("tech_cve_check", "sec_js_deps"):
        sources = ["cve_scanner", "js_dependency_audit"]
    elif kpi_id in ("sec_service_exposure",):
        sources = ["tcp_probe"]

    examples = _build_evidence_examples(kpi_id, data, domain_url) if evidence_quality in ("concrete",) else []

    return {"source": sources, "examples": examples}


def _build_ticket_payload(kpi_id: str, kpi_name: str, severity: str, evidence_quality: str, examples: list) -> dict | None:
    """Builds ticket payload for concrete/aggregate failing KPIs. Returns None for heuristic/not_evaluated."""
    if evidence_quality in ("heuristic", "not_evaluated") or not severity:
        return None

    team = _KPI_TICKET_TEAM.get(kpi_id, "product")

    # Map kpi_id to a French ticket title
    ticket_titles = {
        "func_buttons":      "Corriger les boutons et CTA sans action réelle",
        "func_links":        "Corriger les liens internes cassés",
        "func_forms":        "Traiter les bugs détectés sur les formulaires",
        "sec_ssl":           "Renouveler ou corriger le certificat SSL",
        "sec_http_headers":  "Ajouter les en-têtes de sécurité HTTP manquants",
        "sec_session_cookies":"Corriger les flags Secure/HttpOnly des cookies de session",
        "sec_admin_exposed": "Protéger ou restreindre l'accès aux interfaces d'administration",
        "sec_sqli_ddos":     "Traiter les signaux d'injection SQL ou DDoS détectés",
        "sec_brute_force":   "Implémenter une protection anti-brute force sur les formulaires de connexion",
        "sec_js_deps":       "Mettre à jour les dépendances JS avec des CVEs actifs",
        "sec_service_exposure": "Restreindre l'exposition des services réseau sensibles",
        "seo_meta_tags":     "Renseigner les balises META manquantes sur les pages identifiées",
        "seo_alt_tags":      "Ajouter les attributs ALT manquants sur les images",
        "seo_sitemap":       "Créer et soumettre un sitemap XML",
        "seo_robots_txt":    "Créer un fichier robots.txt adapté",
        "seo_h1_quality":    "Corriger la structure des balises H1 sur les pages concernées",
        "seo_heading_structure": "Corriger la hiérarchie de titres (H1-H6) sur les pages concernées",
        "seo_url_structure": "Normaliser les URLs (supprimer les patterns /node/id)",
        "seo_internal_linking": "Améliorer le maillage interne sur les pages concernées",
        "content_thin":      "Enrichir le contenu des pages identifiées comme insuffisantes",
        "content_missing_cta":"Ajouter des CTA sur les pages transactionnelles sans appel à l'action",
        "content_cannibalization": "Rationaliser les pages ciblant les mêmes mots-clés",
        "perf_desktop_speed":"Optimiser les performances de chargement desktop",
        "perf_mobile_speed": "Optimiser les performances de chargement mobile",
        "perf_image_optim":  "Optimiser les images (format, compression, lazy loading)",
        "perf_console_errors":"Corriger les erreurs JavaScript sur la page d'accueil",
        "rgpd_cookie_consent":"Implémenter un bandeau de consentement cookies conforme à la réglementation applicable",
        "rgpd_privacy_policy":"Publier et lier une politique de confidentialité conforme à la réglementation sur la protection des données",
        "rgpd_legal_notice": "Publier les mentions légales conformes à la législation locale",
        "rgpd_user_rights":  "Mentionner explicitement les droits des personnes sur leurs données dans la politique de confidentialité",
        "rgpd_declared_purpose": "Déclarer la finalité du traitement des données dans la politique",
        "rgpd_pre_consent_trackers": "Bloquer les trackers jusqu'à obtention du consentement utilisateur",
    }

    acceptance_hints = {
        "func_buttons":  "Chaque bouton listé doit déclencher une action réelle, naviguer vers une page valide, ou ouvrir un formulaire fonctionnel.",
        "func_links":    "Chaque lien listé doit retourner HTTP 200 ou une redirection valide (301/302). Les liens 404/410 doivent être supprimés ou redirigés.",
        "sec_ssl":       "Le certificat doit être valide, non expiré, et émis par une autorité reconnue (Let's Encrypt, DigiCert, etc.).",
        "sec_http_headers": "Tous les en-têtes listés doivent être présents dans les réponses HTTP avec des valeurs sécurisées adaptées au site.",
        "sec_service_exposure": "Aucun port critique (DB/RDP/SMB/Redis...) ne doit rester exposé depuis Internet. Les services nécessaires doivent être filtrés, authentifiés et journalisés.",
        "rgpd_cookie_consent": "Un bandeau CMP doit s'afficher avant tout chargement de tracker tiers. La décision de l'utilisateur doit être mémorisée.",
    }

    return {
        "title": ticket_titles.get(kpi_id, f"Corriger : {kpi_name}"),
        "type": "bug" if severity in ("critical", "high") else "improvement",
        "priority": severity or "medium",
        "team_hint": team,
        "acceptance_hint": acceptance_hints.get(kpi_id),
    }


def _build_client_summary_v2(kpi_id: str, status: str, evidence_quality: str, pages: int, data: dict) -> str:
    """Generate a client-readable French summary sentence per KPI — no jargon, no alarmism without proof."""
    d = _safe_dict(data)
    ps = _safe_int(pages)

    if status == "not_evaluated":
        return {
            "seo_multi_browser": "La compatibilité multi-navigateurs n'a pas pu être vérifiée de manière fiable lors de ce scan.",
            "seo_duplication": "Le taux de duplication n'est pas exploitable dans ce scan car la qualité d'extraction du contenu est insuffisante.",
        }.get(kpi_id, "Ce point n'a pas pu être évalué avec suffisamment de fiabilité pendant ce scan.")

    if status == "passing":
        passing_msgs = {
            "sec_ssl":           "Le certificat SSL est valide et la connexion est sécurisée pour les visiteurs.",
            "sec_http_headers":  "Les en-têtes de sécurité HTTP requis sont correctement configurés.",
            "sec_session_cookies":"Les cookies de session sont correctement protégés avec les flags de sécurité.",
            "sec_service_exposure": "Aucun service réseau à risque n'est exposé sur les ports surveillés.",
            "seo_sitemap":       "Un sitemap XML est présent, facilitant l'indexation par les moteurs de recherche.",
            "seo_robots_txt":    "Le fichier robots.txt est en place et contrôle correctement le crawl.",
            "rgpd_privacy_policy":"Une politique de confidentialité a été détectée sur le site.",
            "rgpd_legal_notice": "Les mentions légales ont été détectées sur le site.",
            "rgpd_user_rights":  "Les droits RGPD des utilisateurs sont mentionnés dans la documentation.",
        }
        return passing_msgs.get(kpi_id, "Ce point a été vérifié sans bug identifié.")

    # Failing / warning messages
    failing_msgs = {
        "func_buttons":     f"Des boutons importants ne déclenchent aucune action sur {ps} page(s), ce qui peut bloquer des parcours de conversion.",
        "func_links":       f"Des liens internes cassés ont été détectés sur {ps} page(s), perturbant la navigation et le crawl SEO.",
        "func_forms":       f"Des bugs ont été détectés sur des formulaires du site, pouvant bloquer la soumission ou exposer des erreurs.",
        "sec_ssl":           "Le certificat SSL semble invalide ou expiré, ce qui peut bloquer l'accès et exposer les données des visiteurs.",
        "sec_http_headers":  "Des en-têtes de sécurité essentiels sont absents, élargissant la surface d'attaque du site.",
        "sec_session_cookies":f"Des cookies de session manquent de protections importantes (Secure/HttpOnly).",
        "sec_sqli_ddos":     "Des signaux d'injection SQL ou DDoS ont été détectés, indiquant des risques de sécurité applicative.",
        "sec_admin_exposed": f"{ps} interface(s) d'administration semble(nt) accessible(s) sans authentification.",
        "sec_brute_force":   "Les formulaires de connexion ne semblent pas protégés contre les tentatives de connexion répétées.",
        "sec_js_deps":       "Des librairies JavaScript avec des failles documentées ont été détectées.",
        "sec_service_exposure": "Des ports réseau sensibles semblent accessibles publiquement, ce qui augmente le risque de compromission.",
        "seo_meta_tags":    f"{d.get('pages_missing_meta_desc', ps)} page(s) manquent de balises META, réduisant leur visibilité dans les résultats de recherche.",
        "seo_alt_tags":     f"{d.get('images_missing_alt', ps)} image(s) manquent d'attribut ALT, nuisant à l'accessibilité et au SEO.",
        "seo_sitemap":       "Aucun sitemap XML n'a été trouvé, ce qui peut limiter l'indexation des pages par les moteurs de recherche.",
        "seo_robots_txt":    "Le fichier robots.txt est absent, laissant le crawl des moteurs de recherche non contrôlé.",
        "seo_duplication":  f"Un taux de contenu dupliqué de {d.get('duplicate_content_rate_pct', 0):.1f}% a été détecté, pouvant diluer le positionnement SEO.",
        "seo_url_structure": f"{d.get('node_style_url_count', ps)} URL(s) utilisent un format /node/id peu favorable au référencement.",
        "seo_heading_structure": f"La structure des titres est incorrecte sur {ps} page(s), affaiblissant la hiérarchie sémantique.",
        "seo_internal_linking": f"Le maillage interne est insuffisant sur {ps} page(s), limitant la distribution du PageRank.",
        "content_thin":     f"{ps} page(s) contiennent un volume de texte insuffisant pour obtenir un bon positionnement.",
        "content_missing_cta": f"{ps} page(s) transactionnelles n'ont pas de bouton ou lien d'appel à l'action clairement identifié.",
        "content_cannibalization": f"{ps} cluster(s) de pages ciblent les mêmes mots-clés, créant une compétition interne.",
        "perf_desktop_speed": f"Le temps de chargement desktop est au-dessus des seuils recommandés (LCP : {d.get('lcp_ms', '?')} ms).",
        "perf_mobile_speed": "Les performances mobiles sont insuffisantes, ce qui affecte l'expérience utilisateur et le référencement mobile.",
        "perf_console_errors": "Des erreurs JavaScript ont été détectées en console sur la page d'accueil, pouvant altérer des fonctionnalités.",
        "eco_index_score":  f"Le score écologique est de {_safe_float(d.get('avg_eco_index', 0)):.0f}/100, indiquant des pages relativement lourdes en ressources.",
        "rgpd_cookie_consent": (
            "Le scan n'a pas trouvé de preuve suffisamment fiable d'un bandeau de consentement cookies."
            if evidence_quality == "heuristic"
            else "Aucun bandeau de consentement cookies n'a été détecté sur le site."
        ),
        "rgpd_privacy_policy": "Aucune politique de confidentialité n'a été détectée, ce qui constitue une obligation légale.",
        "rgpd_legal_notice":   "Les mentions légales n'ont pas été trouvées, obligatoires en France pour tout site professionnel.",
        "rgpd_user_rights":    "Les droits RGPD des utilisateurs (accès, rectification, suppression) ne sont pas mentionnés clairement.",
        "rgpd_declared_purpose": "La finalité du traitement des données n'est pas explicitement déclarée.",
        "rgpd_pre_consent_trackers": f"Des trackers semblent se charger avant tout consentement utilisateur sur {ps} page(s).",
        "rgpd_data_retention": "Aucune page ne mentionne clairement la durée de conservation des données.",
        "rgpd_minimization":   "Le principe de minimisation des données n'est pas explicitement mentionné.",
    }
    return failing_msgs.get(kpi_id, f"Un point d'attention a été identifié sur ce critère ({ps} page(s) concernée(s)).")


def _build_technical_summary_v2(kpi_id: str, status: str, evidence_quality: str, data: dict) -> str:
    """Short, concrete, team-facing technical sentence."""
    d = _safe_dict(data)

    if status == "not_evaluated":
        return {
            "seo_multi_browser": "Le résultat repose sur un fallback HTTP User-Agent, sans comparaison réelle de rendu entre moteurs navigateur.",
            "rgpd_cookie_consent": "Détection basée sur HTML statique uniquement ; aucun rendu JS ni contrôle réseau concluant n'a été obtenu.",
            "seo_duplication": "Le calcul de duplication est marqué non fiable (extraction de contenu faible ou incomplète sur un volume significatif de pages).",
        }.get(kpi_id, "Données insuffisantes pour une évaluation fiable — aucune sonde n'a retourné de résultat.")

    if status == "passing":
        return f"Vérification réussie — aucun bug mesurable détecté sur ce critère lors du scan."

    tech_msgs = {
        "func_buttons":     f"{d.get('total_broken_buttons', '?')} bouton(s) problématique(s) sur {d.get('pages_with_nonfunc_buttons', '?')} page(s) — principalement des ancres mortes (href='#') ou CTA sans action attachée.",
        "func_links":       f"{d.get('internal_broken_count', d.get('broken_link_count', '?'))} lien(s) interne(s) cassé(s) — codes HTTP détectés : 404, 403 ou timeout.",
        "func_forms":       f"{d.get('anomalies', '?')} signal(aux) sur {d.get('forms_tested', '?')} formulaire(s) testé(s) via fuzzing.",
        "sec_ssl":          f"SSL valid={d.get('valid')}, expiry={d.get('expiry', 'N/A')}, protocol={d.get('protocol', 'N/A')}.",
        "sec_http_headers": f"En-têtes manquants : {', '.join(_safe_list(d.get('missing_headers', []))[:6])}.",
        "sec_session_cookies": f"{d.get('missing_count', '?')} cookie(s) sans flag(s) Secure/HttpOnly.",
        "sec_sqli_ddos":    f"SQLi={d.get('sqli_vulnerable_count', 0)}, XSS={d.get('xss_vulnerable_count', 0)}, DDoS={d.get('ddos_signal_count', 0)}.",
        "sec_admin_exposed": f"Chemins exposés : {', '.join(_safe_list(d.get('exposed', []))[:5])}.",
        "sec_js_deps":      f"{len(_safe_list(d.get('vulnerable_libraries', [])))} librairie(s) JS vulnérable(s) détectée(s).",
        "seo_meta_tags":    f"{d.get('pages_missing_meta_desc', '?')} pages sans meta description, {d.get('pages_missing_title', '?')} sans title.",
        "seo_alt_tags":     f"{d.get('images_missing_alt', '?')} image(s) sans attribut ALT détectée(s) lors du crawl.",
        "seo_duplication":  f"Taux de duplication : {d.get('duplicate_content_rate_pct', 0):.1f}% — {d.get('duplicate_page_count', 0)} page(s) concernée(s).",
        "seo_url_structure": f"{d.get('node_style_url_count', '?')} URL(s) avec pattern /node/[id] ou query string non normalisé.",
        "content_thin":     f"{d.get('pages_thin_content_nlp', '?')} page(s) < 300 mots (NLP), {d.get('pages_with_keyword_stuffing', 0)} avec keyword stuffing.",
        "perf_desktop_speed": f"LCP moyen : {d.get('lcp_ms', '?')} ms, FCP : {d.get('fcp_ms', '?')} ms, CLS : {d.get('cls', '?')}.",
        "perf_console_errors": f"{d.get('homepage_console_error_count', '?')} erreur(s) JS détectée(s) en console sur la page d'accueil.",
        "eco_index_score":  f"Eco Index moyen : {d.get('avg_eco_index', '?')}/100.",
        "rgpd_cookie_consent": "Détection statique : aucun script CMP reconnu (Axeptio, Cookiebot, OneTrust, Tarteaucitron) trouvé dans le HTML.",
    }
    return tech_msgs.get(kpi_id, f"Bug ou recommandation détecté lors du scan — consulter les données brutes de ce KPI pour le détail.")


def _first_non_empty_str(values) -> Optional[str]:
    for val in values:
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _extract_recommended_action(v1_data: dict, ticket_payload: Optional[dict], status: str) -> tuple[str, str]:
    """Return (recommended_action, recommendation_source)."""
    data = _safe_dict(v1_data)

    direct_fix = _first_non_empty_str([
        data.get("fix"),
        _safe_dict(data.get("detail", {})).get("fix"),
        _safe_dict(data.get("detail", {})).get("recommendation"),
        _safe_dict(data.get("detail", {})).get("action"),
        _safe_dict(data.get("detail", {})).get("remediation"),
    ])
    if direct_fix:
        return direct_fix, "fix"

    for item in _safe_list(data.get("items", [])):
        if not isinstance(item, dict):
            continue
        item_fix = _first_non_empty_str([
            item.get("fix"),
            item.get("recommendation"),
            item.get("action"),
            item.get("remediation"),
        ])
        if item_fix:
            return item_fix, "fix"

    ticket = _safe_dict(ticket_payload)
    ticket_title = _first_non_empty_str([ticket.get("title")])
    ticket_hint = _first_non_empty_str([ticket.get("acceptance_hint")])
    if ticket_title and ticket_hint:
        return f"{ticket_title}. {ticket_hint}", "ticket_payload"
    if ticket_title:
        return ticket_title, "ticket_payload"

    if status == "passing":
        return "Aucune action corrective requise. Maintenir le niveau actuel.", "generated"
    if status == "not_evaluated":
        return "Données insuffisantes pour conclure. Relancer le scan avec un contexte plus complet.", "generated"
    
    # Generate contextual fallback if possible using ticket_payload hint or fallback string
    team_hint = ticket.get("team_hint", "").lower()
    if "seo" in team_hint or "content" in team_hint:
        return "Optimiser ce point pour améliorer le positionnement SEO et l'expérience de lecture.", "generated"
    if "frontend" in team_hint or "infrastructure" in team_hint or "backend" in team_hint:
        return "Optimiser ces éléments techniques pour accélérer le chargement et renforcer la fiabilité.", "generated"
    if "legal" in team_hint:
        return "Mettre en conformité ces éléments avec les obligations légales (RGPD/ePrivacy).", "generated"

    return "Prioriser la correction en s'appuyant sur les preuves techniques de ce KPI.", "generated"


_DIGEST_SKIP_KEYS = {
    "data_quality", "quality", "status", "status_raw", "passed", "enabled",
    "sampled", "source", "detection_source", "observed_metrics",
}

_DIGEST_SECRET_RE = re.compile(
    r"(token|secret|password|passwd|authorization|cookie|session|jwt|api[-_]?key|payload)",
    re.IGNORECASE,
)


def _digest_str(value) -> str:
    if _is_missing_field(value):
        return ""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "oui" if value else "non"
    return _clean_text(value)


def _digest_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "oui", "available", "measured"}:
            return True
        if text in {"0", "false", "no", "non", "none", "null", "not_available", "metrics_unavailable", "zero_metrics"}:
            return False
    return False


def _positive_digest_number(value) -> bool:
    try:
        return float(value) > 0
    except (TypeError, ValueError):
        return False


def _performance_digest_rows(data: dict) -> list[dict]:
    rows = _safe_list(data.get("headless_rows") or data.get("sample_rows") or data.get("rows"))
    if not rows and any(key in data for key in ("fcp_ms", "lcp_ms", "available", "measurement_status")):
        rows = [data]
    return [_safe_dict(row) for row in rows if isinstance(row, dict)]


def _is_valid_performance_digest_row(row: dict) -> bool:
    source = _safe_dict(row)
    if not source:
        return False
    measurement_status = _clean_text(source.get("measurement_status")).lower()
    if measurement_status in {"zero_metrics", "metrics_unavailable", "failed:zero_metrics", "unavailable", "timeout"}:
        return False
    if source.get("available") is not None and not _digest_bool(source.get("available")):
        return False
    fcp_ms = _optional_float(source.get("fcp_ms"))
    lcp_ms = _optional_float(source.get("lcp_ms"))
    if fcp_ms is None or lcp_ms is None or fcp_ms <= 0 or lcp_ms <= 0:
        return False
    # Anti-bot/blocked pages can produce synthetic-looking timings such as 43ms.
    # Treat those as unusable for site performance/eco scoring unless the scanner
    # later adds an explicit tiny-document marker.
    if fcp_ms < 100 or lcp_ms < 100:
        return False
    return True


def _mask_digest_value(key: str, value):
    """Keep proof useful while avoiding secret/token/personal-data leakage."""
    if _is_missing_field(value):
        return ""
    key_text = _clean_text(key)
    if _DIGEST_SECRET_RE.search(key_text):
        rendered = _digest_str(value)
        if not rendered:
            return ""
        if key_text.lower() in {"name", "cookie_name"}:
            return rendered
        return "***masque***"
    if isinstance(value, dict):
        return _missing_field(value.get("reason", "Donnée manquante"))
    if isinstance(value, list):
        return ", ".join(_digest_str(item) for item in value[:5] if _digest_str(item))
    return _digest_str(value)


def _clean_digest_row(row: dict, columns: list[str] | None = None) -> dict:
    result = {}
    source = _safe_dict(row)
    selected = columns or list(source.keys())
    for key in selected:
        if key in _DIGEST_SKIP_KEYS:
            continue
        value = _mask_digest_value(key, source.get(key))
        if value not in ("", None):
            result[key] = value
    return result


def _unique_digest_rows(rows: list[dict], columns: list[str] | None = None, limit: int = 200) -> list[dict]:
    seen = set()
    cleaned = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        item = _clean_digest_row(row, columns)
        if not item:
            continue
        key = tuple(sorted(item.items()))
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(item)
        if len(cleaned) >= limit:
            break
    return cleaned


def _collect_digest_urls(*values) -> list:
    urls = []
    def visit(value):
        if _is_missing_field(value):
            return
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("http://") or text.startswith("https://") or text.startswith("/"):
                if text not in urls:
                    urls.append(text)
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if isinstance(value, dict):
            for key in ("url", "page_url", "source_page", "target_url", "image_url", "action_url", "robots_url", "sitemap_url", "homepage_url"):
                if key in value:
                    visit(value.get(key))
            return
    for value in values:
        visit(value)
    return urls[:50]


def _append_digest_line(lines: list, line: str) -> None:
    text = _clean_text(line)
    if not text:
        return
    if text.upper() in {"VALID", "PARTIAL", "MISSING"}:
        return
    if text not in lines:
        lines.append(text)


def _digest_first_rows_from_keys(evidence: dict, keys: list[str]) -> list[dict]:
    for key in keys:
        value = evidence.get(key)
        if isinstance(value, list):
            rows = _unique_digest_rows([_safe_dict(row) for row in value if isinstance(row, dict)])
            if rows:
                return rows
    return []


_EVIDENCE_COVERAGE_REGISTRY = {
    "tech_modules_versions": {
        "proof_type": "rows",
        "csv_columns": ["module", "name", "version", "source", "verification_result", "verification_source", "risk", "recommendation", "latest_known_version", "minimum_safe_version"],
        "missing_reason": "Aucun tableau module/version exploitable n'a ete fourni par le backend.",
    },
    "tech_cve_check": {
        "proof_type": "rows",
        "csv_columns": ["component", "version", "cve", "severity", "source", "upgrade_target"],
        "missing_reason": "Les compteurs CVE existent mais le detail composant/CVE n'a pas ete conserve.",
    },
    "sec_http_headers": {
        "proof_type": "rows",
        "csv_columns": ["header", "status", "value", "risk", "fix"],
        "missing_reason": "Le tableau des en-tetes HTTP testes est absent.",
    },
    "sec_session_cookies": {
        "proof_type": "rows",
        "csv_columns": ["cookie_name", "missing_flags", "domain", "path", "value"],
        "missing_reason": "Le detail des cookies et flags manquants est absent.",
    },
    "sec_sqli_ddos": {
        "proof_type": "rows",
        "csv_columns": ["category", "endpoint", "payload_class", "status", "anomaly", "details"],
        "missing_reason": "Aucun detail de sonde SQLi/XSS/DDoS n'a ete conserve.",
    },
    "sec_admin_exposed": {
        "proof_type": "rows",
        "csv_columns": ["url", "path", "status", "http_status", "auth_behavior"],
        "missing_reason": "Les chemins admin testes ne sont pas enumeres.",
    },
    "sec_sensitive_files": {
        "proof_type": "rows",
        "csv_columns": ["url", "status", "http_status", "type", "size"],
        "missing_reason": "Les fichiers sensibles exposes ne sont pas enumeres.",
    },
    "sec_robots_disclosure": {
        "proof_type": "rows",
        "csv_columns": ["url", "path", "risk", "accessible"],
        "missing_reason": "Les chemins sensibles reveles par robots.txt ne sont pas enumeres.",
    },
    "sec_error_pages": {
        "proof_type": "rows",
        "csv_columns": ["url", "status", "leak_snippet", "validation"],
        "missing_reason": "Aucun extrait de fuite de page d'erreur n'a ete conserve.",
    },
    "sec_trace_track": {
        "proof_type": "rows",
        "csv_columns": ["url", "method", "status", "echoed_header", "details"],
        "missing_reason": "Le resultat detaille de la sonde TRACE/TRACK est absent.",
    },
    "sec_cors_misconfiguration": {
        "proof_type": "rows",
        "csv_columns": ["url", "test_origin", "allow_origin", "allow_credentials", "unsafe_combination"],
        "missing_reason": "Le resultat detaille de la sonde CORS est absent.",
    },
    "sec_brute_force": {
        "proof_type": "rows",
        "csv_columns": ["login_url", "tested", "protected", "signal", "details"],
        "missing_reason": "La preuve de test brute force login est absente.",
    },
    "sec_file_upload": {
        "proof_type": "rows",
        "csv_columns": ["upload_url", "field", "tested_file_type", "accepted", "details"],
        "missing_reason": "La preuve de controle upload est absente.",
    },
    "sec_js_deps": {
        "proof_type": "rows",
        "csv_columns": ["library", "version", "script_url", "cve", "severity", "upgrade_target"],
        "missing_reason": "Le detail librairie/version/CVE JavaScript est absent.",
    },
    "sec_service_exposure": {
        "proof_type": "rows",
        "csv_columns": ["host", "port", "service", "state", "risk", "note"],
        "missing_reason": "La verification des services reseau n'a pas fourni de lignes de ports testes.",
    },
    "func_forms": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "action_url", "form_id", "test_type", "response_type", "status_code", "anomaly"],
        "missing_reason": "Les resultats de tests formulaires ne sont pas detailles.",
    },
    "func_links": {
        "proof_type": "rows",
        "csv_columns": ["source_page", "target_url", "status_code", "error", "anchor_text"],
        "missing_reason": "Les liens casses ne sont pas enumeres.",
    },
    "func_buttons": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "label_or_text", "selector", "issue_type", "href", "onclick", "form_action"],
        "missing_reason": "Les boutons non fonctionnels ne sont pas enumeres.",
    },
    "func_search": {
        "proof_type": "executed_probe",
        "csv_columns": ["search_url", "query", "status", "result_behavior", "details"],
        "missing_reason": "Le moteur de recherche est seulement detecte; aucun test d'execution backend n'a ete conserve.",
    },
    "perf_desktop_speed": {
        "proof_type": "rows",
        "csv_columns": ["url", "fcp_ms", "lcp_ms", "cls", "speed_index_ms"],
        "missing_reason": "Les lignes Core Web Vitals desktop par URL sont absentes.",
    },
    "perf_mobile_speed": {
        "proof_type": "rows",
        "csv_columns": ["url", "profile", "fcp_ms", "lcp_ms", "cls", "speed_index_ms", "issue"],
        "missing_reason": "Les lignes Core Web Vitals mobile sont absentes.",
    },
    "perf_image_optim": {
        "proof_type": "rows",
        "csv_columns": ["url", "content_type", "size_bytes", "recommendation", "page_url"],
        "missing_reason": "Le detail des images non optimisees est absent.",
    },
    "perf_cache": {
        "proof_type": "rows",
        "csv_columns": ["url", "cache_control", "etag", "expires", "ttl_interpretation"],
        "missing_reason": "La preuve Cache-Control/ETag/Expires est absente.",
    },
    "perf_compression": {
        "proof_type": "rows",
        "csv_columns": ["url", "accept_encoding", "content_encoding", "compressed"],
        "missing_reason": "La preuve de compression HTTP est absente.",
    },
    "perf_console_errors": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "message", "source", "line", "count"],
        "missing_reason": "Les erreurs console ne sont pas detaillees par page.",
    },
    "seo_alt_tags": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "image_url", "alt_value", "selector"],
        "missing_reason": "Les images sans ALT ne sont pas enumerees.",
    },
    "seo_meta_tags": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "issue", "title", "meta_description", "length"],
        "missing_reason": "Les pages sans title/meta ne sont pas enumerees.",
    },
    "seo_duplication": {
        "proof_type": "rows",
        "csv_columns": ["cluster", "url", "similarity", "hash", "confidence"],
        "missing_reason": "Les groupes de duplication ne sont pas conserves.",
    },
    "seo_multi_browser": {
        "proof_type": "rows",
        "csv_columns": ["browser", "device", "url", "status", "issue", "diff_pct"],
        "missing_reason": "La matrice multi-navigateurs n'a pas ete produite.",
    },
    "seo_url_structure": {
        "proof_type": "rows",
        "csv_columns": ["url", "issue", "guidance"],
        "missing_reason": "Les URLs problematiques ne sont pas enumerees.",
    },
    "seo_heading_structure": {
        "proof_type": "rows",
        "csv_columns": ["url", "issue", "h1_count", "h2_count", "snippet"],
        "missing_reason": "Les pages Hn problematiques ne sont pas enumerees.",
    },
    "seo_internal_linking": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "internal_links", "contextual_links", "issue"],
        "missing_reason": "Les pages sans liens contextuels ne sont pas enumerees.",
    },
    "seo_h1_quality": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "issue", "h1_text", "h1_count", "title"],
        "missing_reason": "Les preuves NLP de qualite H1 sont absentes.",
    },
    "seo_meta_nlp": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "issue", "meta_description", "length"],
        "missing_reason": "Les preuves NLP de meta description sont absentes.",
    },
    "seo_ai_readiness": {
        "proof_type": "rows",
        "csv_columns": ["llms_url", "status", "content_type", "length", "useful_line", "parse_status"],
        "missing_reason": "Le fichier llms.txt n'a pas ete verifie avec un GET et des lignes utiles.",
    },
    "ux_mobile_friendly": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "viewport", "overflow", "tap_issue", "layout_issue"],
        "missing_reason": "La preuve mobile par page est absente.",
    },
    "content_freshness": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "latest_date", "source", "page_type", "stale_threshold_days"],
        "missing_reason": "Aucune date source de fraicheur n'a ete conservee.",
    },
    "content_thin": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "word_count", "typo_density", "stuffing_signal", "snippet"],
        "missing_reason": "Les pages de contenu fin/qualite faible ne sont pas enumerees.",
    },
    "content_cannibalization": {
        "proof_type": "rows",
        "csv_columns": ["keyword", "keyword_stem", "url", "cluster_size"],
        "missing_reason": "Les clusters de cannibalisation ne sont pas detailles.",
    },
    "content_missing_cta": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "intent", "cta_count", "snippet"],
        "missing_reason": "Les pages transactionnelles sans CTA ne sont pas enumerees.",
    },
    "content_broken_structure": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "broken_structure_index", "page_type", "snippet"],
        "missing_reason": "Les pages a structure de contenu cassee ne sont pas enumerees.",
    },
    "content_lexical_diversity": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "lexical_diversity", "token_count", "threshold"],
        "missing_reason": "Les pages a faible diversite lexicale ne sont pas enumerees.",
    },
    "rgpd_cookie_consent": {
        "proof_type": "proof_lines",
        "missing_reason": "La preuve CMP/banniere n'a pas ete conservee.",
    },
    "rgpd_privacy_policy": {
        "proof_type": "rows",
        "csv_columns": ["policy_url", "status", "title", "snippet"],
        "missing_reason": "La page ou l'extrait de politique de confidentialite est absent.",
    },
    "rgpd_data_retention": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "snippet", "retention_period"],
        "missing_reason": "Aucun extrait mentionnant la duree de conservation n'a ete conserve.",
    },
    "rgpd_minimization": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "snippet"],
        "missing_reason": "Aucun extrait mentionnant la minimisation n'a ete conserve.",
    },
    "rgpd_legal_notice": {
        "proof_type": "rows",
        "csv_columns": ["legal_url", "status", "publisher", "contact", "snippet"],
        "missing_reason": "La preuve de mentions legales est absente.",
    },
    "rgpd_user_rights": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "right", "present", "snippet"],
        "missing_reason": "Les droits personnes ne sont pas justifies par extrait.",
    },
    "rgpd_declared_purpose": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "purpose", "snippet"],
        "missing_reason": "Aucun extrait de finalite de traitement n'a ete conserve.",
    },
    "rgpd_rights_coverage": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "rights_found", "rights_missing", "score"],
        "missing_reason": "La matrice de droits RGPD est absente.",
    },
    "rgpd_pre_consent_trackers": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "tracker_domain", "category", "order", "before_consent"],
        "missing_reason": "La timeline runtime des trackers avant consentement est absente.",
    },
    "rgpd_privacy_score": {
        "proof_type": "rows",
        "csv_columns": ["page_url", "score", "weakness", "snippet"],
        "missing_reason": "Le score de politique de confidentialite n'a pas de detail rubric/snippet.",
    },
}


def _coverage_rule(kpi_id: str) -> dict:
    return _safe_dict(_EVIDENCE_COVERAGE_REGISTRY.get(kpi_id))


def _ordered_csv_rows(rows: list[dict], columns: list[str]) -> list[dict]:
    if not rows or not columns:
        return rows
    ordered = []
    for row in rows:
        item = {key: row.get(key) for key in columns if key in row}
        for key, value in row.items():
            if key not in item:
                item[key] = value
        ordered.append(item)
    return ordered


def _coverage_missing_reason(rule: dict) -> str:
    return _clean_text(rule.get("missing_reason")) or "Aucune preuve exploitable n'a ete conservee pour ce KPI."


def _issue_requires_rows(rule: dict, status: str) -> bool:
    return _clean_text(rule.get("proof_type")).lower() == "rows" and status in {"failing", "warning"}


def _executed_probe_missing(rule: dict, status: str, rows: list[dict], data: dict, evidence: dict) -> bool:
    if _clean_text(rule.get("proof_type")).lower() != "executed_probe":
        return False
    executed = (
        data.get("search_executed") is True
        or evidence.get("search_executed") is True
        or _clean_text(data.get("execution_status")).lower() in {"executed", "tested", "passed", "failed"}
    )
    return not (executed and rows)


def _build_curated_evidence_digest(kpi_id: str, kpi_name: str, status: str, evidence: dict, kpi_obj: dict, domain_url: str) -> dict:
    """Client-safe evidence block: proof lines, table rows, URLs, and CSV metadata."""
    data = _safe_dict(kpi_obj.get("data", {}))
    quality = _clean_text(evidence.get("data_quality")).upper() or "PARTIAL"
    if quality not in {"VALID", "PARTIAL", "MISSING"}:
        quality = "PARTIAL"
    rule = _coverage_rule(kpi_id)

    lines: list[str] = []
    rows: list[dict] = []
    urls = _collect_digest_urls(kpi_obj.get("pages_affected_urls"), evidence)

    pages_checked = _safe_int(evidence.get("pages_checked"))
    affected_pages = _safe_int(evidence.get("affected_pages"))

    if kpi_id in {"tech_cms_version", "tech_server_version", "tech_programming_language"}:
        product = _digest_str(evidence.get("detected_product"))
        version = _digest_str(evidence.get("detected_version"))
        support = _digest_str(evidence.get("support_status"))
        detection_label = _digest_str(evidence.get("detection_label"))
        if not detection_label:
            if kpi_id == "tech_server_version":
                detection_label = "Serveur détecté"
            elif kpi_id == "tech_programming_language":
                detection_label = "Langage détecté"
            else:
                detection_label = "Technologie détectée"
        source = ", ".join(_safe_list(evidence.get("detection_source")) or _contract_detection_sources(kpi_id))
        _append_digest_line(lines, f"{detection_label}: {product or 'non détecté'}".strip())
        if version:
            version_label = _digest_str(evidence.get("version_label")) or ("Version serveur" if kpi_id == "tech_server_version" else "Version du langage" if kpi_id == "tech_programming_language" else "Version détectée")
            _append_digest_line(lines, f"{version_label}: {version}")
        if support:
            _append_digest_line(lines, f"Statut de support: {support}")
        _append_digest_line(lines, f"Source de détection: {source}")

    elif kpi_id == "tech_modules_versions":
        modules = _safe_list(data.get("modules") or data.get("module_versions"))
        rows = _unique_digest_rows(
            _safe_list(evidence.get("module_version_rows")) or
            _safe_list(_safe_dict(data.get("module_verification")).get("rows")) or
            [_safe_dict(row) for row in modules if isinstance(row, dict)]
        )
        module_count = max(len(rows), _safe_int(evidence.get("module_count")), _safe_int(data.get("module_count")))
        _append_digest_line(lines, f"Modules avec version détectée: {module_count}")
        _append_digest_line(lines, f"Modules verifies conformes: {_safe_int(evidence.get('safe_module_count'))}")
        _append_digest_line(lines, f"Modules a risque confirme: {_safe_int(evidence.get('risky_module_count'))}")
        _append_digest_line(lines, f"Modules a verifier: {_safe_int(evidence.get('uncertain_module_count'))}")
        _append_digest_line(lines, f"Methode de verification: {_digest_str(evidence.get('verification_mode')) or 'hybride, catalogue local d abord'}")
        if rows:
            _append_digest_line(lines, "Table des modules: nom, version, verification et action recommandee disponibles.")
        elif status != "not_evaluated":
            quality = "MISSING"

    elif kpi_id == "tech_cve_check":
        counts = _safe_dict(evidence.get("cve_counts")) or data
        _append_digest_line(
            lines,
            f"CVE détectées: critique={_safe_int(counts.get('critical'))}, haute={_safe_int(counts.get('high'))}, moyenne={_safe_int(counts.get('medium'))}, basse={_safe_int(counts.get('low'))}",
        )
        rows = _unique_digest_rows(_safe_list(data.get("cves") or data.get("items") or data.get("vulnerabilities") or data.get("rows")))

    elif kpi_id == "sec_ssl":
        valid = data.get("valid")
        _append_digest_line(lines, f"Domaine testé: {domain_url}")
        _append_digest_line(lines, f"Certificat TLS: {'valide' if valid is True else 'invalide' if valid is False else 'non vérifié'}")
        for label, key in [("Émetteur", "issuer"), ("Expiration", "expiry"), ("Protocole", "protocol")]:
            value = _digest_str(data.get(key))
            if value:
                _append_digest_line(lines, f"{label}: {value}")

    elif kpi_id == "sec_http_headers":
        missing = _safe_list(data.get("missing_headers"))
        present = _safe_list(data.get("headers"))
        rows = [{"header": h, "status": "missing", "risk": "durcissement HTTP absent"} for h in missing]
        rows += [{"header": h, "status": "present"} for h in present if h not in missing]
        _append_digest_line(lines, f"URL testée: {domain_url}")
        _append_digest_line(lines, f"En-têtes manquants: {len(missing)}")

    elif kpi_id == "sec_session_cookies":
        cookie_rows = []
        for row in _safe_list(data.get("cookies")):
            ck = _safe_dict(row) if isinstance(row, dict) else {"name": row}
            missing_flags = []
            if ck.get("secure") is False:
                missing_flags.append("Secure")
            if ck.get("httponly") is False:
                missing_flags.append("HttpOnly")
            if ck.get("samesite") in (None, "", False):
                missing_flags.append("SameSite")
            cookie_rows.append({
                "cookie_name": ck.get("name") or "cookie",
                "missing_flags": ", ".join(missing_flags) if missing_flags else "aucun",
                "domain": ck.get("domain") or "",
                "path": ck.get("path") or "",
                "value": "***masque***",
            })
        rows = _unique_digest_rows(cookie_rows)
        _append_digest_line(lines, f"Cookies avec flags manquants: {_safe_int(data.get('missing_count') or len([r for r in rows if r.get('missing_flags') != 'aucun']))}")

    elif kpi_id in {"sec_admin_exposed", "sec_version_disclosure", "sec_robots_disclosure", "sec_error_pages", "sec_sensitive_files"}:
        exposed = _safe_list(data.get("exposed")) if kpi_id != "sec_robots_disclosure" else _safe_list(data.get("paths") or data.get("disclosed_paths") or data.get("disallowed_sensitive") or data.get("exposed"))
        server_errors = _safe_list(data.get("server_errors"))
        forbidden = _safe_list(data.get("forbidden"))
        if kpi_id == "sec_sensitive_files":
            exposed = _safe_list(data.get("exposed"))
            rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items")))
            if not rows:
                rows = [{"url": f"{domain_url.rstrip('/')}{path}" if str(path).startswith("/") else str(path), "status": "exposed"} for path in exposed]
        elif kpi_id == "sec_error_pages":
            leaks = _safe_list(data.get("leaks") or data.get("leak_indicators") or data.get("indicators") or data.get("evidence"))
            rows = _unique_digest_rows([_safe_dict(row) for row in leaks if isinstance(row, dict)])
            if not rows:
                rows = [{"url": domain_url, "leak_snippet": _digest_str(item), "validation": domain_url} for item in leaks if _digest_str(item)]
        else:
            rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items")))
            if not rows:
                rows = [{"url": f"{domain_url.rstrip('/')}{path}" if str(path).startswith("/") else str(path), "status": "exposed"} for path in exposed]
                rows += [{"url": f"{domain_url.rstrip('/')}{path}" if str(path).startswith("/") else str(path), "status": "server_error"} for path in server_errors]
        _append_digest_line(lines, f"Confirmés exposés: {len(exposed)}")
        if forbidden:
            _append_digest_line(lines, f"Chemins protégés observés: {len(forbidden)}")
        if kpi_id == "sec_version_disclosure":
            version = _first_non_empty_str([data.get("version"), data.get("cms_version"), data.get("detected_version")])
            if version:
                _append_digest_line(lines, f"Version détectée: {version}")

    elif kpi_id in {"sec_trace_track", "sec_cors_misconfiguration", "sec_brute_force", "sec_file_upload", "sec_sqli_ddos", "sec_js_deps"}:
        candidate_rows = _safe_list(data.get("tests") or data.get("probes") or data.get("items") or data.get("libraries") or data.get("vulnerable_libraries"))
        rows = _unique_digest_rows([_safe_dict(row) for row in candidate_rows if isinstance(row, dict)])
        if kpi_id == "sec_cors_misconfiguration":
            _append_digest_line(lines, f"Origin de test: {_digest_str(data.get('test_origin') or data.get('origin')) or 'non renseignée'}")
            _append_digest_line(lines, f"Access-Control-Allow-Origin: {_digest_str(data.get('allow_origin') or data.get('access_control_allow_origin')) or 'absent'}")
            _append_digest_line(lines, f"Credentials autorisés: {_digest_str(data.get('allow_credentials') or data.get('access_control_allow_credentials')) or 'non'}")
            if not rows and any(key in data for key in ("misconfigured", "allow_origin", "access_control_allow_origin", "details")):
                rows = _unique_digest_rows([{
                    "url": data.get("url") or domain_url,
                    "test_origin": data.get("test_origin") or data.get("origin"),
                    "allow_origin": data.get("allow_origin") or data.get("access_control_allow_origin"),
                    "allow_credentials": data.get("allow_credentials") or data.get("access_control_allow_credentials"),
                    "unsafe_combination": data.get("misconfigured"),
                    "details": data.get("details"),
                }])
        elif kpi_id == "sec_trace_track":
            _append_digest_line(lines, f"Méthode testée: TRACE/TRACK sur {domain_url}")
            _append_digest_line(lines, f"Résultat: {_digest_str(data.get('details') or data.get('status') or data.get('detected')) or 'preuve de sonde à compléter'}")
            if not rows and any(key in data for key in ("detected", "details", "status")):
                rows = _unique_digest_rows([{
                    "url": data.get("url") or domain_url,
                    "method": data.get("method") or "TRACE/TRACK",
                    "status": data.get("status"),
                    "echoed_header": data.get("echoed_header"),
                    "details": data.get("details") or data.get("detected"),
                }])
        elif kpi_id == "sec_js_deps":
            _append_digest_line(lines, f"Librairies vulnérables détectées: {len(rows) or _safe_int(data.get('vulnerable_count'))}")
        elif kpi_id == "sec_brute_force":
            _append_digest_line(lines, f"Page login détectée: {_digest_str(data.get('login_url') or data.get('url')) or 'non confirmée'}")
            _append_digest_line(lines, f"Signal de protection: {_digest_str(data.get('details') or data.get('protected')) or 'à vérifier'}")
            if not rows and any(key in data for key in ("login_url", "protected", "details", "tested")):
                rows = _unique_digest_rows([{
                    "login_url": data.get("login_url") or data.get("url") or domain_url,
                    "tested": data.get("tested", True if data.get("protected") is not None else None),
                    "protected": data.get("protected"),
                    "signal": data.get("signal") or data.get("status"),
                    "details": data.get("details"),
                }])
        elif kpi_id == "sec_file_upload":
            _append_digest_line(lines, f"Formulaire upload détecté: {_digest_str(data.get('upload_url') or data.get('url')) or 'non confirmé'}")
            _append_digest_line(lines, f"Restrictions observées: {_digest_str(data.get('details') or data.get('restrictions')) or 'preuve à compléter'}")
            if not rows and any(key in data for key in ("upload_url", "uploads", "restrictions_found", "issues")):
                rows = _unique_digest_rows([{
                    "upload_url": data.get("upload_url") or data.get("url") or domain_url,
                    "field": ", ".join(_digest_str(item) for item in _safe_list(data.get("uploads")) if _digest_str(item)),
                    "tested_file_type": data.get("tested_file_type"),
                    "accepted": data.get("accepted"),
                    "details": data.get("details") or ", ".join(_digest_str(item) for item in _safe_list(data.get("issues")) if _digest_str(item)),
                }])
        elif kpi_id == "sec_sqli_ddos":
            _append_digest_line(lines, f"Sonde sécurité: {_digest_str(data.get('summary') or data.get('details')) or 'résumé de sonde à compléter'}")
            if not rows:
                vuln_rows = []
                for category, tests_key, count_key in [
                    ("SQLi", "sqli_tests", "sqli_vulnerable_count"),
                    ("XSS", "xss_tests", "xss_vulnerable_count"),
                ]:
                    for item in _safe_list(data.get(tests_key)):
                        row = _safe_dict(item)
                        if not row:
                            continue
                        vuln_rows.append({
                            "category": category,
                            "endpoint": row.get("url") or row.get("endpoint") or row.get("action_url"),
                            "payload_class": row.get("payload_class") or row.get("test_type") or category,
                            "status": "vulnerable" if row.get("vulnerable") else "tested",
                            "anomaly": row.get("anomaly") or row.get("reason"),
                            "details": row.get("details") or row.get("evidence"),
                        })
                    if _safe_int(data.get(count_key)) > 0 and not _safe_list(data.get(tests_key)):
                        vuln_rows.append({"category": category, "status": "signal_count_only", "anomaly": _safe_int(data.get(count_key))})
                for key, value in _safe_dict(data.get("ddos_indicators")).items():
                    if _safe_int(value) > 0:
                        vuln_rows.append({"category": "DDoS", "status": "signal", "anomaly": key, "details": value})
                rows = _unique_digest_rows(vuln_rows)
        if not rows and status in {"failing", "warning"}:
            quality = "PARTIAL"

    elif kpi_id == "sec_service_exposure":
        rows = _unique_digest_rows(_safe_list(evidence.get("open_services_all")), ["port", "service", "state", "risk", "note"])
        _append_digest_line(lines, f"Hôte testé: {_digest_str(evidence.get('host')) or domain_url}")
        _append_digest_line(lines, f"Ports ouverts risqués: {len(rows)}")

    elif kpi_id == "func_forms":
        rows = _unique_digest_rows(_safe_list(evidence.get("anomalous_tests_all")))
        _append_digest_line(lines, f"Formulaires détectés/testés: {_safe_int(evidence.get('forms_detected'))}/{_safe_int(evidence.get('forms_tested'))}")
        _append_digest_line(lines, f"Tests exécutés: {_safe_int(evidence.get('tests_run'))}, signaux: {_safe_int(evidence.get('anomalies_count'))}")

    elif kpi_id == "func_links":
        rows = _unique_digest_rows(_safe_list(evidence.get("broken_links_all")))
        _append_digest_line(lines, f"Liens internes cassés: {_safe_int(evidence.get('broken_internal_link_count'))}")

    elif kpi_id == "func_buttons":
        rows = _unique_digest_rows(_safe_list(evidence.get("broken_buttons_all")))
        _append_digest_line(lines, f"Boutons non fonctionnels: {_safe_int(evidence.get('total_broken_buttons'))}")

    elif kpi_id == "func_features":
        feature_rows = []
        for feature_key, label in [
            ("has_contact", "contact"),
            ("has_rdv", "rendez-vous"),
            ("has_search", "recherche"),
            ("has_login", "login"),
            ("has_newsletter", "newsletter"),
            ("has_cart", "panier"),
        ]:
            feature_rows.append({"feature": label, "detected": bool(data.get(feature_key))})
        rows = _unique_digest_rows(feature_rows)
        detected = [row.get("feature") for row in feature_rows if row.get("detected")]
        _append_digest_line(lines, f"Fonctionnalites detectees: {', '.join(detected) if detected else 'aucune'}")

    elif kpi_id == "func_search":
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("search_tests") or data.get("items")))
        if not rows and data.get("has_search") is not None:
            rows = _unique_digest_rows([{
                "search_url": data.get("search_url") or domain_url,
                "query": data.get("query"),
                "status": data.get("execution_status") or "detected_not_executed",
                "result_behavior": data.get("result_behavior"),
                "details": "Search form detected but no execution proof was retained",
            }])
        _append_digest_line(lines, f"Moteur detecte: {_digest_str(data.get('has_search'))}")
        if data.get("execution_status"):
            _append_digest_line(lines, f"Execution test: {_digest_str(data.get('execution_status'))}")

    elif kpi_id in {"seo_alt_tags", "seo_meta_tags", "seo_heading_structure", "seo_internal_linking", "seo_url_structure", "seo_duplication"}:
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items")))
        if not rows:
            rows = _digest_first_rows_from_keys(evidence, [
                "missing_alt_images_all", "meta_missing_urls_all", "title_missing_urls_all",
                "bad_h1_urls_all", "pages_missing_contextual_links_all", "non_clean_urls_all",
                "duplicate_clusters_all",
            ])
        if kpi_id == "seo_alt_tags":
            _append_digest_line(lines, f"Images sans ALT: {_safe_int(evidence.get('missing_alt_image_count'))}")
        elif kpi_id == "seo_meta_tags":
            _append_digest_line(lines, f"Meta descriptions manquantes: {_safe_int(evidence.get('meta_missing_count'))}")
            _append_digest_line(lines, f"Titres manquants: {_safe_int(evidence.get('title_missing_count'))}")
        elif kpi_id == "seo_heading_structure":
            _append_digest_line(lines, f"Pages avec structure H1 problématique: {_safe_int(evidence.get('bad_h1_page_count'))}")
        elif kpi_id == "seo_internal_linking":
            _append_digest_line(lines, f"Pages sans liens contextuels: {_safe_int(evidence.get('pages_missing_contextual_links_count'))}")
            _append_digest_line(lines, f"Couverture fiable: {_safe_dict(evidence.get('contextual_link_measurement')).get('reliable_coverage_pct', 'N/A')}%")
            if not rows:
                measurement = _safe_dict(evidence.get("contextual_link_measurement"))
                if measurement:
                    rows = _unique_digest_rows([{
                        "page_url": "sitewide",
                        "internal_links": evidence.get("total_internal_links"),
                        "contextual_links": evidence.get("total_contextual_internal_links"),
                        "issue": evidence.get("note") or "contextual_link_measurement",
                        "pages_checked": measurement.get("pages_checked"),
                        "reliable_coverage_pct": measurement.get("reliable_coverage_pct"),
                    }])
        elif kpi_id == "seo_url_structure":
            _append_digest_line(lines, f"URLs problématiques: {_safe_int(evidence.get('non_clean_url_count'))}")
        elif kpi_id == "seo_duplication":
            _append_digest_line(lines, f"Taux de duplication: {_digest_str(evidence.get('duplicate_content_rate_pct'))}%")
            _append_digest_line(lines, f"Pages dupliquées: {_safe_int(evidence.get('duplicate_page_count'))}")

    elif kpi_id in {"seo_multi_browser", "seo_external_linking", "seo_h1_quality", "seo_meta_nlp"}:
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items") or data.get("browser_matrix")))
        if kpi_id == "seo_meta_nlp":
            quality_rows = [
                _safe_dict(row)
                for row in _safe_list(data.get("rows") or data.get("items"))
                if _safe_dict(row).get("issue") in {"title_too_long", "meta_too_short", "meta_too_long"}
            ]
            rows = _unique_digest_rows(quality_rows)
        if kpi_id == "seo_multi_browser":
            _append_digest_line(lines, f"Statut multi-navigateurs: {_digest_str(data.get('status')) or 'non evalue'}")
            _append_digest_line(lines, f"Navigateurs: {_digest_str(data.get('engines'))}")
        elif kpi_id == "seo_external_linking":
            _append_digest_line(lines, f"Liens externes: {_safe_int(data.get('total_external_links'))}")
            _append_digest_line(lines, f"Domaines externes uniques: {_safe_int(data.get('unique_external_domains'))}")
        elif kpi_id == "seo_h1_quality":
            _append_digest_line(lines, f"H1 manquants: {_safe_int(data.get('h1_missing_pages'))}")
            _append_digest_line(lines, f"H1 multiples: {_safe_int(data.get('h1_multiple_pages'))}")
        elif kpi_id == "seo_meta_nlp":
            _append_digest_line(lines, f"Meta descriptions a optimiser: {_safe_int(data.get('meta_quality_issue_pages'))}")
            _append_digest_line(lines, f"Titres trop longs: {_safe_int(data.get('title_too_long_pages'))}")
            if _safe_int(data.get("meta_missing_pages")) > 0:
                _append_digest_line(lines, "Meta descriptions manquantes: suivies dans le KPI Balises META.")

    elif kpi_id in {"seo_sitemap", "seo_robots_txt", "seo_ai_readiness"}:
        url_key = "sitemap_url" if kpi_id == "seo_sitemap" else "robots_url" if kpi_id == "seo_robots_txt" else "llms_url"
        detected_key = "sitemap_detected" if kpi_id == "seo_sitemap" else "robots_detected" if kpi_id == "seo_robots_txt" else "llms_txt_present_pages"
        target_url = _digest_str(evidence.get(url_key) or data.get(url_key) or data.get("url"))
        if not target_url and kpi_id == "seo_ai_readiness":
            target_url = f"{domain_url.rstrip('/')}/llms.txt"
        _append_digest_line(lines, f"URL testée: {target_url or domain_url}")
        _append_digest_line(lines, f"Présence détectée: {_digest_str(evidence.get(detected_key) or data.get(detected_key)) or ('oui' if status == 'passing' else 'non')}")
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items")))

    elif kpi_id in {"perf_desktop_speed", "perf_mobile_speed", "perf_image_optim", "perf_cache", "perf_compression", "perf_console_errors", "eco_index_score"}:
        raw_perf_rows = _performance_digest_rows(data) if kpi_id in {"perf_desktop_speed", "perf_mobile_speed"} else []
        valid_perf_rows = [row for row in raw_perf_rows if _is_valid_performance_digest_row(row)]
        rows = _unique_digest_rows(
            valid_perf_rows if kpi_id in {"perf_desktop_speed", "perf_mobile_speed"} else
            _safe_list(data.get("rows") or data.get("unoptimised_images") or data.get("broken_buttons") or data.get("homepage_console_errors"))
        )
        if not rows and kpi_id == "perf_cache":
            rows = _unique_digest_rows([{
                "url": domain_url,
                "cache_control": data.get("cache_control"),
                "etag": data.get("etag"),
                "expires": data.get("expires"),
                "ttl_interpretation": data.get("cache_policy") or data.get("cache_friendly"),
            }])
        if not rows and kpi_id == "perf_compression":
            rows = _unique_digest_rows([{
                "url": domain_url,
                "accept_encoding": data.get("accept_encoding") or "gzip, br",
                "content_encoding": data.get("content_encoding"),
                "compressed": data.get("html_compression_applied"),
            }])
        if not rows and kpi_id == "perf_mobile_speed" and _is_valid_performance_digest_row(data):
            rows = _unique_digest_rows([{
                "url": data.get("url") or domain_url,
                "profile": data.get("profile") or "mobile",
                "fcp_ms": data.get("fcp_ms"),
                "lcp_ms": data.get("lcp_ms"),
                "cls": data.get("cls"),
                "speed_index_ms": data.get("speed_index_ms"),
                "issue": ", ".join(_digest_str(item) for item in _safe_list(data.get("issues")) if _digest_str(item)),
            }])
        for label, key in [
            ("FCP", "fcp_ms"), ("LCP", "lcp_ms"), ("CLS", "cls"), ("Speed Index", "speed_index_ms"),
            ("Eco Index moyen", "avg_eco_index"), ("Compression", "compression_rate_pct"),
        ]:
            value = _digest_str(data.get(key) or evidence.get(key))
            if value:
                _append_digest_line(lines, f"{label}: {value}")
        if kpi_id in {"perf_desktop_speed", "perf_mobile_speed"}:
            checked = _safe_int(
                evidence.get("pages_checked")
                or data.get("pages_checked")
                or data.get("headless_sample_size")
                or data.get("sample_size")
            )
            if checked <= 0:
                checked = len(valid_perf_rows) or len(raw_perf_rows)
            available = len(valid_perf_rows)
            if checked > 0:
                available = min(available, checked)
            _append_digest_line(lines, f"Pages testees: {checked}, mesures valides: {available}")
        if kpi_id == "perf_console_errors":
            _append_digest_line(lines, f"Pages avec erreurs console: {_safe_int(data.get('pages_with_console_errors'))}")
        if kpi_id == "perf_cache":
            _append_digest_line(lines, f"Cache-Control: {_digest_str(data.get('cache_control')) or 'non renseigné'}")
        if kpi_id == "perf_compression":
            _append_digest_line(lines, f"Compression HTTP: {_digest_str(data.get('html_compression_applied'))}")
        if kpi_id == "eco_index_score":
            _append_digest_line(lines, f"Score ecologique du KPI: {_safe_int(evidence.get('score_value'))} %")

    elif kpi_id.startswith("ux_"):
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items") or data.get("evidence")))
        if kpi_id == "ux_audience_targeting":
            counts = _safe_dict(data.get("counts"))
            _append_digest_line(lines, f"Segments detectes: {', '.join(f'{k}={v}' for k, v in counts.items()) if counts else 'non disponibles'}")
        elif kpi_id == "ux_social_sharing":
            _append_digest_line(lines, f"Pages avec partage social: {_safe_int(data.get('pages_with_social_sharing'))}")
            _append_digest_line(lines, f"Score moyen partage social: {_digest_str(data.get('avg_social_sharing_score'))}")
        elif kpi_id == "ux_design_ergonomics":
            _append_digest_line(lines, f"CLS moyen: {_digest_str(data.get('avg_cls'))}")
            _append_digest_line(lines, f"Pages sans image produit: {_safe_int(data.get('pages_missing_product_images'))}")
        elif kpi_id == "ux_navigation":
            _append_digest_line(lines, f"Pages avec funnels: {_safe_int(data.get('pages_with_conversion_funnels'))}")
        elif kpi_id == "ux_mobile_friendly":
            if not rows:
                rows = _unique_digest_rows([
                    {"page_url": url, "viewport": "mobile", "overflow": True, "layout_issue": "horizontal_overflow"}
                    for url in _safe_list(data.get("affected_page_urls"))
                ])
            _append_digest_line(lines, f"Pages mobiles testees: {_safe_int(data.get('pages_checked'))}")
            _append_digest_line(lines, f"Pages avec overflow mobile: {_safe_int(data.get('pages_with_mobile_overflow'))}")

    elif kpi_id.startswith("content_"):
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items") or data.get("examples")))
        if kpi_id == "content_freshness":
            _append_digest_line(lines, f"Derniere date: {_digest_str(data.get('latest_pub_date')) or 'non detectee'}")
            _append_digest_line(lines, f"Pages actualite: {_safe_int(data.get('news_page_count'))}")
        elif kpi_id == "content_thin":
            _append_digest_line(lines, f"Pages contenu fin: {_safe_int(data.get('pages_thin_content_nlp'))}")
            _append_digest_line(lines, f"Pages avec fautes: {_safe_int(data.get('pages_with_typos'))}")
            _append_digest_line(lines, f"Pages keyword stuffing: {_safe_int(data.get('pages_with_keyword_stuffing'))}")
        elif kpi_id == "content_key_pages":
            _append_digest_line(lines, f"Produits={_safe_int(data.get('product_page_count'))}, FAQ={_safe_int(data.get('faq_pages'))}, landing={_safe_int(data.get('landing_page_count'))}")
        elif kpi_id == "content_cannibalization":
            _append_digest_line(lines, f"Clusters cannibalises: {_safe_int(data.get('cannibalized_keyword_count'))}")
        elif kpi_id == "content_missing_cta":
            _append_digest_line(lines, f"Pages transactionnelles sans CTA: {_safe_int(data.get('transactional_no_cta_pages'))}")
        elif kpi_id == "content_broken_structure":
            _append_digest_line(lines, f"Pages structure elevee: {_safe_int(data.get('high_broken_structure_pages'))}")
        elif kpi_id == "content_lexical_diversity":
            _append_digest_line(lines, f"Diversite lexicale moyenne: {_digest_str(data.get('avg_lexical_diversity'))}")
            _append_digest_line(lines, f"Pages faibles: {_safe_int(data.get('low_lexical_diversity_pages'))}")

    elif kpi_id.startswith("rgpd_"):
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("snippets") or data.get("items")))
        for label, key in [
            ("Politique confidentialité", "has_privacy_policy"),
            ("Mentions légales", "has_legal_notice"),
            ("Droits mentionnés", "has_information_rights"),
            ("Finalité déclarée", "has_declared_purpose"),
            ("Pages rétention", "rgpd_retention_signal_pages"),
            ("Pages minimisation", "rgpd_minimization_signal_pages"),
            ("Pages avec droits faibles", "rights_low_pages"),
            ("Trackers pré-consentement", "pre_consent_violation_pages"),
            ("Score faible confidentialité", "privacy_score_low_pages"),
        ]:
            value = _digest_str(data.get(key))
            if value:
                _append_digest_line(lines, f"{label}: {value}")
        if kpi_id == "rgpd_cookie_consent":
            cc = _safe_dict(data)
            _append_digest_line(lines, f"Bannière/CMP détectée: {_digest_str(cc.get('has_banner') or cc.get('cmp_present')) or 'non'}")
            vendor = _digest_str(cc.get("vendor") or cc.get("cmp_vendor") or cc.get("cmp_name"))
            if vendor:
                _append_digest_line(lines, f"CMP: {vendor}")

    else:
        rows = _unique_digest_rows(_safe_list(data.get("rows") or data.get("items") or data.get("examples")))
        for key, value in list(evidence.items()) + list(data.items()):
            if key in _DIGEST_SKIP_KEYS or isinstance(value, (dict, list)) or _is_missing_field(value):
                continue
            rendered = _mask_digest_value(key, value)
            if rendered:
                _append_digest_line(lines, f"{key.replace('_', ' ')}: {rendered}")
            if len(lines) >= 5:
                break

    core_line_count = len(lines)

    if pages_checked > 0:
        _append_digest_line(lines, f"Pages vérifiées: {pages_checked}")
    if affected_pages > 0:
        _append_digest_line(lines, f"Éléments/pages concernés: {affected_pages}")

    urls = _collect_digest_urls(urls, rows, evidence)
    configured_columns = _safe_list(rule.get("csv_columns"))
    if rows and configured_columns:
        csv_columns = [key for key in configured_columns if any(key in row for row in rows)]
        for key in rows[0].keys():
            if key not in csv_columns:
                csv_columns.append(key)
        rows = _ordered_csv_rows(rows, csv_columns)
    else:
        csv_columns = list(rows[0].keys()) if rows else []

    has_meaningful_proof = bool(core_line_count > 0 or rows or urls)
    missing_required_rows = _issue_requires_rows(rule, status) and not rows
    missing_executed_probe = _executed_probe_missing(rule, status, rows, data, evidence)
    missing_not_evaluated_rows = (
        status == "not_evaluated"
        and _clean_text(rule.get("proof_type")).lower() == "rows"
        and not rows
    )
    if not has_meaningful_proof or missing_required_rows or missing_executed_probe or missing_not_evaluated_rows:
        quality = "MISSING"

    digest = {
        "quality": quality,
        "summary": lines[0] if lines else "",
        "proof_lines": lines[:8],
        "rows": rows[:200],
        "urls": urls,
        "affected_pages": affected_pages,
        "csv_columns": csv_columns,
        "csv_rows": rows[:500],
    }
    if rows:
        digest["top_items"] = [
            " | ".join(f"{key}={value}" for key, value in list(row.items())[:3])
            for row in rows[:5]
        ]
    if urls:
        digest["top_urls"] = urls[:5]
    if quality == "MISSING":
        digest["missing_reason"] = "Aucune preuve exploitable n'a été conservée pour ce KPI."
    if quality == "MISSING":
        digest["missing_reason"] = _coverage_missing_reason(rule)
    return digest


_KPI_TYPE_DEFAULTS = {
    "tech_cms_version": "bug",
    "tech_modules_versions": "recommendation",
    "tech_server_version": "bug",
    "tech_programming_language": "recommendation",
    "tech_cve_check": "bug",
    "sec_ssl": "bug",
    "sec_http_headers": "bug",
    "sec_session_cookies": "bug",
    "sec_sqli_ddos": "bug",
    "sec_admin_exposed": "bug",
    "sec_sensitive_files": "bug",
    "sec_version_disclosure": "bug",
    "sec_robots_disclosure": "bug",
    "sec_error_pages": "bug",
    "sec_brute_force": "bug",
    "sec_file_upload": "bug",
    "sec_js_deps": "bug",
    "sec_service_exposure": "bug",
    "sec_trace_track": "bug",
    "sec_cors_misconfiguration": "bug",
    "func_forms": "bug",
    "func_links": "bug",
    "func_buttons": "bug",
    "func_features": "recommendation",
    "func_search": "recommendation",
    "perf_desktop_speed": "recommendation",
    "perf_mobile_speed": "recommendation",
    "perf_image_optim": "recommendation",
    "perf_cache": "recommendation",
    "perf_compression": "recommendation",
    "perf_console_errors": "bug",
    "seo_alt_tags": "recommendation",
    "seo_meta_tags": "recommendation",
    "seo_sitemap": "recommendation",
    "seo_robots_txt": "recommendation",
    "seo_duplication": "recommendation",
    "seo_multi_browser": "recommendation",
    "seo_url_structure": "recommendation",
    "seo_heading_structure": "recommendation",
    "seo_internal_linking": "recommendation",
    "seo_external_linking": "recommendation",
    "seo_h1_quality": "recommendation",
    "seo_meta_nlp": "recommendation",
    "seo_ai_readiness": "recommendation",
    "ux_audience_targeting": "recommendation",
    "ux_social_sharing": "recommendation",
    "ux_design_ergonomics": "recommendation",
    "ux_navigation": "recommendation",
    "ux_mobile_friendly": "recommendation",
    "content_freshness": "recommendation",
    "content_thin": "recommendation",
    "content_key_pages": "recommendation",
    "content_cannibalization": "recommendation",
    "content_missing_cta": "recommendation",
    "content_broken_structure": "recommendation",
    "content_lexical_diversity": "recommendation",
    "eco_index_score": "recommendation",
    "rgpd_cookie_consent": "compliance",
    "rgpd_privacy_policy": "compliance",
    "rgpd_data_retention": "compliance",
    "rgpd_minimization": "compliance",
    "rgpd_legal_notice": "compliance",
    "rgpd_user_rights": "compliance",
    "rgpd_declared_purpose": "compliance",
    "rgpd_rights_coverage": "compliance",
    "rgpd_pre_consent_trackers": "compliance",
    "rgpd_privacy_score": "compliance",
}

_LATEST_VERSION_CATALOG = {
    "wordpress": {"latest_known_version": "6.8.1", "latest_version_source": "local_catalog_2026_04"},
    "drupal": {"latest_known_version": "11.2.5", "latest_version_source": "local_catalog_2026_04"},
    "joomla": {"latest_known_version": "5.3.1", "latest_version_source": "local_catalog_2026_04"},
    "prestashop": {"latest_known_version": "8.2.2", "latest_version_source": "local_catalog_2026_04"},
    "php": {"latest_known_version": "8.4.5", "latest_version_source": "local_catalog_2026_04"},
    "apache": {"latest_known_version": "2.4.63", "latest_version_source": "local_catalog_2026_04"},
    "apache http server": {"latest_known_version": "2.4.63", "latest_version_source": "local_catalog_2026_04"},
    "nginx": {"latest_known_version": "1.28.0", "latest_version_source": "local_catalog_2026_04"},
    "node": {"latest_known_version": "22.15.0", "latest_version_source": "local_catalog_2026_04"},
    "node.js": {"latest_known_version": "22.15.0", "latest_version_source": "local_catalog_2026_04"},
    "nodejs": {"latest_known_version": "22.15.0", "latest_version_source": "local_catalog_2026_04"},
}

_MODULE_VERSION_RULES = {
    "jquery": {
        "latest_known_version": "4.0.0",
        "minimum_safe_version": "3.5.0",
        "source": "official_jquery_cdn_2026_05",
        "risk": "Ancienne branche jQuery associee a des vulnerabilites de script connues.",
        "recommendation": "Mettre a jour jQuery vers une version maintenue (3.7.1 ou 4.0.0 selon compatibilite).",
    },
    "bootstrap": {
        "latest_known_version": "5.3.3",
        "minimum_safe_version": "4.6.2",
        "source": "offline_module_catalog_2026_04",
        "risk": "Ancienne branche Bootstrap potentiellement non maintenue ou exposee a des corrections manquantes.",
        "recommendation": "Migrer Bootstrap vers une branche maintenue apres verification de compatibilite.",
    },
    "vue js": {
        "latest_known_version": "3.5.13",
        "minimum_safe_version": "3.0.0",
        "source": "offline_module_catalog_2026_04",
        "risk": "Vue 2 est en fin de vie; les correctifs de securite ne sont plus garantis.",
        "recommendation": "Planifier la migration vers Vue 3.",
    },
    "vue": {
        "latest_known_version": "3.5.13",
        "minimum_safe_version": "3.0.0",
        "source": "offline_module_catalog_2026_04",
        "risk": "Vue 2 est en fin de vie; les correctifs de securite ne sont plus garantis.",
        "recommendation": "Planifier la migration vers Vue 3.",
    },
    "angular": {
        "latest_known_version": "19.2.0",
        "minimum_safe_version": "15.0.0",
        "source": "offline_module_catalog_2026_04",
        "risk": "Ancienne branche Angular potentiellement hors support.",
        "recommendation": "Verifier la branche Angular et planifier une mise a jour maintenue.",
    },
    "react": {
        "latest_known_version": "19.0.0",
        "minimum_safe_version": "16.14.0",
        "source": "offline_module_catalog_2026_04",
        "risk": "Tres ancienne version React; compatibilite et maintenance a verifier.",
        "recommendation": "Verifier la branche React et appliquer les mises a jour de maintenance.",
    },
}


def _missing_field(reason: str) -> dict:
    return {"value": None, "status": "MISSING", "reason": reason}


def _is_missing_field(value) -> bool:
    return isinstance(value, dict) and value.get("status") == "MISSING" and "value" in value


def _clean_text(value) -> str:
    if isinstance(value, str):
        return value.strip()
    if value is None:
        return ""
    return str(value).strip()


def _display_value(value, fallback: str = "non détecté") -> str:
    if _is_missing_field(value):
        return fallback
    rendered = _clean_text(value)
    return rendered or fallback


def _unique_strings(values) -> list:
    unique = []
    for value in _safe_list(values):
        text = _clean_text(value)
        if text and text not in unique:
            unique.append(text)
    return unique


def _value_or_missing(value, reason: str, empty_is_missing: bool = True):
    if value is None:
        return _missing_field(reason)
    if isinstance(value, str) and not value.strip():
        return _missing_field(reason)
    if empty_is_missing and isinstance(value, (list, dict)) and len(value) == 0:
        return _missing_field(reason)
    return value


def _normalize_contract_status(v1_status: str) -> str:
    status = _clean_text(v1_status).lower()
    if status in {"passing", "pass", "covered"}:
        return "passing"
    if status in {"failing", "fail", "failed"}:
        return "failing"
    if status == "warning":
        return "warning"
    if status in {"non_evalue", "not_available", "not available", "not-evaluated", "not_evaluated"}:
        return "not_evaluated"
    return "not_evaluated"


def _compare_versions(left: str, right: str) -> Optional[int]:
    left_parts = [int(part) for part in re.findall(r"\d+", str(left or ""))]
    right_parts = [int(part) for part in re.findall(r"\d+", str(right or ""))]
    if not left_parts or not right_parts:
        return None
    max_len = max(len(left_parts), len(right_parts))
    left_parts += [0] * (max_len - len(left_parts))
    right_parts += [0] * (max_len - len(right_parts))
    if left_parts < right_parts:
        return -1
    if left_parts > right_parts:
        return 1
    return 0


def _lookup_latest_version(product_name: str):
    normalized = re.sub(r"[^a-z0-9]+", " ", _clean_text(product_name).lower()).strip()
    if not normalized:
        return None
    aliases = {
        "apache httpd": "apache",
        "apache http server": "apache",
        "httpd": "apache",
        "node js": "node.js",
        "nodejs": "node.js",
    }
    key = aliases.get(normalized, normalized)
    return _LATEST_VERSION_CATALOG.get(key)


def _normalize_product_key(product_name: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", _clean_text(product_name).lower()).strip()
    aliases = {
        "vue js": "vue js",
        "vuejs": "vue js",
        "vue": "vue",
        "jquery": "jquery",
        "bootstrap": "bootstrap",
        "angular": "angular",
        "react": "react",
    }
    return aliases.get(normalized, normalized)


def _verify_module_version(module: dict) -> dict:
    name = _clean_text(module.get("name") or module.get("module") or module.get("library"))
    version = _clean_text(module.get("version"))
    source = _clean_text(module.get("source"))
    key = _normalize_product_key(name)
    rule = _MODULE_VERSION_RULES.get(key)
    result = {
        "module": name or "module non identifie",
        "name": name or "module non identifie",
        "version": version or "non detectee",
        "source": source or "scan automatique",
        "verification_source": "catalogue local" if rule else "aucune regle disponible",
        "verification_result": "non_verifie",
        "risk": "Version detectee mais non verifiee par le catalogue de securite.",
        "recommendation": "Verifier manuellement la version exposee avant de conclure.",
        "latest_known_version": None,
        "minimum_safe_version": None,
    }
    if not name or not version:
        result["verification_result"] = "donnees_incompletes"
        result["risk"] = "Nom ou version du module incomplet."
        return result
    if not rule:
        return result

    result["verification_source"] = rule.get("source", "catalogue local")
    result["latest_known_version"] = rule.get("latest_known_version")
    result["minimum_safe_version"] = rule.get("minimum_safe_version")
    min_safe = rule.get("minimum_safe_version")
    latest = rule.get("latest_known_version")
    cmp_min = _compare_versions(version, min_safe) if min_safe else None
    cmp_latest = _compare_versions(version, latest) if latest else None

    if cmp_min == -1:
        result["verification_result"] = "risque_confirme"
        result["risk"] = rule.get("risk", "Version inferieure au seuil de securite local.")
        result["recommendation"] = rule.get("recommendation", "Mettre a jour le module.")
    elif cmp_latest == 0:
        result["verification_result"] = "verifie_conforme"
        result["risk"] = "Aucun risque connu dans le catalogue local pour cette version."
        result["recommendation"] = "Maintenir la veille de securite sur ce module."
    else:
        result["verification_result"] = "a_verifier"
        result["risk"] = "Version au-dessus du seuil minimal local, mais pas confirmee comme derniere version maintenue."
        result["recommendation"] = "Verifier la branche de maintenance et appliquer les correctifs disponibles si necessaire."
    return result


def _evaluate_module_versions(modules: list) -> dict:
    verified_rows = [
        _verify_module_version(_safe_dict(module))
        for module in _safe_list(modules)
        if isinstance(module, dict)
    ]
    risky = [row for row in verified_rows if row.get("verification_result") == "risque_confirme"]
    uncertain = [
        row for row in verified_rows
        if row.get("verification_result") in {"non_verifie", "donnees_incompletes", "a_verifier"}
    ]
    safe = [row for row in verified_rows if row.get("verification_result") == "verifie_conforme"]

    if risky:
        status = "failing"
        severity = "high"
    elif verified_rows and len(safe) == len(verified_rows):
        status = "passing"
        severity = None
    elif uncertain:
        # Modules were detected but cannot be fully evaluated (not in local catalogue,
        # or version data incomplete). This is inconclusive, not untested.
        status = "warning"
        severity = "medium"
    else:
        # Truly empty module list — scan ran but found nothing to evaluate
        status = "not_available"
        severity = None

    return {
        "status": status,
        "severity": severity,
        "rows": verified_rows,
        "module_count": len(verified_rows),
        "risky_count": len(risky),
        "safe_count": len(safe),
        "uncertain_count": len(uncertain),
        "verification_mode": "hybrid_offline_first",
        "live_advisory_status": "non_configure",
        "failure_reason": "cms_modules_not_extractable" if not verified_rows else None,
        "data_quality": "MISSING" if not verified_rows else ("PARTIAL" if uncertain else "VALID"),
    }


def _downgrade_confidence(level: str, steps: int = 1) -> str:
    order = ["low", "medium", "high"]
    current = _clean_text(level).lower() or "medium"
    if current not in order:
        current = "medium"
    index = max(order.index(current) - max(steps, 0), 0)
    return order[index]


def _contract_detection_sources(kpi_id: str) -> list:
    if kpi_id == "func_forms":
        return ["form_fuzzer", "scanner_aggregation"]
    if kpi_id == "func_buttons":
        return ["headless_probe", "scanner_aggregation"]
    if kpi_id == "func_links":
        return ["crawler_link_check", "scanner_aggregation"]
    if kpi_id == "sec_ssl":
        return ["ssl_probe"]
    if kpi_id in {"sec_http_headers", "sec_session_cookies"}:
        return ["http_response_headers"]
    if kpi_id == "tech_modules_versions":
        return ["scanner_aggregation", "module_version_catalog"]

    if kpi_id == "sec_service_exposure":
        return ["tcp_probe", "scanner_aggregation"]
    if kpi_id in {"sec_trace_track", "sec_cors_misconfiguration"}:
        return ["http_probe", "security_analyzer"]
    if kpi_id in {"sec_version_disclosure", "sec_robots_disclosure", "sec_error_pages", "sec_brute_force", "sec_file_upload", "sec_js_deps"}:
        return ["security_analyzer", "scanner_aggregation"]
    if kpi_id in {"seo_meta_tags", "seo_alt_tags", "seo_heading_structure", "seo_internal_linking"}:
        return ["scanner_aggregation", "nlp"]
    if kpi_id in {"seo_sitemap", "seo_robots_txt"}:
        return ["http_probe"]
    if kpi_id in {"tech_cms_version", "tech_server_version", "tech_programming_language", "tech_cve_check"}:
        return ["scanner_aggregation", "stack_fingerprint"]
    return ["scanner_aggregation"]


def _derive_pages_checked(kpi_id: str, pages_scanned: int, data: dict, affected_urls: list) -> int:
    if kpi_id in {
        "tech_cms_version", "tech_modules_versions", "tech_server_version", "tech_programming_language",
        "tech_cve_check", "sec_ssl", "sec_http_headers", "sec_session_cookies", "sec_sqli_ddos",
        "sec_admin_exposed", "sec_sensitive_files", "sec_version_disclosure", "sec_robots_disclosure", "sec_error_pages",
        "sec_brute_force", "sec_file_upload", "sec_js_deps", "sec_service_exposure", "sec_trace_track",
        "sec_cors_misconfiguration", "seo_sitemap", "seo_robots_txt",
    }:
        return 1
    if kpi_id == "func_forms":
        return max(len(_unique_strings(data.get("affected_page_urls"))), _safe_int(data.get("forms_tested")), _safe_int(data.get("total_forms")), 0)
    if affected_urls:
        return len(affected_urls)
    return max(_safe_int(pages_scanned), 1)


def _normalize_anomalous_test_row(row: dict) -> dict:
    payload = row.get("payload") if isinstance(row, dict) and "payload" in row else None
    return {
        "page_url": _value_or_missing(_clean_text(row.get("page_url")) if isinstance(row, dict) else "", "URL de page absente pour le test de formulaire"),
        "action_url": _value_or_missing(_clean_text(row.get("action_url")) if isinstance(row, dict) else "", "URL d'action du formulaire absente"),
        "form_id": _value_or_missing(_clean_text(row.get("form_id")) if isinstance(row, dict) else "", "Identifiant du formulaire absent"),
        "test_type": _value_or_missing(_clean_text(row.get("test_type")) if isinstance(row, dict) else "", "Type de test absent"),
        "payload": payload if payload not in (None, "") else _missing_field("Payload de fuzzing absent dans le résultat stocké"),
        "response_type": _value_or_missing(_clean_text(row.get("response_type")) if isinstance(row, dict) else "", "Type de réponse absent"),
        "status_code": row.get("status_code") if isinstance(row, dict) and row.get("status_code") is not None else _missing_field("Code HTTP absent"),
        "anomaly": _value_or_missing(_clean_text(row.get("anomaly")) if isinstance(row, dict) else "", "Nom du signal absent"),
        "anomaly_reason": _value_or_missing(_clean_text(row.get("anomaly_reason")) if isinstance(row, dict) else "", "Raison du signal absente"),
        "duration_ms": row.get("duration_ms") if isinstance(row, dict) and row.get("duration_ms") is not None else _missing_field("Durée d'exécution absente"),
        "error": _clean_text(row.get("error")) if isinstance(row, dict) and row.get("error") is not None else "",
    }


def _build_contract_evidence(kpi_id: str, kpi_obj: dict, pages_scanned: int, domain_url: str):
    data = _safe_dict(kpi_obj.get("data", {}))
    affected_pages = _safe_int(kpi_obj.get("pages_affected", 0))
    affected_urls = _unique_strings(kpi_obj.get("pages_affected_urls", []))
    evidence = {
        "detection_source": _contract_detection_sources(kpi_id),
        "pages_checked": _derive_pages_checked(kpi_id, pages_scanned, data, affected_urls),
        "affected_pages": affected_pages,
    }
    data_quality = "VALID"
    status_override = None
    confidence_penalty = 0

    if kpi_id in {"perf_desktop_speed", "perf_mobile_speed"}:
        rows = _performance_digest_rows(data)
        valid_rows = [row for row in rows if _is_valid_performance_digest_row(row)]
        pages_checked = _safe_int(
            data.get("pages_checked")
            or data.get("headless_sample_size")
            or data.get("sample_size")
            or len(rows)
        )
        if pages_checked <= 0:
            pages_checked = len(valid_rows)
        if not valid_rows:
            data_quality = "MISSING"
            status_override = "not_evaluated"
            confidence_penalty = 2
        elif pages_checked > len(valid_rows):
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "pages_checked": pages_checked,
            "valid_measurement_count": len(valid_rows),
            "measurement_row_count": len(rows),
            "valid_measurement_rows": valid_rows[:200],
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_meta_nlp":
        rows = _safe_list(data.get("rows") or data.get("items"))
        quality_rows = [
            _safe_dict(row)
            for row in rows
            if _safe_dict(row).get("issue") in {"title_too_long", "meta_too_short", "meta_too_long"}
        ]
        meta_missing_pages = _safe_int(data.get("meta_missing_pages"))
        quality_issue_pages = _safe_int(data.get("meta_quality_issue_pages"))
        if quality_issue_pages <= 0:
            quality_issue_pages = len({
                _clean_text(row.get("page_url"))
                for row in quality_rows
                if _clean_text(row.get("page_url"))
            })
        if quality_issue_pages > 0:
            status_override = "failing"
        else:
            status_override = "passing"
        evidence.update({
            "data_quality": data_quality,
            "pages_checked": max(_safe_int(data.get("pages_checked")), len(rows), quality_issue_pages, 1),
            "affected_pages": quality_issue_pages,
            "meta_quality_issue_pages": quality_issue_pages,
            "title_too_long_pages": _safe_int(data.get("title_too_long_pages")),
            "meta_missing_pages": meta_missing_pages,
            "meta_missing_owned_by": data.get("meta_missing_owned_by") or "seo_meta_tags",
            "quality_rows": quality_rows[:200],
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "func_forms":
        forms_detected = _safe_int(data.get("forms_detected") or data.get("unique_transactional_forms_detected") or data.get("total_forms"))
        forms_tested = _safe_int(data.get("forms_tested") or data.get("unique_transactional_forms_tested"))
        non_transactional_forms_tested = _safe_int(data.get("non_transactional_forms_tested"))
        tests_run = _safe_int(data.get("tests_run"))
        anomalies_count = _safe_int(data.get("anomalies") or data.get("anomalies_count"))
        suppressed_low_confidence_anomalies = _safe_int(data.get("suppressed_low_confidence_anomalies"))
        anomalies_by_type = _safe_dict(data.get("anomalies_by_type"))
        affected_page_urls_all = _unique_strings(data.get("affected_page_urls", [])) or _unique_strings([
            _safe_dict(item).get("page_url") for item in _safe_list(data.get("top_affected", []))
        ])
        anomalous_tests_raw = _safe_list(data.get("anomalous_tests_all", []))
        anomalous_tests_all = [_normalize_anomalous_test_row(_safe_dict(row)) for row in anomalous_tests_raw]

        if forms_detected > 0 and forms_tested == 0:
            status_override = "not_evaluated"
            data_quality = "MISSING"
            confidence_penalty = 2
        elif forms_detected > forms_tested and forms_tested > 0:
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 1)
        elif anomalies_count > 0 and forms_tested > 0:
            status_override = "failing"
        elif forms_tested > 0 and anomalies_count == 0:
            status_override = "passing"
        elif forms_detected == 0:
            status_override = "not_evaluated"
            data_quality = "MISSING"
            confidence_penalty = 2

        evidence.update({
            "data_quality": data_quality,
            "forms_detected": forms_detected,
            "forms_tested": forms_tested,
            "non_transactional_forms_tested": non_transactional_forms_tested,
            "tests_run": tests_run,
            "anomalies_count": anomalies_count,
            "suppressed_low_confidence_anomalies": suppressed_low_confidence_anomalies,
            "anomalies_by_type": anomalies_by_type if anomalies_by_type or anomalies_count == 0 else _missing_field("Le détail des signaux par type n'a pas été conservé"),
            "affected_page_urls_all": affected_page_urls_all if affected_page_urls_all or forms_detected == 0 else _missing_field("Aucune URL de page formulaire n'a été conservée"),
            "anomalous_tests_all": anomalous_tests_all if anomalous_tests_all or anomalies_count == 0 else _missing_field("Les payloads de fuzzing anormaux n'ont pas été conservés"),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "func_buttons":
        broken_buttons = []
        for row in _safe_list(data.get("broken_buttons", [])):
            if not isinstance(row, dict):
                continue
            broken_buttons.append({
                "page_url": _value_or_missing(_clean_text(row.get("url")), "URL de la page du bouton absente"),
                "selector": _value_or_missing(_clean_text(row.get("selector")), "Sélecteur du bouton absent"),
                "label_or_text": _value_or_missing(_clean_text(row.get("label") or row.get("text")), "Texte du bouton absent"),
                "tag": _value_or_missing(_clean_text(row.get("tag")), "Balise HTML du bouton absente"),
                "href": row.get("href") if row.get("href") not in (None, "") else _missing_field("Aucun href détecté"),
                "onclick": row.get("onclick") if row.get("onclick") not in (None, "") else _missing_field("Aucun gestionnaire onclick détecté"),
                "form_action": row.get("form_action") if row.get("form_action") not in (None, "") else _missing_field("Aucune action de formulaire associée"),
                "issue_type": _value_or_missing(_clean_text(row.get("issue_type")), "Type de signal du bouton absent"),
            })
        affected_page_urls_all = _unique_strings([_clean_text(row.get("url")) for row in _safe_list(data.get("broken_buttons", [])) if isinstance(row, dict)])
        if _safe_int(data.get("total_broken_buttons")) > 0 and not broken_buttons:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        elif any(_is_missing_field(row.get("page_url")) or _is_missing_field(row.get("selector")) for row in broken_buttons):
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "pages_with_nonfunc_buttons": _safe_int(data.get("pages_with_nonfunc_buttons")),
            "total_broken_buttons": _safe_int(data.get("total_broken_buttons")),
            "affected_page_urls_all": affected_page_urls_all if affected_page_urls_all or _safe_int(data.get("total_broken_buttons")) == 0 else _missing_field("Les URLs des pages affectées n'ont pas été conservées"),
            "broken_buttons_all": broken_buttons if broken_buttons or _safe_int(data.get("total_broken_buttons")) == 0 else _missing_field("Le détail des boutons cassés n'a pas été conservé"),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "func_links":
        broken_links = []
        for row in _safe_list(data.get("broken_links", [])):
            if not isinstance(row, dict):
                continue
            broken_links.append({
                "source_page": _value_or_missing(_clean_text(row.get("source_page")), "Page source du lien absente"),
                "target_url": _value_or_missing(_clean_text(row.get("url")), "URL cible du lien absente"),
                "anchor_text": row.get("anchor_text") if row.get("anchor_text") not in (None, "") else _missing_field("Texte d'ancrage absent"),
                "status_code": row.get("status_code") if row.get("status_code") is not None else _missing_field("Code HTTP absent"),
                "error": _clean_text(row.get("error")) if row.get("error") is not None else "",
                "link_selector": row.get("link_selector") if row.get("link_selector") not in (None, "") else _missing_field("Sélecteur du lien absent"),
            })
        affected_page_urls_all = _unique_strings([_clean_text(row.get("source_page")) for row in _safe_list(data.get("broken_links", [])) if isinstance(row, dict)])
        if affected_pages > 0 and not broken_links:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "broken_internal_link_count": _safe_int(data.get("broken_link_count")),
            "broken_links_all": broken_links if broken_links or affected_pages == 0 else _missing_field("Le détail des liens cassés n'a pas été conservé"),
            "affected_page_urls_all": affected_page_urls_all if affected_page_urls_all or affected_pages == 0 else _missing_field("Les pages sources des liens cassés n'ont pas été conservées"),
            "by_status": _safe_dict(data.get("by_status")),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "sec_service_exposure":
        enabled = bool(data.get("enabled"))
        host = _clean_text(data.get("host"))
        timeout_ms = _safe_int(data.get("timeout_ms"))
        ports_scanned = []
        for port in _safe_list(data.get("ports_scanned", [])):
            try:
                value = int(port)
            except (TypeError, ValueError):
                continue
            if value > 0:
                ports_scanned.append(value)

        open_services_all = []
        critical_open_count = 0
        high_open_count = 0
        for row in _safe_list(data.get("open_services", [])):
            svc = _safe_dict(row)
            risk = _clean_text(svc.get("risk")).lower()
            if risk == "critical":
                critical_open_count += 1
            elif risk == "high":
                high_open_count += 1
            open_services_all.append({
                "port": svc.get("port") if svc.get("port") is not None else _missing_field("Port absent dans le résultat"),
                "service": _value_or_missing(_clean_text(svc.get("service")), "Nom de service absent"),
                "state": _value_or_missing(_clean_text(svc.get("state")), "État du port absent"),
                "risk": _value_or_missing(_clean_text(svc.get("risk")), "Niveau de risque absent"),
                "banner": _clean_text(svc.get("banner")) if svc.get("banner") is not None else "",
                "note": _clean_text(svc.get("note")) if svc.get("note") is not None else "",
            })

        open_service_count = len(open_services_all)
        status_raw = _clean_text(data.get("status")).lower()
        warning = _clean_text(data.get("warning"))
        error = _clean_text(data.get("error"))

        if not enabled:
            status_override = "not_evaluated"
        elif status_raw in {"non_evalue", "not_evaluated", "not-evaluated", "not_available"}:
            status_override = "not_evaluated"
        elif status_raw in {"failing", "fail", "failed"}:
            status_override = "failing"
        elif status_raw == "warning":
            status_override = "warning"
        elif status_raw in {"passing", "pass", "covered"}:
            status_override = "passing"
        elif critical_open_count > 0:
            status_override = "failing"
        elif high_open_count > 0 or open_service_count > 0:
            status_override = "warning"
        else:
            status_override = "passing"

        if enabled and not host:
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 1)
        if enabled and not ports_scanned:
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 1)
        if error and status_override == "not_evaluated":
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 1)

        evidence.update({
            "data_quality": data_quality,
            "enabled": enabled,
            "host": _value_or_missing(host, "Hôte de scan non déterminé") if enabled else _missing_field("Scan de ports désactivé"),
            "timeout_ms": timeout_ms if timeout_ms > 0 else _missing_field("Timeout du scan non renseigné"),
            "ports_scanned": ports_scanned if ports_scanned else _missing_field("Liste des ports scannés absente"),
            "open_service_count": open_service_count,
            "critical_open_service_count": critical_open_count,
            "high_open_service_count": high_open_count,
            "open_services_all": open_services_all if open_services_all else [],
            "status_raw": status_raw or _missing_field("Statut brut du scanner absent"),
            "warning": warning,
            "error": error,
            "impact": _clean_text(data.get("impact")),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_meta_tags":
        meta_missing_count = _safe_int(data.get("pages_missing_meta_desc"))
        title_missing_count = _safe_int(data.get("pages_missing_title"))
        meta_urls = _unique_strings(data.get("affected_pages_meta", []))
        title_urls = _unique_strings(data.get("affected_pages_title", []))
        if (meta_missing_count > 0 and not meta_urls) or (title_missing_count > 0 and not title_urls):
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "meta_missing_count": meta_missing_count,
            "title_missing_count": title_missing_count,
            "meta_missing_urls_all": meta_urls if meta_urls or meta_missing_count == 0 else _missing_field("Les URLs sans meta description n'ont pas été conservées"),
            "title_missing_urls_all": title_urls if title_urls or title_missing_count == 0 else _missing_field("Les URLs sans balise title n'ont pas été conservées"),
        })
        evidence["affected_pages"] = max(len(_unique_strings(meta_urls + title_urls)), affected_pages)
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_alt_tags":
        missing_alt_count = _safe_int(data.get("images_missing_alt"))
        images = []
        page_urls = []
        for row in _safe_list(data.get("images", [])):
            if not isinstance(row, dict):
                continue
            page_url = _clean_text(row.get("page_url") or row.get("url"))
            image_url = _clean_text(row.get("image_url") or row.get("src"))
            if page_url:
                page_urls.append(page_url)
            images.append({
                "page_url": _value_or_missing(page_url, "Page source de l'image absente"),
                "image_url": _value_or_missing(image_url, "URL de l'image absente"),
                "alt_value": row.get("alt") if row.get("alt") not in (None, "") else _missing_field("Attribut alt absent"),
                "selector": row.get("selector") if row.get("selector") not in (None, "") else _missing_field("Sélecteur de l'image absent"),
            })
        page_urls = _unique_strings(page_urls)
        if missing_alt_count > 0 and (not images or not page_urls):
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "missing_alt_image_count": missing_alt_count,
            "missing_alt_page_urls_all": page_urls if page_urls or missing_alt_count == 0 else _missing_field("Les pages contenant des images sans ALT n'ont pas été conservées"),
            "missing_alt_images_all": images if images or missing_alt_count == 0 else _missing_field("Le détail des images sans ALT n'a pas été conservé"),
        })
        evidence["affected_pages"] = max(len(page_urls), affected_pages)
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_heading_structure":
        bad_h1_count = _safe_int(data.get("pages_with_bad_h1"))
        bad_h1_urls = _unique_strings(data.get("bad_h1_urls", []))
        homepage_h1_missing = bool(data.get("homepage_h1_missing"))
        homepage_url = _clean_text(data.get("homepage_url") or domain_url)
        if homepage_h1_missing and homepage_url and homepage_url not in bad_h1_urls:
            bad_h1_urls = [homepage_url] + bad_h1_urls
        if bad_h1_count > 0 and not bad_h1_urls:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "bad_h1_page_count": bad_h1_count,
            "bad_h1_urls_all": bad_h1_urls if bad_h1_urls or bad_h1_count == 0 else _missing_field("Les URLs avec H1 invalide n'ont pas été conservées"),
            "homepage_h1_missing": homepage_h1_missing,
            "homepage_url": homepage_url if homepage_url else _missing_field("URL de la page d'accueil absente"),
        })
        evidence["affected_pages"] = max(len(bad_h1_urls), bad_h1_count)
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_internal_linking":
        missing_count = _safe_int(data.get("pages_missing_contextual_links"))
        urls = _unique_strings(data.get("pages_missing_contextual_links_all", []))
        total_internal_links = _safe_int(data.get("total_internal_links"))
        total_contextual_links = _safe_int(data.get("total_contextual_internal_links"))
        internal_linking_source = _clean_text(data.get("internal_linking_source"))
        internal_linking_note = _clean_text(data.get("internal_linking_note"))
        measurement = dict(_safe_dict(data.get("contextual_link_measurement")))
        pages_checked = _safe_int(measurement.get("pages_checked"))
        reliable_coverage_pct = _safe_float(measurement.get("reliable_coverage_pct"))
        if missing_count > 0 and not urls:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        if total_internal_links == 0 and total_contextual_links > 0:
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 1)
            if status_override is None and missing_count > 0:
                status_override = "warning"
        if reliable_coverage_pct and reliable_coverage_pct < 50.0:
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 2)
            status_override = "not_evaluated"
        sitewide_zero_contextual_suspect = (
            pages_checked > 0
            and reliable_coverage_pct >= 90.0
            and total_internal_links > 0
            and total_contextual_links == 0
            and missing_count * 10 >= pages_checked * 9
        )
        if sitewide_zero_contextual_suspect:
            data_quality = "PARTIAL"
            confidence_penalty = max(confidence_penalty, 2)
            if status_override is None and missing_count > 0:
                status_override = "warning"
            if not internal_linking_note:
                internal_linking_note = "Le recomptage remonte 0 lien contextuel malgré un volume élevé de liens internes. Le résultat est traité comme une alerte de qualité de données plutôt qu'un échec confirmé."
            measurement["sitewide_zero_contextual_suspect"] = True
        if internal_linking_source == "page_recount" and not internal_linking_note:
            internal_linking_note = "Le total des liens internes provient d'un recomptage page-par-page (agrégat scanner absent)."
        evidence.update({
            "data_quality": data_quality,
            "pages_missing_contextual_links_count": missing_count,
            "pages_missing_contextual_links_all": urls if urls or missing_count == 0 else _missing_field("Les URLs sans liens contextuels n'ont pas été conservées"),
            "total_internal_links": total_internal_links,
            "total_contextual_internal_links": total_contextual_links,
            "internal_linking_source": internal_linking_source or _missing_field("Source de comptage des liens internes non spécifiée"),
            "contextual_link_measurement": measurement,
            "note": internal_linking_note,
        })
        evidence["affected_pages"] = max(len(urls), missing_count)
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_url_structure":
        non_clean_count = _safe_int(data.get("node_style_url_count"))
        non_clean_urls = _unique_strings(data.get("non_clean_urls_all", []))
        if non_clean_count > 0 and not non_clean_urls:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "non_clean_url_count": non_clean_count,
            "non_clean_urls_all": non_clean_urls if non_clean_urls or non_clean_count == 0 else _missing_field("Le scanner a remonté un volume agrégé sans conserver la liste des URLs"),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "seo_sitemap":
        detected = bool(data.get("has_sitemap"))
        evidence.update({
            "data_quality": "VALID",
            "sitemap_detected": detected,
            "sitemap_url": _clean_text(data.get("sitemap_url")) or (f"{domain_url.rstrip('/')}/sitemap.xml" if detected and domain_url else _missing_field("Aucun sitemap.xml n'a été détecté à la racine du domaine")),
            "detected_via": _clean_text(data.get("sitemap_detected_via")) or (_missing_field("Aucune provenance de détection du sitemap n'a été conservée") if detected else _missing_field("Aucun sitemap détecté")),
        })
        return evidence, "VALID", status_override, confidence_penalty

    if kpi_id == "seo_robots_txt":
        detected = bool(data.get("has_robots_txt"))
        evidence.update({
            "data_quality": "VALID",
            "robots_detected": detected,
            "robots_url": _clean_text(data.get("robots_url")) or (f"{domain_url.rstrip('/')}/robots.txt" if detected and domain_url else _missing_field("Aucun robots.txt n'a été détecté à la racine du domaine")),
            "detected_via": _clean_text(data.get("robots_detected_via")) or (_missing_field("Aucune provenance de détection du robots.txt n'a été conservée") if detected else _missing_field("Aucun robots.txt détecté")),
        })
        return evidence, "VALID", status_override, confidence_penalty

    if kpi_id == "seo_duplication":
        duplicate_rate = _safe_float(data.get("duplicate_content_rate_pct"))
        duplicate_page_count = _safe_int(data.get("duplicate_page_count"))
        hash_eligible_pages = _safe_int(data.get("hash_eligible_pages"))
        hash_low_conf_pages = _safe_int(data.get("hash_low_confidence_pages"))
        duplication_reliability = _clean_text(data.get("duplication_reliability")).lower()
        pipeline_suspect = bool(data.get("pipeline_suspect")) or duplication_reliability == "pipeline_suspect"
        duplication_note = _clean_text(data.get("note"))
        duplicate_clusters = _safe_list(data.get("duplicate_clusters", [])) or _safe_list(data.get("duplicate_groups", []))
        if hash_eligible_pages == 0 and pages_scanned > 0:
            data_quality = "MISSING"
            confidence_penalty = 2
            status_override = "not_evaluated"
        elif pipeline_suspect:
            data_quality = "PARTIAL"
            confidence_penalty = 2
            status_override = "not_evaluated"
        elif duplicate_page_count > 0 and not duplicate_clusters:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "duplicate_content_rate_pct": duplicate_rate,
            "duplicate_page_count": duplicate_page_count,
            "hash_eligible_pages": hash_eligible_pages,
            "hash_low_confidence_pages": hash_low_conf_pages,
            "duplication_reliability": duplication_reliability or _missing_field("Niveau de fiabilité de la duplication non fourni"),
            "pipeline_suspect": pipeline_suspect,
            "note": duplication_note,
            "duplicate_clusters_all": duplicate_clusters if duplicate_clusters or duplicate_page_count == 0 else _missing_field("Les groupes de duplication n'ont pas été conservés dans l'agrégat"),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id in {"tech_cms_version", "tech_server_version"}:
        if kpi_id == "tech_server_version":
            product = _clean_text(data.get("server_tech"))
            version = _clean_text(data.get("server_version"))
            eol = None
            explicit_support_status = _clean_text(data.get("server_support_status"))
        else:
            product = _clean_text(data.get("cms_name"))
            version = _clean_text(data.get("cms_version"))
            eol = data.get("cms_eol")
            explicit_support_status = _clean_text(data.get("cms_support_status"))
        version_label = "Branche detectee" if re.match(r"^\d+\.x$", version, re.IGNORECASE) else "Version detectee"
        support_status = explicit_support_status or ("end_of_life" if eol is True else "supported" if eol is False else _missing_field("Le statut de support n'a pas été déterminé par le scan"))
        latest = _lookup_latest_version(product)
        latest_version = latest.get("latest_known_version") if latest else None
        comparison = None
        if version and latest_version:
            cmp = _compare_versions(version, latest_version)
            comparison = "behind_latest" if cmp == -1 else "current_or_newer" if cmp in {0, 1} else None
        if not product:
            data_quality = "MISSING"
            confidence_penalty = 2
        elif not version:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        elif kpi_id == "tech_cms_version" and _is_missing_field(support_status):
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "detected_product": _value_or_missing(product, "Produit ou technologie non détecté(e)"),
            "detected_version": _value_or_missing(version, "Version non détectée"),
            "version_label": version_label,
            "support_status": support_status,
            "eol": eol if eol is not None else _missing_field("Fin de support inconnue"),
            "latest_known_version": latest_version if latest_version else _missing_field("Aucune version de référence maintenue localement pour ce produit"),
            "latest_version_source": latest.get("latest_version_source") if latest else _missing_field("Catalogue local absent pour ce produit"),
            "comparison_result": comparison if comparison else _missing_field("Comparaison impossible sans version détectée et version de référence"),
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "tech_programming_language":
        language = _clean_text(data.get("language") or data.get("programming_language"))
        language_version = _clean_text(data.get("language_version") or data.get("programming_language_version"))
        language_inferred = bool(data.get("language_inferred"))
        server_tech = _clean_text(data.get("server_tech"))
        server_version = _clean_text(data.get("server_version"))
        cms_name = _clean_text(data.get("cms_name"))
        cms_version = _clean_text(data.get("cms_version"))
        context_product = language or server_tech or cms_name
        context_version = language_version if language else (server_version or cms_version)
        latest = _lookup_latest_version(language)
        evidence.update({
            "detected_product": _value_or_missing(context_product, "Langage ou runtime non détecté"),
            "detected_version": _value_or_missing(context_version, "Version du langage non détectée"),
            "detection_label": "Langage détecté" if language else "Serveur détecté" if server_tech else "Système de gestion détecté" if cms_name else "Langage détecté",
            "detection_note": "Langage détecté directement par le scan" if language else "Langage non exposé directement; contexte technique partiel détecté",
            "support_status": _missing_field("Le statut de support du runtime n'est pas disponible dans cet agrégat"),
            "eol": _missing_field("La date de fin de support n'est pas disponible dans cet agrégat"),
            "latest_known_version": latest.get("latest_known_version") if latest else _missing_field("Aucune version de référence maintenue localement pour ce runtime"),
            "latest_version_source": latest.get("latest_version_source") if latest else _missing_field("Catalogue local absent pour ce runtime"),
            "comparison_result": _missing_field("Comparaison impossible sans version de référence fiable"),
        })
        if language_inferred:
            evidence["detection_label"] = "Langage infere"
            evidence["detection_note"] = "Langage deduit depuis le systeme de gestion du site; version a verifier."
            evidence["language_inferred"] = True
            data_quality = "PARTIAL"
            status_override = "not_evaluated"
            confidence_penalty = 1
        elif not language and context_product:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        elif not language:
            data_quality = "MISSING"
            confidence_penalty = 2
        elif not language_version:
            data_quality = "PARTIAL"
            confidence_penalty = 1
        evidence["data_quality"] = data_quality
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "tech_modules_versions":
        modules = _safe_list(data.get("modules") or data.get("module_versions"))
        verification = _safe_dict(data.get("module_verification"))
        verified_rows = _safe_list(verification.get("rows"))
        if not verified_rows:
            verification = _evaluate_module_versions(modules)
            verified_rows = _safe_list(verification.get("rows"))
        module_count = max(_safe_int(data.get("module_count")), _safe_int(verification.get("module_count")), len(verified_rows))
        risky_count = _safe_int(verification.get("risky_count"))
        uncertain_count = _safe_int(verification.get("uncertain_count"))
        safe_count = _safe_int(verification.get("safe_count"))
        status_override = _clean_text(verification.get("status")) or "not_evaluated"
        if status_override == "not_available":
            status_override = "not_evaluated"
        if module_count == 0:
            data_quality = "MISSING"
            status_override = "not_evaluated"
            confidence_penalty = 2
        elif risky_count > 0:
            data_quality = "VALID"
        elif uncertain_count > 0:
            data_quality = "PARTIAL"
            status_override = "not_evaluated"
            confidence_penalty = 1
        elif safe_count == module_count and module_count > 0:
            data_quality = "VALID"
            status_override = "passing"
        else:
            data_quality = "PARTIAL"
            status_override = "not_evaluated"
            confidence_penalty = 1
        evidence.update({
            "data_quality": data_quality,
            "module_count": module_count,
            "safe_module_count": safe_count,
            "risky_module_count": risky_count,
            "uncertain_module_count": uncertain_count,
            "verification_mode": verification.get("verification_mode") or "hybrid_offline_first",
            "live_advisory_status": verification.get("live_advisory_status") or "non_configure",
            "module_version_rows": verified_rows,
        })
        return evidence, data_quality, status_override, confidence_penalty

    if kpi_id == "tech_cve_check":
        critical = _safe_int(data.get("critical"))
        high = _safe_int(data.get("high"))
        medium = _safe_int(data.get("medium"))
        low = _safe_int(data.get("low"))
        evidence.update({
            "data_quality": "VALID",
            "cve_counts": {"critical": critical, "high": high, "medium": medium, "low": low},
            "critical_cve_count": critical,
            "high_cve_count": high,
            "medium_cve_count": medium,
            "low_cve_count": low,
        })
        return evidence, "VALID", status_override, confidence_penalty

    observed_metrics = {key: value for key, value in data.items() if key != "fix"}
    if not observed_metrics and _normalize_contract_status(kpi_obj.get("status")) == "not_evaluated":
        data_quality = "MISSING"
        confidence_penalty = 2
    elif not observed_metrics:
        data_quality = "PARTIAL"
        confidence_penalty = 1
    evidence.update({
        "data_quality": data_quality,
        "observed_metrics": observed_metrics if observed_metrics else _missing_field("Aucune métrique exploitable n'a été conservée pour ce KPI"),
        "affected_page_urls_all": affected_urls if affected_urls or affected_pages == 0 else _missing_field("La liste des URLs concernées n'a pas été conservée"),
    })
    return evidence, data_quality, status_override, confidence_penalty
def _compute_v2_status(kpi_id: str, v1_status: str, evidence_quality: str, confidence: str) -> str:
    return _normalize_contract_status(v1_status)


def _contract_type(kpi_id: str, axis: str, kpi_obj: dict) -> str:
    explicit = _clean_text(kpi_obj.get("type")).lower()
    if explicit in {"bug", "recommendation", "compliance"}:
        return explicit
    if _axis_is_compliance(axis):
        return "compliance"
    return _KPI_TYPE_DEFAULTS.get(kpi_id, "recommendation")


def _compute_contract_score(status: str, severity: Optional[str], data_quality: str) -> Optional[int]:
    if status == "not_evaluated":
        return None
    if status == "passing":
        return 92 if data_quality == "VALID" else 78
    if status == "warning":
        return 45 if data_quality == "PARTIAL" else 58
    severity_value = _clean_text(severity).lower()
    if severity_value == "critical":
        return 15
    if severity_value == "high":
        return 28
    if severity_value == "medium":
        return 40
    return 48 if data_quality == "VALID" else 42


def _compute_eco_status_score(status: str) -> int:
    if status == "passing":
        return 100
    if status == "warning":
        return 50
    return 0


def _cap_severity_by_confidence(severity: Optional[str], confidence: str) -> Optional[str]:
    """Avoid critical severity when confidence is low."""
    sev = _clean_text(severity).lower()
    if not sev:
        return None
    if _clean_text(confidence).lower() == "low" and sev == "critical":
        return "high"
    return sev


def _contract_fix(kpi_id: str, kpi_name: str, status: str, data: dict, severity: Optional[str]) -> Optional[str]:
    if status == "passing":
        return None
    ticket = _build_ticket_payload(kpi_id, kpi_name, severity or "medium", "aggregate", []) if status in {"failing", "warning"} else None
    recommended_action, _ = _extract_recommended_action(data, ticket, status)
    return recommended_action


def _contract_impact(kpi_id: str, status: str, kpi_obj: dict) -> Optional[str]:
    if status == "passing":
        return None
    impact = _clean_text(kpi_obj.get("impact"))
    return impact or _KPI_BUSINESS_IMPACT.get(kpi_id, "Ce point peut freiner la performance opérationnelle ou commerciale du site.")


def _build_contract_constat(kpi_id: str, kpi_name: str, status: str, kpi_type: str, axis: str, kpi_obj: dict, evidence: dict) -> str:
    data = _safe_dict(kpi_obj.get("data", {}))
    pages_affected = _safe_int(kpi_obj.get("pages_affected", 0))

    _UNKNOWN_TOKENS = {"non detecte", "non détecté", "non detectee", "non détectée", ""}

    def _tech_known(raw: str) -> bool:
        return bool(raw) and raw.lower().strip() not in _UNKNOWN_TOKENS

    if kpi_id == "tech_cms_version":
        product = _display_value(evidence.get("detected_product"))
        version = _display_value(evidence.get("detected_version"))
        support_status = _display_value(evidence.get("support_status"), "statut de support inconnu")
        product_known = _tech_known(product)
        version_known = _tech_known(version)
        if status == "passing":
            return f"Le CMS détecté est {product} {version} et le statut de support remonté est « {support_status} »."
        if status in ("not_evaluated", "warning"):
            if not product_known:
                return "Aucun CMS ou framework n'a été identifié lors du scan (signatures non reconnues ou en-têtes masqués). Le niveau de risque lié à la base technique ne peut pas être évalué."
            if not version_known:
                return f"Le CMS {product} a été identifié mais sa version n'est pas exposée publiquement. Il n'est pas possible de déterminer le statut de support avec certitude."
            return f"Le CMS {product} {version} a été détecté mais son statut de support n'a pas pu être qualifié de façon fiable dans le catalogue utilisé."
        return f"Le site expose {product} {version} avec un statut de support « {support_status} ». Cette base technique doit être traitée avant qu'elle ne devienne un risque d'exploitation ou de maintenance."

    if kpi_id == "tech_server_version":
        product = _display_value(evidence.get("detected_product"))
        version = _display_value(evidence.get("detected_version"))
        critical = _safe_int(_safe_dict(data.get("cve_severity")).get("critical"))
        high = _safe_int(_safe_dict(data.get("cve_severity")).get("high"))
        product_known = _tech_known(product)
        version_known = _tech_known(version)
        if status == "passing":
            return f"Le serveur ou runtime détecté est {product} {version}. Aucun signal critique ou haut n'a été remonté dans l'agrégat utilisé pour ce KPI."
        if status in ("not_evaluated", "warning"):
            if not product_known:
                return "Le serveur du site n'a pas pu être identifié lors du scan (en-têtes masqués, CDN ou réponse non standard). Le risque lié à la version serveur ne peut pas être évalué sans cette information."
            if not version_known:
                return f"Le serveur {product} a été détecté mais sa version n'est pas exposée dans les en-têtes HTTP. Il n'est pas possible de conclure sur son niveau de risque avec certitude."
            return f"Le serveur {product} {version} a été détecté mais n'a pas pu être qualifié de façon fiable dans l'agrégat technique (CVE ou EOL non déterminé)."
        return f"Le site expose {product} {version} avec {critical} CVE critique(s) et {high} CVE haute(s) dans l'agrégat technique. Cette exposition facilite le ciblage d'attaques connues."

    if kpi_id == "tech_programming_language":
        language = _clean_text(data.get("language") or data.get("programming_language"))
        lang_version = _clean_text(data.get("language_version") or data.get("programming_language_version"))
        server_tech = _clean_text(data.get("server_tech"))
        cms_name = _clean_text(data.get("cms_name"))
        context_product = language or server_tech or cms_name
        context_version = lang_version if language else _clean_text(data.get("server_version") or data.get("cms_version"))
        lang_known = bool(context_product) and context_product.lower() not in {"non detecte", "non détecté", ""}
        ver_known = bool(context_version) and context_version.lower() not in {"non detectee", "non détectée", ""}
        lang_inferred = bool(data.get("language_inferred"))
        if status == "passing":
            return f"Le langage ou runtime {context_product} {context_version} ne présente aucun signal de risque dans l'agrégat utilisé."
        if status in ("not_evaluated", "warning"):
            if not lang_known:
                return "Le langage de programmation du site n'est pas exposé directement dans les pages analysées (runtime masqué ou CDN). Le niveau de risque ne peut pas être conclu avec certitude."
            if lang_inferred:
                return f"Le langage utilisé ({context_product}) a été inféré depuis le CMS détecté, mais sa version n'est pas confirmée. Le risque associé reste incertain et nécessite une vérification manuelle."
            if not ver_known:
                return f"Le langage {context_product} a été détecté mais sa version n'est pas exposée. Identifier le langage/runtime aide à cibler les correctifs de sécurité et les upgrades de maintenance."
            return f"Le langage {context_product} {context_version} a été détecté mais n'a pas pu être qualifié de façon fiable (statut EOL ou support non déterminé dans le catalogue)."
        return f"Le site utilise {context_product} {context_version}. Une vérification du statut de maintenance de ce runtime est recommandée pour prévenir des vulnérabilités connues."

    if kpi_id == "sec_service_exposure":
        enabled = bool(evidence.get("enabled"))
        host = _display_value(evidence.get("host"), "hôte non déterminé")
        open_count = _safe_int(evidence.get("open_service_count"))
        critical_count = _safe_int(evidence.get("critical_open_service_count"))
        high_count = _safe_int(evidence.get("high_open_service_count"))
        preview = []
        for svc in _safe_list(evidence.get("open_services_all"))[:3]:
            item = _safe_dict(svc)
            port = item.get("port")
            service = _display_value(item.get("service"), "service inconnu")
            risk = _display_value(item.get("risk"), "risque inconnu")
            preview.append(f"{service} ({port}/{risk})")
        preview_suffix = f" Services observés: {', '.join(preview)}." if preview else ""
        if status == "passing":
            return f"Aucun service à risque n'a été trouvé sur les ports surveillés de {host}."
        if status == "not_evaluated":
            if not enabled:
                return "Le contrôle d'exposition des services réseau est désactivé. Activez ENABLE_PORT_SCAN pour évaluer ce risque."
            return f"Le contrôle d'exposition des services réseau n'a pas pu conclure de façon fiable pour {host}."
        if critical_count > 0:
            return f"{critical_count} service(s) critique(s) exposé(s) publiquement ont été détectés sur {host}.{preview_suffix}"
        if high_count > 0:
            return f"{high_count} service(s) à risque élevé sont exposés publiquement sur {host}.{preview_suffix}"
        return f"{open_count} service(s) réseau exposé(s) ont été identifiés sur {host}. Une revue de nécessité et de filtrage est recommandée.{preview_suffix}"

    if kpi_id == "func_forms":
        forms_detected = _safe_int(evidence.get("forms_detected"))
        forms_tested = _safe_int(evidence.get("forms_tested"))
        tests_run = _safe_int(evidence.get("tests_run"))
        anomalies_count = _safe_int(evidence.get("anomalies_count"))
        non_transactional_forms_tested = _safe_int(evidence.get("non_transactional_forms_tested"))
        suppressed_low_confidence_anomalies = _safe_int(evidence.get("suppressed_low_confidence_anomalies"))
        if status == "passing":
            return f"{forms_detected} formulaire(s) ont été détectés et {forms_tested} testés, sans bug remonté par le fuzzing."
        if status == "not_evaluated":
            return f"{forms_detected} formulaire(s) ont été détectés mais aucun test exploitable n'a été exécuté ({tests_run} test(s)). Le risque métier sur les parcours de soumission reste donc inconnu."
        if status == "warning":
            return f"{forms_detected} formulaire(s) ont été détectés mais seulement {forms_tested} ont été testés. La couverture reste partielle et {anomalies_count} signal(aux) ont déjà été remontés."
        suffix = ""
        if non_transactional_forms_tested > 0 or suppressed_low_confidence_anomalies > 0:
            suffix = f" {non_transactional_forms_tested} formulaire(s) non transactionnel(s) ont été isolés hors du score principal, avec {suppressed_low_confidence_anomalies} signal(s) à faible confiance conservés en preuve."
        return f"{anomalies_count} signal(aux) ont été remontés sur {forms_tested} formulaire(s) transactionnels testés, alors que {forms_detected} formulaire(s) transactionnels ont été détectés au total. Des parcours de conversion ou de contact peuvent échouer en production.{suffix}"

    if kpi_id == "func_buttons":
        total_broken_buttons = _safe_int(evidence.get("total_broken_buttons"))
        affected_pages = _safe_int(evidence.get("affected_pages"))
        first_button = (_safe_list(evidence.get("broken_buttons_all")) or [{}])[0]
        label = _display_value(_safe_dict(first_button).get("label_or_text"), "bouton sans libellé exploitable")
        page_url = _display_value(_safe_dict(first_button).get("page_url"), "page non conservée")
        if status == "passing":
            return "Aucun bouton sans action exploitable n'a été détecté sur les pages échantillonnées."
        return f"{total_broken_buttons} bouton(s) sans action exploitable ont été détectés sur {affected_pages} page(s). Exemple prioritaire : « {label} » sur {page_url}."

    if kpi_id == "func_links":
        broken_count = _safe_int(evidence.get("broken_internal_link_count"))
        first_link = (_safe_list(evidence.get("broken_links_all")) or [{}])[0]
        source_page = _display_value(_safe_dict(first_link).get("source_page"), "page source non conservée")
        target_url = _display_value(_safe_dict(first_link).get("target_url"), "URL cible non conservée")
        if status == "passing":
            return "Aucun lien interne cassé n'a été remonté sur les pages échantillonnées."
        return f"{broken_count} lien(s) interne(s) cassé(s) ont été détectés. Un exemple concerne {source_page}, qui pointe vers {target_url} sans réponse exploitable."

    if kpi_id == "seo_meta_tags":
        meta_missing_count = _safe_int(evidence.get("meta_missing_count"))
        title_missing_count = _safe_int(evidence.get("title_missing_count"))
        meta_urls = _safe_list(evidence.get("meta_missing_urls_all")) if isinstance(evidence.get("meta_missing_urls_all"), list) else []
        title_urls = _safe_list(evidence.get("title_missing_urls_all")) if isinstance(evidence.get("title_missing_urls_all"), list) else []
        if status == "passing":
            return "Les pages analysées disposent de titres et de meta descriptions exploitables dans l'agrégat SEO."
        details = []
        if meta_missing_count > 0:
            details.append(f"{meta_missing_count} page(s) sans meta description")
        if title_missing_count > 0:
            details.append(f"{title_missing_count} page(s) sans balise title")
        preview_url = (meta_urls + title_urls)[:2]
        suffix = f" Exemples : {', '.join(preview_url)}." if preview_url else ""
        return f"{' et '.join(details)} ont été détectées dans l'audit SEO.{suffix}"

    if kpi_id == "seo_alt_tags":
        missing_alt_count = _safe_int(evidence.get("missing_alt_image_count"))
        page_urls = _safe_list(evidence.get("missing_alt_page_urls_all")) if isinstance(evidence.get("missing_alt_page_urls_all"), list) else []
        if status == "passing":
            return "Les images échantillonnées disposent d'un attribut ALT exploitable dans l'agrégat SEO."
        suffix = f" Les premières pages concernées sont {', '.join(page_urls[:2])}." if page_urls else ""
        return f"{missing_alt_count} image(s) sans ALT ont été détectées sur {max(len(page_urls), pages_affected)} page(s).{suffix}"

    if kpi_id == "seo_heading_structure":
        bad_h1_count = _safe_int(evidence.get("bad_h1_page_count"))
        homepage_h1_missing = bool(evidence.get("homepage_h1_missing"))
        homepage_url = _display_value(evidence.get("homepage_url"), "page d'accueil non conservée")
        if status == "passing":
            return "La hiérarchie Hn est cohérente sur les pages analysées et la page d'accueil dispose d'un H1 exploitable."
        if homepage_h1_missing:
            return f"La hiérarchie Hn est défaillante et la page d'accueil ({homepage_url}) est elle-même concernée. {bad_h1_count} page(s) sont remontées comme non conformes."
        return f"{bad_h1_count} page(s) présentent une hiérarchie Hn non conforme dans l'agrégat SEO. Cela affaiblit la lisibilité et la compréhension du sujet principal."

    if kpi_id == "seo_internal_linking":
        missing_count = _safe_int(evidence.get("pages_missing_contextual_links_count"))
        urls = _safe_list(evidence.get("pages_missing_contextual_links_all")) if isinstance(evidence.get("pages_missing_contextual_links_all"), list) else []
        total_internal_links = _safe_int(evidence.get("total_internal_links"))
        total_contextual_links = _safe_int(evidence.get("total_contextual_internal_links"))
        measurement = _safe_dict(evidence.get("contextual_link_measurement"))
        reliable_coverage_pct = _safe_float(measurement.get("reliable_coverage_pct"))
        if status == "passing":
            return f"Le maillage contextuel remonte comme suffisant sur les pages analysées ({total_contextual_links} lien(s) contextuel(s), {total_internal_links} lien(s) interne(s) agrégés)."
        if status == "not_evaluated":
            if reliable_coverage_pct:
                return f"Le KPI de maillage interne n'a pas pu être évalué de manière fiable sur ce scan, la couverture de mesure contextuelle restant limitée à {reliable_coverage_pct:.1f}% des pages."
            return "Le KPI de maillage interne n'a pas pu être évalué de manière fiable sur ce scan."
        if total_internal_links == 0 and total_contextual_links > 0:
            return f"Le volume global de liens internes est incohérent avec le comptage contextuel ({total_contextual_links} liens contextuels détectés). Le résultat est traité comme une alerte de qualité de données."
        if measurement.get("sitewide_zero_contextual_suspect"):
            return f"Le maillage contextuel remonte 0 lien contextuel pour {total_internal_links} liens internes agrégés, avec une couverture annoncée à {reliable_coverage_pct:.1f}% des pages. Le résultat est dégradé en alerte de qualité de données plutôt qu'en échec confirmé."
        suffix = f" Exemples : {', '.join(urls[:2])}." if urls else ""
        return f"{missing_count} page(s) manquent de liens contextuels dans la zone de contenu principale.{suffix}"

    base_constat = _generate_constat({
        "status": status,
        "type": kpi_type,
        "info": kpi_obj.get("info"),
        "data": data,
        "pages_affected": pages_affected,
    }, axis, kpi_name)
    return _clean_text(base_constat) or f"{kpi_name}: observation disponible dans les éléments collectés."


def _make_kpi_v2(kpi_name: str, kpi_obj: dict, axis: str, pages_scanned: int, domain_url: str) -> dict:
    """
    Transforms a V1 KPI object into the V2 14-field standardised schema.
    Called from the phase-4 normalization loop.
    """
    meta = _KPI_META.get(kpi_name, (f"kpi_{kpi_name.lower().replace(' ', '_')}", "medium", "aggregate"))
    kpi_id, base_confidence, evidence_quality = meta

    v1_status = str(kpi_obj.get("status", "not_available"))
    v1_severity = kpi_obj.get("severity")
    v1_pages = _safe_int(kpi_obj.get("pages_affected", 0))
    v1_data = _safe_dict(kpi_obj.get("data", {}))

    evidence, data_quality, status_override, confidence_penalty = _build_contract_evidence(
        kpi_id, kpi_obj, pages_scanned, domain_url
    )
    status = status_override or _compute_v2_status(kpi_id, v1_status, evidence_quality, base_confidence)
    if kpi_id == "eco_index_score":
        evidence["score_value"] = _compute_eco_status_score(status)
    evidence_digest = _build_curated_evidence_digest(
        kpi_id, kpi_name, status, evidence, kpi_obj, domain_url
    )
    digest_quality = _clean_text(evidence_digest.get("quality")).upper()
    if digest_quality in {"VALID", "PARTIAL", "MISSING"}:
        data_quality = digest_quality
        evidence["data_quality"] = digest_quality
    if digest_quality == "MISSING":
        status = "not_evaluated"
    if status == "passing" and data_quality in {"PARTIAL", "MISSING"}:
        status = "not_evaluated"
    kpi_type = _contract_type(kpi_id, axis, kpi_obj)

    if status in {"passing", "not_evaluated"}:
        severity = None
    else:
        severity = v1_severity or _infer_severity_from_context(
            kpi_type,
            v1_pages or _safe_int(evidence.get("affected_pages", 0)),
            is_security=_axis_is_security(axis),
        )

    if status == "not_evaluated":
        confidence = "low"
    else:
        if data_quality == "PARTIAL":
            confidence_penalty += 1
        elif data_quality == "MISSING":
            confidence_penalty += 2
        confidence = _downgrade_confidence(base_confidence, confidence_penalty)
    severity = _cap_severity_by_confidence(severity, confidence)
    if kpi_id == "eco_index_score":
        # Use the actual measured eco index value as the score (e.g. 41.1 → 41),
        # not the status-derived synthetic value (warning→50, passing→100, else→0).
        # Fall back to the status-derived score only when no measurement is available.
        avg_eco_idx = _optional_float(v1_data.get("avg_eco_index"))
        score = round(avg_eco_idx) if avg_eco_idx is not None else _compute_eco_status_score(status)
        evidence["score_value"] = score
    else:
        score = _compute_contract_score(status, severity, data_quality)

    return {
        "kpi_id": kpi_id,
        "name": kpi_name,
        "axis": axis,
        "type": kpi_type,
        "status": status,
        "severity": severity,
        "confidence": confidence,
        "constat": _build_contract_constat(kpi_id, kpi_name, status, kpi_type, axis, kpi_obj, evidence),
        "score": score,
        "impact": _contract_impact(kpi_id, status, kpi_obj),
        "evidence": evidence,
        "evidence_digest": evidence_digest,
        "fix": _contract_fix(kpi_id, kpi_name, status, v1_data, severity),
    }


def _build_summary_v2(axes: dict, pages_scanned: int) -> dict:
    """Build the V2 top-level summary block from normalised axes."""
    total_kpis = passed = warning = failed = not_eval = critical = high = medium = low = 0
    axis_failed: dict[str, dict] = {}
    key_candidates = []

    for axis_name, axis_data in axes.items():
        if not isinstance(axis_data, dict):
            continue
        for _, kpi in axis_data.items():
            if not isinstance(kpi, dict) or "status" not in kpi:
                continue
            total_kpis += 1
            status = kpi.get("status")
            severity = _clean_text(kpi.get("severity")).lower()
            if status == "passing":
                passed += 1
            elif status == "warning":
                warning += 1
                if severity == "critical":
                    critical += 1
                elif severity == "high":
                    high += 1
                elif severity == "medium":
                    medium += 1
                elif severity == "low":
                    low += 1
                key_candidates.append((severity or "low", kpi.get("constat", ""), axis_name, _clean_text(kpi.get("kpi_id"))))
            elif status == "failing":
                failed += 1
                if severity == "critical":
                    critical += 1
                elif severity == "high":
                    high += 1
                elif severity == "medium":
                    medium += 1
                elif severity == "low":
                    low += 1
                axis_key = axis_name.lower()
                axis_failed.setdefault(axis_key, {"failed": 0, "high_confidence_failed": 0})
                axis_failed[axis_key]["failed"] += 1
                if kpi.get("confidence") in ("high", "medium"):
                    axis_failed[axis_key]["high_confidence_failed"] += 1
                key_candidates.append((severity or "low", kpi.get("constat", ""), axis_name, _clean_text(kpi.get("kpi_id"))))
            elif status == "not_evaluated":
                not_eval += 1

    if critical > 0:
        health = "critical"
    elif failed > 0 or warning > 3:
        health = "needs_attention"
    else:
        health = "healthy"

    if health == "critical":
        headline = f"{critical} indicateur(s) critique(s) ont été confirmés. Une action prioritaire est nécessaire avant de poursuivre l'optimisation."
    elif health == "needs_attention":
        headline = f"{failed} KPI en échec et {warning} en alerte freinent actuellement la performance, la conformité ou la conversion."
    else:
        headline = f"Le site reste globalement maîtrisé sur {total_kpis} KPI, avec peu d'écarts bloquants remontés par le scan."

    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "": 4}
    key_candidates.sort(key=lambda item: severity_order.get(item[0], 5))
    key_points = []
    seen_points = set()
    seen_kpis = set()
    for _, constat, _, kpi_id in key_candidates:
        clean_constat = _clean_text(constat)
        if not clean_constat:
            continue
        if kpi_id and kpi_id in seen_kpis:
            continue
        key = clean_constat.casefold()
        if key in seen_points:
            continue
        seen_points.add(key)
        if kpi_id:
            seen_kpis.add(kpi_id)
        key_points.append(clean_constat)
        if len(key_points) >= 3:
            break

    axis_map = {
        "check sécurité": "sécurité",
        "audit technique": "sécurité",
        "audit fonctionnel": "fonctionnel",
        "audit de performance et temps de réponse": "performance",
        "seo": "seo",
        "audit ux/ui": "ux",
        "contenu": "contenu",
        "eco index": "performance_eco",
        "rgpd": "rgpd",
    }
    risk_breakdown: dict[str, dict] = {}
    for axis_name_lower, bucket in axis_map.items():
        src = axis_failed.get(axis_name_lower, {"failed": 0, "high_confidence_failed": 0})
        risk_breakdown.setdefault(bucket, {"failed": 0, "high_confidence_failed": 0})
        risk_breakdown[bucket]["failed"] += src["failed"]
        risk_breakdown[bucket]["high_confidence_failed"] += src["high_confidence_failed"]

    return {
        "client_overview": {
            "health_status": health,
            "headline": headline,
            "key_points": key_points,
        },
        "risk_breakdown": risk_breakdown,
        "delivery_overview": {
            "pages_scanned": pages_scanned,
            "total_kpis": total_kpis,
            "passed_kpis": passed,
            "warning_kpis": warning,
            "failed_kpis": failed,
            "not_evaluated_kpis": not_eval,
            "critical_kpis": critical,
            "high_kpis": high,
            "medium_kpis": medium,
            "low_kpis": low,
        },
    }


def build_kpi_centric_report(report: dict) -> dict:
    """
    Build a KPI-centric report from the standard report.
    Structure: axes -> sous_axes -> KPIs
    Each KPI has: info, impact, pages_affected, pages_affected_urls, status, type, severity (if bug)
    """
    if not report or report.get("error"):
        return {"error": report.get("error", "report_unavailable")}

    da = report.get("domain_analysis", {})
    sm = report.get("site_metrics", {})
    seo = sm.get("seo", {})
    ux = sm.get("ux", {})
    perf = sm.get("performance", {})
    content = sm.get("content", {})
    sec = da.get("security", {})
    cms_kpi = da.get("cms_kpi", {})
    privacy_kpi = da.get("privacy_kpi", {})
    cookie_kpi = da.get("cookie_kpi", {})
    functional_kpi = da.get("functional_kpi", {})
    functional_fuzzer_kpi = da.get("functional_fuzzer_kpi", {})
    domain_url = report.get("domain", "")
    scan_telemetry = _safe_dict(report.get("scan_telemetry", {}))
    blocked_recovery_partial = bool(scan_telemetry.get("blocked_recovery_partial"))

    non_func_buttons_evidence = _normalized_kpi_evidence(report, "Non-Functional Buttons")
    button_kpi = _safe_dict(perf.get("button_kpi", {}))
    broken_buttons = _safe_list(button_kpi.get("broken_buttons"))
    total_broken_buttons = button_kpi.get("total_nonfunc_buttons")
    if total_broken_buttons is None:
        total_broken_buttons = len(broken_buttons) if broken_buttons else 0
    # SEO evidence: scanner stores counts in seo_kpi_extended, not in report["kpis"].
    # URL lists are not collected by the scanner for these KPIs — only counts are available.
    missing_meta_evidence = _normalized_kpi_evidence(report, "Missing Meta Descriptions") or {"count": seo.get("pages_missing_meta_desc", 0), "affected_pages": []}
    missing_title_evidence = _normalized_kpi_evidence(report, "Missing Page Titles") or {"count": seo.get("pages_missing_title", 0), "affected_pages": []}
    missing_alt_evidence = {"images": []}
    heading_hierarchy_evidence = {"count": seo.get("pages_with_bad_h1", 0), "affected_pages": []}
    internal_contextual_links_evidence = _normalized_kpi_evidence(report, "Internal Contextual Links")
    pages_checked_total = _safe_int(report.get("pages_scanned", 0))
    seo_bad_h1_raw = _safe_int(seo.get("pages_with_bad_h1", 0))
    seo_bad_h1_pages = min(seo_bad_h1_raw, pages_checked_total) if pages_checked_total > 0 else seo_bad_h1_raw

    axes = {}

    # Security normalization: scanner uses pass|warning|fail, while KPI API uses passing|failing|not_available.
    admin_exposure = _safe_dict(sec.get("admin_sensitive_page_exposed"))
    version_disclosure = _safe_dict(sec.get("version_disclosure_cms"))
    robots_disclosure = _safe_dict(sec.get("robots_txt_info_disclosure"))
    error_page_leak = _safe_dict(sec.get("custom_error_page_info_leak"))
    brute_force_login = _safe_dict(sec.get("bruteforced_protection_login"))
    upload_control = _safe_dict(sec.get("file_upload_extension_control"))
    vulnerable_js = _safe_dict(sec.get("vulnerable_js_dependencies"))
    service_exposure = _safe_dict(sec.get("service_exposure"))
    if not service_exposure:
        service_exposure = _safe_dict(da.get("service_exposure_kpi"))

    admin_exposed = _safe_list(admin_exposure.get("exposed"))
    admin_forbidden = _safe_list(admin_exposure.get("forbidden"))
    admin_server_errors = _safe_list(admin_exposure.get("server_errors"))
    admin_risky = admin_exposed + admin_server_errors
    admin_findings = admin_exposed + admin_forbidden + admin_server_errors
    admin_has_issue = bool(admin_risky)

    version_disclosed = _safe_list(version_disclosure.get("disclosed"))
    version_forbidden = _safe_list(version_disclosure.get("forbidden"))
    version_server_errors = _safe_list(version_disclosure.get("server_errors"))
    version_risky = version_disclosed + version_server_errors
    version_findings = version_disclosed + version_forbidden + version_server_errors
    version_disclosure_has_issue = bool(version_risky)

    sensitive_file_exposure = _safe_dict(sec.get("sensitive_file_exposed"))
    sensitive_exposed = _safe_list(sensitive_file_exposure.get("exposed"))
    sensitive_forbidden = _safe_list(sensitive_file_exposure.get("forbidden"))
    sensitive_server_errors = _safe_list(sensitive_file_exposure.get("server_errors"))
    sensitive_risky = sensitive_exposed + sensitive_server_errors

    robots_paths = _safe_list(robots_disclosure.get("disclosed_paths"))
    robots_has_issue = bool(robots_paths) or str(robots_disclosure.get("status", "")).lower() in {"warning", "fail"}

    error_leaks_raw = _safe_list(error_page_leak.get("leak_indicators"))
    # Filter out standalone PHP runtime prefixes (Warning:, Notice:, Deprecated:)
    # that appear on any PHP site's error page without constituting a real info leak.
    # Real leaks require file paths, stack traces, SQL errors, or language tracebacks.
    _WEAK_ERROR_PREFIXES = {"warning:", "notice:", "deprecated:"}
    error_leaks = [l for l in error_leaks_raw if isinstance(l, str) and str(l).strip().lower() not in _WEAK_ERROR_PREFIXES]
    # Status is authoritative: if scanner (v3.1+) says "pass", we trust its
    # strong-vs-weak classification. If scanner says "fail", a strong or multi-weak
    # indicator was confirmed.
    error_page_has_issue = bool(error_leaks) or str(error_page_leak.get("status", "")).lower() == "fail"

    has_login = _safe_bool(functional_kpi.get("has_login"))
    brute_force_protected = _safe_bool(brute_force_login.get("protected"))
    brute_force_target_confirmed = (
        _clean_text(brute_force_login.get("target_type")).lower() == "login"
        and _clean_text(brute_force_login.get("confidence")).lower() in {"high", "medium"}
    )
    brute_force_status_raw = _clean_text(brute_force_login.get("status")).lower()
    brute_force_legacy_text = _clean_text(
        f"{brute_force_login.get('target_url', '')} {brute_force_login.get('details', '')}"
    ).lower()
    brute_force_legacy_non_login = any(
        marker in brute_force_legacy_text
        for marker in ("newsletter", "subscribe", "subscription", "blockemailsubscription", "footer", "search", "contact")
    )
    if not brute_force_target_confirmed and not brute_force_login.get("target_type") and not brute_force_legacy_non_login:
        brute_force_target_confirmed = brute_force_status_raw in {"fail", "failing", "failed", "pass", "passing"}
    brute_force_has_issue = (
        has_login
        and brute_force_target_confirmed
        and ((not brute_force_protected) or brute_force_status_raw in {"fail", "failing", "failed"})
    )

    upload_issues = _safe_list(upload_control.get("issues"))
    upload_restrictions_found = _safe_bool(upload_control.get("restrictions_found"))
    upload_has_issue = bool(upload_issues) or str(upload_control.get("status", "")).lower() == "fail"

    vulnerable_libraries = _safe_list(vulnerable_js.get("vulnerable_libraries"))
    vulnerable_js_has_issue = bool(vulnerable_libraries) or str(vulnerable_js.get("status", "")).lower() == "fail"
    service_exposure_status_raw = _clean_text(service_exposure.get("status")).lower()
    service_exposure_enabled = bool(service_exposure.get("enabled"))
    service_exposure_open_services = _safe_list(service_exposure.get("open_services"))
    service_exposure_critical_open = sum(
        1 for svc in service_exposure_open_services
        if _clean_text(_safe_dict(svc).get("risk")).lower() == "critical"
    )
    service_exposure_high_open = sum(
        1 for svc in service_exposure_open_services
        if _clean_text(_safe_dict(svc).get("risk")).lower() == "high"
    )
    service_exposure_medium_open = sum(
        1 for svc in service_exposure_open_services
        if _clean_text(_safe_dict(svc).get("risk")).lower() == "medium"
    )
    service_exposure_low_open = sum(
        1 for svc in service_exposure_open_services
        if _clean_text(_safe_dict(svc).get("risk")).lower() == "low"
    )
    if not service_exposure_enabled:
        service_exposure_status = "non_evalue"
    elif service_exposure_status_raw in {"pass", "passing"}:
        service_exposure_status = "passing"
    elif service_exposure_status_raw in {"fail", "failing", "failed"} and (service_exposure_critical_open > 0 or service_exposure_high_open > 0):
        service_exposure_status = "failing"
    elif service_exposure_status_raw in {"warning"} and service_exposure_medium_open > 0:
        service_exposure_status = "warning"
    elif service_exposure_status_raw in {"non_evalue", "not_evaluated", "not-evaluated", "not_available"}:
        service_exposure_status = "non_evalue"
    elif service_exposure_critical_open > 0:
        service_exposure_status = "failing"
    elif service_exposure_high_open > 0:
        service_exposure_status = "failing"
    elif service_exposure_medium_open > 0:
        service_exposure_status = "warning"
    else:
        service_exposure_status = "passing"
    service_exposure_severity = _clean_text(service_exposure.get("severity")).lower()
    if service_exposure_status in {"passing", "non_evalue"}:
        service_exposure_severity = None
    elif service_exposure_severity not in {"critical", "high", "medium", "low"}:
        if service_exposure_critical_open > 0:
            service_exposure_severity = "critical"
        elif service_exposure_high_open > 0:
            service_exposure_severity = "high"
        elif service_exposure_medium_open > 0:
            service_exposure_severity = "medium"
        else:
            service_exposure_severity = "low"

    tech_issues = _safe_list(cms_kpi.get("issues"))
    server_tech = str(cms_kpi.get("server_tech") or "").strip()
    server_version = str(cms_kpi.get("server_version") or "").strip()
    cms_detected_name = str(cms_kpi.get("cms_detected") or "").strip()
    cms_detected_version = str(cms_kpi.get("cms_version") or "").strip()
    cms_version_range = str(cms_kpi.get("cms_version_range") or "").strip()
    tech_inference_sources = _safe_list(cms_kpi.get("inference_sources"))
    programming_language = str(cms_kpi.get("language") or "").strip()
    programming_language_version = str(cms_kpi.get("language_version") or "").strip()
    programming_language_inferred = bool(cms_kpi.get("language_inferred"))
    cve_severity = _safe_dict(cms_kpi.get("cve_severity"))
    server_critical = _safe_int(cve_severity.get("critical"))
    server_high = _safe_int(cve_severity.get("high"))
    server_related_issues = [
        str(issue) for issue in tech_issues
        if any(tag in str(issue).lower() for tag in ("server", "version", "x-powered-by", "header"))
    ]

    if programming_language:
        if programming_language_version:
            programming_language_info = f"Langage détecté: {programming_language} {programming_language_version}"
        else:
            programming_language_info = f"Langage détecté: {programming_language} (version non détectée)"
        programming_language_status = "passing"
    elif server_tech:
        version_text = f" {server_version}" if server_version else " (version serveur non détectée)"
        programming_language_info = f"Langage non exposé directement; serveur détecté: {server_tech}{version_text}"
        programming_language_status = "non_evalue"
    elif cms_detected_name:
        version_text = f" {cms_detected_version}" if cms_detected_version else " (version non détectée)"
        programming_language_info = f"Langage non exposé directement; système de gestion détecté: {cms_detected_name}{version_text}"
        programming_language_status = "non_evalue"
    else:
        programming_language_info = "Langage de programmation: Non détecté"
        programming_language_status = "non_evalue"

    if not server_tech:
        server_version_status = "not_available"
        server_version_has_issue = False
        server_version_info = "Serveur: Non détecté"
    elif not server_version:
        server_version_status = "passing"
        server_version_has_issue = False
        server_version_info = f"Serveur: {server_tech} (version non détectée)"
    else:
        server_version_has_issue = (server_critical > 0 or server_high > 0 or len(server_related_issues) > 0)
        server_version_status = "failing" if server_version_has_issue else "passing"
        server_version_info = f"Serveur: {server_tech} {server_version}"
    if server_tech and not server_version:
        server_version_info = f"Serveur: {server_tech} (version non exposee, configuration de securite favorable)"

    # ─── AUDIT TECHNIQUE ───────────────────────────────────────────────────────
    # [5.6] Distinguish cms_version_eol=None (probe didn't run) from False (not EOL).
    # None => 'non_evalue' status; only True fires 'failing'+'critical'.
    cms_eol = cms_kpi.get("cms_version_eol")
    module_verification = _evaluate_module_versions(cms_kpi.get("module_versions", []))
    module_status = module_verification.get("status", "not_evaluated")
    module_severity = module_verification.get("severity")
    module_count = _safe_int(module_verification.get("module_count"))
    cms_version_status = (
        "failing" if cms_eol is True
        else "passing" if cms_eol is False or cms_detected_name
        else "non_evalue"
    )
    
    axes["Audit Technique"] = {
        "Version CMS/Framework": {
            "info": f"CMS détecté: {cms_kpi.get('cms_detected') or 'Aucun'}",
            "impact": "Risque de sécurité si version obsolète ou non maintenue",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": cms_version_status,
            "type": "bug" if cms_eol is True else None,
            "severity": "critical" if cms_eol is True else None,
            "data": {
                "cms_name": cms_kpi.get("cms_detected"),
                "cms_version": cms_kpi.get("cms_version"),
                "cms_version_range": cms_version_range,
                "cms_eol": cms_eol,
                "cms_support_status": cms_kpi.get("cms_support_status"),
                "inference_sources": tech_inference_sources,
                "data_quality": "VALID" if cms_detected_version else ("PARTIAL" if cms_detected_name else "MISSING"),
                "confidence": "medium" if cms_version_range else ("high" if cms_detected_version else "none"),
            }
        },
        "Version Modules Installés": {
            "info": f"{len(cms_kpi.get('module_versions', []))} modules détectés avec versions",
            "impact": "Modules obsolètes = vulnérabilités potentielles non corrigées",
            "pages_affected": 1 if module_count > 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if module_count > 0 else [],
            "status": module_status,
            "type": "bug" if module_status == "failing" else None,
            "severity": module_severity,
            "data": {
                "module_count": module_count,
                "modules": cms_kpi.get("module_versions", []),
                "module_verification": module_verification,
            }
        },
        "Version serveur": {
            "info": server_version_info,
            "impact": "Versions obsolètes exposent à des vulnérabilités connues",
            "pages_affected": 1 if server_version_status in ("passing", "failing") else 0,
            "pages_affected_urls": [report.get("domain", "")] if server_version_status in ("passing", "failing") else [],
            "status": server_version_status,
            "type": "bug" if server_version_has_issue else None,
            "severity": "high" if server_version_has_issue else None,
            "data": {
                "server_tech": cms_kpi.get("server_tech"),
                "server_version": cms_kpi.get("server_version"),
                "programming_language": cms_kpi.get("language"),
                "programming_language_version": cms_kpi.get("language_version"),
                "issues": server_related_issues,
                "cve_severity": cve_severity,
                "data_quality": "VALID" if server_version else ("PARTIAL" if server_tech else "MISSING"),
                "failure_reason": "server_version_hidden_by_design" if server_tech and not server_version else None,
                "confidence": "medium" if server_tech and not server_version else ("high" if server_version else "none"),
            }
        },
        "Langage de Programmation": {
            "info": programming_language_info,
            "impact": "Identifier le langage/runtime aide a cibler les correctifs de securite et les upgrades de maintenance.",
            "pages_affected": 1 if programming_language_status == "passing" or server_tech or cms_detected_name else 0,
            "pages_affected_urls": [report.get("domain", "")] if programming_language_status == "passing" or server_tech or cms_detected_name else [],
            "status": programming_language_status,
            "type": None,
            "severity": None,
            "data": {
                "language": cms_kpi.get("language"),
                "language_version": cms_kpi.get("language_version"),
                "language_inferred": cms_kpi.get("language_inferred"),
                "server_tech": cms_kpi.get("server_tech"),
                "server_version": cms_kpi.get("server_version"),
                "cms_name": cms_kpi.get("cms_detected"),
                "cms_version": cms_kpi.get("cms_version"),
                "cms_version_range": cms_version_range,
                "inference_sources": tech_inference_sources,
                "data_quality": "PARTIAL" if programming_language_inferred or not programming_language_version else "VALID",
                "confidence": "medium" if programming_language_inferred else ("high" if programming_language else "none"),
            }
        },
        "Vérification du Code": {
            "info": f"CVE détectées: Critique={cms_kpi.get('cve_severity', {}).get('critical', 0)}, Haute={cms_kpi.get('cve_severity', {}).get('high', 0)}, Moyenne={cms_kpi.get('cve_severity', {}).get('medium', 0)}, Basse={cms_kpi.get('cve_severity', {}).get('low', 0)}",
            "impact": "Vulnérabilités connues exposent l'application à des attaques",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "failing" if (cms_kpi.get('cve_severity', {}).get('critical', 0) > 0 or cms_kpi.get('cve_severity', {}).get('high', 0) > 0) else "passing",
            "type": "bug" if (cms_kpi.get('cve_severity', {}).get('critical', 0) > 0 or cms_kpi.get('cve_severity', {}).get('high', 0) > 0) else None,
            "severity": "critical" if cms_kpi.get('cve_severity', {}).get('critical', 0) > 0 else ("high" if cms_kpi.get('cve_severity', {}).get('high', 0) > 0 else None),
            "data": cms_kpi.get("cve_severity", {}),
        }
    }

    def _evaluate_cookie_severity(cookies_list):
        if not cookies_list:
            return None
        analytics_patterns = ["_ga", "_fbp", "ajs_", "mixpanel", "_hj", "ym_"]
        max_sev = "low"
        sev_rank = {"low": 1, "warning": 2, "medium": 3, "high": 4, "critical": 5}
        for c in cookies_list:
            name = str(c.get("name", "")).lower() if isinstance(c, dict) else str(c).lower()
            if any(p in name for p in analytics_patterns):
                sev = "warning"
            elif "session" in name or "auth" in name or "jwt" in name or "token" in name or "sid" in name:
                sev = "critical"
            else:
                sev = "medium"
            if sev_rank.get(sev, 0) > sev_rank.get(max_sev, 0):
                max_sev = sev
        return max_sev

    cookie_severity = _evaluate_cookie_severity(cookie_kpi.get("cookies_with_missing_flags", []))

    # ─── CHECK SÉCURITÉ ────────────────────────────────────────────────────────
    # [5.4] Distinguish ssl.valid=None (probe not run) from ssl.valid=False (failed).
    # None must become 'non_evalue' — not 'failing' — to avoid conflicting with
    # the classifier's ssl_non_evalue finding.
    ssl_valid = (sec.get("ssl") or {}).get("valid")

    axes["Check Sécurité"] = {
        "SSL": {
            "info": (
                "Certificat SSL: Valide" if ssl_valid is True
                else "Certificat SSL: Invalide/Expiré" if ssl_valid is False
                else "Certificat SSL: Non vérifié (sonde échouée)"
            ),
            "impact": "Certificat invalide = risque de sécurité élevé et perte de confiance utilisateur",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing" if ssl_valid is True else "failing" if ssl_valid is False else "non_evalue",
            "type": "bug" if ssl_valid is False else None,
            "severity": "critical" if ssl_valid is False else None,
            "data": sec.get("ssl", {}),
        },
        "Sécurité des En-têtes HTTP": {
            "info": f"{len(sec.get('headers', []))} en-têtes de sécurité configurés",
            "impact": "En-têtes manquants = surface d'attaque accrue (XSS, clickjacking, MIME sniffing)",
            "pages_affected": 1 if sec.get("missing_headers") else 0,
            "pages_affected_urls": [report.get("domain", "")] if sec.get("missing_headers") else [],
            "status": "failing" if sec.get("missing_headers") else "passing",
            "type": "bug" if sec.get("missing_headers") else None,
            "severity": "high" if sec.get("missing_headers") else None,
            "data": {
                "headers_present": len(sec.get("headers", [])),
                "missing_headers": sec.get("missing_headers", []),
                "headers": sec.get("headers", []),
            }
        },
        "Gestion des Sessions": {
            "info": f"Cookies manquant flags: {cookie_kpi.get('missing_cookie_flag_count', 0)}",
            "impact": "Cookies sans HttpOnly/Secure exposent à des exploitations XSS et MITM",
            # [#10] missing_cookie_flag_count is cookie-level cardinality, not page-level.
            # This is a domain-level check — 1 domain is affected when any cookies fail.
            "pages_affected": 1 if cookie_kpi.get("missing_cookie_flag_count", 0) > 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if cookie_kpi.get("missing_cookie_flag_count", 0) > 0 else [],
            "status": "failing" if cookie_kpi.get("missing_cookie_flag_count", 0) > 0 else "passing",
            "type": "bug" if cookie_kpi.get("missing_cookie_flag_count", 0) > 0 else None,
            "severity": cookie_severity,
            "data": {
                "missing_count": cookie_kpi.get("missing_cookie_flag_count", 0),
                "cookies": cookie_kpi.get("cookies_with_missing_flags", []),
            }
        },
        "SQL Injection et DDoS": _build_vuln_kpi(da, domain_url),
        "Exposition Services Reseau": {
            "info": f"Services exposés: {len(service_exposure_open_services)} (hôte: {service_exposure.get('host', '') or 'N/A'})",
            "impact": "Ports sensibles exposés = surface d'attaque réseau accrue (intrusion, brute force, exfiltration)",
            "pages_affected": 1 if service_exposure_status in {"failing", "warning"} else 0,
            "pages_affected_urls": [report.get("domain", "")] if service_exposure_status in {"failing", "warning"} else [],
            "status": service_exposure_status,
            "type": "bug" if service_exposure_status in {"failing", "warning"} else None,
            "severity": service_exposure_severity,
            "data": {
                "enabled": service_exposure_enabled,
                "host": service_exposure.get("host", ""),
                "timeout_ms": service_exposure.get("timeout_ms"),
                "ports_scanned": _safe_list(service_exposure.get("ports_scanned", [])),
                "open_services": service_exposure_open_services,
                "status": service_exposure_status_raw or service_exposure.get("status", ""),
                "severity": service_exposure.get("severity", ""),
                "impact": service_exposure.get("impact", ""),
                "warning": service_exposure.get("warning", ""),
                "error": service_exposure.get("error", ""),
                "critical_open_count": service_exposure_critical_open,
                "high_open_count": service_exposure_high_open,
                "medium_open_count": service_exposure_medium_open,
                "low_open_count": service_exposure_low_open,
                "data_quality": "VALID" if service_exposure_enabled else "MISSING",
                "applicability_context": "public_web_ports_expected" if service_exposure_low_open > 0 and service_exposure_medium_open == 0 and service_exposure_high_open == 0 and service_exposure_critical_open == 0 else "network_exposure",
            },
        },

        "Pages Admin Exposées": {
            "info": f"Endpoints admin/sensibles: exposés={len(admin_exposed)}, protégés={len(admin_forbidden)}, instables={len(admin_server_errors)}",
            "impact": "Pages admin accessibles ou instables = surface d'attaque et risque de compromission",
            "pages_affected": len(admin_risky),
            "pages_affected_urls": _to_absolute_urls(domain_url, admin_risky),
            "status": "failing" if admin_has_issue else "passing",
            "type": "bug" if admin_has_issue else None,
            "severity": "critical" if len(admin_exposed) > 0 else ("high" if len(admin_server_errors) > 0 else None),
            "data": admin_exposure,
        },
        "Divulgation de Version CMS": {
            "info": f"Fichiers version CMS: exposés={len(version_disclosed)}, protégés={len(version_forbidden)}, instables={len(version_server_errors)}",
            "impact": "Divulgation/versioning facilite la reconnaissance et l'exploitation de vulnérabilités",
            "pages_affected": len(version_risky),
            "pages_affected_urls": _to_absolute_urls(domain_url, version_risky),
            "status": "failing" if version_disclosure_has_issue else "passing",
            "type": "bug" if version_disclosure_has_issue else None,
            "severity": "high" if len(version_server_errors) > 0 else ("medium" if len(version_disclosed) > 0 else None),
            "data": version_disclosure,
        },
        "Divulgation d'Information via robots.txt": {
            "info": f"Chemins sensibles dans robots.txt: {len(robots_paths)} révélés",
            "impact": "Chemins sensibles exposés via robots.txt = reconnaissance facilitée pour attaquants",
            "pages_affected": len(robots_paths),
            "pages_affected_urls": _to_absolute_urls(domain_url, robots_paths),
            "status": "failing" if robots_has_issue else "passing",
            "type": "bug" if robots_has_issue else None,
            "severity": "medium" if robots_has_issue else None,
            "data": robots_disclosure,
        },
        "Fuite d'Information Page d'Erreur": {
            "info": f"Indicateurs de fuite dans page d'erreur: {len(error_leaks)} détectés",
            "impact": "Page d'erreur révélant infos sensibles (stack trace, chemin fichier) = reconnaissance d'attaquant",
            "pages_affected": 1 if error_page_has_issue else 0,
            "pages_affected_urls": _safe_list([report.get('domain', '')]) if error_page_has_issue else [],
            "status": "failing" if error_page_has_issue else "passing",
            "type": "bug" if error_page_has_issue else None,
            "severity": "medium" if error_page_has_issue else None,
            "data": error_page_leak,
        },
        "Fichiers Sensibles Exposés": {
            "info": f"Fichiers sensibles: exposés={len(sensitive_exposed)}, protégés={len(sensitive_forbidden)}, instables={len(sensitive_server_errors)}",
            "impact": "Fichiers sensibles accessibles ou instables peuvent exposer secrets, configs et données",
            # [#11] pages_affected should be 1 (domain-level check), not the count of endpoints.
            # Exposed/server_error paths are endpoint-level, not page-level — they go in pages_affected_urls.
            "pages_affected": 1 if sensitive_risky else 0,
            "pages_affected_urls": _to_absolute_urls(domain_url, sensitive_risky),
            "status": "failing" if sensitive_risky else "passing",
            "type": "bug" if sensitive_risky else None,
            "severity": "critical" if sensitive_exposed else ("high" if sensitive_server_errors else None),
            "data": sensitive_file_exposure,
        },
        "Méthodes HTTP TRACE/TRACK": {
            "info": f"Méthodes TRACE/TRACK activées: {'OUI' if sec.get('http_trace_methods', {}).get('detected', False) else 'NON'}",
            "impact": "Méthodes TRACE/TRACK activées = accès aux en-têtes de requête sensibles (XST)",
            "pages_affected": 1 if sec.get('http_trace_methods', {}).get('detected', False) else 0,
            "pages_affected_urls": _safe_list([report.get('domain', '')]) if sec.get('http_trace_methods', {}).get('detected', False) else [],
            "status": "failing" if sec.get('http_trace_methods', {}).get('detected', False) else "passing",
            "type": "bug" if sec.get('http_trace_methods', {}).get('detected', False) else None,
            "severity": "high" if sec.get('http_trace_methods', {}).get('detected', False) else None,
            "data": sec.get('http_trace_methods', {}),
        },
        "Misconfiguration CORS": {
            "info": f"CORS misconfigurée: {'OUI' if sec.get('cors_misconfiguration', {}).get('misconfigured', False) else 'NON'} - {sec.get('cors_misconfiguration', {}).get('details', '')}",
            "impact": "CORS mal configurée (wildcard + credentials, Origin reflect) = vol de données cross-origin",
            "pages_affected": 1 if sec.get('cors_misconfiguration', {}).get('misconfigured', False) else 0,
            "pages_affected_urls": _safe_list([report.get('domain', '')]) if sec.get('cors_misconfiguration', {}).get('misconfigured', False) else [],
            "status": "failing" if sec.get('cors_misconfiguration', {}).get('misconfigured', False) else "passing",
            "type": "bug" if sec.get('cors_misconfiguration', {}).get('misconfigured', False) else None,
            "severity": "high" if sec.get('cors_misconfiguration', {}).get('misconfigured', False) else None,
            "data": sec.get('cors_misconfiguration', {}),
        },
        "Protection Brute Force Login": {
            "info": f"Protection brute force sur login: {'OUI' if brute_force_protected else 'NON'} - {brute_force_login.get('details', '')}",
            "impact": "Pas de protection brute force = facilite attaques par dictionnaire sur credentials",
            "pages_affected": 1 if brute_force_has_issue else 0,
            "pages_affected_urls": _safe_list([brute_force_login.get("target_url") or report.get('domain', '')]) if brute_force_has_issue else [],
            "status": (
                "failing" if brute_force_has_issue
                else "passing" if has_login and brute_force_target_confirmed and brute_force_protected
                else "not_evaluated"
            ),
            "type": "bug" if brute_force_has_issue else None,
            "severity": "high" if brute_force_has_issue else None,
            "data": {
                **brute_force_login,
                "execution_status": "completed" if brute_force_target_confirmed else "target_rejected",
                "failure_reason": brute_force_login.get("failure_reason") or (None if brute_force_target_confirmed else "login_target_not_confirmed"),
                "data_quality": "VALID" if brute_force_target_confirmed else "MISSING",
                "confidence": brute_force_login.get("confidence") or ("high" if brute_force_target_confirmed else "none"),
                "tested_targets": _safe_list(brute_force_login.get("tested_targets")),
                "rejected_candidates": _safe_list(brute_force_login.get("rejected_candidates")),
                "applicability_context": "login_only",
            },
        },
        "Contrôle d'Extension Upload Fichier": {
            "info": f"Restrictions upload fichier: {'OUI' if upload_restrictions_found else 'NON'} - {len(upload_issues)} problèmes",
            "impact": "Pas de restriction upload = RCE, malware upload, défacement",
            "pages_affected": max(1, len(upload_issues)) if upload_has_issue else 0,
            "pages_affected_urls": _safe_list([domain_url]) if upload_has_issue else [],
            "status": "failing" if upload_has_issue else ("passing" if upload_restrictions_found else "not_evaluated"),
            "type": "bug" if upload_has_issue else None,
            "severity": "critical" if upload_has_issue else None,
            "data": upload_control,
        },
        "Dépendances JS Vulnérables (CVE)": {
            "info": f"Librairies JS vulnérables: {len(vulnerable_libraries)} détectées",
            "impact": "Dépendances vulnérables = exploitation via CVEs connus (RCE, XSS, DoS)",
            "pages_affected": 1 if vulnerable_js_has_issue else 0,
            "pages_affected_urls": _safe_list([report.get('domain', '')]) if vulnerable_js_has_issue else [],
            "status": "failing" if vulnerable_js_has_issue else "passing",
            "type": "bug" if vulnerable_js_has_issue else None,
            "severity": "critical" if any(_safe_dict(lib).get('severity') == 'critical' for lib in vulnerable_libraries) else ("high" if vulnerable_js_has_issue else None),
            "data": vulnerable_js,
        }
    }

    # ─── AUDIT FONCTIONNEL ──────────────────────────────────────────────────────
    axes["Audit Fonctionnel"] = {
        "Les Formulaires": {
            "info": f"{functional_fuzzer_kpi.get('unique_transactional_forms_detected', functional_kpi.get('total_forms', 0))} formulaires transactionnels détectés, {functional_fuzzer_kpi.get('tests_run', 0)} tests exécutés"
                    f"{' (pages affectées estimées)' if functional_fuzzer_kpi.get('affected_pages_estimated') else ''}",
            "impact": "Formulaires avec bugs = perte de conversions et problèmes de saisie utilisateur",
            "pages_affected": (
                _safe_int(functional_fuzzer_kpi.get("affected_pages", 0))
                or len({
                    str(item.get("page_url") or "").strip()
                    for item in _safe_list(functional_fuzzer_kpi.get("top_affected", []))
                    if isinstance(item, dict) and str(item.get("page_url") or "").strip()
                })
            ),
            "pages_affected_urls": (
                _safe_list(functional_fuzzer_kpi.get("affected_page_urls", []))
                or list({
                    str(item.get("page_url") or "").strip()
                    for item in _safe_list(functional_fuzzer_kpi.get("top_affected", []))
                    if isinstance(item, dict) and str(item.get("page_url") or "").strip()
                })
            ),
            "status": (
                "failing" if functional_fuzzer_kpi.get("status") == "failing"
                else "passing" if functional_fuzzer_kpi.get("status") == "passing"
                else "non_evalue"
            ),
            "type": "bug" if functional_fuzzer_kpi.get("status") == "failing" else None,
            "severity": "high" if functional_fuzzer_kpi.get("status") == "failing" else None,
            "data": {
                "total_forms": functional_kpi.get("total_forms", 0),
                "forms_detected": functional_fuzzer_kpi.get("unique_transactional_forms_detected", functional_kpi.get("total_forms", 0)),
                "forms_tested": functional_fuzzer_kpi.get("unique_transactional_forms_tested", functional_fuzzer_kpi.get("total_forms_tested", 0)),
                "non_transactional_forms_tested": functional_fuzzer_kpi.get("non_transactional_forms_tested", 0),
                "tests_run": functional_fuzzer_kpi.get("tests_run", 0),
                "signal_count": functional_fuzzer_kpi.get("signal_count", 0),
                "response_type": functional_fuzzer_kpi.get("response_type"),
                "submitted": functional_fuzzer_kpi.get("submitted"),
                "execution_status": functional_fuzzer_kpi.get("execution_status"),
                "failure_reason": functional_fuzzer_kpi.get("failure_reason"),
                "data_quality": functional_fuzzer_kpi.get("data_quality"),
                "anomalies": functional_fuzzer_kpi.get("anomalies_count", 0),
                "suppressed_low_confidence_anomalies": functional_fuzzer_kpi.get("suppressed_low_confidence_anomalies", 0),
                "affected_pages": functional_fuzzer_kpi.get("affected_pages", 0),
                "affected_pages_estimated": bool(functional_fuzzer_kpi.get("affected_pages_estimated")),
                "affected_page_urls": _safe_list(functional_fuzzer_kpi.get("affected_page_urls", [])),
                "anomalies_by_type": functional_fuzzer_kpi.get("anomalies_by_type", {}),
                "top_affected": functional_fuzzer_kpi.get("top_affected", []),
                "anomalous_tests_all": _safe_list(functional_fuzzer_kpi.get("anomalous_tests_all", [])),
            }
        }
    }
    
    # BL-06 & BL-07: Proportional broken links logic excluding external URLs
    raw_broken_links = seo.get("broken_link_kpi", {}).get("broken_links", [])
    internal_broken_links = [l for l in raw_broken_links if not l.get("is_external")]
    external_broken_links = [l for l in raw_broken_links if l.get("is_external")]
    internal_broken_count = len(internal_broken_links)
    
    total_pages_scanned = max(_safe_int(report.get("pages_scanned", 1)), 1)
    affected_broken_pages_set = list(dict.fromkeys([l.get("found_on", "") for l in internal_broken_links if l.get("found_on")]))
    affected_broken_pages = len(affected_broken_pages_set)
    broken_ratio = affected_broken_pages / total_pages_scanned
    
    broken_status = "passing"
    broken_severity = None
    if internal_broken_count > 0:
        if broken_ratio > 0.05:
            broken_status = "failing"
            broken_severity = "high"
        elif broken_ratio > 0.005:
            broken_status = "warning"
            broken_severity = "medium"
        elif affected_broken_pages <= 5:
            broken_status = "warning"
            broken_severity = "low"
        else:
            broken_status = "warning"
            broken_severity = "low"
            
    axes["Audit Fonctionnel"]["Liens"] = {
        "info": f"{internal_broken_count} lien(s) interne(s) cassé(s), {len(external_broken_links)} externe(s)",
        "impact": "Liens cassés dégradent l'UX, le crawl SEO et les conversions",
        "pages_affected": affected_broken_pages,
        "pages_affected_urls": affected_broken_pages_set,
        "status": broken_status,
        "type": "bug" if internal_broken_count > 0 else None,
        "severity": broken_severity,
            "data": {
                "broken_link_count": seo.get("broken_link_kpi", {}).get("broken_link_count", 0),
                "by_status": {
                    "404": len([l for l in seo.get("broken_link_kpi", {}).get("broken_links", []) if l.get("status_code") == 404]),
                    "403": len([l for l in seo.get("broken_link_kpi", {}).get("broken_links", []) if l.get("status_code") == 403]),
                    "500": len([l for l in seo.get("broken_link_kpi", {}).get("broken_links", []) if l.get("status_code") == 500]),
                },
                "broken_links": [
                    {
                        "url": link.get("url"),
                        "status_code": link.get("status_code"),
                        "error": link.get("error"),
                        "source_page": link.get("found_on"),
                        "anchor_text": link.get("anchor_text"),
                        "link_selector": None,
                        "context": None,
                    }
                    for link in seo.get("broken_link_kpi", {}).get("broken_links", [])
                ],
            },
    }

    axes["Audit Fonctionnel"]["Boutons"] = {
        "info": f"Boutons non-fonctionnels: {perf.get('button_kpi', {}).get('pages_with_nonfunc_buttons', 0)} pages affectées",
        "impact": "Boutons non-fonctionnels = abandon de parcours utilisateur et baisse de conversion",
        "pages_affected": perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0),
        "pages_affected_urls": list(dict.fromkeys(_safe_list(non_func_buttons_evidence.get("affected_pages")))),
        "status": "failing" if perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0) > 0 else "passing",
        "type": "bug" if perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0) > 0 else None,
        "severity": "medium" if perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0) > 0 else None,
        "data": {
            "pages_with_nonfunc_buttons": perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0),
            "total_broken_buttons": int(total_broken_buttons or 0),
            "broken_buttons": [
                {
                    "url": btn.get("url"),
                    "label": btn.get("label"),
                    "selector": btn.get("selector"),
                    "tag": btn.get("tag"),
                    "issue_type": btn.get("issue_type"),
                    "href": btn.get("href"),
                    "onclick": btn.get("onclick"),
                    "form_action": btn.get("form_action"),
                }
                for btn in broken_buttons
                if isinstance(btn, dict)
            ],
        },
    }

    _feat_has_contact = bool(functional_kpi.get("has_contact"))
    _feat_has_rdv = bool(functional_kpi.get("has_rdv"))
    _feat_has_search = bool(functional_kpi.get("has_search"))
    _feat_has_login = bool(functional_kpi.get("has_login"))
    _feat_has_newsletter = bool(functional_kpi.get("has_newsletter"))
    _feat_has_cart = bool(functional_kpi.get("has_cart"))
    _feat_secondary = _feat_has_search or _feat_has_login or _feat_has_newsletter or _feat_has_cart
    if not _feat_has_contact and not _feat_has_rdv:
        _feat_status = "failing"
        _feat_type = "bug"
        _feat_severity = "high"
    elif (_feat_has_contact or _feat_has_rdv) and _feat_secondary:
        _feat_status = "passing"
        _feat_type = None
        _feat_severity = None
    else:
        _feat_status = "warning"
        _feat_type = "recommendation"
        _feat_severity = "medium"

    axes["Audit Fonctionnel"]["Fonctionnalités"] = {
        "info": f"Fonctionnalités détectées: Connexion={functional_kpi.get('has_login')}, Contact={functional_kpi.get('has_contact')}, Newsletter={functional_kpi.get('has_newsletter')}, Panier={functional_kpi.get('has_cart')}, RDV={functional_kpi.get('has_rdv')}",
        "impact": "Fonctionnalités manquantes = services utilisateur incomplets",
        "pages_affected": 0,
        "pages_affected_urls": [],
        "status": _feat_status,
        "type": _feat_type,
        "severity": _feat_severity,
        "data": {
            "has_login": functional_kpi.get("has_login"),
            "has_contact": functional_kpi.get("has_contact"),
            "has_newsletter": functional_kpi.get("has_newsletter"),
            "has_cart": functional_kpi.get("has_cart"),
            "has_rdv": functional_kpi.get("has_rdv"),
        }
    }

    search_rows = _safe_list(functional_kpi.get("search_tests") or functional_kpi.get("search_rows"))
    search_executed = bool(functional_kpi.get("search_executed"))
    if not search_executed:
        executed_statuses = {"passed", "failed", "executed", "tested"}
        search_executed = any(
            bool(_safe_dict(row).get("executed"))
            or _clean_text(_safe_dict(row).get("status")).lower() in executed_statuses
            for row in search_rows
        )
    search_passed = functional_kpi.get("search_passed")
    search_status = (
        "passing" if search_executed and search_passed is not False
        else "failing" if search_executed and search_passed is False
        else "not_evaluated"
    )
    axes["Audit Fonctionnel"]["Fonctionnement du Moteur de Recherche Interne"] = {
        "info": f"Moteur de recherche interne: {'Détecté' if functional_kpi.get('has_search') else 'Non détecté'}",
        "impact": "Fonctionnement défaillant = utilisateurs ne trouvent pas le contenu, taux de rebond élevé",
        "pages_affected": 1 if search_status == "failing" else 0,
        "pages_affected_urls": [domain_url] if search_status == "failing" else [],
        "status": search_status,
        "type": "bug" if search_status == "failing" else None,
        "severity": "medium" if search_status == "failing" else None,
        "data": {
            "has_search": functional_kpi.get("has_search"),
            "search_executed": search_executed,
            "search_passed": search_passed,
            "rows": search_rows,
        }
    }

    # ─── AUDIT DE PERFORMANCE ET TEMPS DE RÉPONSE ──────────────────────────────
    mobile_kpi = _safe_dict(perf.get("mobile_kpi", {}))
    mobile_available = mobile_kpi.get("available", False)
    mobile_status = _resolve_mobile_kpi_status(mobile_kpi)
    mobile_is_available = mobile_status != "not_available"
    mobile_friendly_kpi = _safe_dict(ux.get("mobile_friendly_kpi", {}))
    mobile_friendly_status = _resolve_mobile_friendly_status(mobile_friendly_kpi)
    mobile_friendly_available = mobile_friendly_status != "not_available"
    raw_headless_rows = _performance_digest_rows({"rows": _safe_list(perf.get("headless_rows"))})
    valid_headless_rows = [row for row in raw_headless_rows if _is_valid_performance_digest_row(row)]
    if raw_headless_rows:
        if valid_headless_rows:
            avg_fcp_ms = sum(_safe_float(row.get("fcp_ms")) for row in valid_headless_rows) / len(valid_headless_rows)
            avg_lcp_ms = sum(_safe_float(row.get("lcp_ms")) for row in valid_headless_rows) / len(valid_headless_rows)
            avg_cls = sum(_safe_float(row.get("cls")) for row in valid_headless_rows) / len(valid_headless_rows)
            eco_values = [_optional_float(row.get("eco_index")) for row in valid_headless_rows]
            eco_values = [value for value in eco_values if value is not None]
            avg_eco_index = sum(eco_values) / len(eco_values) if eco_values else None
        else:
            avg_fcp_ms = None
            avg_lcp_ms = None
            avg_cls = None
            avg_eco_index = None
    else:
        avg_fcp_ms = _optional_float(perf.get("avg_fcp_ms"))
        avg_lcp_ms = _optional_float(perf.get("avg_lcp_ms"))
        avg_cls = _optional_float(perf.get("avg_cls"))
        avg_eco_index = _optional_float(perf.get("avg_eco_index"))
    effective_lcp_ms = _optional_float(perf.get("effective_lcp_ms")) or avg_lcp_ms
    fallback_render_count = _safe_int(perf.get("fallback_render_count"))
    performance_data_quality = "MISSING" if raw_headless_rows and not valid_headless_rows else "PARTIAL" if len(valid_headless_rows) < len(raw_headless_rows) else "VALID"
    image_stats = _safe_dict(content.get("image_compression_stats", {}))
    compression_rate_pct = _optional_float(image_stats.get("compression_rate_pct")) or 0.0
    sampled_images = _safe_int(image_stats.get("sampled_images"))
    unoptimised_count = _safe_int(image_stats.get("unoptimised_count"))
    desktop_perf_status = "non_evalue" if effective_lcp_ms is None or effective_lcp_ms <= 0 or avg_fcp_ms is None or avg_fcp_ms <= 0 else ("failing" if effective_lcp_ms > 2500 else "passing")
    image_perf_status = "non_evalue" if sampled_images <= 0 else ("failing" if unoptimised_count > 0 else "passing")
    cache_is_friendly = _is_cache_friendly(sec.get("cache_control"), bool(sec.get("has_cache")))
    eco_status = "non_evalue" if avg_eco_index is None else ("failing" if avg_eco_index < 30 else "warning" if avg_eco_index < 70 else "passing")
    
    axes["Audit de Performance et Temps de Réponse"] = {
        "Temps de Chargement Desktop": {
            "info": (
                f"FCP={avg_fcp_ms:.0f}ms, LCP={avg_lcp_ms:.0f}ms, CLS={(avg_cls or 0):.2f}"
                if desktop_perf_status != "non_evalue"
                else "Mesure FCP/LCP desktop indisponible"
            ),
            "impact": "Temps de chargement élevé = abandon utilisateur, baisse des conversions, mauvais SEO",
            "pages_affected": report.get("pages_scanned", 0) if desktop_perf_status == "failing" else 0,
            "pages_affected_urls": _safe_list(heading_hierarchy_evidence.get("affected_pages")) if desktop_perf_status == "failing" else [],
            "status": desktop_perf_status,
            "type": "recommendation" if desktop_perf_status == "failing" else None,
            "severity": None,
            "data": {
                "fcp_ms": avg_fcp_ms,
                "lcp_ms": avg_lcp_ms,
                "effective_lcp_ms": effective_lcp_ms,
                "fallback_render_count": fallback_render_count,
                "confidence_multiplier": perf.get("confidence_multiplier"),
                "measurement_note": "Certaines mesures desktop proviennent du moteur de rendu de secours Obscura et sont ponderees a 90%." if fallback_render_count > 0 else None,
                "cls": avg_cls,
                "speed_index_ms": perf.get("avg_speed_index_ms"),
                "speed_index_synthetic": True,
                "rows": valid_headless_rows or _safe_list(perf.get("headless_rows")),
                "measurement_row_count": len(raw_headless_rows),
                "valid_measurement_count": len(valid_headless_rows),
                "data_quality": "MISSING" if desktop_perf_status == "non_evalue" else performance_data_quality,
            }
        },
        "Temps de Chargement Mobile": {
            "info": f"Pages testees: {_safe_int(mobile_kpi.get('pages_attempted', 1 if mobile_available else 0))}, mesures valides: {_safe_int(mobile_kpi.get('pages_measured', 1 if mobile_available else 0))}",
            "impact": "Performance mobile dégradée = mauvaise expérience et pénalité SEO mobile-first",
            "pages_affected": 1 if mobile_is_available else 0,
            "pages_affected_urls": [report.get("domain", "")] if mobile_is_available else [],
            "status": mobile_status,
            "type": None,
            "severity": None,
            "data": {
                **mobile_kpi,
                "failure_reason": mobile_kpi.get("failure_reason") or ("mobile_cwv_measurement_failed" if _safe_int(mobile_kpi.get("pages_attempted")) > 0 and _safe_int(mobile_kpi.get("pages_measured")) == 0 else None),
                "execution_status": mobile_kpi.get("execution_status") or ("failed" if _safe_int(mobile_kpi.get("pages_attempted")) > 0 and _safe_int(mobile_kpi.get("pages_measured")) == 0 else "completed"),
                "data_quality": mobile_kpi.get("data_quality") or ("MISSING" if not mobile_is_available else "VALID"),
                "rows": _safe_list(mobile_kpi.get("rows")) or ([{
                    "url": report.get("domain", ""),
                    "profile": "mobile",
                    "fcp_ms": mobile_kpi.get("fcp_ms"),
                    "lcp_ms": mobile_kpi.get("lcp_ms"),
                    "cls": mobile_kpi.get("cls"),
                    "speed_index_ms": mobile_kpi.get("speed_index_ms"),
                    "issue": ", ".join(str(item) for item in _safe_list(mobile_kpi.get("issues"))),
                }] if mobile_is_available else []),
            },
        },
        "Optimisation des Images": {
            "info": f"Compression: {compression_rate_pct:.1f}%, Images non optimisées: {content.get('image_compression_stats', {}).get('unoptimised_count', 0)}/{content.get('image_compression_stats', {}).get('sampled_images', 0)}",
            "impact": "Images mal optimisées = temps de chargement lent, énergie wasted, mauvaise UX",
            "pages_affected": unoptimised_count if image_perf_status == "failing" else 0,
            "pages_affected_urls": [img.get("url", "") for img in _safe_list(image_stats.get("unoptimised_images", []))][:5] if image_perf_status == "failing" else [],
            "status": image_perf_status,
            "type": "recommendation" if image_perf_status == "failing" else None,
            "severity": None,
            "data": {**image_stats, "data_quality": "MISSING" if sampled_images <= 0 else "VALID"},
        },
        "Gestion de Cache": {
            "info": f"Cache: {'Activé' if sec.get('has_cache') else 'Désactivé'}, Control: {sec.get('cache_control', 'N/A')}",
            "impact": "Cache désactivé = plus de requêtes serveur, temps de réponse lent, surcharge serveur",
            "pages_affected": 0 if cache_is_friendly else 1,
            "pages_affected_urls": [] if cache_is_friendly else [report.get("domain", "")],
            "status": "passing" if cache_is_friendly else "failing",
            "type": "recommendation" if not cache_is_friendly else None,
            "severity": None,
            "data": {
                "has_cache": sec.get("has_cache"),
                "cache_control": sec.get("cache_control"),
                "cache_policy": sec.get("cache_policy"),
                "cache_friendly": cache_is_friendly,
                "rows": [{
                    "url": report.get("domain", ""),
                    "cache_control": sec.get("cache_control"),
                    "etag": sec.get("etag"),
                    "expires": sec.get("expires"),
                    "ttl_interpretation": sec.get("cache_policy"),
                }],
            },
        },
        "Utilisation de Compression": {
            "info": f"Compression HTTP: {'Activée' if perf.get('html_compression_applied') else 'Désactivée'}",
            "impact": "Compression désactivée = taille des transferts importante, navigation plus lente",
            "pages_affected": 1 if not perf.get("html_compression_applied") else 0,
            "pages_affected_urls": [report.get("domain", "")] if not perf.get("html_compression_applied") else [],
            "status": "failing" if not perf.get("html_compression_applied") else "passing",
            "type": "recommendation" if not perf.get("html_compression_applied") else None,
            "severity": None,
            "data": {
                "html_compression_applied": perf.get("html_compression_applied"),
                "rows": [{
                    "url": report.get("domain", ""),
                    "accept_encoding": "gzip, br",
                    "content_encoding": sec.get("compression"),
                    "compressed": perf.get("html_compression_applied"),
                }],
            },
        },
        "Erreurs Console JavaScript": {
            "info": f"Pages avec erreurs console: {_safe_int(perf.get('console_error_kpi', {}).get('pages_with_console_errors'))}",
            "impact": "Erreurs JavaScript = fonctionnalites bloquees et parcours utilisateur instables",
            "pages_affected": _safe_int(perf.get("console_error_kpi", {}).get("pages_with_console_errors")),
            "pages_affected_urls": _safe_list(perf.get("console_error_kpi", {}).get("page_urls")),
            "status": "failing" if _safe_int(perf.get("console_error_kpi", {}).get("pages_with_console_errors")) > 0 else "passing",
            "type": "bug" if _safe_int(perf.get("console_error_kpi", {}).get("pages_with_console_errors")) > 0 else None,
            "severity": "medium" if _safe_int(perf.get("console_error_kpi", {}).get("pages_with_console_errors")) > 0 else None,
            "data": {
                **_safe_dict(perf.get("console_error_kpi")),
                "rows": _safe_list(_safe_dict(perf.get("console_error_kpi")).get("rows")),
            },
        }
    }

    # ─── SEO ──────────────────────────────────────────────────────────────────────
    internal_link_measurement = _safe_dict(seo.get("contextual_link_measurement", {}))
    internal_link_pages_checked = _safe_int(internal_link_measurement.get("pages_checked"))
    internal_link_reliable_coverage_pct = _safe_float(internal_link_measurement.get("reliable_coverage_pct"))
    internal_link_total = _safe_int(seo.get("total_internal_links", 0))
    contextual_link_total = _safe_int(seo.get("total_contextual_internal_links", 0))
    missing_contextual_pages = _safe_int(ux.get("pages_missing_contextual_links", 0))
    sitewide_zero_contextual_suspect = (
        internal_link_pages_checked > 0
        and internal_link_reliable_coverage_pct >= 90.0
        and internal_link_total > 0
        and contextual_link_total == 0
        and missing_contextual_pages * 10 >= internal_link_pages_checked * 9
    )
    axes["SEO"] = {
        "Balise Alts": {
            "info": f"Images sans ALT: {seo.get('images_missing_alt', 0)} images",
            "impact": "Images sans ALT = perte de signal SEO, accessibilité dégradée, mauvaise expérience handicapés",
            "pages_affected": seo.get("images_missing_alt", 0),
            "pages_affected_urls": list(dict.fromkeys([
                img.get("page_url") or img.get("url") or img.get("image_url")
                for img in _safe_list(missing_alt_evidence.get("images"))
                if isinstance(img, dict) and (img.get("page_url") or img.get("url") or img.get("image_url"))
            ])),
            "status": "failing" if seo.get("images_missing_alt", 0) > 0 else "passing",
            "type": "recommendation" if seo.get("images_missing_alt", 0) > 0 else None,
            "severity": None,
            "data": {
                "images_missing_alt": seo.get("images_missing_alt", 0),
                "images": _safe_list(missing_alt_evidence.get("images")),
            },
        },
        "Balises META": {
            "info": f"Meta descriptions manquantes: {seo.get('pages_missing_meta_desc', 0)} pages, Titres manquants: {seo.get('pages_missing_title', 0)} pages",
            "impact": "Meta descriptions manquantes = mauvais CTR dans SERP et signaux SEO réduits",
            "pages_affected": seo.get("pages_missing_meta_desc", 0),
            "pages_affected_urls": list(dict.fromkeys(_safe_list(missing_meta_evidence.get("affected_pages")) + _safe_list(missing_title_evidence.get("affected_pages")))),
            "status": "failing" if seo.get("pages_missing_meta_desc", 0) > 0 or seo.get("pages_missing_title", 0) > 0 else "passing",
            "type": "recommendation" if seo.get("pages_missing_meta_desc", 0) > 0 or seo.get("pages_missing_title", 0) > 0 else None,
            "severity": None,
            "data": {
                "pages_missing_meta_desc": seo.get("pages_missing_meta_desc", 0),
                "pages_missing_title": seo.get("pages_missing_title", 0),
                "affected_pages_meta": _safe_list(missing_meta_evidence.get("affected_pages")),
                "affected_pages_title": _safe_list(missing_title_evidence.get("affected_pages")),
            },
        },
        "Sitemap": {
            "info": f"Sitemap XML: {'Présent' if seo.get('has_sitemap') else 'Absent'}",
            "impact": "Sitemap absent = crawl SEO moins efficace, indexation potentiellement incomplète",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing" if seo.get("has_sitemap") else "failing",
            "type": "recommendation" if not seo.get("has_sitemap") else None,
            "severity": None,
            "data": {
                "has_sitemap": seo.get("has_sitemap"),
                "sitemap_url": seo.get("sitemap_url"),
                "sitemap_detected_via": seo.get("sitemap_detected_via"),
            },
        },
        "Robot Txt": {
            "info": f"robots.txt: {'Présent' if seo.get('has_robots_txt') else 'Absent'}",
            "impact": "robots.txt absent = contrôle insuffisant du crawl, risque d'indexation de pages sensibles",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing" if seo.get("has_robots_txt") else "failing",
            "type": "recommendation" if not seo.get("has_robots_txt") else None,
            "severity": None,
            "data": {
                "has_robots_txt": seo.get("has_robots_txt"),
                "robots_url": seo.get("robots_url"),
                "robots_detected_via": seo.get("robots_detected_via"),
            },
        },
        "Duplication de Contenu": {
            "info": f"Taux de duplication: {seo.get('duplicate_content_kpi', {}).get('duplicate_content_rate_pct', 0):.1f}% ({seo.get('duplicate_content_kpi', {}).get('duplicate_page_count', 0)} pages), fiabilité: {seo.get('duplicate_content_kpi', {}).get('duplication_reliability', 'unknown')}",
            "impact": "Contenu dupliqué = cannibalisation SEO, dilution de pertinence, classement affaibli",
            "pages_affected": seo.get("duplicate_content_kpi", {}).get("duplicate_page_count", 0),
            "pages_affected_urls": [],
            "status": (
                "not_evaluated" if seo.get("duplicate_content_kpi", {}).get("pipeline_suspect") or seo.get("duplicate_content_kpi", {}).get("passed") is None
                else ("failing" if seo.get("duplicate_content_kpi", {}).get("duplicate_content_rate_pct", 0) > 10.0 else "passing")
            ),
            "type": (
                None if seo.get("duplicate_content_kpi", {}).get("pipeline_suspect") or seo.get("duplicate_content_kpi", {}).get("passed") is None
                else ("recommendation" if seo.get("duplicate_content_kpi", {}).get("duplicate_content_rate_pct", 0) > 10.0 else None)
            ),
            "severity": None,
            "data": {
                **_safe_dict(seo.get("duplicate_content_kpi", {})),
                "rows": _safe_list(_safe_dict(seo.get("duplicate_content_kpi", {})).get("duplicate_clusters")),
            },
        },
        "Compatibilité Multiplateforme": {
            "info": f"Multi-browser: {seo.get('multi_browser_compatibility', {}).get('status', 'unknown')}",
            "impact": "Incompatibilité multiplateforme = perte d'utilisateurs, mauvaise expérience, pénalité SEO",
            "pages_affected": 1 if seo.get("multi_browser_compatibility", {}).get("status") != "not_available" else 0,
            "pages_affected_urls": [report.get("domain", "")] if seo.get("multi_browser_compatibility", {}).get("status") != "not_available" else [],
            "status": (
                "not_available"
                if seo.get("multi_browser_compatibility", {}).get("status") == "not_available"
                else ("failing" if seo.get("multi_browser_compatibility", {}).get("passed") is False else "passing")
            ),
            "type": "recommendation" if seo.get("multi_browser_compatibility", {}).get("passed") is False else None,
            "severity": None,
            "data": seo.get("multi_browser_compatibility", {}),
        },
        "Structure des URLs": {
            "info": f"URLs non-propres (node/query): {seo.get('node_style_url_count', 0)} URL(s)",
            "impact": "URLs sales = mauvais SEO, inefficacité crawl, perte de PageRank",
            "pages_affected": seo.get("node_style_url_count", 0),
            "pages_affected_urls": [],
            "status": "failing" if seo.get("node_style_url_count", 0) > 0 else "passing",
            "type": "recommendation" if seo.get("node_style_url_count", 0) > 0 else None,
            "severity": None,
            "data": {
                "node_style_url_count": seo.get("node_style_url_count", 0),
                "rows": _safe_list(seo.get("non_clean_urls_all")),
            },
        },
        "Structure du Contenu (Hn)": {
            "info": f"Pages avec mauvaise structure H1: {seo.get('pages_with_bad_h1', 0)}, Homepage H1: {'Manquant' if seo.get('homepage_h1_kpi', {}).get('homepage_h1_missing') else 'Présent'}",
            "impact": "Structure H1 défaillante = signal SEO réduit, hiérarchie de contenu confuse pour utilisateurs",
            "pages_affected": seo_bad_h1_pages,
            "pages_affected_urls": [],
            "status": "failing" if seo_bad_h1_pages > 0 or seo.get("homepage_h1_kpi", {}).get("homepage_h1_missing") else "passing",
            "type": "recommendation" if seo_bad_h1_pages > 0 else None,
            "severity": None,
            "data": {
                "pages_with_bad_h1": seo_bad_h1_pages,
                "pages_checked": pages_checked_total,
                "affected_pages": seo_bad_h1_pages,
                "affected_elements": seo_bad_h1_raw,
                "homepage_h1_missing": seo.get("homepage_h1_kpi", {}).get("homepage_h1_missing"),
                "bad_h1_urls": _safe_list(heading_hierarchy_evidence.get("affected_pages")),
                "heading_hierarchy_note": heading_hierarchy_evidence.get("note"),
                "homepage_url": domain_url,
            },
        },
        "Linking Interne": {
            "info": f"Total liens internes: {seo.get('total_internal_links', 0)}, Pages manquant liens contextuels: {ux.get('pages_missing_contextual_links', 0)}",
            "impact": "Linking interne faible = distribution du PageRank inefficace, crawl incomplet, perte de pertinence",
            "pages_affected": ux.get("pages_missing_contextual_links", 0),
            "pages_affected_urls": _safe_list(internal_contextual_links_evidence.get("affected_pages")),
            "status": (
                "non_evalue" if (
                    internal_link_pages_checked > 0
                    and internal_link_reliable_coverage_pct < 50.0
                )
                else "warning" if (
                    (internal_link_total == 0 and contextual_link_total > 0)
                    or sitewide_zero_contextual_suspect
                )
                else "failing" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.30
                else "warning" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.15
                else "passing"
            ),
            "type": (
                None if (
                    internal_link_pages_checked > 0
                    and internal_link_reliable_coverage_pct < 50.0
                )
                else
                "recommendation" if (
                    (internal_link_total == 0 and contextual_link_total > 0)
                    or sitewide_zero_contextual_suspect
                    or ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.15
                )
                else None
            ),
            "severity": (
                "medium" if ((internal_link_total == 0 and contextual_link_total > 0) or sitewide_zero_contextual_suspect)
                else "high" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.30
                else "medium" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.15
                else None
            ),
            "data": {
                "total_internal_links": seo.get("total_internal_links", 0),
                "total_contextual_internal_links": seo.get("total_contextual_internal_links", 0),
                "internal_linking_source": seo.get("internal_linking_source"),
                "pages_missing_contextual_links": ux.get("pages_missing_contextual_links", 0),
                "pages_missing_contextual_links_all": _safe_list(internal_contextual_links_evidence.get("affected_pages")),
                "internal_linking_note": seo.get("internal_linking_note") or internal_contextual_links_evidence.get("note"),
                "contextual_link_measurement": seo.get("contextual_link_measurement", {}),
            },
        },
        "Linking Externe": {
            "info": f"Total liens externes: {seo.get('total_external_links', 0)}, Domaines uniques: {seo.get('unique_external_domains', 0)}",
            "impact": "Linking externe faible = faible autorité perçue, moins de backlinks, trust réduit",
            "pages_affected": 0,
            "pages_affected_urls": [],
            "status": "passing",
            "type": None,
            "severity": None,
            "data": {
                "total_external_links": seo.get("total_external_links", 0),
                "unique_external_domains": seo.get("unique_external_domains", 0),
                "rows": _safe_list(seo.get("external_link_rows")),
            },
        },
        "Qualité H1 (NLP)": {
            "info": f"H1 manquants: {seo.get('nlp_seo_h1_kpi', {}).get('h1_missing_pages', 0)} pages, H1 multiples: {seo.get('nlp_seo_h1_kpi', {}).get('h1_multiple_pages', 0)} pages",
            "impact": "Structure H1 incorrecte nuit au SEO on-page et à la lisibilité sémantique",
            "pages_affected": _safe_int(seo.get('nlp_seo_h1_kpi', {}).get('h1_missing_pages', 0)) + _safe_int(seo.get('nlp_seo_h1_kpi', {}).get('h1_multiple_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if (_safe_int(seo.get('nlp_seo_h1_kpi', {}).get('h1_missing_pages', 0)) + _safe_int(seo.get('nlp_seo_h1_kpi', {}).get('h1_multiple_pages', 0))) > 0 else "passing",
            "type": "recommendation" if (_safe_int(seo.get('nlp_seo_h1_kpi', {}).get('h1_missing_pages', 0)) + _safe_int(seo.get('nlp_seo_h1_kpi', {}).get('h1_multiple_pages', 0))) > 0 else None,
            "severity": None,
            "data": _safe_dict(seo.get("nlp_seo_h1_kpi", {})),
        },
        "Méta Description (NLP)": {
            "info": f"Meta descriptions manquantes (NLP): {seo.get('nlp_seo_meta_kpi', {}).get('meta_missing_pages', 0)} pages",
            "impact": "Descriptions meta manquantes diminuent le CTR et la qualité des snippets SERP",
            "pages_affected": _safe_int(seo.get('nlp_seo_meta_kpi', {}).get('meta_missing_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(seo.get('nlp_seo_meta_kpi', {}).get('meta_missing_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(seo.get('nlp_seo_meta_kpi', {}).get('meta_missing_pages', 0)) > 0 else None,
            "severity": None,
            "data": _safe_dict(seo.get("nlp_seo_meta_kpi", {})),
        },
        "AI Readiness (llms.txt)": {
            "info": f"Pages avec llms.txt détecté: {seo.get('nlp_seo_ai_readiness_kpi', {}).get('llms_txt_present_pages', 0)}",
            "impact": "Absence de llms.txt réduit la découvrabilité du site dans les moteurs génératifs",
            "pages_affected": 1 if _safe_int(seo.get('nlp_seo_ai_readiness_kpi', {}).get('llms_txt_present_pages', 0)) == 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if _safe_int(seo.get('nlp_seo_ai_readiness_kpi', {}).get('llms_txt_present_pages', 0)) == 0 else [],
            "status": "failing" if _safe_int(seo.get('nlp_seo_ai_readiness_kpi', {}).get('llms_txt_present_pages', 0)) == 0 else "passing",
            "type": "recommendation" if _safe_int(seo.get('nlp_seo_ai_readiness_kpi', {}).get('llms_txt_present_pages', 0)) == 0 else None,
            "severity": "low" if _safe_int(seo.get('nlp_seo_ai_readiness_kpi', {}).get('llms_txt_present_pages', 0)) == 0 else None,
            "data": _safe_dict(seo.get("nlp_seo_ai_readiness_kpi", {})),
        }
    }

    # ─── AUDIT UX/UI ──────────────────────────────────────────────────────────────
    ux_funnel_count = _safe_int(ux.get("pages_with_conversion_funnels", 0))
    ux_funnel_inconclusive = _safe_bool(functional_kpi.get("has_cart")) and ux_funnel_count == 0
    ux_funnel_status = "passing" if ux_funnel_count > 0 else ("not_evaluated" if ux_funnel_inconclusive else "failing")

    axes["Audit UX/UI"] = {
        "Ciblage": {
            "info": f"Segments d'audience détectés: B2B={content.get('audience_segments', {}).get('counts', {}).get('b2b', 0)}, Institutionnel={content.get('audience_segments', {}).get('counts', {}).get('institutionnel', 0)}, Investisseur={content.get('audience_segments', {}).get('counts', {}).get('investisseur', 0)}",
            "impact": "Ciblage incomplet = message non adapté aux audiences, conversion réduite",
            "pages_affected": 0,
            "pages_affected_urls": [],
            "status": "passing",
            "type": None,
            "severity": None,
            "data": content.get("audience_segments", {}),
        },

        "Partage Social": {
            "info": f"Pages avec partage social: {seo.get('social_sharing_kpi', {}).get('pages_with_social_sharing', 0)}/{report.get('pages_scanned', 0)} pages",
            "impact": "Partage social faible = acquisition organique limitée, viralité réduite, portée diminuée",
            "pages_affected": report.get("pages_scanned", 0) - seo.get("social_sharing_kpi", {}).get("pages_with_social_sharing", 0),
            "pages_affected_urls": [],
            "status": "failing" if seo.get("social_sharing_kpi", {}).get("passed", True) == False else "passing",
            "type": "recommendation" if seo.get("social_sharing_kpi", {}).get("passed", True) == False else None,
            "severity": None,
            "data": seo.get("social_sharing_kpi", {}),
        },

        "Ergonomie et Design": {
            "info": f"Signaux CLS: {(avg_cls or 0.0):.2f}, Pages sans images produit: {ux.get('pages_with_missing_product_images', 0)}",
            "impact": "Design pauvre = mauvaise UX, conversion réduite, pénalité Core Web Vitals",
            "pages_affected": ux.get("pages_with_missing_product_images", 0),
            "pages_affected_urls": [],
            "status": "failing" if (avg_cls or 0.0) > 0.1 else "passing",
            "type": "recommendation" if (avg_cls or 0.0) > 0.1 else None,
            "severity": None,
            "data": {
                "avg_cls": perf.get("avg_cls"),
                "pages_missing_product_images": ux.get("pages_with_missing_product_images", 0),
            },
        },
        "Structure, Navigation et Parcours Client": {
            "info": f"Pages avec funnels de conversion: {ux.get('pages_with_conversion_funnels', 0)}/{report.get('pages_scanned', 0)}",
            "impact": "Navigation confuse = perte utilisateur, taux rebond élevé, parcours client frustrant",
            "pages_affected": 0,
            "pages_affected_urls": [],
            "status": ux_funnel_status,
            "type": None,
            "severity": None,
            "data": {
                "pages_with_conversion_funnels": ux.get("pages_with_conversion_funnels", 0),
                "pages_missing_contextual_links": ux.get("pages_missing_contextual_links", 0),
                "has_cart": functional_kpi.get("has_cart"),
                "execution_status": "detection_inconclusive" if ux_funnel_inconclusive else "completed",
                "failure_reason": "funnel_detection_inconclusive" if ux_funnel_inconclusive else None,
                "data_quality": "MISSING" if ux_funnel_inconclusive else "VALID",
            },
        },

        "Mobile Friendly": {
            "info": f"Évaluation mobile UX: {'Disponible' if mobile_friendly_available else 'Non disponible'}",
            "impact": "Site non mobile-friendly = perte d'utilisateurs mobiles (~60%), pénalité SEO mobile-first",
            "pages_affected": _safe_int(mobile_friendly_kpi.get("pages_with_mobile_overflow", 0)) if mobile_friendly_available else 0,
            "pages_affected_urls": _safe_list(mobile_friendly_kpi.get("affected_page_urls", [])) if mobile_friendly_available else [],
            "status": mobile_friendly_status,
            "type": None,
            "severity": None,
            "data": mobile_friendly_kpi,
        }
    }

    # ─── CONTENT ────────────────────────────────────────────────────────────────
    axes["Contenu"] = {
        "Fraîcheur du Contenu": {
            "info": f"Pages d'actualité: {content.get('news_page_count', 0)}, Dernière publication: {content.get('freshness_kpi', {}).get('latest_pub_date', 'N/A')}",
            "impact": "Contenu obsolète = baisse du SEO, perte de confiance utilisateur, moins de retours",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing" if content.get("freshness_kpi", {}).get("passed") else "failing",
            "type": None,
            "severity": None,
            "data": {
                "news_page_count": content.get("news_page_count", 0),
                "latest_pub_date": content.get("freshness_kpi", {}).get("latest_pub_date"),
                "rows": _safe_list(_safe_dict(content.get("freshness_kpi", {})).get("rows")),
                "passed": content.get("freshness_kpi", {}).get("passed"),
            }
        },
        "Contenu Fin et Qualité": {
            "info": f"Contenu fin (NLP <300 mots): {int(content.get('pages_thin_content_nlp', 0) or 0)} pages, Fautes: {int(content.get('typo_detection', {}).get('pages_with_typos', 0) or 0)} pages, Keyword stuffing: {int(content.get('pages_with_keyword_stuffing', 0) or 0)} pages",
            "impact": "Contenu mince = mauvais classement SEO, mauvaise UX, taux de rebond élevé",
            "pages_affected": max(
                int(content.get("pages_thin_content_nlp", 0) or 0),
                int(content.get("typo_detection", {}).get("pages_with_typos", 0) or 0),
                int(content.get("pages_with_keyword_stuffing", 0) or 0),
            ),
            "pages_affected_urls": [],
            "status": "failing" if int(content.get("pages_thin_content_nlp", 0) or 0) > 0 or int(content.get("typo_detection", {}).get("pages_with_typos", 0) or 0) > 0 or int(content.get("pages_with_keyword_stuffing", 0) or 0) > 0 else "passing",
            "type": "recommendation" if int(content.get("pages_thin_content_nlp", 0) or 0) > 0 or int(content.get("typo_detection", {}).get("pages_with_typos", 0) or 0) > 0 or int(content.get("pages_with_keyword_stuffing", 0) or 0) > 0 else None,
            "severity": None,
            "data": {
                "pages_thin_content_nlp": int(content.get("pages_thin_content_nlp", 0) or 0),
                "pages_with_typos": int(content.get("typo_detection", {}).get("pages_with_typos", 0) or 0),
                "pages_with_keyword_stuffing": int(content.get("pages_with_keyword_stuffing", 0) or 0),
                "rows": _safe_list(content.get("thin_content_rows")),
            }
        },
        "Pages Clés": {
            "info": f"Pages produits: {content.get('product_page_count', 0)}, Pages de FAQ: {content.get('faq_pages', 0)}, Pages d'accueil: {content.get('landing_page_count', 0)}, Pages partenariat: {content.get('partenariat_page_count', 0)}",
            "impact": "Pages clés mal identifiées = structure de site confuse, navigation utilisateur dégradée",
            "pages_affected": 0,
            "pages_affected_urls": [],
            "status": "passing",
            "type": None,
            "severity": None,
            "data": {
                "product_page_count": content.get("product_page_count", 0),
                "faq_pages": content.get("faq_pages", 0),
                "landing_page_count": content.get("landing_page_count", 0),
                "partenariat_page_count": content.get("partenariat_page_count", 0),
                "news_page_count": content.get("news_page_count", 0),
            }
        },
        "Cannabalisation de Mots-clés": {
            "info": f"Clusters de mots-clés cannibalisés: {len(_safe_list(content.get('cannibalized_keywords', [])))}" if content.get('cannibalized_keywords') else "Aucune cannibalisation détectée",
            "impact": "Cannabalisation = competition entre pages pour les mêmes mots-clés, dilution du classement SEO",
            "pages_affected": len(_safe_list(content.get('cannibalized_keywords', []))),
            "pages_affected_urls": [],
            "status": "passing" if not _safe_list(content.get('cannibalized_keywords')) else "failing",
            "type": "recommendation" if _safe_list(content.get('cannibalized_keywords')) else None,
            "severity": None,
            "data": {
                "cannibalized_keyword_count": len(_safe_list(content.get('cannibalized_keywords', []))),
                "cannibalized_keywords": content.get("cannibalized_keywords", []),
                "rows": [
                    {
                        "keyword": item.get("keyword"),
                        "keyword_stem": item.get("keyword_stem"),
                        "url": url,
                        "cluster_size": item.get("count"),
                    }
                    for item in _safe_list(content.get("cannibalized_keywords", []))
                    if isinstance(item, dict)
                    for url in _safe_list(item.get("pages"))
                ],
            }
        },
        "CTA Transactionnels Manquants": {
            "info": f"Pages transactionnelles sans CTA: {content.get('advanced_content_kpis', {}).get('transactional_no_cta_pages', 0)}",
            "impact": "Pages transactionnelles sans CTA réduisent directement la conversion",
            "pages_affected": _safe_int(content.get('advanced_content_kpis', {}).get('transactional_no_cta_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_content_kpis', {}).get('transactional_no_cta_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(content.get('advanced_content_kpis', {}).get('transactional_no_cta_pages', 0)) > 0 else None,
            "severity": None,
            "data": {**_safe_dict(content.get("advanced_content_kpis", {})), "rows": _safe_list(_safe_dict(content.get("advanced_content_kpis", {})).get("cta_rows"))},
        },
        "Structure Contenu Cassée": {
            "info": f"Pages avec indice structure élevé: {content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)}",
            "impact": "Structure de contenu dégradée nuit à la lisibilité, au SEO et à la conversion",
            "pages_affected": _safe_int(content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)) > 0 else None,
            "severity": None,
            "data": {**_safe_dict(content.get("advanced_content_kpis", {})), "rows": _safe_list(_safe_dict(content.get("advanced_content_kpis", {})).get("broken_structure_rows"))},
        },
        "Diversité Lexicale": {
            "info": f"Diversité lexicale moyenne: {content.get('advanced_content_kpis', {}).get('avg_lexical_diversity', 'N/A')}",
            "impact": "Faible diversité lexicale suggère contenu répétitif ou faible valeur éditoriale",
            "pages_affected": _safe_int(content.get('advanced_content_kpis', {}).get('low_lexical_diversity_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_content_kpis', {}).get('low_lexical_diversity_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(content.get('advanced_content_kpis', {}).get('low_lexical_diversity_pages', 0)) > 0 else None,
            "severity": None,
            "data": {**_safe_dict(content.get("advanced_content_kpis", {})), "rows": _safe_list(_safe_dict(content.get("advanced_content_kpis", {})).get("lexical_diversity_rows"))},
        }
    }

    # ─── ECO INDEX ──────────────────────────────────────────────────────────────
    axes["Eco Index"] = {
        "Score Écologique et Impact Climatique": {
            "info": f"Eco Index: {avg_eco_index:.1f}/100" if avg_eco_index is not None else "Eco Index: mesure indisponible",
            "impact": "Site gourmand en énergie = impact climatique, consommation serveur élevée, coûts d'infrastructure",
            "pages_affected": report.get("pages_scanned", 0),
            "pages_affected_urls": [],
            # [5.2] The original had two identical 'else "passing"' branches, making
            # eco-index 30-49 (marginal) show as green. Corrected to warn on 30-49.
            "status": eco_status,
            "type": "recommendation" if avg_eco_index is not None and avg_eco_index < 50 else None,
            "severity": None,
            "data": {
                "avg_eco_index": avg_eco_index,
                "rows": valid_headless_rows,
                "measurement_row_count": len(raw_headless_rows),
                "valid_measurement_count": len(valid_headless_rows),
                "data_quality": "MISSING" if avg_eco_index is None else performance_data_quality,
            },
        }
    }

    # ─── RGPD ───────────────────────────────────────────────────────────────────
    rgpd_runtime_unavailable = "Preuve runtime indisponible: crawl bloque ou rendu partiel, controle a relancer avec une couverture plus large."
    def _rgpd_status_from_signal(signal: bool, rows: list, missing_status: str = "failing") -> str:
        if signal:
            return "passing"
        if blocked_recovery_partial and not rows:
            return "not_evaluated"
        return missing_status

    def _rgpd_placeholder_row(status: str, snippet: str, **extra) -> dict:
        return {"page_url": domain_url, "status": status, "snippet": snippet, **extra}

    inferred_privacy_urls = _safe_list(privacy_kpi.get("privacy_policy_inferred_urls"))
    privacy_policy_real_rows = bool(inferred_privacy_urls) or bool(privacy_kpi.get("has_privacy_policy"))
    privacy_policy_rows = [
        {
            "policy_url": url,
            "status": "inferred_from_content",
            "title": "Politique de confidentialite",
            "snippet": "Signal RGPD detecte sur cette page",
        }
        for url in inferred_privacy_urls
    ]
    if not privacy_policy_rows:
        privacy_policy_rows = [{
            "policy_url": domain_url,
            "status": "detected" if privacy_kpi.get("has_privacy_policy") else ("runtime_unavailable" if blocked_recovery_partial else "missing"),
            "title": "Politique de confidentialite",
            "snippet": "Politique detectee par le scan domaine" if privacy_kpi.get("has_privacy_policy") else (rgpd_runtime_unavailable if blocked_recovery_partial else "Aucune politique detectee"),
        }]
    retention_rows = _safe_list(content.get("rgpd_retention_rows"))
    retention_real_rows = bool(retention_rows)
    if not retention_rows and blocked_recovery_partial:
        retention_rows = [_rgpd_placeholder_row("runtime_unavailable", rgpd_runtime_unavailable)]
    elif not retention_rows and _safe_int(content.get("rgpd_retention_signal_pages", 0)) == 0:
        retention_rows = [_rgpd_placeholder_row("missing", "Aucun extrait mentionnant la duree de conservation n'a ete detecte.")]
    minimization_rows = _safe_list(content.get("rgpd_minimization_rows"))
    minimization_real_rows = bool(minimization_rows)
    if not minimization_rows and blocked_recovery_partial:
        minimization_rows = [_rgpd_placeholder_row("runtime_unavailable", rgpd_runtime_unavailable)]
    elif not minimization_rows and _safe_int(content.get("rgpd_minimization_signal_pages", 0)) == 0:
        minimization_rows = [_rgpd_placeholder_row("missing", "Aucun extrait mentionnant la minimisation des donnees n'a ete detecte.")]
    legal_notice_real_rows = bool(privacy_kpi.get("has_legal_notice"))
    legal_notice_rows = [{
        "legal_url": domain_url,
        "status": "detected" if privacy_kpi.get("has_legal_notice") else ("runtime_unavailable" if blocked_recovery_partial else "missing"),
        "publisher": None,
        "contact": None,
        "snippet": "Mentions legales detectees" if privacy_kpi.get("has_legal_notice") else (rgpd_runtime_unavailable if blocked_recovery_partial else "Mentions legales non detectees"),
    }]
    rights_rows = _safe_list(_safe_dict(content.get("advanced_rgpd_kpis", {})).get("rights_rows"))
    rights_real_rows = bool(rights_rows)
    if not rights_rows and blocked_recovery_partial:
        rights_rows = [_rgpd_placeholder_row("runtime_unavailable", rgpd_runtime_unavailable, right="droits RGPD", present=False)]
    elif not rights_rows and not privacy_kpi.get("has_information_rights"):
        rights_rows = [_rgpd_placeholder_row("missing", "Les droits des personnes ne sont pas mentionnes clairement.", right="droits RGPD", present=False)]
    purpose_rows = _safe_list(content.get("rgpd_purpose_rows"))
    purpose_real_rows = bool(purpose_rows)
    if not purpose_rows and blocked_recovery_partial:
        purpose_rows = [_rgpd_placeholder_row("runtime_unavailable", rgpd_runtime_unavailable, purpose="finalite du traitement")]
    elif not purpose_rows and not privacy_kpi.get("has_declared_purpose"):
        purpose_rows = [_rgpd_placeholder_row("missing", "La finalite du traitement n'est pas explicitement declaree.", purpose="finalite du traitement")]
    pre_consent_rows = _safe_list(_safe_dict(content.get("advanced_rgpd_kpis", {})).get("pre_consent_rows"))
    pre_consent_real_rows = bool(pre_consent_rows)
    if not pre_consent_rows and blocked_recovery_partial:
        pre_consent_rows = [_rgpd_placeholder_row("runtime_unavailable", "Preuve runtime indisponible pour la timeline des traceurs avant consentement.", tracker_domain="non mesure", category="runtime", before_consent=None)]
    elif not pre_consent_rows and _safe_int(_safe_dict(content.get("advanced_rgpd_kpis", {})).get("pre_consent_violation_pages")) > 0:
        pre_consent_rows = [_rgpd_placeholder_row("missing", "Violation pre-consentement signalee sans timeline detaillee.", tracker_domain="non conserve", category="runtime", before_consent=True)]
    privacy_score_rows = _safe_list(_safe_dict(content.get("advanced_rgpd_kpis", {})).get("privacy_score_rows"))
    privacy_score_real_rows = bool(privacy_score_rows)
    if not privacy_score_rows and blocked_recovery_partial:
        privacy_score_rows = [_rgpd_placeholder_row("runtime_unavailable", rgpd_runtime_unavailable, score=None, weakness="preuve insuffisante")]
    elif not privacy_score_rows and _safe_int(_safe_dict(content.get("advanced_rgpd_kpis", {})).get("privacy_score_low_pages")) > 0:
        privacy_score_rows = [_rgpd_placeholder_row("missing", "Score faible signale sans extrait detaille.", score=None, weakness="preuve non conservee")]

    axes["RGPD"] = {
        "Consentement Cookies": {
            "info": f"Banneau consentement: {'Partiel (NLP)' if privacy_kpi.get('cookie_consent', {}).get('cmp_nlp_detected') else ('Détecté' if privacy_kpi.get('cookie_consent', {}).get('has_banner') else 'Absent')}",
            "impact": "Consentement absent = violation RGPD/ePrivacy, risque légal et amende, perte de confiance utilisateur",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": (
                "not_evaluated" if privacy_kpi.get("cookie_consent") is None
                else "passing" if (
                    privacy_kpi.get("cookie_consent", {}).get("has_banner")
                    or privacy_kpi.get("cookie_consent", {}).get("cmp_present")
                )
                else "warning" if privacy_kpi.get("cookie_consent", {}).get("cmp_nlp_detected")
                else "failing"
            ),
            "type": "compliance",
            "severity": (
                None if (
                    privacy_kpi.get("cookie_consent", {}).get("has_banner")
                    or privacy_kpi.get("cookie_consent", {}).get("cmp_present")
                    or privacy_kpi.get("cookie_consent") is None
                )
                else "low" if privacy_kpi.get("cookie_consent", {}).get("cmp_nlp_detected")
                else "critical"
            ),
            "data": privacy_kpi.get("cookie_consent") or {
                "data_quality": "MISSING",
                "runtime_evidence_status": "unavailable" if blocked_recovery_partial else "not_collected",
                "missing_reason": rgpd_runtime_unavailable if blocked_recovery_partial else "Preuve CMP/banniere non conservee.",
            },
        },
        "Politique de Confidentialité": {
            "info": f"Politique de confidentialité: {'Présente' if privacy_kpi.get('has_privacy_policy') else 'Absente'}",
            "impact": "Politique absente = violation RGPD, risque légal, manque de transparence envers utilisateurs",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": _rgpd_status_from_signal(bool(privacy_kpi.get("has_privacy_policy")), privacy_policy_rows if privacy_policy_real_rows else []),
            "type": "compliance",
            "severity": None,
            "data": {
                "has_privacy_policy": privacy_kpi.get("has_privacy_policy"),
                "rows": privacy_policy_rows,
            },
        },
        "Durée de Conservation": {
            "info": f"Déclaration durée conservation: {content.get('rgpd_retention_signal_pages', 0)} pages mentionnent la rétention",
            "impact": "Durée non déclarée = non-conformité RGPD Art.5, transparence insuffisante",
            "pages_affected": 1 if content.get("rgpd_retention_signal_pages", 0) == 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if content.get("rgpd_retention_signal_pages", 0) == 0 else [],
            "status": _rgpd_status_from_signal(_safe_int(content.get("rgpd_retention_signal_pages", 0)) > 0, retention_rows if retention_real_rows else []),
            "type": "compliance",
            "severity": None,
            "data": {
                "rgpd_retention_signal_pages": content.get("rgpd_retention_signal_pages", 0),
                "rows": retention_rows,
            },
        },
        "Minimisation des Données": {
            "info": f"Déclaration minimisation: {content.get('rgpd_minimization_signal_pages', 0)} pages mentionnent la minimisation",
            "impact": "Minimisation non déclarée = non-conformité RGPD, principes de collecte transparence insuffisan",
            "pages_affected": 1 if content.get("rgpd_minimization_signal_pages", 0) == 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if content.get("rgpd_minimization_signal_pages", 0) == 0 else [],
            "status": _rgpd_status_from_signal(_safe_int(content.get("rgpd_minimization_signal_pages", 0)) > 0, minimization_rows if minimization_real_rows else []),
            "type": "compliance",
            "severity": None,
            "data": {
                "rgpd_minimization_signal_pages": content.get("rgpd_minimization_signal_pages", 0),
                "rows": minimization_rows,
            },
        },
        "Mentions Légales": {
            "info": f"Mentions légales: {'Présentes' if privacy_kpi.get('has_legal_notice') else 'Absentes'}",
            "impact": "Mentions absentes = risque réglementaire France/EU, manque de transparence juridique",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": _rgpd_status_from_signal(bool(privacy_kpi.get("has_legal_notice")), legal_notice_rows if legal_notice_real_rows else []),
            "type": "compliance",
            "severity": None,
            "data": {
                "has_legal_notice": privacy_kpi.get("has_legal_notice"),
                "rows": legal_notice_rows,
            },
        },
        "Droits des Personnes": {
            "info": f"Droits RGPD mentionnés: {'Oui' if privacy_kpi.get('has_information_rights') else 'Non'}",
            "impact": "Droits non mentionnés = non-conformité RGPD Art.13/14, violation transparence",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": _rgpd_status_from_signal(bool(privacy_kpi.get("has_information_rights")), rights_rows if rights_real_rows else []),
            "type": "compliance",
            "severity": None,
            "data": {
                "has_information_rights": privacy_kpi.get("has_information_rights"),
                "rows": rights_rows,
            },
        },
        "Finalité du Traitement": {
            "info": f"Finalité déclarée: {'Oui' if privacy_kpi.get('has_declared_purpose') else 'Non'}",
            "impact": "Finalité non déclarée = non-conformité RGPD, base légale insuffisante",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": _rgpd_status_from_signal(bool(privacy_kpi.get("has_declared_purpose")), purpose_rows if purpose_real_rows else []),
            "type": "compliance",
            "severity": None,
            "data": {
                "has_declared_purpose": privacy_kpi.get("has_declared_purpose"),
                "rows": purpose_rows,
            },
        },
        "Couverture des Droits RGPD": {
            "info": f"Pages avec couverture droits insuffisante: {content.get('advanced_rgpd_kpis', {}).get('rights_low_pages', 0)}",
            "impact": "Droits RGPD incomplets exposent à des risques de non-conformité réglementaire",
            "pages_affected": _safe_int(content.get('advanced_rgpd_kpis', {}).get('rights_low_pages', 0)),
            "pages_affected_urls": [],
            "status": "not_evaluated" if blocked_recovery_partial and not rights_real_rows else ("failing" if _safe_int(content.get('advanced_rgpd_kpis', {}).get('rights_low_pages', 0)) > 0 else "passing"),
            "type": "compliance",
            "severity": None,
            "data": {**_safe_dict(content.get("advanced_rgpd_kpis", {})), "rows": rights_rows},
        },
        "Trackers Avant Consentement": {
            "info": f"Pages avec trackers pré-consentement: {content.get('advanced_rgpd_kpis', {}).get('pre_consent_violation_pages', 0)}",
            "impact": "Trackers avant consentement peuvent enfreindre ePrivacy/CNIL et exposer à des sanctions",
            "pages_affected": _safe_int(content.get('advanced_rgpd_kpis', {}).get('pre_consent_violation_pages', 0)),
            "pages_affected_urls": [],
            "status": "not_evaluated" if blocked_recovery_partial and not pre_consent_real_rows else ("failing" if _safe_int(content.get('advanced_rgpd_kpis', {}).get('pre_consent_violation_pages', 0)) > 0 else "passing"),
            "type": "compliance",
            "severity": None,
            "data": {**_safe_dict(content.get("advanced_rgpd_kpis", {})), "rows": pre_consent_rows},
        },
        "Score Politique de Confidentialité": {
            "info": f"Pages avec score confidentialité faible: {content.get('advanced_rgpd_kpis', {}).get('privacy_score_low_pages', 0)}",
            "impact": "Politique de confidentialité faible dégrade la confiance et le niveau de conformité perçu",
            "pages_affected": 1 if not privacy_kpi.get("has_privacy_policy") else _safe_int(content.get('advanced_rgpd_kpis', {}).get('privacy_score_low_pages', 0)),
            "pages_affected_urls": [report.get("domain", "")] if not privacy_kpi.get("has_privacy_policy") else [],
            "status": "failing" if not privacy_kpi.get("has_privacy_policy") else ("not_evaluated" if blocked_recovery_partial and not privacy_score_real_rows else ("failing" if _safe_int(content.get('advanced_rgpd_kpis', {}).get('privacy_score_low_pages', 0)) > 0 else "passing")),
            "type": "compliance",
            "severity": "high" if not privacy_kpi.get("has_privacy_policy") else None,
            "data": {
                **_safe_dict(content.get("advanced_rgpd_kpis", {})),
                "rows": privacy_score_rows,
                "execution_status": "prerequisite_failed" if not privacy_kpi.get("has_privacy_policy") else "completed",
                "failure_reason": "privacy_policy_missing" if not privacy_kpi.get("has_privacy_policy") else None,
                "data_quality": "MISSING" if not privacy_kpi.get("has_privacy_policy") else ("PARTIAL" if blocked_recovery_partial and not privacy_score_real_rows else "VALID"),
            },
        }
    }

    # ─── PHASE 4: V2 NORMALIZATION ─────────────────────────────────────────────
    # Convert every KPI object to the V2 standard 14-field schema via _make_kpi_v2.
    # Handles both flat axes (direct KPI children) and nested sous_axes structures.
    pages_scanned_total = _safe_int(report.get("pages_scanned", 1)) or 1

    for axis_name, axis_data in axes.items():
        if not isinstance(axis_data, dict):
            continue
        sous_axes = axis_data.get("sous_axes")
        if sous_axes is None:
            # Flat structure: direct dict children are KPI objects
            for kpi_name, kpi_obj in list(axis_data.items()):
                if isinstance(kpi_obj, dict) and "status" in kpi_obj:
                    # First apply V1 normalization for severity inference, then convert to V2
                    v1_normalized = _normalize_kpi_object(kpi_obj, axis_name, kpi_name)
                    axis_data[kpi_name] = _make_kpi_v2(
                        kpi_name, v1_normalized, axis_name,
                        pages_scanned_total, domain_url
                    )
        elif isinstance(sous_axes, dict):
            # Nested structure: sous_axes -> kpis
            for sous_axe_name, sous_axe_data in sous_axes.items():
                if not isinstance(sous_axe_data, dict):
                    continue
                kpis = sous_axe_data.get("kpis", {})
                if isinstance(kpis, dict):
                    for kpi_name, kpi_obj in kpis.items():
                        if isinstance(kpi_obj, dict) and "status" in kpi_obj:
                            v1_normalized = _normalize_kpi_object(kpi_obj, axis_name, kpi_name)
                            sous_axe_data["kpis"][kpi_name] = _make_kpi_v2(
                                kpi_name, v1_normalized, axis_name,
                                pages_scanned_total, domain_url
                            )

    # ─── PHASE 5: BUILD V2 SUMMARY ────────────────────────────────────────────
    summary_v2 = _build_summary_v2(axes, pages_scanned_total)

    # ─── PHASE 5: RETURN V2 REPORT ────────────────────────────────────────────
    return {
        "report_version": "v2",
        "scan_id":        report.get("scan_id"),
        "domain":         report.get("domain"),
        "generated_at":   report.get("generated_at") or datetime.utcnow().isoformat() + "Z",
        "pages_scanned":  pages_scanned_total,
        "summary":        summary_v2,
        "axes":           axes,
    }
