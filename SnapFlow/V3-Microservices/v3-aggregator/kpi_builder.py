"""
KPI-Centric Report Builder
Converts raw report data to axis/sub-axis/KPI structure
All output in French for easy client consumption
"""
from datetime import datetime
from typing import Optional

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

    passed = mobile.get("passed")
    if isinstance(passed, bool):
        return "passing" if passed else "failing"

    lcp_ms = _safe_float(mobile.get("lcp_ms"))
    cls = _safe_float(mobile.get("cls"))
    fcp_ms = _safe_float(mobile.get("fcp_ms"))
    if lcp_ms > 2500 or cls > 0.1 or fcp_ms > 1800:
        return "failing"
    return "passing"


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
    
    detail = ". ".join(parts) if parts else f"{kpi_name}: anomalie détectée"
    if _axis_is_security(axis_name):
        impact = "Risque de sécurité avéré" if pages_affected > 0 else "Risque de sécurité potentiel"
        return f"{detail}. {impact}. Correction prioritaire recommandée."

    if pages_affected > 0:
        return f"{detail}. Affecte {pages_affected} page(s). Correction recommandée."
    return f"{detail}. Vérification manuelle recommandée."


def _generate_constat_failing_compliance(kpi_name, data, info, pages_affected):
    """Generate French constat for failing compliance KPI. Legal/regulatory risk framing."""
    if not data:
        return f"{kpi_name}: non-conformité détectée. Risque réglementaire."
    
    parts = []
    
    # RGPD-specific defects
    if "has_privacy_policy" in data and not data.get("has_privacy_policy"):
        parts.append("Politique de confidentialité absente (Art.13/14 RGPD)")
    if "has_legal_notice" in data and not data.get("has_legal_notice"):
        parts.append("Mentions légales absentes (Loi LCEN)")
    if "has_information_rights" in data and not data.get("has_information_rights"):
        parts.append("Droits des personnes non mentionnés (non-conformité Art.13/14)")
    if "has_declared_purpose" in data and not data.get("has_declared_purpose"):
        parts.append("Finalité du traitement non déclarée")
    
    # Pre-consent violations
    if "pre_consent_violation_pages" in data:
        count = _safe_int(data.get("pre_consent_violation_pages", 0))
        if count > 0:
            parts.append(f"{count} page(s) avec trackers avant consentement (violation ePrivacy/CNIL)")
    
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
            constat = f"{display_name}: anomalie détectée. Vérification manuelle recommandée."
    else:
        constat = f"{display_name}: données insuffisantes pour une évaluation fiable."
    
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
    "Version Langage de Programmation":   ("tech_server_version",     "medium", "aggregate"),
    "Vérification du Code":               ("tech_cve_check",          "high",   "aggregate"),
    # — Check Sécurité —
    "SSL":                                ("sec_ssl",                  "high",   "concrete"),
    "Sécurité des En-têtes HTTP":         ("sec_http_headers",        "high",   "concrete"),
    "Gestion des Sessions":               ("sec_session_cookies",     "high",   "concrete"),
    "SQL Injection et DDoS":              ("sec_sqli_ddos",           "high",   "concrete"),
    "Pages Admin Exposées":               ("sec_admin_exposed",       "high",   "concrete"),
    "Fichiers Sensibles Exposés":         ("sec_sensitive_files",     "high",   "concrete"),
    "Robots.txt Info Disclosure":         ("sec_robots_disclosure",   "medium", "heuristic"),
    "Pages d'Erreur Personnalisées":      ("sec_error_pages",         "medium", "heuristic"),
    "Protection Brute Force":             ("sec_brute_force",         "medium", "heuristic"),
    "Contrôle d'Extension Upload Fichier":("sec_file_upload",         "medium", "aggregate"),
    "Dépendances JS Vulnérables (CVE)":   ("sec_js_deps",             "high",   "aggregate"),
    "Mise en Cache":                      ("perf_cache",              "medium", "heuristic"),
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
    "Images Optimisées":                  ("perf_image_optim",        "medium", "aggregate"),
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
    "perf_cache":               "Un cache désactivé augmente la charge serveur, ralentit les temps de réponse et dégrade l'expérience utilisateur.",
    "perf_compression":         "Sans compression, les transferts sont plus lourds, la page se charge plus lentement et la consommation réseau augmente.",
    "func_forms":               "Des formulaires avec anomalies peuvent bloquer les conversions et frustrer les utilisateurs lors des soumissions.",
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
    "rgpd_cookie_consent":      "L'absence de banneau de consentement peut violer le RGPD et l'ePrivacy, exposant à des amendes CNIL.",
    "rgpd_privacy_policy":      "Sans politique de confidentialité, le site manque à ses obligations légales de transparence envers les utilisateurs.",
    "rgpd_data_retention":      "La durée de conservation non déclarée viole l'article 5 du RGPD et affaiblit la transparence des traitements.",
    "rgpd_minimization":        "Sans mention de minimisation, le principe de collecte proportionnée n'est pas démontré aux visiteurs.",
    "rgpd_legal_notice":        "L'absence de mentions légales contrevient à la loi française LCEN et fragilise la crédibilité juridique.",
    "rgpd_user_rights":         "Si les droits des personnes ne sont pas mentionnés, les utilisateurs ne peuvent pas connaître leurs droits RGPD.",
    "rgpd_declared_purpose":    "La finalité du traitement non déclarée empêche les utilisateurs d'évaluer la légitimité de la collecte.",
    "rgpd_rights_coverage":     "Une couverture insuffisante des droits RGPD expose à des demandes de mise en conformité ou des plaintes.",
    "rgpd_pre_consent_trackers":"Le chargement de trackers avant consentement constitue une violation de l'ePrivacy et des directives CNIL.",
    "rgpd_privacy_score":       "Un score de politique de confidentialité faible indique une politique incomplète ou rédigée superficiellement.",
}

_KPI_TICKET_TEAM = {
    "sec_ssl": "infrastructure", "sec_http_headers": "infrastructure", "sec_session_cookies": "backend",
    "sec_sqli_ddos": "backend", "sec_admin_exposed": "infrastructure", "sec_sensitive_files": "infrastructure",
    "sec_robots_disclosure": "backend", "sec_error_pages": "backend", "sec_brute_force": "backend",
    "sec_file_upload": "backend", "sec_js_deps": "frontend",
    "tech_cms_version": "infrastructure", "tech_modules_versions": "infrastructure",
    "tech_server_version": "infrastructure", "tech_cve_check": "infrastructure",
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
            "expected": "Lien 'Mentions légales' ou 'CGU' visible, obligatoire en France (LCEN)",
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
        "func_forms":        "Traiter les anomalies détectées sur les formulaires",
        "sec_ssl":           "Renouveler ou corriger le certificat SSL",
        "sec_http_headers":  "Ajouter les en-têtes de sécurité HTTP manquants",
        "sec_session_cookies":"Corriger les flags Secure/HttpOnly des cookies de session",
        "sec_admin_exposed": "Protéger ou restreindre l'accès aux interfaces d'administration",
        "sec_sqli_ddos":     "Traiter les signaux d'injection SQL ou DDoS détectés",
        "sec_brute_force":   "Implémenter une protection anti-brute force sur les formulaires de connexion",
        "sec_js_deps":       "Mettre à jour les dépendances JS avec des CVEs actifs",
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
        "rgpd_cookie_consent":"Implémenter un bandeau de consentement cookies conforme CNIL",
        "rgpd_privacy_policy":"Publier et lier une politique de confidentialité conforme RGPD",
        "rgpd_legal_notice": "Publier les mentions légales conformes à la loi LCEN",
        "rgpd_user_rights":  "Mentionner explicitement les droits RGPD (Art.13/14) dans la politique",
        "rgpd_declared_purpose": "Déclarer la finalité du traitement des données dans la politique",
        "rgpd_pre_consent_trackers": "Bloquer les trackers jusqu'à obtention du consentement utilisateur",
    }

    acceptance_hints = {
        "func_buttons":  "Chaque bouton listé doit déclencher une action réelle, naviguer vers une page valide, ou ouvrir un formulaire fonctionnel.",
        "func_links":    "Chaque lien listé doit retourner HTTP 200 ou une redirection valide (301/302). Les liens 404/410 doivent être supprimés ou redirigés.",
        "sec_ssl":       "Le certificat doit être valide, non expiré, et émis par une autorité reconnue (Let's Encrypt, DigiCert, etc.).",
        "sec_http_headers": "Tous les en-têtes listés doivent être présents dans les réponses HTTP avec des valeurs sécurisées adaptées au site.",
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
        }.get(kpi_id, "Ce point n'a pas pu être évalué avec suffisamment de fiabilité pendant ce scan.")

    if status == "passing":
        passing_msgs = {
            "sec_ssl":           "Le certificat SSL est valide et la connexion est sécurisée pour les visiteurs.",
            "sec_http_headers":  "Les en-têtes de sécurité HTTP requis sont correctement configurés.",
            "sec_session_cookies":"Les cookies de session sont correctement protégés avec les flags de sécurité.",
            "seo_sitemap":       "Un sitemap XML est présent, facilitant l'indexation par les moteurs de recherche.",
            "seo_robots_txt":    "Le fichier robots.txt est en place et contrôle correctement le crawl.",
            "rgpd_privacy_policy":"Une politique de confidentialité a été détectée sur le site.",
            "rgpd_legal_notice": "Les mentions légales ont été détectées sur le site.",
            "rgpd_user_rights":  "Les droits RGPD des utilisateurs sont mentionnés dans la documentation.",
        }
        return passing_msgs.get(kpi_id, "Ce point a été vérifié sans anomalie identifiée.")

    # Failing / warning messages
    failing_msgs = {
        "func_buttons":     f"Des boutons importants ne déclenchent aucune action sur {ps} page(s), ce qui peut bloquer des parcours de conversion.",
        "func_links":       f"Des liens internes cassés ont été détectés sur {ps} page(s), perturbant la navigation et le crawl SEO.",
        "func_forms":       f"Des anomalies ont été détectées sur des formulaires du site, pouvant bloquer la soumission ou exposer des erreurs.",
        "sec_ssl":           "Le certificat SSL semble invalide ou expiré, ce qui peut bloquer l'accès et exposer les données des visiteurs.",
        "sec_http_headers":  "Des en-têtes de sécurité essentiels sont absents, élargissant la surface d'attaque du site.",
        "sec_session_cookies":f"Des cookies de session manquent de protections importantes (Secure/HttpOnly).",
        "sec_sqli_ddos":     "Des signaux d'injection SQL ou DDoS ont été détectés, indiquant des risques de sécurité applicative.",
        "sec_admin_exposed": f"{ps} interface(s) d'administration semble(nt) accessible(s) sans authentification.",
        "sec_brute_force":   "Les formulaires de connexion ne semblent pas protégés contre les tentatives de connexion répétées.",
        "sec_js_deps":       "Des librairies JavaScript avec des failles documentées ont été détectées.",
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
        }.get(kpi_id, "Données insuffisantes pour une évaluation fiable — aucune sonde n'a retourné de résultat.")

    if status == "passing":
        return f"Vérification réussie — aucune anomalie mesurable détectée sur ce critère lors du scan."

    tech_msgs = {
        "func_buttons":     f"{d.get('total_broken_buttons', '?')} bouton(s) problématique(s) sur {d.get('pages_with_nonfunc_buttons', '?')} page(s) — principalement des ancres mortes (href='#') ou CTA sans action attachée.",
        "func_links":       f"{d.get('internal_broken_count', d.get('broken_link_count', '?'))} lien(s) interne(s) cassé(s) — codes HTTP détectés : 404, 403 ou timeout.",
        "func_forms":       f"{d.get('anomalies', '?')} anomalie(s) sur {d.get('forms_tested', '?')} formulaire(s) testé(s) via fuzzing.",
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
    return tech_msgs.get(kpi_id, f"Anomalie détectée lors du scan — consulter les données brutes de ce KPI pour le détail.")


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


def _build_evidence_digest(client_summary: str, scope: dict, v1_data: dict, pages_affected_urls: list) -> dict:
    """Build a compact digest that frontends can render without dumping raw JSON."""
    data = _safe_dict(v1_data)
    item_rows = _safe_list(data.get("items", []))

    top_items = []
    extracted_urls = []
    for row in item_rows:
        if isinstance(row, dict):
            label = _first_non_empty_str([
                row.get("name"),
                row.get("url"),
                row.get("found_on"),
                row.get("selector"),
                row.get("issue_type"),
            ])
            if label:
                top_items.append(label)

            row_url = _first_non_empty_str([
                row.get("url"),
                row.get("found_on"),
                row.get("source_page"),
            ])
            if row_url:
                extracted_urls.append(row_url)
        elif isinstance(row, str) and row.strip():
            top_items.append(row.strip())

    combined_urls = []
    for url in pages_affected_urls + extracted_urls:
        if isinstance(url, str) and url.strip() and url not in combined_urls:
            combined_urls.append(url)

    key_metrics = {}
    noisy_keys = {
        "items", "rows", "images", "broken_links", "broken_buttons", "cookies",
        "module_versions", "cannibalized_keywords", "affected_pages", "affected_pages_meta",
        "affected_pages_title", "affected_page_urls", "top_affected",
    }
    for key, value in data.items():
        if key in noisy_keys:
            continue
        if isinstance(value, (str, int, float, bool)):
            key_metrics[key] = value
        if len(key_metrics) >= 6:
            break

    return {
        "summary": client_summary,
        "affected_pages": _safe_int(scope.get("affected_pages", 0)),
        "top_urls": combined_urls[:5],
        "top_items": top_items[:5],
        "key_metrics": key_metrics,
    }


def _compute_v2_status(kpi_id: str, v1_status: str, evidence_quality: str, confidence: str) -> str:
    """Enforce: heuristic KPIs can be 'warning' or 'not_evaluated', never 'failing'."""
    if v1_status == "not_available" or evidence_quality == "not_evaluated":
        return "not_evaluated"
    if v1_status == "passing":
        return "passing"
    if v1_status == "failing":
        if evidence_quality == "heuristic":
            return "warning"  # Downgrade: heuristic cannot be 'failing'
        return "failing"
    if v1_status in ("warning", "non_evalue"):
        return "warning" if v1_status == "warning" else "not_evaluated"
    return v1_status


def _make_kpi_v2(kpi_name: str, kpi_obj: dict, axis: str, pages_scanned: int, domain_url: str) -> dict:
    """
    Transforms a V1 KPI object into the V2 14-field standardised schema.
    Called from the phase-4 normalization loop.
    """
    # Look up metadata
    meta = _KPI_META.get(kpi_name, (f"kpi_{kpi_name.lower().replace(' ', '_')}", "medium", "aggregate"))
    kpi_id, confidence, evidence_quality = meta

    # V1 fields
    v1_status   = str(kpi_obj.get("status", "not_available"))
    v1_severity = kpi_obj.get("severity")
    v1_pages    = _safe_int(kpi_obj.get("pages_affected", 0))
    v1_data     = _safe_dict(kpi_obj.get("data", {}))

    # Compute V2 status (enforces heuristic→warning rule)
    v2_status = _compute_v2_status(kpi_id, v1_status, evidence_quality, confidence)

    # Severity: null if passing/not_evaluated; keep v1 severity otherwise (already inferred)
    v2_severity = None if v2_status in ("passing", "not_evaluated") else (v1_severity or "low")

    # Build sub-objects
    scope   = _derive_scope(pages_scanned, v1_pages)
    ev      = _build_evidence(kpi_id, evidence_quality, v1_data, domain_url)
    ticket  = _build_ticket_payload(kpi_id, kpi_name, v2_severity, evidence_quality, ev["examples"]) if v2_status in ("failing", "warning") else None
    pages_affected_urls = _safe_list(kpi_obj.get("pages_affected_urls", []))
    client_summary = _build_client_summary_v2(kpi_id, v2_status, evidence_quality, v1_pages, v1_data)
    technical_summary = _build_technical_summary_v2(kpi_id, v2_status, evidence_quality, v1_data)
    recommended_action, recommendation_source = _extract_recommended_action(v1_data, ticket, v2_status)
    evidence_digest = _build_evidence_digest(client_summary, scope, v1_data, pages_affected_urls)

    return {
        "kpi_id":           kpi_id,
        "name":             kpi_name,
        "axis":             axis,
        "status":           v2_status,
        "severity":         v2_severity,
        "confidence":       confidence if v2_status != "not_evaluated" else "low",
        "evidence_quality": evidence_quality,
        "client_summary":   client_summary,
        "recommended_action": recommended_action,
        "recommendation_source": recommendation_source,
        "business_impact":  _KPI_BUSINESS_IMPACT.get(kpi_id, ""),
        "technical_summary":technical_summary,
        "scope":            scope,
        "evidence_digest":  evidence_digest,
        "evidence":         ev,
        "ticket_payload":   ticket,
        "metrics":          v1_data,  # raw metrics preserved here
    }


def _build_summary_v2(axes: dict, pages_scanned: int) -> dict:
    """Build the V2 top-level summary block from normalised axes."""
    total_kpis = passed = warning = failed = not_eval = critical = high = medium = low = 0
    axis_failed: dict[str, dict] = {}

    for axis_name, axis_data in axes.items():
        if not isinstance(axis_data, dict):
            continue
        for kpi_name, kpi in axis_data.items():
            if not isinstance(kpi, dict) or "status" not in kpi:
                continue
            total_kpis += 1
            st  = kpi.get("status")
            sev = str(kpi.get("severity") or "").lower()
            if st == "passing":
                passed += 1
            elif st == "warning":
                warning += 1
                if sev == "medium":   medium += 1
                elif sev == "low":    low    += 1
            elif st == "failing":
                failed += 1
                if sev == "critical": critical += 1
                elif sev == "high":   high   += 1
                elif sev == "medium": medium += 1
                elif sev == "low":    low    += 1
                # risk_breakdown
                akey = axis_name.lower()
                if akey not in axis_failed:
                    axis_failed[akey] = {"failed": 0, "high_confidence_failed": 0}
                axis_failed[akey]["failed"] += 1
                if kpi.get("confidence") in ("high", "medium"):
                    axis_failed[akey]["high_confidence_failed"] += 1
            elif st == "not_evaluated":
                not_eval += 1

    # Determine health status
    if critical > 0:
        health = "critical"
    elif failed > 2 or high > 0:
        health = "needs_attention"
    else:
        health = "healthy"

    # Build headline
    if health == "critical":
        headline = f"Des problèmes critiques ont été identifiés sur {failed} indicateur(s). Une intervention immédiate est requise."
    elif health == "needs_attention":
        headline = f"Le site présente {failed} anomalie(s) confirmée(s) qui freinent la performance, la conformité ou la conversion."
    else:
        headline = f"Le site présente un bon niveau global sur les {total_kpis} indicateurs analysés. Quelques optimisations restent possibles."

    # Key points (top 3 failing by severity)
    severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    failing_kpis_list = []
    for ax_name, ax_data in axes.items():
        if not isinstance(ax_data, dict):
            continue
        for kn, kv in ax_data.items():
            if isinstance(kv, dict) and kv.get("status") in ("failing", "warning"):
                failing_kpis_list.append((kv.get("severity"), kv.get("client_summary", ""), ax_name))
    failing_kpis_list.sort(key=lambda x: severity_order.get(str(x[0] or "low").lower(), 4))
    key_points = [cs for _, cs, _ in failing_kpis_list[:3]]

    # Risk breakdown
    axis_map = {
        "check sécurité": "sécurité", "audit technique": "sécurité",
        "audit fonctionnel": "fonctionnel",
        "audit de performance et temps de réponse": "performance",
        "seo": "seo", "audit ux/ui": "ux",
        "contenu": "contenu",
        "eco index": "performance_eco",
        "rgpd": "rgpd",
    }
    risk_breakdown: dict[str, dict] = {}
    for ax_name_lower, bucket in axis_map.items():
        src = axis_failed.get(ax_name_lower, {"failed": 0, "high_confidence_failed": 0})
        if bucket not in risk_breakdown:
            risk_breakdown[bucket] = {"failed": 0, "high_confidence_failed": 0}
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
            "pages_scanned":       pages_scanned,
            "total_kpis":          total_kpis,
            "passed_kpis":         passed,
            "warning_kpis":        warning,
            "failed_kpis":         failed,
            "not_evaluated_kpis":  not_eval,
            "critical_kpis":       critical,
            "high_kpis":           high,
            "medium_kpis":         medium,
            "low_kpis":            low,
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

    non_func_buttons_evidence = _normalized_kpi_evidence(report, "Non-Functional Buttons")
    button_kpi = _safe_dict(perf.get("button_kpi", {}))
    broken_buttons = _safe_list(button_kpi.get("broken_buttons"))
    total_broken_buttons = button_kpi.get("total_nonfunc_buttons")
    if total_broken_buttons is None:
        total_broken_buttons = len(broken_buttons) if broken_buttons else 0
    missing_meta_evidence = _normalized_kpi_evidence(report, "Missing Meta Descriptions")
    missing_title_evidence = _normalized_kpi_evidence(report, "Missing Page Titles")
    missing_alt_evidence = _normalized_kpi_evidence(report, "Images Missing Alt Text")

    axes = {}

    # Security normalization: scanner uses pass|warning|fail, while KPI API uses passing|failing|not_available.
    admin_exposure = _safe_dict(sec.get("admin_sensitive_page_exposed"))
    version_disclosure = _safe_dict(sec.get("version_disclosure_cms"))
    robots_disclosure = _safe_dict(sec.get("robots_txt_info_disclosure"))
    error_page_leak = _safe_dict(sec.get("custom_error_page_info_leak"))
    brute_force_login = _safe_dict(sec.get("bruteforced_protection_login"))
    upload_control = _safe_dict(sec.get("file_upload_extension_control"))
    vulnerable_js = _safe_dict(sec.get("vulnerable_js_dependencies"))

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

    error_leaks = _safe_list(error_page_leak.get("leak_indicators"))
    error_page_has_issue = bool(error_leaks) or str(error_page_leak.get("status", "")).lower() == "fail"

    has_login = _safe_bool(functional_kpi.get("has_login"))
    brute_force_protected = _safe_bool(brute_force_login.get("protected"))
    brute_force_has_issue = has_login and ((not brute_force_protected) or str(brute_force_login.get("status", "")).lower() == "fail")

    upload_issues = _safe_list(upload_control.get("issues"))
    upload_restrictions_found = _safe_bool(upload_control.get("restrictions_found"))
    upload_has_issue = bool(upload_issues) or str(upload_control.get("status", "")).lower() == "fail"

    vulnerable_libraries = _safe_list(vulnerable_js.get("vulnerable_libraries"))
    vulnerable_js_has_issue = bool(vulnerable_libraries) or str(vulnerable_js.get("status", "")).lower() == "fail"

    tech_issues = _safe_list(cms_kpi.get("issues"))
    server_tech = str(cms_kpi.get("server_tech") or "").strip()
    server_version = str(cms_kpi.get("server_version") or "").strip()
    cve_severity = _safe_dict(cms_kpi.get("cve_severity"))
    server_critical = _safe_int(cve_severity.get("critical"))
    server_high = _safe_int(cve_severity.get("high"))
    server_related_issues = [
        str(issue) for issue in tech_issues
        if any(tag in str(issue).lower() for tag in ("server", "version", "x-powered-by", "header"))
    ]

    if not server_tech:
        server_version_status = "not_available"
        server_version_has_issue = False
        server_version_info = "Serveur: Non détecté"
    elif not server_version:
        server_version_status = "passing"
        server_version_has_issue = False
        server_version_info = f"Serveur: {server_tech} (version masquée)"
    else:
        server_version_has_issue = (server_critical > 0 or server_high > 0 or len(server_related_issues) > 0)
        server_version_status = "failing" if server_version_has_issue else "passing"
        server_version_info = f"Serveur: {server_tech} {server_version}"

    # ─── AUDIT TECHNIQUE ───────────────────────────────────────────────────────
    # [5.6] Distinguish cms_version_eol=None (probe didn't run) from False (not EOL).
    # None => 'non_evalue' status; only True fires 'failing'+'critical'.
    cms_eol = cms_kpi.get("cms_version_eol")
    
    axes["Audit Technique"] = {
        "Version CMS/Framework": {
            "info": f"CMS détecté: {cms_kpi.get('cms_detected') or 'Aucun'}",
            "impact": "Risque de sécurité si version obsolète ou non maintenue",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "failing" if cms_eol is True else "passing" if cms_eol is False else "non_evalue",
            "type": "bug" if cms_eol is True else None,
            "severity": "critical" if cms_eol is True else None,
            "data": {
                "cms_name": cms_kpi.get("cms_detected"),
                "cms_version": cms_kpi.get("cms_version"),
                "cms_eol": cms_eol,
            }
        },
        "Version Modules Installés": {
            "info": f"{len(cms_kpi.get('module_versions', []))} modules détectés avec versions",
            "impact": "Modules obsolètes = vulnérabilités potentielles non corrigées",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing",  # Info only, no pass/fail here
            "type": None,
            "severity": None,
            "data": {
                "module_count": len(cms_kpi.get("module_versions", [])),
                "modules": cms_kpi.get("module_versions", []),
            }
        },
        "Version Langage de Programmation": {
            "info": server_version_info,
            "impact": "Versions obsolètes exposent à des vulnérabilités connues",
            "pages_affected": 1 if server_version_status != "not_available" else 0,
            "pages_affected_urls": [report.get("domain", "")] if server_version_status != "not_available" else [],
            "status": server_version_status,
            "type": "bug" if server_version_has_issue else None,
            "severity": "high" if server_version_has_issue else None,
            "data": {
                "server_tech": cms_kpi.get("server_tech"),
                "server_version": cms_kpi.get("server_version"),
                "issues": server_related_issues,
                "cve_severity": cve_severity,
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
            "pages_affected_urls": _safe_list([report.get('domain', '')]) if brute_force_has_issue else [],
            "status": "failing" if brute_force_has_issue else ("passing" if has_login else "not_evaluated"),
            "type": "bug" if brute_force_has_issue else None,
            "severity": "high" if brute_force_has_issue else None,
            "data": brute_force_login,
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
            "info": f"{functional_kpi.get('total_forms', 0)} formulaires détectés, {functional_fuzzer_kpi.get('tests_run', 0)} tests exécutés"
                    f"{' (pages affectées estimées)' if functional_fuzzer_kpi.get('affected_pages_estimated') else ''}",
            "impact": "Formulaires avec anomalies = perte de conversions et problèmes de saisie utilisateur",
            "pages_affected": (
                _safe_int(functional_fuzzer_kpi.get("affected_pages", 0))
                or len({
                    str(item.get("page_url") or "").strip()
                    for item in _safe_list(functional_fuzzer_kpi.get("top_affected", []))
                    if isinstance(item, dict) and str(item.get("page_url") or "").strip()
                })
            ),
            "pages_affected_urls": (
                _safe_list(functional_fuzzer_kpi.get("affected_page_urls", []))[:25]
                or list({
                    str(item.get("page_url") or "").strip()
                    for item in _safe_list(functional_fuzzer_kpi.get("top_affected", []))
                    if isinstance(item, dict) and str(item.get("page_url") or "").strip()
                })[:25]
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
                "forms_tested": functional_fuzzer_kpi.get("total_forms_tested", 0),
                "tests_run": functional_fuzzer_kpi.get("tests_run", 0),
                "anomalies": functional_fuzzer_kpi.get("anomalies_count", 0),
                "affected_pages": functional_fuzzer_kpi.get("affected_pages", 0),
                "affected_pages_estimated": bool(functional_fuzzer_kpi.get("affected_pages_estimated")),
                "affected_page_urls": _safe_list(functional_fuzzer_kpi.get("affected_page_urls", []))[:25],
                "anomalies_by_type": functional_fuzzer_kpi.get("anomalies_by_type", {}),
                "top_affected": functional_fuzzer_kpi.get("top_affected", []),
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
        "pages_affected_urls": affected_broken_pages_set[:25],
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
                    for link in seo.get("broken_link_kpi", {}).get("broken_links", [])[:50]
                ],
            },
    }

    axes["Audit Fonctionnel"]["Boutons"] = {
        "info": f"Boutons non-fonctionnels: {perf.get('button_kpi', {}).get('pages_with_nonfunc_buttons', 0)} pages affectées",
        "impact": "Boutons non-fonctionnels = abandon de parcours utilisateur et baisse de conversion",
        "pages_affected": perf.get("button_kpi", {}).get("pages_with_nonfunc_buttons", 0),
        "pages_affected_urls": list(dict.fromkeys(_safe_list(non_func_buttons_evidence.get("affected_pages"))))[:25],
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
                for btn in broken_buttons[:100]
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

    axes["Audit Fonctionnel"]["Fonctionnement du Moteur de Recherche Interne"] = {
        "info": f"Moteur de recherche interne: {'Détecté' if functional_kpi.get('has_search') else 'Non détecté'}",
        "impact": "Fonctionnement défaillant = utilisateurs ne trouvent pas le contenu, taux de rebond élevé",
        "pages_affected": 0,
        "pages_affected_urls": [],
        "status": "passing",
        "type": None,
        "severity": None,
        "data": {"has_search": functional_kpi.get("has_search")}
    }

    # ─── AUDIT DE PERFORMANCE ET TEMPS DE RÉPONSE ──────────────────────────────
    mobile_available = perf.get("mobile_kpi", {}).get("available", False)
    mobile_status = _resolve_mobile_kpi_status(perf.get("mobile_kpi", {}))
    mobile_is_available = mobile_status != "not_available"
    avg_fcp_ms = _safe_float(perf.get("avg_fcp_ms"))
    avg_lcp_ms = _safe_float(perf.get("avg_lcp_ms"))
    avg_cls = _safe_float(perf.get("avg_cls"))
    avg_eco_index = _safe_float(perf.get("avg_eco_index"))
    compression_rate_pct = _safe_float(content.get("image_compression_stats", {}).get("compression_rate_pct"))
    
    axes["Audit de Performance et Temps de Réponse"] = {
        "Temps de Chargement Desktop": {
            "info": f"FCP={avg_fcp_ms:.0f}ms, LCP={avg_lcp_ms:.0f}ms, CLS={avg_cls:.2f}",
            "impact": "Temps de chargement élevé = abandon utilisateur, baisse des conversions, mauvais SEO",
            "pages_affected": report.get("pages_scanned", 0),
            "pages_affected_urls": [],
            "status": "failing" if avg_lcp_ms > 2500 else "passing",
            "type": "recommendation" if avg_lcp_ms > 2500 else None,
            "severity": None,
            "data": {
                "fcp_ms": perf.get("avg_fcp_ms"),
                "lcp_ms": perf.get("avg_lcp_ms"),
                "cls": perf.get("avg_cls"),
                "speed_index_ms": perf.get("avg_speed_index_ms"),
            }
        },
        "Temps de Chargement Mobile": {
            "info": f"Disponible: {mobile_available}, LCP={perf.get('mobile_kpi', {}).get('lcp_ms') if mobile_available else 'N/A'}ms",
            "impact": "Performance mobile dégradée = mauvaise expérience et pénalité SEO mobile-first",
            "pages_affected": 1 if mobile_is_available else 0,
            "pages_affected_urls": [report.get("domain", "")] if mobile_is_available else [],
            "status": mobile_status,
            "type": None,
            "severity": None,
            "data": perf.get("mobile_kpi", {}),
        },
        "Optimisation des Images": {
            "info": f"Compression: {compression_rate_pct:.1f}%, Images non optimisées: {content.get('image_compression_stats', {}).get('unoptimised_count', 0)}/{content.get('image_compression_stats', {}).get('sampled_images', 0)}",
            "impact": "Images mal optimisées = temps de chargement lent, énergie wasted, mauvaise UX",
            "pages_affected": content.get("image_compression_stats", {}).get("unoptimised_count", 0),
            "pages_affected_urls": [img.get("url", "") for img in content.get("image_compression_stats", {}).get("unoptimised_images", [])][:5],
            "status": "failing" if content.get("image_compression_stats", {}).get("unoptimised_count", 0) > 0 else "passing",
            "type": "recommendation" if content.get("image_compression_stats", {}).get("unoptimised_count", 0) > 0 else None,
            "severity": None,
            "data": content.get("image_compression_stats", {}),
        },
        "Gestion de Cache": {
            "info": f"Cache: {'Activé' if sec.get('has_cache') else 'Désactivé'}, Control: {sec.get('cache_control', 'N/A')}",
            "impact": "Cache désactivé = plus de requêtes serveur, temps de réponse lent, surcharge serveur",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing" if sec.get("has_cache") else "failing",
            "type": "recommendation" if not sec.get("has_cache") else None,
            "severity": None,
            "data": {"has_cache": sec.get("has_cache"), "cache_control": sec.get("cache_control")},
        },
        "Utilisation de Compression": {
            "info": f"Compression HTTP: {'Activée' if perf.get('html_compression_applied') else 'Désactivée'}",
            "impact": "Compression désactivée = taille des transferts importante, navigation plus lente",
            "pages_affected": 1 if not perf.get("html_compression_applied") else 0,
            "pages_affected_urls": [report.get("domain", "")] if not perf.get("html_compression_applied") else [],
            "status": "failing" if not perf.get("html_compression_applied") else "passing",
            "type": "recommendation" if not perf.get("html_compression_applied") else None,
            "severity": None,
            "data": {"html_compression_applied": perf.get("html_compression_applied")},
        }
    }

    # ─── SEO ──────────────────────────────────────────────────────────────────────
    axes["SEO"] = {
        "Balise Alts": {
            "info": f"Images sans ALT: {seo.get('images_missing_alt', 0)} images",
            "impact": "Images sans ALT = perte de signal SEO, accessibilité dégradée, mauvaise expérience handicapés",
            "pages_affected": seo.get("images_missing_alt", 0),
            "pages_affected_urls": list(dict.fromkeys([img.get("image_url") for img in _safe_list(missing_alt_evidence.get("images")) if isinstance(img, dict) and img.get("image_url")]))[:25],
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
            "pages_affected_urls": list(dict.fromkeys(_safe_list(missing_meta_evidence.get("affected_pages")) + _safe_list(missing_title_evidence.get("affected_pages"))))[:25],
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
            "data": {"has_sitemap": seo.get("has_sitemap")},
        },
        "Robot Txt": {
            "info": f"robots.txt: {'Présent' if seo.get('has_robots_txt') else 'Absent'}",
            "impact": "robots.txt absent = contrôle insuffisant du crawl, risque d'indexation de pages sensibles",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing" if seo.get("has_robots_txt") else "failing",
            "type": "recommendation" if not seo.get("has_robots_txt") else None,
            "severity": None,
            "data": {"has_robots_txt": seo.get("has_robots_txt")},
        },
        "Duplication de Contenu": {
            "info": f"Taux de duplication: {seo.get('duplicate_content_kpi', {}).get('duplicate_content_rate_pct', 0):.1f}% ({seo.get('duplicate_content_kpi', {}).get('duplicate_page_count', 0)} pages)",
            "impact": "Contenu dupliqué = cannibalisation SEO, dilution de pertinence, classement affaibli",
            "pages_affected": seo.get("duplicate_content_kpi", {}).get("duplicate_page_count", 0),
            "pages_affected_urls": [],
            "status": "failing" if seo.get("duplicate_content_kpi", {}).get("duplicate_content_rate_pct", 0) > 10.0 else "passing",
            "type": "recommendation" if seo.get("duplicate_content_kpi", {}).get("duplicate_content_rate_pct", 0) > 10.0 else None,
            "severity": None,
            "data": seo.get("duplicate_content_kpi", {}),
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
            "data": {"node_style_url_count": seo.get("node_style_url_count", 0)},
        },
        "Structure du Contenu (Hn)": {
            "info": f"Pages avec mauvaise structure H1: {seo.get('pages_with_bad_h1', 0)}, Homepage H1: {'Manquant' if seo.get('homepage_h1_kpi', {}).get('homepage_h1_missing') else 'Présent'}",
            "impact": "Structure H1 défaillante = signal SEO réduit, hiérarchie de contenu confuse pour utilisateurs",
            "pages_affected": seo.get("pages_with_bad_h1", 0),
            "pages_affected_urls": [],
            "status": "failing" if seo.get("pages_with_bad_h1", 0) > 0 or seo.get("homepage_h1_kpi", {}).get("homepage_h1_missing") else "passing",
            "type": "recommendation" if seo.get("pages_with_bad_h1", 0) > 0 else None,
            "severity": None,
            "data": {
                "pages_with_bad_h1": seo.get("pages_with_bad_h1", 0),
                "homepage_h1_missing": seo.get("homepage_h1_kpi", {}).get("homepage_h1_missing"),
            },
        },
        "Linking Interne": {
            "info": f"Total liens internes: {seo.get('total_internal_links', 0)}, Pages manquant liens contextuels: {ux.get('pages_missing_contextual_links', 0)}",
            "impact": "Linking interne faible = distribution du PageRank inefficace, crawl incomplet, perte de pertinence",
            "pages_affected": ux.get("pages_missing_contextual_links", 0),
            "pages_affected_urls": [],
            "status": (
                "failing" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.30
                else "warning" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.15
                else "passing"
            ),
            "type": (
                "recommendation" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.15
                else None
            ),
            "severity": (
                "high" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.30
                else "medium" if ux.get("pages_missing_contextual_links", 0) > report.get("pages_scanned", 1) * 0.15
                else None
            ),
            "data": {
                "total_internal_links": seo.get("total_internal_links", 0),
                "pages_missing_contextual_links": ux.get("pages_missing_contextual_links", 0),
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
            },
        },
        "Qualité H1 (NLP)": {
            "info": f"H1 manquants: {seo.get('nlp_seo_kpis', {}).get('h1_missing_pages', 0)} pages, H1 multiples: {seo.get('nlp_seo_kpis', {}).get('h1_multiple_pages', 0)} pages",
            "impact": "Structure H1 incorrecte nuit au SEO on-page et à la lisibilité sémantique",
            "pages_affected": _safe_int(seo.get('nlp_seo_kpis', {}).get('h1_missing_pages', 0)) + _safe_int(seo.get('nlp_seo_kpis', {}).get('h1_multiple_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if (_safe_int(seo.get('nlp_seo_kpis', {}).get('h1_missing_pages', 0)) + _safe_int(seo.get('nlp_seo_kpis', {}).get('h1_multiple_pages', 0))) > 0 else "passing",
            "type": "recommendation" if (_safe_int(seo.get('nlp_seo_kpis', {}).get('h1_missing_pages', 0)) + _safe_int(seo.get('nlp_seo_kpis', {}).get('h1_multiple_pages', 0))) > 0 else None,
            "severity": None,
            "data": _safe_dict(seo.get("nlp_seo_kpis", {})),
        },
        "Méta Description (NLP)": {
            "info": f"Meta descriptions manquantes (NLP): {seo.get('nlp_seo_kpis', {}).get('meta_missing_pages', 0)} pages",
            "impact": "Descriptions meta manquantes diminuent le CTR et la qualité des snippets SERP",
            "pages_affected": _safe_int(seo.get('nlp_seo_kpis', {}).get('meta_missing_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(seo.get('nlp_seo_kpis', {}).get('meta_missing_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(seo.get('nlp_seo_kpis', {}).get('meta_missing_pages', 0)) > 0 else None,
            "severity": None,
            "data": _safe_dict(seo.get("nlp_seo_kpis", {})),
        },
        "AI Readiness (llms.txt)": {
            "info": f"Pages avec llms.txt détecté: {seo.get('nlp_seo_kpis', {}).get('llms_txt_present_pages', 0)}",
            "impact": "Présence llms.txt améliore la découvrabilité dans les moteurs génératifs",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "passing",
            "type": "recommendation" if _safe_int(seo.get('nlp_seo_kpis', {}).get('llms_txt_present_pages', 0)) == 0 else None,
            "severity": None,
            "data": _safe_dict(seo.get("nlp_seo_kpis", {})),
        }
    }

    # ─── AUDIT UX/UI ──────────────────────────────────────────────────────────────
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
            "info": f"Signaux CLS: {avg_cls:.2f}, Pages sans images produit: {ux.get('pages_with_missing_product_images', 0)}",
            "impact": "Design pauvre = mauvaise UX, conversion réduite, pénalité Core Web Vitals",
            "pages_affected": ux.get("pages_with_missing_product_images", 0),
            "pages_affected_urls": [],
            "status": "failing" if avg_cls > 0.1 else "passing",
            "type": "recommendation" if avg_cls > 0.1 else None,
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
            "status": "passing" if ux.get("pages_with_conversion_funnels", 0) > 0 else "failing",
            "type": None,
            "severity": None,
            "data": {
                "pages_with_conversion_funnels": ux.get("pages_with_conversion_funnels", 0),
                "pages_missing_contextual_links": ux.get("pages_missing_contextual_links", 0),
            },
        },

        "Mobile Friendly": {
            "info": f"Performance mobile: {'Disponible' if mobile_available else 'Non disponible'}",
            "impact": "Site non mobile-friendly = perte d'utilisateurs mobiles (~60%), pénalité SEO mobile-first",
            "pages_affected": 1 if mobile_is_available else 0,
            "pages_affected_urls": [report.get("domain", "")] if mobile_is_available else [],
            "status": mobile_status,
            "type": None,
            "severity": None,
            "data": perf.get("mobile_kpi", {}),
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
            "data": _safe_dict(content.get("advanced_content_kpis", {})),
        },
        "Structure Contenu Cassée": {
            "info": f"Pages avec indice structure élevé: {content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)}",
            "impact": "Structure de contenu dégradée nuit à la lisibilité, au SEO et à la conversion",
            "pages_affected": _safe_int(content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(content.get('advanced_content_kpis', {}).get('high_broken_structure_pages', 0)) > 0 else None,
            "severity": None,
            "data": _safe_dict(content.get("advanced_content_kpis", {})),
        },
        "Diversité Lexicale": {
            "info": f"Diversité lexicale moyenne: {content.get('advanced_content_kpis', {}).get('avg_lexical_diversity', 'N/A')}",
            "impact": "Faible diversité lexicale suggère contenu répétitif ou faible valeur éditoriale",
            "pages_affected": _safe_int(content.get('advanced_content_kpis', {}).get('low_lexical_diversity_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_content_kpis', {}).get('low_lexical_diversity_pages', 0)) > 0 else "passing",
            "type": "recommendation" if _safe_int(content.get('advanced_content_kpis', {}).get('low_lexical_diversity_pages', 0)) > 0 else None,
            "severity": None,
            "data": _safe_dict(content.get("advanced_content_kpis", {})),
        }
    }

    # ─── ECO INDEX ──────────────────────────────────────────────────────────────
    axes["Eco Index"] = {
        "Score Écologique et Impact Climatique": {
            "info": f"Eco Index: {avg_eco_index:.1f}/100",
            "impact": "Site gourmand en énergie = impact climatique, consommation serveur élevée, coûts d'infrastructure",
            "pages_affected": report.get("pages_scanned", 0),
            "pages_affected_urls": [],
            # [5.2] The original had two identical 'else "passing"' branches, making
            # eco-index 30-49 (marginal) show as green. Corrected to warn on 30-49.
            "status": "failing" if avg_eco_index < 30 else "warning" if avg_eco_index < 50 else "passing",
            "type": "recommendation" if avg_eco_index < 50 else None,
            "severity": None,
            "data": {"avg_eco_index": perf.get("avg_eco_index")},
        }
    }

    # ─── RGPD ───────────────────────────────────────────────────────────────────
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
            "client_summary": (
                None if (
                    privacy_kpi.get("cookie_consent", {}).get("has_banner")
                    or privacy_kpi.get("cookie_consent", {}).get("cmp_present")
                    or privacy_kpi.get("cookie_consent") is None
                )
                else "Aucune bannière de consentement cookies détectée. Non-conformité RGPD potentielle."
            ),
            "data": privacy_kpi.get("cookie_consent", {}),
        },
        "Politique de Confidentialité": {
            "info": f"Politique de confidentialité: {'Présente' if privacy_kpi.get('has_privacy_policy') else 'Absente'}",
            "impact": "Politique absente = violation RGPD, risque légal, manque de transparence envers utilisateurs",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "failing" if not privacy_kpi.get("has_privacy_policy") else "passing",
            "type": "compliance",
            "severity": None,
            "data": {"has_privacy_policy": privacy_kpi.get("has_privacy_policy")},
        },
        "Durée de Conservation": {
            "info": f"Déclaration durée conservation: {content.get('rgpd_retention_signal_pages', 0)} pages mentionnent la rétention",
            "impact": "Durée non déclarée = non-conformité RGPD Art.5, transparence insuffisante",
            "pages_affected": 1 if content.get("rgpd_retention_signal_pages", 0) == 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if content.get("rgpd_retention_signal_pages", 0) == 0 else [],
            "status": "failing" if content.get("rgpd_retention_signal_pages", 0) == 0 else "passing",
            "type": "compliance",
            "severity": None,
            "data": {"rgpd_retention_signal_pages": content.get("rgpd_retention_signal_pages", 0)},
        },
        "Minimisation des Données": {
            "info": f"Déclaration minimisation: {content.get('rgpd_minimization_signal_pages', 0)} pages mentionnent la minimisation",
            "impact": "Minimisation non déclarée = non-conformité RGPD, principes de collecte transparence insuffisan",
            "pages_affected": 1 if content.get("rgpd_minimization_signal_pages", 0) == 0 else 0,
            "pages_affected_urls": [report.get("domain", "")] if content.get("rgpd_minimization_signal_pages", 0) == 0 else [],
            "status": "failing" if content.get("rgpd_minimization_signal_pages", 0) == 0 else "passing",
            "type": "compliance",
            "severity": None,
            "data": {"rgpd_minimization_signal_pages": content.get("rgpd_minimization_signal_pages", 0)},
        },
        "Mentions Légales": {
            "info": f"Mentions légales: {'Présentes' if privacy_kpi.get('has_legal_notice') else 'Absentes'}",
            "impact": "Mentions absentes = risque réglementaire France/EU, manque de transparence juridique",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "failing" if not privacy_kpi.get("has_legal_notice") else "passing",
            "type": "compliance",
            "severity": None,
            "data": {"has_legal_notice": privacy_kpi.get("has_legal_notice")},
        },
        "Droits des Personnes": {
            "info": f"Droits RGPD mentionnés: {'Oui' if privacy_kpi.get('has_information_rights') else 'Non'}",
            "impact": "Droits non mentionnés = non-conformité RGPD Art.13/14, violation transparence",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "failing" if not privacy_kpi.get("has_information_rights") else "passing",
            "type": "compliance",
            "severity": None,
            "data": {"has_information_rights": privacy_kpi.get("has_information_rights")},
        },
        "Finalité du Traitement": {
            "info": f"Finalité déclarée: {'Oui' if privacy_kpi.get('has_declared_purpose') else 'Non'}",
            "impact": "Finalité non déclarée = non-conformité RGPD, base légale insuffisante",
            "pages_affected": 1,
            "pages_affected_urls": [report.get("domain", "")],
            "status": "failing" if not privacy_kpi.get("has_declared_purpose") else "passing",
            "type": "compliance",
            "severity": None,
            "data": {"has_declared_purpose": privacy_kpi.get("has_declared_purpose")},
        },
        "Couverture des Droits RGPD": {
            "info": f"Pages avec couverture droits insuffisante: {content.get('advanced_rgpd_kpis', {}).get('rights_low_pages', 0)}",
            "impact": "Droits RGPD incomplets exposent à des risques de non-conformité réglementaire",
            "pages_affected": _safe_int(content.get('advanced_rgpd_kpis', {}).get('rights_low_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_rgpd_kpis', {}).get('rights_low_pages', 0)) > 0 else "passing",
            "type": "compliance",
            "severity": None,
            "data": _safe_dict(content.get("advanced_rgpd_kpis", {})),
        },
        "Trackers Avant Consentement": {
            "info": f"Pages avec trackers pré-consentement: {content.get('advanced_rgpd_kpis', {}).get('pre_consent_violation_pages', 0)}",
            "impact": "Trackers avant consentement peuvent enfreindre ePrivacy/CNIL et exposer à des sanctions",
            "pages_affected": _safe_int(content.get('advanced_rgpd_kpis', {}).get('pre_consent_violation_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_rgpd_kpis', {}).get('pre_consent_violation_pages', 0)) > 0 else "passing",
            "type": "compliance",
            "severity": None,
            "data": _safe_dict(content.get("advanced_rgpd_kpis", {})),
        },
        "Score Politique de Confidentialité": {
            "info": f"Pages avec score confidentialité faible: {content.get('advanced_rgpd_kpis', {}).get('privacy_score_low_pages', 0)}",
            "impact": "Politique de confidentialité faible dégrade la confiance et le niveau de conformité perçu",
            "pages_affected": _safe_int(content.get('advanced_rgpd_kpis', {}).get('privacy_score_low_pages', 0)),
            "pages_affected_urls": [],
            "status": "failing" if _safe_int(content.get('advanced_rgpd_kpis', {}).get('privacy_score_low_pages', 0)) > 0 else "passing",
            "type": "compliance",
            "severity": None,
            "data": _safe_dict(content.get("advanced_rgpd_kpis", {})),
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
        "summary":        summary_v2,
        "axes":           axes,
    }
