import { getAxisScoreBreakdown, getRiskLevelFromScore, isNonTestedStatus } from '@/data/mockAuditData';
import type {
  AuditActionItem,
  AuditCoverageItem,
  AuditReport,
  AuditAxis,
  AuditFinding,
  AuditPassingKpi,
  AuditRoadmap,
  AuditSummary,
  Criticality,
  FindingStatus,
  FindingOrigin,
  Priority,
  KpiItem,
  KpiLabels,
  KpiStatut,
  KpiTypeLabel,
  KpiPriorite,
} from '@/data/mockAuditData';

export interface ApiResponse {
  report_version?: string;
  scan_id: string;
  domain: string;
  axes?: Record<string, Record<string, any>>;
  top_level_kpis?: Record<string, unknown>;
  domain_analysis?: any;
  site_metrics?: any;
  issues?: any;
  summary?: AuditSummary & {
    delivery_overview?: Record<string, unknown>;
    client_overview?: Record<string, unknown>;
    risk_breakdown?: Record<string, unknown>;
  };
  quick_wins?: AuditActionItem[];
  bugs?: AuditActionItem[];
  recommendations?: AuditActionItem[];
  compliance?: AuditActionItem[];
  roadmap?: AuditRoadmap;
  audit_coverage?: AuditCoverageItem[];
  passing_kpis?: AuditPassingKpi[];
  kpis?: KpiItem[];
  generated_at?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// KPI Display Label Contracts
// ────────────────────────────────────────────────────────────────────────────

/* Canonical triplet helpers */
const OK_DEFAULT:  KpiLabels = { statut: 'Concluant',    typeLabel: 'Conforme',        priorite: 'Normale'  };
const NT_DEFAULT:  KpiLabels = { statut: 'Non testé',    typeLabel: 'Indéterminé',     priorite: 'Normale'   };
const REVIEW_DEFAULT: KpiLabels = { statut: 'À vérifier', typeLabel: 'Indéterminé',     priorite: 'Normale'   };

const KO_BUG_MAJ:  KpiLabels = { statut: 'Non concluant', typeLabel: 'Bug',             priorite: 'Majeure'   };
const KO_BUG_MIN:  KpiLabels = { statut: 'Non concluant', typeLabel: 'Bug',             priorite: 'Mineure'   };
const KO_RECO_MAJ: KpiLabels = { statut: 'Non concluant', typeLabel: 'Recommandation',  priorite: 'Majeure'   };
const KO_RECO_MIN: KpiLabels = { statut: 'Non concluant', typeLabel: 'Recommandation',  priorite: 'Mineure'   };
const KO_NA:       KpiLabels = { statut: 'Non concluant', typeLabel: 'Non applicable',  priorite: 'Normale'   };

/**
 * Helper: return Bug/Majeure for critical/high severity, Recommandation/Mineure otherwise.
 */
function koBugOrReco(severity: string | null | undefined): KpiLabels {
  const sev = String(severity ?? '').toLowerCase();
  if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ;
  return KO_RECO_MIN;
}

/**
 * Helper: return Bug/Majeure for critical/high, Bug/Mineure for medium, Recommandation/Mineure for low.
 */
function koBugSeverity(severity: string | null | undefined): KpiLabels {
  const sev = String(severity ?? '').toLowerCase();
  if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ;
  if (sev === 'medium') return KO_BUG_MIN;
  return KO_RECO_MIN;
}

function hasPositiveTechnicalEvidence(value: unknown, depth = 0): boolean {
  if (depth > 4 || value == null) return false;
  if (typeof value === 'string') {
    const normalized = normalizeForComparison(value);
    if (!normalized || normalized === 'false' || normalized === '0') return false;
    if (
      normalized.includes('non detecte') ||
      normalized.includes('non disponible') ||
      normalized.includes('aucun') ||
      normalized.includes('missing')
    ) {
      return false;
    }
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some((item) => hasPositiveTechnicalEvidence(item, depth + 1));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const positiveKeys = [
      'detected_product',
      'detected_version',
      'cms_name',
      'cms_version',
      'cms_detected',
      'server',
      'server_technology',
      'language',
      'runtime',
      'module',
      'modules',
      'module_verification',
      'module_count',
      'technologies',
      'technology',
      'rows',
      'csv_rows',
    ];
    return positiveKeys.some((key) => hasPositiveTechnicalEvidence(record[key], depth + 1));
  }
  return false;
}

function technicalUncertainLabel(data: any): KpiLabels {
  return hasPositiveTechnicalEvidence(data) ? REVIEW_DEFAULT : NT_DEFAULT;
}

/**
 * KPI-specific override rules.
 * Each entry maps the canonical KPI ID to a resolver that returns KpiLabels
 * based on the raw backend status and severity.
 * Unlisted KPIs fall through to the default logic in resolveKpiLabels().
 */
const KPI_LABEL_RULES: Record<string, (status: string, severity: string | null | undefined, data: any) => KpiLabels | null> = {
  // ── Technique ─────────────────────────────────────────────────────────
  tech_cms_version(rawStatus, severity, data) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (isNonTestedStatus(rawStatus)) return technicalUncertainLabel(data);
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ;
    return KO_RECO_MIN; // outdated only
  },
  tech_modules_versions(rawStatus, severity, data) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (isNonTestedStatus(rawStatus)) return technicalUncertainLabel(data);
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ;  // CVE confirmed
    return KO_RECO_MIN; // outdated only
  },
  tech_server_version(rawStatus, severity, data) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (isNonTestedStatus(rawStatus)) return technicalUncertainLabel(data);
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ;  // EOL
    return KO_RECO_MIN; // exposed but current
  },
  tech_programming_language(rawStatus, severity, data) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (isNonTestedStatus(rawStatus)) return technicalUncertainLabel(data);
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ;  // obsolete runtime
    return KO_RECO_MIN;
  },
  tech_cve_check(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (isNonTestedStatus(rawStatus)) return NT_DEFAULT;
    return KO_BUG_MAJ; // confirmed high/critical CVE → always Bug/Majeure
  },

  // ── Sécurité ──────────────────────────────────────────────────────────
  sec_ssl(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // expired/invalid → always Bug/Majeure
  },
  sec_http_headers(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // HSTS/CSP/XFO missing
    return KO_RECO_MIN;
  },
  sec_session_cookies(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // Secure/HttpOnly missing
  },
  sec_sqli_ddos(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // confirmed vulnerable
  },
  sec_admin_exposed(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // public admin confirmed
  },
  sec_sensitive_files(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // secret/config/version found
  },
  sec_robots_disclosure(rawStatus, _severity, data) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    // Check if sensitive custom paths were found
    const hasSensitive = String(data?.has_sensitive_custom_paths ?? '').toLowerCase() === 'true'
      || (Array.isArray(data?.exposed_paths) && data.exposed_paths.length > 0);
    return hasSensitive ? KO_BUG_MAJ : KO_RECO_MIN;
  },
  sec_error_pages(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // stack/path/token leak
  },
  sec_brute_force(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // login tested with no limit/captcha/lockout
  },
  sec_file_upload(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // dangerous extension accepted
  },
  sec_js_deps(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // high CVE
    return KO_RECO_MIN; // outdated only
  },
  sec_service_exposure(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // sensitive public port open
  },

  // ── Fonctionnel ───────────────────────────────────────────────────────
  func_forms(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // tested form fails
  },
  func_links(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // conversion link broken
    return KO_BUG_MIN; // other broken links
  },
  func_buttons(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // CTA broken
    return KO_BUG_MIN; // other buttons
  },
  func_features(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // expected feature missing
  },
  func_search(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // search empty/broken
  },

  // ── Performance ───────────────────────────────────────────────────────
  perf_cache(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // no-cache/private/no-store
  },
  perf_compression(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // no gzip/br/brotli
  },
  perf_desktop_speed(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical') return KO_RECO_MAJ; // extreme slow confirmed
    return KO_RECO_MIN;
  },
  perf_mobile_speed(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // measured slow
  },
  perf_image_optim(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // heavy images
  },
  perf_console_errors(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // feature-breaking
    return KO_BUG_MIN; // isolated console error
  },

  // ── SEO ───────────────────────────────────────────────────────────────
  seo_alt_tags(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_meta_tags(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_sitemap(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_robots_txt(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_duplication(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_multi_browser(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_url_structure(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_heading_structure(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_internal_linking(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_external_linking(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_h1_quality(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_meta_nlp(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  seo_ai_readiness(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },

  // ── UX/UI ─────────────────────────────────────────────────────────────
  ux_audience_targeting(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  ux_social_sharing(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  ux_design_ergonomics(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // layout blocks usage
    return KO_RECO_MIN;
  },
  ux_navigation(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // path blocked
    return KO_RECO_MIN; // confusing
  },
  ux_mobile_friendly(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MAJ; // severe mobile usability issue
  },

  // ── Contenu ───────────────────────────────────────────────────────────
  content_freshness(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  content_thin(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  content_key_pages(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  content_cannibalization(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  content_missing_cta(rawStatus, severity) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    const sev = String(severity ?? '').toLowerCase();
    if (sev === 'critical' || sev === 'high') return KO_BUG_MAJ; // conversion path blocked
    return KO_RECO_MIN;
  },
  content_broken_structure(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },
  content_lexical_diversity(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN;
  },

  // ── Eco Index ─────────────────────────────────────────────────────────
  eco_index_score(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // measured low score
  },

  // ── RGPD ──────────────────────────────────────────────────────────────
  rgpd_cookie_consent(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // trackers before consent
  },
  rgpd_privacy_policy(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // policy absent
  },
  rgpd_data_retention(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ;
  },
  rgpd_minimization(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ;
  },
  rgpd_legal_notice(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ;
  },
  rgpd_user_rights(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ;
  },
  rgpd_declared_purpose(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ;
  },
  rgpd_rights_coverage(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ;
  },
  rgpd_pre_consent_trackers(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_BUG_MAJ; // tracker loaded before consent
  },
  rgpd_privacy_score(rawStatus) {
    if (rawStatus === 'passing') return OK_DEFAULT;
    if (rawStatus === 'not_available') return NT_DEFAULT;
    return KO_RECO_MIN; // measured low policy score
  },
  rgpd_policy_score(rawStatus) {
    return KPI_LABEL_RULES.rgpd_privacy_score(rawStatus, null, null);
  },
};

/**
 * Resolve the French display labels (statut, typeLabel, priorite) for a KPI.
 *
 * Uses the per-KPI rule table when the KPI ID is known, then falls back to
 * a generic default that matches the plan's contract rules.
 */
function resolveKpiLabels(
  kpiId: string,
  rawStatus: string | undefined | null,
  severity: string | null | undefined,
  data: any,
): KpiLabels {
  const status = String(rawStatus ?? '').toLowerCase();

  // Status wins over type: non-tested KPIs are informational, not bugs/recommendations.
  if (isNonTestedStatus(status)) {
    return NT_DEFAULT;
  }

  // Check for passing
  if (status === 'passing' || status === 'pass' || status === 'covered') {
    return OK_DEFAULT;
  }

  // For failing/warning, look up per-KPI rule
  const normalizedKpiId = kpiId.replace(/[^a-z0-9_]/g, '').toLowerCase();
  const rule = KPI_LABEL_RULES[normalizedKpiId];
  if (rule) {
    const result = rule(normalizedKpiId, severity, data);
    if (result) return result;
  }

  // Default fallback for unknown KPIs
  if (status === 'warning') {
    return KO_RECO_MIN; // warnings → Recommandation/Mineure
  }
  return koBugOrReco(severity); // failing → severity-dependent
}

type AxisBucketKey = keyof typeof AXIS_META;
type RawAxisSection = Record<string, any>;

/**
 * Normalize axis labels to uppercase, remove accents, and standardize separators.
 * @example "Sécurité" -> "SECURITE", "Check Sécurité" -> "CHECK_SECURITE"
 */
function normalizeAxisLabel(label: string): string {
  if (!label || typeof label !== 'string') return '';
  
  return label
    .trim()
    .toLowerCase()
    // Remove accents/diacritics using NFD normalization
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    // Replace spaces, hyphens, slashes with underscores
    .replace(/[\s\-/]+/g, '_')
    // Collapse multiple underscores
    .replace(/_+/g, '_')
    // Clean up leading/trailing underscores
    .replace(/^_+|_+$/g, '');
}

/**
 * Unified axis alias table: mapped from normalized label → AXIS_META key.
 * Includes French and English synonyms with accents stripped.
 */
const AXIS_ALIAS_TABLE: Record<string, AxisBucketKey> = {
  // TECHNIQUE aliases
  TECHNIQUE: 'TECHNIQUE',
  TECHNICAL: 'TECHNIQUE',
  AUDIT_TECHNIQUE: 'TECHNIQUE',
  CMS: 'TECHNIQUE',
  FRAMEWORK: 'TECHNIQUE',
  SERVER: 'TECHNIQUE',
  
  // SECURITY aliases
  SECURITY: 'SECURITY',
  SECURITE: 'SECURITY',
  CHECK_SECURITE: 'SECURITY',
  SSL: 'SECURITY',
  HEADERS: 'SECURITY',
  COOKIE: 'SECURITY',
  
  // FUNCTIONAL aliases
  FUNCTIONAL: 'FUNCTIONAL',
  FUNCTION: 'FUNCTIONAL',
  AUDIT_FONCTIONNEL: 'FUNCTIONAL',
  FONCTIONNEL: 'FUNCTIONAL',
  FORMS: 'FUNCTIONAL',
  BUTTONS: 'FUNCTIONAL',
  
  // PERFORMANCE aliases
  PERFORMANCE: 'PERFORMANCE',
  PERF: 'PERFORMANCE',
  AUDIT_DE_PERFORMANCE_ET_TEMPS_DE_REPONSE: 'PERFORMANCE',
  PERFORMANCE_ET_TEMPS_DE_REPONSE: 'PERFORMANCE',
  CORE_WEB_VITALS: 'PERFORMANCE',
  SPEED: 'PERFORMANCE',
  LCP: 'PERFORMANCE',
  FCP: 'PERFORMANCE',
  
  // SEO aliases
  SEO: 'SEO',
  SEARCH_ENGINE_OPTIMIZATION: 'SEO',
  REFERENCEMENT: 'SEO',
  
  // CONTENT aliases (most important for this fix!)
  CONTENT: 'CONTENT',
  CONTENU: 'CONTENT',
  AUDIT_DE_CONTENU: 'CONTENT',
  AUDIT_CONTENU: 'CONTENT',
  TEXT_QUALITY: 'CONTENT',
  QUALITY: 'CONTENT',
  
  // UX_UI aliases
  UX_UI: 'UX_UI',
  UX: 'UX_UI',
  UI: 'UX_UI',
  AUDIT_UX_UI: 'UX_UI',
  UXUI: 'UX_UI',
  USER_EXPERIENCE: 'UX_UI',
  DESIGN: 'UX_UI',
  
  // ECO_INDEX aliases
  ECO_INDEX: 'ECO_INDEX',
  ECOINDEX: 'ECO_INDEX',
  ECO: 'ECO_INDEX',
  ENVIRONMENTAL: 'ECO_INDEX',
  
  // RGPD aliases
  RGPD: 'RGPD',
  PRIVACY: 'RGPD',
  COMPLIANCE: 'RGPD',
  LEGAL: 'RGPD',
  CONFORMITE: 'RGPD',
  GDPR: 'RGPD',
};

/**
 * Resolve an axis label to its AXIS_META key using unified normalization.
 * Handles French and English labels with/without accents.
 * Falls back to FUNCTIONAL with a warning log if axis is unknown.
 */
function resolveAxisMetaKey(label: string | undefined | null): AxisBucketKey {
  if (!label) {
    return 'FUNCTIONAL';
  }

  const normalized = normalizeAxisLabel(label);
  if (!normalized) {
    return 'FUNCTIONAL';
  }

  const mapped = AXIS_ALIAS_TABLE[normalized];
  if (mapped) {
    return mapped;
  }

  // Log unknown axis for debugging
  console.warn(
    `[auditMapper] Unknown axis label: "${label}" (normalized: "${normalized}"), falling back to FUNCTIONAL`
  );
  return 'FUNCTIONAL';
}

const AXIS_META: Record<string, { id: string; name: string; description: string }> = {
  TECHNIQUE: {
    id: 'technique',
    name: 'Technique',
    description: 'Versions serveur, technologies du site et erreurs de scripts.',
  },
  SECURITY: {
    id: 'security',
    name: 'Sécurité',
    description: 'Certificat de securite, protections du navigateur, cookies et cache.',
  },
  FUNCTIONAL: {
    id: 'functional',
    name: 'Fonctionnel',
    description: 'Formulaires, liens cassés, boutons, adresses email protégées.',
  },
  PERFORMANCE: {
    id: 'performance',
    name: 'Performance',
    description: 'Temps d affichage, stabilite visuelle, poids des ressources et images.',
  },
  SEO: {
    id: 'seo',
    name: 'SEO',
    description: 'Descriptions de pages, liens internes, plan du site et contenu duplique.',
  },
  CONTENT: {
    id: 'content',
    name: 'Contenu',
    description: 'Qualité temporelle (fraîcheur), taux de remplissage texte, orthographe.',
  },
  UX_UI: {
    id: 'ux-ui',
    name: 'Experience utilisateur',
    description: 'Menu structuré, liens invisibles, ratios de densité de texte.',
  },
  ECO_INDEX: {
    id: 'eco-index',
    name: 'Impact ecologique',
    description: 'Impact environnemental global du site web.',
  },
  RGPD: {
    id: 'rgpd',
    name: 'Protection des données',
    description: 'Bannière de consentement, politique de confidentialité visée.',
  },
};

function normalizeFindingStatus(statusRaw: unknown): FindingStatus {
  const status = String(statusRaw ?? '').toLowerCase();
  if (status === 'passing' || status === 'pass' || status === 'covered') return 'pass';
  if (status === 'failing' || status === 'fail' || status === 'failed') return 'fail';
  if (status === 'warning') return 'fail';
  if (status === 'not_available' || status === 'not-available') return 'not_available';
  if (status === 'not_evaluated' || status === 'not-evaluated' || status === 'non_evalue' || status === 'non-evalue') return 'not_evaluated';
  if (status === 'not_measured' || status === 'not-measured') return 'not_measured';
  return 'not_measured';
}

function normalizeOrigin(typeRaw: unknown): FindingOrigin {
  const value = String(typeRaw ?? '').toLowerCase();
  if (value === 'compliance') return 'RGPD';
  if (value === 'rgpd') return 'RGPD';
  if (value === 'bug') return 'bug';
  if (value === 'recommendation') return 'recommendation';
  return 'recommendation';
}

function normalizePriority(params: { status: FindingStatus; severity?: unknown; type?: unknown }): Priority {
  if (params.status === 'pass') return 'long-terme';
  if (params.status === 'not_available' || params.status === 'not_measured' || params.status === 'not_evaluated') {
    return 'moyen-terme';
  }
  const severity = String(params.severity ?? '').toLowerCase();
  if (severity === 'critical' || severity === 'high') return 'moyen-terme';
  const type = String(params.type ?? '').toLowerCase();
  if (type === 'recommendation') return 'long-terme';
  return 'moyen-terme';
}

function normalizeCriticality(params: { status: FindingStatus; severity?: unknown }): Criticality {
  if (params.status === 'pass') return 'low';
  if (params.status === 'not_available') return 'low';
  if (params.status === 'not_measured' || params.status === 'not_evaluated') return 'medium';
  const sev = String(params.severity ?? '').toLowerCase();
  if (sev === 'critical') return 'critical';
  if (sev === 'high') return 'high';
  if (sev === 'medium') return 'medium';
  return 'medium';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatEvidenceScalar(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function sanitizeEvidenceLine(line: string): string {
  const normalized = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (/^(VALID|PARTIAL|MISSING)$/i.test(normalized)) return '';
  if (/^(data quality|quality|status|passed|sampled|source|detection source)\s*:/i.test(normalized)) return '';

  const looksLikeJson =
    normalized.startsWith('{') ||
    normalized.startsWith('[') ||
    /\{.*:.*\}/.test(normalized) ||
    normalized.includes('"') && normalized.includes('{');

  if (looksLikeJson) {
    return 'Donnee technique structuree disponible dans les details bruts.';
  }

  return normalized
    .replace(/\bevidence\./gi, '')
    .replace(/\bmetrics\./gi, '')
    .replace(/\banomalie\b/gi, 'signal')
    .replace(/\banomalies\b/gi, 'signaux');
}

function normalizeForComparison(value: string | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function expandKnownAbbreviations(text: string | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(/\bKPIs\b/gi, 'indicateurs')
    .replace(/\bKPI\b/gi, 'indicateur')
    .replace(/certificat SSL/gi, 'certificat de securite')
    .replace(/Largest Contentful Paint/gi, "temps d'affichage principal")
    .replace(/First Contentful Paint/gi, 'premier affichage visible')
    .replace(/\bCore Web Vitals\b/gi, 'indicateurs de chargement')
    .replace(/\bSpeed Index\b/gi, 'indice de vitesse')
    .replace(/\bLCP\b/g, "temps d'affichage principal")
    .replace(/\bFCP\b/g, 'premier affichage visible')
    .replace(/\bCLS\b/g, 'stabilite visuelle')
    .replace(/\bCVE\b/gi, 'vulnerabilite connue')
    .replace(/\bCMS\b/g, 'systeme de gestion du site')
    .replace(/\bSSL\b/g, 'certificat de securite')
    .replace(/\bSEO\b/gi, 'SEO')
    .replace(/\bRGPD\b/gi, 'protection des données')
    .replace(/\bGDPR\b/gi, 'protection des données')
    .replace(/\bJS\b/g, 'JavaScript')
    .replace(/\bSQLi\b/gi, 'injection dans la base de donnees')
    .replace(/\bXSS\b/gi, 'injection de script')
    .replace(/\bDDoS\b/gi, 'saturation du service')
    .replace(/Content-Security-Policy/g, 'regle de securite du contenu')
    .replace(/\bHTTP\b/g, 'reponse du serveur')
    .replace(/\bHTML\b/g, 'page web');
}

function removeAffectedLead(text: string): string {
  return text
    .replace(/\s*Affecte\s+\d+\s+page\(s\)\.?/gi, '')
    .replace(/\s*Affecte\s+\d+\s+element\(s\)\.?/gi, '')
    .replace(/\s*Affected\s+\d+\s+page\(s\)\.?/gi, '')
    .replace(/\s*Pages?\s+concernees?\s*:\s*\d+\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPlainDisplayText(text: string | undefined): string {
  const expanded = expandKnownAbbreviations(text)
    .replace(/\bMETA\b/g, 'metadonnees')
    .replace(/\bURLs? concernees/gi, 'Pages concernees')
    .replace(/\bURLs?\b/g, 'pages')
    .replace(/\bmeta descriptions?\b/gi, 'description de page')
    .replace(/\bduplicate content\b/gi, 'contenu duplique')
    .replace(/\bFlags cookies\b/gi, 'protections des cookies')
    .replace(/\bGoogle Dorks\b/gi, 'chemins publics sensibles')
    .replace(/\bpayloads?\b/gi, 'contenus de test')
    .replace(/\bscanner_aggregation\b/gi, 'scan automatique')
    .replace(/\bstack_fingerprint\b/gi, 'empreinte technique')
    .replace(/\bN\/A\b/g, 'non disponible');
  return removeAffectedLead(expanded).replace(/\s+/g, ' ').trim();
}

function isGenericRecommendation(text: string | undefined): boolean {
  const normalized = normalizeForComparison(text);
  if (!normalized) return true;
  return [
    'indicateur valide maintenir ce niveau de conformite',
    'controle valide maintenir ce niveau de conformite',
    'controle conforme',
    'indicateur non mesure relancer le scan avec les prerequis complets',
    'indicateur non disponible dans ce contexte de scan',
    'prioriser la correction en s appuyant sur les preuves techniques',
    'corriger selon les details techniques remontes par ce indicateur',
    'corriger selon les details techniques remontes par cet indicateur',
    'veuillez corriger ou ajuster ce point selon les regles metier',
    'resoudre les problemes detectes listes en annexe',
    'donnees insuffisantes pour conclure relancer le scan avec un contexte plus complet',
  ].some((pattern) => normalized.includes(pattern));
}

function findingFamily(finding: AuditFinding): string {
  const source = `${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`.toLowerCase();
  if (/tech|cms|server|serveur|language|langage|module|version|cve/.test(source)) return 'technique';
  if (/sec_|security|ssl|header|cookie|admin|sensitive|brute|upload|vulnerab|robots_disclosure/.test(source)) return 'security';
  if (/perf|lcp|fcp|cls|speed|cache|compression|image|console/.test(source)) return 'performance';
  if (/seo|meta|sitemap|robots|heading|alt|linking|duplicate|ai_readiness/.test(source)) return 'seo';
  if (/rgpd|privacy|legal|consent|rights|tracker|cookie_policy/.test(source)) return 'rgpd';
  if (/content|thin|freshness|cta|lexical|cannibal|structure/.test(source)) return 'content';
  if (/ux|design|navigation|mobile|social|ergonom/.test(source)) return 'ux';
  if (/func|form|button|search|feature|broken_link|email/.test(source)) return 'functional';
  if (/eco/.test(source)) return 'eco';
  return 'general';
}

function isServerVersionFinding(finding: AuditFinding): boolean {
  const source = normalizeForComparison(`${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`);
  return source.includes('tech server version') ||
    source.includes('server version') ||
    source.includes('serveur web') ||
    source.includes('version serveur') ||
    source.includes('version langage');
}

function isProgrammingLanguageFinding(finding: AuditFinding): boolean {
  const source = normalizeForComparison(`${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`);
  return source.includes('tech programming language') ||
    source.includes('langage de programmation') ||
    source.includes('programming language');
}

function isModuleVersionFinding(finding: AuditFinding): boolean {
  const source = normalizeForComparison(`${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`);
  return source.includes('tech modules versions') ||
    source.includes('version modules') ||
    source.includes('version des modules') ||
    source.includes('modules installes');
}

function isDesktopPerformanceFinding(finding: AuditFinding): boolean {
  const source = normalizeForComparison(`${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`);
  return source.includes('perf desktop speed') ||
    source.includes('temps de chargement desktop') ||
    source.includes('desktop load time') ||
    source.includes('desktop speed');
}

const PRIVACY_KPI_TITLES: Record<string, string> = {
  rgpd_cookie_consent: 'Gestion du consentement aux cookies',
  rgpd_privacy_policy: 'Politique de confidentialité',
  rgpd_data_retention: 'Durée de conservation des données',
  rgpd_minimization: 'Minimisation des données collectées',
  rgpd_legal_notice: 'Mentions légales',
  rgpd_user_rights: 'Droits des personnes',
  rgpd_declared_purpose: 'Finalité du traitement',
  rgpd_rights_coverage: 'Couverture des droits utilisateur',
  rgpd_pre_consent_trackers: 'Traceurs avant consentement',
  rgpd_privacy_score: 'Qualité de la politique de confidentialité',
  rgpd_policy_score: 'Qualité de la politique de confidentialité',
};

function stripSectionPrefix(text: string): string {
  return String(text ?? '').replace(/^\s*[A-Z]\)\s*/i, '').trim();
}

function privacyTitleForFinding(finding: AuditFinding): string | undefined {
  const source = `${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`.toLowerCase();
  for (const [kpiId, title] of Object.entries(PRIVACY_KPI_TITLES)) {
    if (source.includes(kpiId)) return title;
  }
  return undefined;
}

function cleanFindingTitle(finding: AuditFinding): string {
  if (isServerVersionFinding(finding)) return 'Version serveur';
  if (isProgrammingLanguageFinding(finding)) return 'Version du langage de programmation';
  if (isModuleVersionFinding(finding)) return 'Version des modules';
  const privacyTitle = privacyTitleForFinding(finding);
  if (privacyTitle) return privacyTitle;
  const source = `${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`.toLowerCase();
  if (/^ssl$/i.test(finding.title.trim())) return 'Certificat de sécurité';
  if (/tech_cms_version/.test(source)) return 'Version du système de gestion du site';
  if (/tech_cve_check/.test(source)) return 'Vérification des vulnérabilités connues';
  if (/perf_desktop_speed|desktop|core vitals/.test(source)) return 'Temps de chargement desktop';
  if (/sec_ssl|certificat/.test(source)) return 'Certificat de sécurité';
  if (/sec_js_deps|javascript/.test(source)) return 'Fichiers JavaScript vulnérables';
  if (/seo_meta|meta/.test(source)) return 'Descriptions de pages pour le referencement';
  if (/seo_sitemap|sitemap/.test(source)) return 'Plan du site';
  if (/seo_robots|robots/.test(source)) return 'Instructions pour les moteurs de recherche';
  if (/eco_index/.test(source)) return 'Impact ecologique';
  return stripSectionPrefix(toPlainDisplayText(finding.title).replace(/\s*\(NLP\)/gi, '')).trim();
}

function isCmsVersionFinding(finding: AuditFinding): boolean {
  const source = `${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`.toLowerCase();
  return source.includes('tech_cms_version') || source.includes('version cms') || source.includes('cms/framework');
}

function fallbackImpactByFamily(finding: AuditFinding): string {
  switch (findingFamily(finding)) {
    case 'technique':
      return 'Une information technique incomplete rend le diagnostic moins fiable et peut masquer une mise a jour importante.';
    case 'security':
      return 'Ce point peut reduire la confiance des visiteurs et augmenter le risque d incident de securite.';
    case 'performance':
      return 'Un chargement lent peut faire partir des visiteurs avant que le contenu principal soit visible.';
    case 'seo':
      return 'Le site peut etre moins bien compris par les moteurs de recherche et donc moins visible.';
    case 'rgpd':
      return 'Les visiteurs peuvent manquer d informations claires sur l utilisation de leurs donnees.';
    case 'content':
      return 'Le message peut etre moins clair pour les visiteurs et moins convaincant pour passer a l action.';
    case 'ux':
      return 'La navigation peut devenir moins fluide, surtout sur mobile ou lors d une premiere visite.';
    case 'functional':
      return 'Un parcours utilisateur peut echouer et empecher une demande, un contact ou une conversion.';
    case 'eco':
      return 'Des pages trop lourdes consomment plus de ressources et degradent l experience de navigation.';
    default:
      return 'Ce point peut reduire la qualite globale de l experience utilisateur.';
  }
}

function fallbackRiskByFamily(finding: AuditFinding): string {
  switch (findingFamily(finding)) {
    case 'technique':
      return 'Le risque est de conserver une information technique incomplete ou une version a verifier.';
    case 'security':
      return 'Le risque est de laisser une protection importante absente ou insuffisante.';
    case 'performance':
      return 'Le risque est de perdre des visiteurs avant que la page soit totalement utilisable.';
    case 'seo':
      return 'Le risque est de rendre certaines pages moins visibles dans les resultats de recherche.';
    case 'rgpd':
      return 'Le risque est de manquer de clarte sur l usage des donnees personnelles.';
    case 'content':
      return 'Le risque est de proposer un contenu moins convaincant ou incomplet.';
    case 'ux':
      return 'Le risque est de rendre le parcours moins evident pour les visiteurs.';
    case 'functional':
      return 'Le risque est de bloquer une action importante du visiteur.';
    case 'eco':
      return 'Le risque est de garder des pages trop lourdes pour leur usage.';
    default:
      return 'Le risque est de degrader la qualite globale de l experience.';
  }
}

function fallbackRecommendationByFamily(finding: AuditFinding): string {
  if (isServerVersionFinding(finding)) {
    return 'Verifier la configuration du serveur et exposer une version exploitable uniquement dans un contexte de diagnostic securise.';
  }
  if (isProgrammingLanguageFinding(finding)) {
    return 'Verifier le langage ou le runtime utilise par le site dans un contexte de diagnostic securise.';
  }
  if (isModuleVersionFinding(finding)) {
    return 'Verifier la liste des modules installes et confirmer que leurs versions sont maintenues.';
  }
  switch (findingFamily(finding)) {
    case 'technique':
      return 'Completer les informations techniques detectees et verifier les versions utilisees.';
    case 'security':
      return 'Renforcer la configuration de securite et corriger les protections manquantes.';
    case 'performance':
      return 'Alleger les ressources, reduire les fichiers bloquants et ameliorer l affichage initial.';
    case 'seo':
      return 'Clarifier les balises, les titres et la structure afin d aider le referencement.';
    case 'rgpd':
      return 'Rendre les informations de protection des donnees plus visibles et plus completes.';
    case 'content':
      return 'Completer le contenu, clarifier les appels a l action et supprimer les zones trop faibles.';
    case 'ux':
      return 'Simplifier le parcours et rendre les actions principales plus visibles.';
    case 'functional':
      return 'Tester le parcours concerne et corriger les elements qui bloquent l utilisateur.';
    case 'eco':
      return 'Reduire le poids des pages et optimiser les ressources chargees.';
    default:
      return 'Corriger ce point en s appuyant sur les preuves du controle.';
  }
}

function fallbackIssueByFamily(finding: AuditFinding): string {
  if (isServerVersionFinding(finding)) {
    const product = extractEvidenceValue(finding, /^(Serveur detecte|Serveur détecté|Technologie detectee|Technologie détectée|Produit detecte|Produit détecté)\s*:/i);
    const version = extractEvidenceValue(finding, /^(Version serveur|Version detectee|Version détectée|Version)\s*:/i);
    if (product && !version) {
      return `Le serveur ${product} a ete detecte, mais sa version n est pas disponible. Le niveau de risque ne peut donc pas etre conclu avec certitude.`;
    }
    if (product && version) {
      return `Le serveur ${product} a ete detecte avec la version ${version}. Cette information permet de verifier si la version est encore adaptee.`;
    }
    return 'Le serveur ou le langage technique a ete partiellement detecte, mais les informations de version ne sont pas suffisantes pour conclure.';
  }
  if (isProgrammingLanguageFinding(finding)) {
    const language = extractEvidenceValueByLabels(finding, ['Langage detecte', 'Langage de programmation', 'Runtime detecte']);
    const languageVersion = extractEvidenceValueByLabels(finding, ['Version du langage', 'Version runtime', 'Version detectee']);
    const server = extractEvidenceValueByLabels(finding, ['Serveur detecte', 'Technologie detectee', 'Produit detecte']);
    const serverVersion = extractEvidenceValueByLabels(finding, ['Version serveur']);
    if (language) {
      return languageVersion
        ? `Le langage ${language} a ete detecte avec la version ${languageVersion}. Cette information permet de verifier les mises a jour de securite.`
        : `Le langage ${language} a ete detecte, mais sa version n est pas disponible. Le niveau de risque doit etre confirme.`;
    }
    if (server) {
      const versionText = serverVersion ? ` avec la version ${serverVersion}` : '';
      return `Le langage utilise par le site n est pas expose directement. Le scan a cependant detecte le serveur ${server}${versionText}, ce qui donne un contexte technique partiel.`;
    }
    return 'Le langage utilise par le site n est pas expose directement par les pages analysees. Le niveau de risque ne peut donc pas etre conclu avec certitude.';
  }
  if (isModuleVersionFinding(finding)) {
    const count = extractEvidenceValueByLabels(finding, ['Modules avec version detectee', 'Modules detectes avec version', 'Modules detectes']);
    const parsedCount = Number(String(count).replace(/[^0-9]/g, ''));
    if (Number.isFinite(parsedCount) && parsedCount > 0) {
      return `Le scan a detecte ${parsedCount} module${parsedCount > 1 ? 's' : ''} avec une version exploitable. Ces versions doivent etre verifiees pour confirmer leur niveau de maintenance.`;
    }
    if (Number.isFinite(parsedCount) && parsedCount === 0) {
      return 'Aucun module avec version exploitable n a ete detecte pendant ce scan. Cela ne signifie pas necessairement qu aucun module n existe, seulement qu ils ne sont pas exposes clairement.';
    }
    return 'Les modules installes ne sont pas assez documentes dans les resultats du scan pour conclure sur leur niveau de maintenance.';
  }
  switch (findingFamily(finding)) {
    case 'performance':
      return 'Un point de chargement ralentit l affichage du contenu principal pour les visiteurs.';
    case 'security':
      return 'Une protection de securite attendue est absente ou incomplete.';
    case 'seo':
      return 'Un element de referencement manque ou n est pas assez clair pour les moteurs de recherche.';
    case 'rgpd':
      return 'Une information attendue sur la protection des donnees est absente ou incomplete.';
    case 'content':
      return 'Une partie du contenu manque de clarte, de profondeur ou d action proposee.';
    case 'ux':
      return 'Un element d interface peut rendre le parcours moins clair pour les visiteurs.';
    case 'functional':
      return 'Un element fonctionnel peut empecher l utilisateur de terminer son action.';
    case 'eco':
      return 'La page semble plus lourde que necessaire pour l usage attendu.';
    default:
      return 'Un point d amelioration a ete detecte sur ce controle.';
  }
}

function cleanEvidenceLines(lines: string[] | undefined, finding: AuditFinding): string[] {
  let base = (lines ?? [])
    .map((line) => toPlainDisplayText(sanitizeEvidenceLine(line)))
    .filter(Boolean)
    .filter((line) => {
      const label = normalizeForComparison(String(line).split(':')[0] || line);
      const whole = normalizeForComparison(line);
      return !label.startsWith('source') &&
        !whole.includes('scanner aggregation') &&
        !whole.includes('stack fingerprint') &&
        whole !== 'scan automatique' &&
        whole !== 'empreinte technique';
    });

  if (isCmsVersionFinding(finding)) {
    base = base.map((line) => {
      const splitIdx = line.indexOf(':');
      if (splitIdx <= 0) return line;
      const label = normalizeForComparison(line.slice(0, splitIdx));
      const value = line.slice(splitIdx + 1).trim();
      if ((label === 'version detectee' || label === 'version') && /^\d+\.x$/i.test(value)) {
        return `Branche detectee : ${value}`;
      }
      return line;
    });
  }

  if (!isServerVersionFinding(finding)) {
    if (isProgrammingLanguageFinding(finding)) {
      const proxyFinding = { ...finding, evidence: base, evidenceSummary: base, annexes: base };
      const language = extractEvidenceValueByLabels(proxyFinding, ['Langage detecte', 'Langage de programmation', 'Runtime detecte']);
      const languageVersion = extractEvidenceValueByLabels(proxyFinding, ['Version du langage', 'Version runtime', 'Version detectee']);
      const server = extractEvidenceValueByLabels(proxyFinding, ['Serveur detecte', 'Technologie detectee', 'Produit detecte']);
      const serverVersion = extractEvidenceValueByLabels(proxyFinding, ['Version serveur']);
      const rest = base.filter((line) => {
        const label = normalizeForComparison(String(line).split(':')[0] || line);
        return ![
          'langage detecte',
          'langage de programmation',
          'runtime detecte',
          'version du langage',
          'version runtime',
          'version detectee',
          'serveur detecte',
          'technologie detectee',
          'produit detecte',
          'version serveur',
        ].includes(label);
      });
      const rewritten = [
        language ? `Langage detecte : ${language}` : undefined,
        language ? `Version du langage : ${languageVersion || 'non detectee'}` : undefined,
        !language && server ? `Serveur detecte : ${server}` : undefined,
        !language && server ? `Version serveur : ${serverVersion || 'non detectee'}` : undefined,
        ...rest,
      ].filter(Boolean) as string[];
      return Array.from(new Set(rewritten));
    }
    if (isModuleVersionFinding(finding)) {
      return Array.from(new Set(base.map((line) => {
        const label = normalizeForComparison(String(line).split(':')[0] || line);
        if (label === 'modules avec version detectee' || label === 'modules detectes avec version') {
          const value = String(line).split(':').slice(1).join(':').trim();
          return `Modules avec version detectee : ${value || '0'}`;
        }
        return line;
      })));
    }
    return Array.from(new Set(base));
  }

  const product = extractEvidenceValue({ ...finding, evidence: base, evidenceSummary: base, annexes: base }, /^(Serveur detecte|Serveur détecté|Technologie detectee|Technologie détectée|Produit detecte|Produit détecté)\s*:/i);
  const version = extractEvidenceValue({ ...finding, evidence: base, evidenceSummary: base, annexes: base }, /^(Version serveur|Version detectee|Version détectée|Version)\s*:/i);
  const rest = base.filter((line) => !/^(Serveur detecte|Serveur détecté|Technologie detectee|Technologie détectée|Produit detecte|Produit détecté|Version serveur|Version detectee|Version détectée|Version)\s*:/i.test(line));
  const readableProduct = product || extractEvidenceValueByLabels({ ...finding, evidence: base, evidenceSummary: base, annexes: base }, ['Serveur detecte', 'Technologie detectee', 'Produit detecte']);
  const readableVersion = version || extractEvidenceValueByLabels({ ...finding, evidence: base, evidenceSummary: base, annexes: base }, ['Version serveur', 'Version detectee', 'Version']);
  const rewritten = [
    readableProduct ? `Serveur detecte : ${readableProduct}` : undefined,
    `Version serveur : ${readableVersion || 'non detectee'}`,
    ...rest,
  ].filter(Boolean) as string[];
  return Array.from(new Set(rewritten));
}

function extractEvidenceValueByLabels(finding: AuditFinding, labels: string[]): string {
  const normalizedLabels = labels.map(normalizeForComparison);
  const lines = [
    finding.description,
    finding.recommendation,
    finding.risk,
    finding.impact,
    ...(finding.evidenceSummary ?? []),
    ...(finding.evidence ?? []),
    ...(finding.annexes ?? []),
  ].filter(Boolean) as string[];

  for (const line of lines) {
    const cleaned = toPlainDisplayText(line);
    const splitIdx = cleaned.indexOf(':');
    if (splitIdx <= 0) continue;
    const label = normalizeForComparison(cleaned.slice(0, splitIdx));
    if (normalizedLabels.some((expected) => label === expected || label.includes(expected))) {
      const value = cleaned.slice(splitIdx + 1).trim().replace(/[.;]$/, '');
      const normalizedValue = normalizeForComparison(value);
      if (
        value &&
        normalizedValue !== 'non detectee' &&
        normalizedValue !== 'non detecte' &&
        !normalizedValue.includes('donnees insuffisantes')
      ) {
        return value;
      }
    }
  }
  return '';
}

function extractEvidenceValue(finding: AuditFinding, pattern: RegExp): string {
  const lines = [
    finding.description,
    finding.recommendation,
    finding.risk,
    finding.impact,
    ...(finding.evidenceSummary ?? []),
    ...(finding.evidence ?? []),
    ...(finding.annexes ?? []),
  ].filter(Boolean) as string[];
  for (const line of lines) {
    const cleaned = toPlainDisplayText(line);
    const match = cleaned.match(pattern);
    if (match?.[2]) return match[2].trim().replace(/[.;]$/, '');
    if (match?.[1] && cleaned.includes(':')) return cleaned.split(':').slice(1).join(':').trim().replace(/[.;]$/, '');
  }
  return '';
}

function extractDesktopScoreLine(finding: AuditFinding): string {
  const lines = [
    finding.description,
    ...(finding.evidenceSummary ?? []),
    ...(finding.evidence ?? []),
    ...(finding.annexes ?? []),
  ].filter(Boolean) as string[];
  for (const line of lines) {
    const cleaned = toPlainDisplayText(line);
    const match = cleaned.match(/Score desktop estime\s*:\s*\d+\s*%\.?/i);
    if (match?.[0]) return match[0].trim().replace(/\.$/, '');
  }
  return '';
}

function ensureDesktopScoreInDescription(description: string, finding: AuditFinding): string {
  if (!isDesktopPerformanceFinding(finding)) return description;
  if (normalizeForComparison(description).includes('score desktop estime')) return description;
  const scoreLine = extractDesktopScoreLine(finding);
  if (!scoreLine) return description;
  return `${scoreLine}. ${description}`.trim();
}

function scoreLineForFinding(finding: AuditFinding): string | undefined {
  if (typeof finding.displayScorePct !== 'number') return undefined;
  const score = Math.max(0, Math.min(100, Math.round(finding.displayScorePct)));
  const source = normalizeForComparison(`${finding.id} ${finding.sourceKpi ?? ''} ${finding.title}`);
  if (source.includes('perf desktop speed') || source.includes('temps de chargement desktop')) {
    return `Score desktop estime : ${score} %.`;
  }
  if (source.includes('perf mobile speed') || source.includes('mobile')) {
    return `Score mobile estime : ${score} %.`;
  }
  if (source.includes('eco index')) {
    return `Score ecologique : ${score} %.`;
  }
  return undefined;
}

function findingHasUncertainEvidence(finding: AuditFinding, evidenceLines: string[]): boolean {
  const combined = normalizeForComparison([
    finding.description,
    finding.recommendation,
    finding.risk,
    finding.impact,
    finding.evidenceMissingReason,
    ...evidenceLines,
  ].filter(Boolean).join(' '));

  if (!combined) return false;
  if (isModuleVersionFinding(finding)) {
    const hasSafeModuleProof =
      /modules verifies conformes\s+[1-9]/.test(combined) &&
      /modules a verifier\s+0/.test(combined) &&
      /modules a risque confirme\s+0/.test(combined);
    if (!hasSafeModuleProof) return true;
  }
  return [
    'a verifier',
    'doivent etre verifie',
    'reste a verifier',
    'donnees insuffisantes',
    'non detecte',
    'non detectee',
    'version non detectee',
    'impossible sans',
    'impossible de conclure',
    'ne peut donc pas etre conclu',
    'ne peut donc pas conclure',
    'controle non teste',
    'verification automatique partielle',
  ].some((needle) => combined.includes(needle));
}

function findingHasPositiveTechnicalEvidence(finding: AuditFinding, evidenceLines: string[]): boolean {
  if (findingFamily(finding) !== 'technique') return false;
  if (hasPositiveTechnicalEvidence(finding.evidenceRows) || hasPositiveTechnicalEvidence(finding.evidenceCsvRows) || hasPositiveTechnicalEvidence(finding.evidenceRaw)) {
    return true;
  }
  return evidenceLines.some((line) => {
    const normalized = normalizeForComparison(line);
    if (!normalized || normalized.includes('non detecte') || normalized.includes('non disponible')) return false;
    return normalized.includes('detecte') ||
      normalized.includes('version exploitable') ||
      normalized.includes('module') ||
      normalized.includes('serveur') ||
      normalized.includes('runtime');
  });
}

function polishAuditFinding(finding: AuditFinding): AuditFinding {
  const evidenceSummary = cleanEvidenceLines(finding.evidenceSummary ?? finding.evidence ?? finding.annexes, finding);
  const evidence = cleanEvidenceLines(finding.evidence ?? finding.annexes, finding);
  const annexes = cleanEvidenceLines(finding.annexes, finding);
  const title = cleanFindingTitle(finding);
  const shouldDowngradePass =
    (finding.status === 'pass' || finding.type === 'pass' || finding.origin === 'passing_kpi') &&
    findingHasUncertainEvidence(finding, [...evidenceSummary, ...evidence, ...annexes]);
  const effectiveStatus: FindingStatus = shouldDowngradePass ? 'not_evaluated' : (finding.status ?? (finding.type === 'pass' ? 'pass' : finding.type === 'bug' ? 'fail' : 'not_measured'));
  const isPass = effectiveStatus === 'pass';
  const isNonTested = isNonTestedStatus(effectiveStatus);
  const scoreLine = scoreLineForFinding({ ...finding, title, evidenceSummary, evidence, annexes });
  const hasPositiveTechEvidence = findingHasPositiveTechnicalEvidence(
    { ...finding, title },
    [...evidenceSummary, ...evidence, ...annexes],
  );
  const displayEvidenceSummary = scoreLine && !evidenceSummary.some((line) => normalizeForComparison(line).includes(normalizeForComparison(scoreLine)))
    ? [scoreLine, ...evidenceSummary]
    : evidenceSummary;
  const rawDescription = toPlainDisplayText(finding.description);
  let description = rawDescription;

  if (!description || /^indicateur (non )?(concluant|teste|valide)/i.test(description)) {
    description = isPass
      ? `Controle conforme : ${displayEvidenceSummary[0] || evidence[0] || 'aucun probleme detecte.'}`
      : fallbackIssueByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  const normalizedDescription = normalizeForComparison(description);
  if (
    isServerVersionFinding({ ...finding, title }) &&
    (
      normalizedDescription.startsWith('serveur') ||
      normalizedDescription.includes('donnees insuffisantes') ||
      normalizedDescription.includes('versions obsoletes') ||
      normalizedDescription.includes('version exploitable manque')
    )
  ) {
    description = fallbackIssueByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  if (
    isProgrammingLanguageFinding({ ...finding, title }) &&
    (
      normalizedDescription.includes('donnees insuffisantes') ||
      normalizedDescription.includes('non detecte') ||
      normalizedDescription.startsWith('langage de programmation')
    )
  ) {
    description = fallbackIssueByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  if (
    isModuleVersionFinding({ ...finding, title }) &&
    (
      normalizedDescription.startsWith('version modules') ||
      normalizedDescription.includes('modules detectes avec versions') ||
      normalizedDescription.includes('donnees insuffisantes')
    )
  ) {
    description = fallbackIssueByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  if (!isPass && !isNonTested && /point d.optimisation identifie/i.test(normalizeForComparison(description))) {
    description = fallbackIssueByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  if (isNonTested && /^indicateur non teste/i.test(description)) {
    description = description.replace(/^indicateur non teste\s*:\s*/i, 'Controle non teste : ');
  }
  description = ensureDesktopScoreInDescription(description, { ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  if (scoreLine && !normalizeForComparison(description).includes(normalizeForComparison(scoreLine).replace(/\s+/g, ' ').trim())) {
    description = `${scoreLine} ${description}`.trim();
  }

  let recommendation = toPlainDisplayText(finding.recommendation);
  if (isPass) {
    recommendation = 'Controle conforme.';
  } else if (isGenericRecommendation(recommendation)) {
    recommendation = isNonTested
      ? 'Relancer le scan avec un contexte plus complet pour obtenir une mesure exploitable.'
      : fallbackRecommendationByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }

  let risk = toPlainDisplayText(finding.risk);
  let impact = toPlainDisplayText(finding.impact);
  if (!isPass && risk && impact && normalizeForComparison(risk) === normalizeForComparison(impact)) {
    risk = fallbackRiskByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  if (!isPass && !impact && risk) {
    impact = fallbackImpactByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }
  if (!isPass && !risk && impact) {
    risk = impact;
    impact = fallbackImpactByFamily({ ...finding, evidenceSummary: displayEvidenceSummary, evidence, annexes, title });
  }

  return {
    ...finding,
    title,
    description,
    recommendation,
    status: effectiveStatus,
    type: isPass ? 'pass' : finding.type === 'bug' ? 'bug' : 'recommendation',
    origin: shouldDowngradePass ? 'coverage' : finding.origin,
    criticality: shouldDowngradePass ? 'medium' : finding.criticality,
    priority: shouldDowngradePass ? 'moyen-terme' : finding.priority,
    risk: isPass ? undefined : risk || undefined,
    impact: isPass ? undefined : impact || undefined,
    fix: finding.fix ? toPlainDisplayText(finding.fix) : undefined,
    evidenceSummary: displayEvidenceSummary,
    evidence,
    annexes,
    kpiLabels: shouldDowngradePass
      ? (hasPositiveTechEvidence ? REVIEW_DEFAULT : NT_DEFAULT)
      : (isNonTested && finding.kpiLabels?.statut === 'Non testé' && hasPositiveTechEvidence ? REVIEW_DEFAULT : finding.kpiLabels),
  };
}

function readNumericMetric(source: any, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source?.[key];
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function scoreLowerIsBetter(value: number | undefined, good: number, poor: number): number | undefined {
  if (value === undefined) return undefined;
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return Math.round(100 - ((value - good) / (poor - good)) * 100);
}

function computeDesktopPerformanceScore(perf: any): number {
  const metrics = [
    { score: scoreLowerIsBetter(readNumericMetric(perf, ['avg_lcp_ms', 'lcp_ms', 'desktop_lcp_ms']), 2500, 6000), weight: 0.42 },
    { score: scoreLowerIsBetter(readNumericMetric(perf, ['avg_fcp_ms', 'fcp_ms', 'desktop_fcp_ms']), 1800, 4500), weight: 0.23 },
    { score: scoreLowerIsBetter(readNumericMetric(perf, ['avg_cls', 'cls', 'desktop_cls']), 0.1, 0.35), weight: 0.2 },
    { score: scoreLowerIsBetter(readNumericMetric(perf, ['total_resource_size_kb', 'resource_size_kb', 'total_kb']), 1000, 5000), weight: 0.15 },
  ].filter((item): item is { score: number; weight: number } => typeof item.score === 'number');

  if (metrics.length === 0) return 0;
  const totalWeight = metrics.reduce((sum, item) => sum + item.weight, 0);
  return Math.max(0, Math.min(100, Math.round(metrics.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight)));
}

function formatSeconds(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function buildDesktopPerformanceCopy(perf: any): { description: string; evidence: string[]; score: number } {
  const score = computeDesktopPerformanceScore(perf);
  const lcp = readNumericMetric(perf, ['avg_lcp_ms', 'lcp_ms', 'desktop_lcp_ms']);
  const fcp = readNumericMetric(perf, ['avg_fcp_ms', 'fcp_ms', 'desktop_fcp_ms']);
  const cls = readNumericMetric(perf, ['avg_cls', 'cls', 'desktop_cls']);
  const weight = readNumericMetric(perf, ['total_resource_size_kb', 'resource_size_kb', 'total_kb']);
  const problem = score >= 75
    ? 'Le chargement desktop est globalement satisfaisant.'
    : 'La page principale met trop de temps a afficher son contenu visible.';
  const evidence = [
    `Score desktop estime : ${score} %.`,
    lcp !== undefined ? `Temps d'affichage principal : ${formatSeconds(lcp)}` : undefined,
    fcp !== undefined ? `Premier affichage visible : ${formatSeconds(fcp)}` : undefined,
    cls !== undefined ? `Stabilite visuelle : ${cls.toFixed(2).replace('.', ',')}` : undefined,
    weight !== undefined ? `Poids total des ressources : ${Math.round(weight).toLocaleString('fr-FR')} KB` : undefined,
  ].filter(Boolean) as string[];
  return {
    score,
    description: `${evidence[0]} ${problem}`,
    evidence,
  };
}

function humanizeEvidenceLabel(label: string): string {
  const normalized = String(label ?? '')
    .replace(/^(evidence|metrics)\.?/i, '')
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .trim();

  const known: Record<string, string> = {
    url: 'Adresse de page',
    urls: 'Adresses de pages',
    page_url: 'Page',
    source_page: 'Page source',
    target_url: 'Adresse cible',
    status_code: 'Code de reponse',
    content_encoding: 'Mode de compression',
    cache_control: 'Regle de cache',
    detected_version: 'Version serveur',
    detected_product: 'Technologie detectee',
    support_status: 'Statut de support',
    verification_result: 'Resultat de verification',
    verification_source: 'Source de verification',
    latest_known_version: 'Derniere version connue',
    minimum_safe_version: 'Version minimale securisee',
    module: 'Module',
    name: 'Nom',
    version: 'Version',
    risk: 'Risque',
    recommendation: 'Recommandation',
    score_formula: 'Formule du score',
    score_value: 'Score calcule',
    measurement_status: 'Statut de mesure',
    affected_pages: 'Pages concernees',
    affected_page_urls_all: 'Pages concernees',
    pages_checked: 'Pages verifiees',
    pages_verified: 'Pages verifiees',
    observed_metrics: 'Mesures observees',
    lcp_ms: "Temps d'affichage principal",
    fcp_ms: 'Premier affichage visible',
    cls: 'Stabilite visuelle',
    total_resource_size_kb: 'Poids total des ressources',
    anomalies_count: 'Signaux detectes',
    anomalies_by_type: 'Signaux par type',
    suppressed_low_confidence_anomalies: 'Signaux faibles ignores',
    anomaly_reason: 'Raison du signal',
    anomaly: 'Signal',
  };

  return known[normalized] ?? normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        const best = [
          typeof row.page_url === 'string' ? row.page_url : undefined,
          typeof row.action_url === 'string' ? row.action_url : undefined,
          typeof row.target_url === 'string' ? row.target_url : undefined,
          typeof row.image_url === 'string' ? row.image_url : undefined,
          typeof row.url === 'string' ? row.url : undefined,
          typeof row.found_on === 'string' ? row.found_on : undefined,
          typeof row.source_page === 'string' ? row.source_page : undefined,
          typeof row.name === 'string' ? row.name : undefined,
          typeof row.title === 'string' ? row.title : undefined,
        ].find((valuePart) => typeof valuePart === 'string' && valuePart.trim().length > 0);

        return best ? best.trim() : '';
      }
      return String(item ?? '');
    })
    .filter(Boolean);
}

function toEvidenceLines(prefix: string, value: unknown): string[] {
  const labelPrefix = humanizeEvidenceLabel(prefix);
  const rawKey = String(prefix ?? '').split('.').pop()?.toLowerCase() ?? '';

  if ([
    'data_quality',
    'quality',
    'status',
    'passed',
    'sampled',
    'detection_source',
    'source',
    'observed_metrics',
  ].includes(rawKey)) {
    return [];
  }

  if (value === null || value === undefined) return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const rendered = String(value).trim();
    return rendered ? [`${labelPrefix}: ${rendered}`] : [];
  }

  if (Array.isArray(value)) {
    const primitiveItems = value
      .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8);

    if (primitiveItems.length > 0) {
      return [`${labelPrefix}: ${primitiveItems.join(', ')}`];
    }

    const objectItems = value
      .filter((item) => item && typeof item === 'object')
      .slice(0, 8)
      .map((item) => {
        const row = item as Record<string, unknown>;
        const pageUrl =
          typeof row.page_url === 'string' ? row.page_url
            : typeof row.source_page === 'string' ? row.source_page
              : typeof row.url === 'string' ? row.url
                : typeof row.found_on === 'string' ? row.found_on
                  : '';
        const targetUrl =
          typeof row.target_url === 'string' ? row.target_url
            : typeof row.action_url === 'string' ? row.action_url
              : typeof row.image_url === 'string' ? row.image_url
                : '';
        const status = row.status_code ?? row.status ?? '';
        const error = typeof row.error === 'string' ? row.error : '';
        const label =
          typeof row.label_or_text === 'string' ? row.label_or_text
            : typeof row.label === 'string' ? row.label
              : typeof row.anchor_text === 'string' ? row.anchor_text
                : typeof row.anomaly === 'string' ? row.anomaly
                  : typeof row.issue_type === 'string' ? row.issue_type
                    : '';
        const selector = typeof row.selector === 'string' ? row.selector : '';
        const compact = [
          pageUrl && `page=${pageUrl}`,
          targetUrl && `target=${targetUrl}`,
          selector && `selector=${selector}`,
          label && `item=${label}`,
          status !== '' && `status=${status}`,
          error && `error=${error}`,
        ]
          .filter(Boolean)
          .join(' | ');

        if (compact) return `${labelPrefix}: ${compact}`;
        return `${labelPrefix}: donnee technique structuree disponible dans les details bruts`;
      })
      .filter(Boolean);

    return objectItems;
  }

  if (typeof value === 'object') {
    if (isRecord(value) && value.status === 'MISSING' && typeof value.reason === 'string') {
      return [`${labelPrefix}: non teste - ${value.reason}`];
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && val !== '')
      .slice(0, 8);

    return entries.flatMap(([key, val]) => toEvidenceLines(`${prefix}.${key}`, val));
  }

  return [];
}

function extractScannerRecommendation(kpiNode: any, status: FindingStatus): { text: string; source: string } {
  const detail = isRecord(kpiNode?.metrics?.detail)
    ? kpiNode.metrics.detail
    : isRecord(kpiNode?.evidence?.detail)
      ? kpiNode.evidence.detail
      : {};

  const fromBackend = [
    typeof kpiNode?.fix === 'string' ? kpiNode.fix : '',
    typeof kpiNode?.recommended_action === 'string' ? kpiNode.recommended_action : '',
    typeof kpiNode?.evidence?.fix === 'string' ? kpiNode.evidence.fix : '',
    typeof kpiNode?.metrics?.fix === 'string' ? kpiNode.metrics.fix : '',
    typeof detail.fix === 'string' ? detail.fix : '',
  ]
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  if (fromBackend) {
    return {
      text: fromBackend,
      source: typeof kpiNode?.recommendation_source === 'string'
        ? kpiNode.recommendation_source
        : typeof kpiNode?.fix === 'string'
          ? 'fix'
          : 'fix',
    };
  }

  const ticketTitle = typeof kpiNode?.ticket_payload?.title === 'string' ? kpiNode.ticket_payload.title.trim() : '';
  const ticketHint = typeof kpiNode?.ticket_payload?.acceptance_hint === 'string'
    ? kpiNode.ticket_payload.acceptance_hint.trim()
    : '';
  if (ticketTitle) {
    return {
      text: ticketHint ? `${ticketTitle}. ${ticketHint}` : ticketTitle,
      source: 'ticket_payload',
    };
  }

  if (status === 'pass') {
    return { text: 'Controle conforme.', source: 'generated' };
  }
  if (status === 'not_available') {
    return {
      text: 'Controle non disponible dans ce contexte de scan. Verifier les prerequis techniques.',
      source: 'generated',
    };
  }
  if (status === 'not_measured' || status === 'not_evaluated') {
    return {
      text: 'Controle non mesure. Relancer le scan avec un contexte plus complet.',
      source: 'generated',
    };
  }
  return {
    text: 'Prioriser la correction en s appuyant sur les preuves du controle.',
    source: 'generated',
  };
}

function extractDigestSummary(kpiNode: any): string[] {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  const lines: string[] = [];

  if (Array.isArray(digest.proof_lines) && digest.proof_lines.length > 0) {
    digest.proof_lines
      .map((item) => sanitizeEvidenceLine(String(item ?? '')))
      .filter(Boolean)
      .slice(0, 8)
      .forEach((item) => lines.push(item));
  }

  if (typeof digest.summary === 'string' && digest.summary.trim().length > 0) {
    const summary = sanitizeEvidenceLine(digest.summary);
    if (summary && !lines.includes(summary)) lines.push(summary);
  }

  if (Array.isArray(digest.top_items) && digest.top_items.length > 0) {
    const topItems = digest.top_items
      .map((item) => sanitizeEvidenceLine(String(item ?? '')))
      .filter(Boolean)
      .slice(0, 3);
    if (topItems.length > 0) {
      lines.push(`Elements concernes: ${topItems.join(', ')}`);
    }
  }

  if (Array.isArray(digest.top_urls) && digest.top_urls.length > 0) {
    const urls = digest.top_urls
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 3);
    if (urls.length > 0) {
      lines.push(`Pages concernees: ${urls.join(', ')}`);
    }
  }

  if (isRecord(digest.key_metrics)) {
    const metricPairs = Object.entries(digest.key_metrics)
      .map(([key, value]) => {
        const renderedValue = formatEvidenceScalar(value);
        return renderedValue ? `${key}: ${renderedValue}` : '';
      })
      .filter(Boolean)
      .slice(0, 3);

    if (metricPairs.length > 0) {
      lines.push(`Metriques: ${metricPairs.join(' | ')}`);
    }
  }

  return lines.filter(Boolean).slice(0, 6);
}

function hasCuratedDigest(kpiNode: any): boolean {
  return isRecord(kpiNode?.evidence_digest);
}

function extractDigestRows(kpiNode: any): Record<string, string | number | boolean | null | undefined>[] {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  const rows = Array.isArray(digest.rows) ? digest.rows : [];
  return rows
    .filter((row): row is Record<string, string | number | boolean | null | undefined> => isRecord(row))
    .slice(0, 200);
}

function extractDigestCsvRows(kpiNode: any): Record<string, string | number | boolean | null | undefined>[] {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  const rows = Array.isArray(digest.csv_rows) ? digest.csv_rows : Array.isArray(digest.rows) ? digest.rows : [];
  return rows
    .filter((row): row is Record<string, string | number | boolean | null | undefined> => isRecord(row))
    .slice(0, 1000);
}

function extractDigestCsvColumns(kpiNode: any, rows: Record<string, unknown>[]): string[] {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  const columns = Array.isArray(digest.csv_columns)
    ? digest.csv_columns.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  if (columns.length > 0) return columns;
  const first = rows.find((row) => isRecord(row));
  return first ? Object.keys(first) : [];
}

function extractDigestUrls(kpiNode: any): string[] {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  const urls = [
    ...(Array.isArray(digest.urls) ? digest.urls : []),
    ...(Array.isArray(digest.top_urls) ? digest.top_urls : []),
  ];
  return Array.from(new Set(urls.map((item) => String(item ?? '').trim()).filter(Boolean))).slice(0, 500);
}

function digestMissingReason(kpiNode: any): string | undefined {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  return typeof digest.missing_reason === 'string' && digest.missing_reason.trim()
    ? digest.missing_reason.trim()
    : undefined;
}

function toScannerSourceKpi(axisKey: AxisBucketKey, kpiName: string): string {
  const axis = axisKey.toLowerCase();
  const slug = kpiName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `scanner.${axis}.${slug || 'kpi'}`;
}

function collectScannerKpiNodes(section: RawAxisSection): Array<{ kpiName: string; kpiNode: any }> {
  const collected: Array<{ kpiName: string; kpiNode: any }> = [];

  if (!section || typeof section !== 'object') {
    return collected;
  }

  Object.entries(section).forEach(([kpiName, kpiNode]) => {
    if (kpiName === 'sous_axes') return;
    if (!kpiNode || typeof kpiNode !== 'object') return;
    if ('status' in kpiNode) {
      collected.push({ kpiName, kpiNode });
    }
  });

  const rawSousAxes = (section as Record<string, any>).sous_axes;
  if (rawSousAxes && typeof rawSousAxes === 'object') {
    Object.values(rawSousAxes).forEach((sousAxe: any) => {
      if (!sousAxe || typeof sousAxe !== 'object') return;
      const nestedKpis = sousAxe.kpis;
      if (!nestedKpis || typeof nestedKpis !== 'object') return;

      Object.entries(nestedKpis).forEach(([kpiName, kpiNode]) => {
        if (!kpiNode || typeof kpiNode !== 'object') return;
        if ('status' in kpiNode) {
          collected.push({ kpiName, kpiNode });
        }
      });
    });
  }

  return collected;
}

function collectUrlsDeep(value: unknown, seen: Set<string>) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      seen.add(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUrlsDeep(item, seen));
    return;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((item) => collectUrlsDeep(item, seen));
  }
}

function extractScannerKpiUrls(kpiNode: any): string[] {
  const digestUrls = extractDigestUrls(kpiNode);
  const scopeUrls = Array.isArray(kpiNode?.scope?.pages_affected_urls)
    ? kpiNode.scope.pages_affected_urls
    : [];

  const legacyUrls = Array.isArray(kpiNode?.pages_affected_urls)
    ? kpiNode.pages_affected_urls
    : [];

  const samplePages = Array.isArray(kpiNode?.evidence?.sample_affected_pages)
    ? kpiNode.evidence.sample_affected_pages
    : [];

  const evidenceExamples = Array.isArray(kpiNode?.evidence?.examples)
    ? kpiNode.evidence.examples
    : [];

  const all = [
    ...toStringList(digestUrls),
    ...toStringList(scopeUrls),
    ...toStringList(legacyUrls),
    ...toStringList(samplePages),
    ...toStringList(evidenceExamples),
  ];

  const seen = new Set<string>(all);
  collectUrlsDeep(kpiNode?.evidence, seen);
  return Array.from(seen).slice(0, 500);
}

function extractScannerKpiAffectedCount(kpiNode: any, urls: string[]): number | undefined {
  if (typeof kpiNode?.evidence?.affected_pages === 'number') return kpiNode.evidence.affected_pages;
  if (typeof kpiNode?.scope?.pages_affected === 'number') return kpiNode.scope.pages_affected;
  if (typeof kpiNode?.pages_affected === 'number') return kpiNode.pages_affected;
  return urls.length > 0 ? urls.length : undefined;
}

function extractScannerKpiDescription(kpiNode: any, fallbackName: string): string {
  if (typeof kpiNode?.constat === 'string' && kpiNode.constat.trim().length > 0) {
    return kpiNode.constat;
  }
  if (typeof kpiNode?.client_summary === 'string' && kpiNode.client_summary.trim().length > 0) {
    return kpiNode.client_summary;
  }
  if (typeof kpiNode?.info === 'string' && kpiNode.info.trim().length > 0) {
    return kpiNode.info;
  }
  if (typeof kpiNode?.name === 'string' && kpiNode.name.trim().length > 0) {
    return kpiNode.name;
  }
  return fallbackName || 'Aucune description fournie.';
}

function extractScannerKpiImpact(kpiNode: any): string | undefined {
  if (typeof kpiNode?.business_impact === 'string' && kpiNode.business_impact.trim().length > 0) {
    return kpiNode.business_impact;
  }
  if (typeof kpiNode?.impact === 'string' && kpiNode.impact.trim().length > 0) {
    return kpiNode.impact;
  }
  if (typeof kpiNode?.metrics?.impact === 'string' && kpiNode.metrics.impact.trim().length > 0) {
    return kpiNode.metrics.impact;
  }
  return undefined;
}

function extractScannerKpiEvidence(kpiNode: any, urls: string[]): string[] {
  const additionalEvidence: string[] = [];

  const metricsData = kpiNode?.metrics && typeof kpiNode.metrics === 'object'
    ? kpiNode.metrics
    : kpiNode?.data && typeof kpiNode.data === 'object'
      ? kpiNode.data
      : undefined;

  if (metricsData) {
    Object.entries(metricsData).forEach(([key, val]) => {
      if (key === 'status' || key === 'severity' || key === 'impact' || key === 'passed') return;
      additionalEvidence.push(...toEvidenceLines(`metrics.${key}`, val));
    });
  }

  if (kpiNode?.evidence && typeof kpiNode.evidence === 'object') {
    Object.entries(kpiNode.evidence).forEach(([key, val]) => {
      if (key === 'examples' || key === 'sample_affected_pages') return;
      additionalEvidence.push(...toEvidenceLines(`evidence.${key}`, val));
    });
  }

  return [
    ...toStringList(urls),
    ...toStringList(kpiNode?.issues),
    ...additionalEvidence,
  ]
    .map((line) => sanitizeEvidenceLine(line))
    .filter(Boolean)
    .slice(0, 40);
}

function normalizeScannerOrigin(axisKey: AxisBucketKey, status: FindingStatus, kpiNode: any): FindingOrigin {
  if (isNonTestedStatus(status)) return 'coverage';
  const legacyOrigin = normalizeOrigin(kpiNode?.type);
  if (kpiNode?.type) return legacyOrigin;
  if (axisKey === 'RGPD') return 'RGPD';
  if (status === 'fail' && (kpiNode?.severity === 'critical' || kpiNode?.severity === 'high')) {
    return 'bug';
  }
  return 'recommendation';
}

function buildFindingFromScannerKpi(axisKey: AxisBucketKey, kpiName: string, kpiNode: any): AuditFinding {
  let status = normalizeFindingStatus(kpiNode?.status);
  const curatedDigest = hasCuratedDigest(kpiNode);
  const digestQuality = String(kpiNode?.evidence_digest?.quality ?? '').toUpperCase();
  const digestRows = extractDigestRows(kpiNode);
  const digestCsvRows = extractDigestCsvRows(kpiNode);
  const digestCsvColumns = extractDigestCsvColumns(kpiNode, digestCsvRows.length > 0 ? digestCsvRows : digestRows);
  const digestReason = digestMissingReason(kpiNode);
  if (
    curatedDigest &&
    digestQuality === 'MISSING' &&
    digestRows.length === 0 &&
    extractDigestSummary(kpiNode).length === 0 &&
    extractDigestUrls(kpiNode).length === 0
  ) {
    status = 'not_evaluated';
  }
  if (status === 'pass' && (digestQuality === 'PARTIAL' || digestQuality === 'MISSING')) {
    status = 'not_evaluated';
  }
  const isNonTested = isNonTestedStatus(status);
  const origin = normalizeScannerOrigin(axisKey, status, kpiNode);
  const criticality = normalizeCriticality({ status, severity: kpiNode?.severity });
  const priority = normalizePriority({ status, severity: kpiNode?.severity, type: kpiNode?.type });
  const urls = extractScannerKpiUrls(kpiNode);
  const evidence = curatedDigest ? [] : extractScannerKpiEvidence(kpiNode, urls);
  const digestSummary = extractDigestSummary(kpiNode);
  const recommendationDetails = extractScannerRecommendation(kpiNode, status);
  const impact = extractScannerKpiImpact(kpiNode);
  const title = typeof kpiNode?.name === 'string' && kpiNode.name.trim().length > 0
    ? kpiNode.name
    : kpiName;
  const affectedCount = extractScannerKpiAffectedCount(kpiNode, urls);

  const summaryEvidence = curatedDigest
    ? (digestSummary.length > 0 ? digestSummary : (digestReason ? [digestReason] : []))
    : (digestSummary.length > 0 ? digestSummary : evidence.slice(0, 8));

  const type = status === 'pass'
    ? 'pass'
    : isNonTested
      ? 'recommendation'
      : origin === 'bug'
      ? 'bug'
      : 'recommendation';

  const kpiId = (typeof kpiNode?.kpi_id === 'string' && kpiNode.kpi_id.trim().length > 0
    ? kpiNode.kpi_id
    : `${axisKey.toLowerCase()}-${kpiName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  ).replace(/-+/g, '-');

  // ── Resolve French display labels per the new KPI contract ────────────
  const rawBackendStatus = status === 'pass'
    ? 'passing'
    : status === 'fail'
      ? 'failing'
      : 'not_evaluated';
  const kpiLabels = resolveKpiLabels(kpiId, rawBackendStatus, kpiNode?.severity, kpiNode?.data ?? kpiNode?.metrics ?? {});
  const displayScorePct = typeof kpiNode?.score === 'number'
    ? kpiNode.score
    : Number.isFinite(Number(kpiNode?.score))
      ? Number(kpiNode.score)
      : undefined;

  return polishAuditFinding({
    id: kpiId,
    title,
    description: extractScannerKpiDescription(kpiNode, kpiName),
    criticality,
    priority,
    recommendation: recommendationDetails.text,
    type,
    status,
    risk: status === 'pass' ? undefined : impact,
    annexes: summaryEvidence,
    origin,
    impact: status === 'pass' ? undefined : impact,
    recommendationSource: recommendationDetails.source,
    sourceKpi: typeof kpiNode?.source_kpi === 'string' && kpiNode.source_kpi.trim().length > 0
      ? kpiNode.source_kpi
      : (typeof kpiNode?.kpi_id === 'string' && kpiNode.kpi_id.trim().length > 0
        ? kpiNode.kpi_id
        : toScannerSourceKpi(axisKey, kpiName)),
    affectedCount,
    exampleUrls: toStringList(urls).slice(0, 10),
    evidence: summaryEvidence.slice(0, 3),
    evidenceSummary: summaryEvidence,
    evidenceRows: digestRows,
    evidenceCsvColumns: digestCsvColumns,
    evidenceCsvRows: digestCsvRows,
    evidenceMissingReason: digestReason,
    displayScorePct,
    evidenceRaw: curatedDigest
      ? {
        digest: isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : undefined,
      }
      : undefined,
    pageUrl: typeof urls?.[0] === 'string' ? urls[0] : undefined,
    page: typeof urls?.[0] === 'string' ? urls[0] : undefined,
    kpiLabels, // ← new French display labels
  });
}

function buildActionItemFromFinding(finding: AuditFinding): AuditActionItem {
  return {
    id: finding.id,
    title: finding.title,
    type: finding.type,
    severity: finding.criticality,
    scope: finding.scope || 'global',
    description: finding.description,
    impact: finding.risk || finding.impact || '',
    effort: finding.effort || (finding.priority === 'long-terme' ? 'high' : 'medium'),
    affected_count: finding.affectedCount ?? 0,
    example_urls: finding.exampleUrls ?? [],
    fix: finding.recommendation,
    source_kpi: finding.sourceKpi || '',
    evidence: finding.evidence ?? finding.annexes ?? [],
  };
}

function buildScannerAxesReport(
  api: ApiResponse,
  auditId: string,
  project: { url: string; site_name: string },
): AuditReport {
  const axisBuckets: Record<AxisBucketKey, AuditFinding[]> = {
    TECHNIQUE: [],
    SECURITY: [],
    FUNCTIONAL: [],
    PERFORMANCE: [],
    SEO: [],
    CONTENT: [],
    UX_UI: [],
    ECO_INDEX: [],
    RGPD: [],
  };

  const sections = api.axes ?? {};
  Object.entries(sections).forEach(([apiAxisName, kpis]) => {
    // Use unified resolver instead of static API_AXIS_TO_META_KEY table
    const axisKey = resolveAxisMetaKey(apiAxisName);
    const section = (kpis ?? {}) as RawAxisSection;
    collectScannerKpiNodes(section).forEach(({ kpiName, kpiNode }) => {
      axisBuckets[axisKey].push(buildFindingFromScannerKpi(axisKey, kpiName, kpiNode));
    });
  });

  const axes: AuditAxis[] = Object.keys(AXIS_META).map((metaKey) => {
    const key = metaKey as AxisBucketKey;
    const meta = AXIS_META[key];
    const findings = axisBuckets[key];
    const breakdown = getAxisScoreBreakdown({
      id: meta.id,
      name: meta.name,
      icon: meta.id,
      score: 0,
      maxScore: 0,
      description: meta.description,
      findings,
    });
    return {
      id: meta.id,
      name: meta.name,
      icon: meta.id,
      score: breakdown.x,
      maxScore: breakdown.y,
      description: meta.description,
      findings,
    };
  });

  const allFindings = axes.flatMap((axis) => axis.findings);
  const passFindings = allFindings.filter((f) => f.status === 'pass');
  const failFindings = allFindings.filter((f) => f.status === 'fail');
  const coverageFindings = allFindings.filter((f) => isNonTestedStatus(f.status) || f.origin === 'coverage');
  const complianceFindings = failFindings.filter((f) => f.origin === 'RGPD');
  const recommendationFindings = failFindings.filter((f) => f.origin !== 'RGPD' && f.type !== 'bug');
  const bugFindings = failFindings.filter((f) => f.type === 'bug');
  const criticalFindings = failFindings.filter((f) => f.criticality === 'critical' || f.criticality === 'high');

  const backendTopLevel = isRecord(api.top_level_kpis) ? api.top_level_kpis : {};
  const backendDelivery = isRecord(api.summary?.delivery_overview) ? api.summary.delivery_overview : {};
  const backendClient = isRecord(api.summary?.client_overview) ? api.summary.client_overview : {};
  const readBackendInt = (key: string): number | undefined => {
    const value = backendTopLevel[key] ?? backendDelivery[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.trunc(parsed);
    }
    return undefined;
  };

  const total = passFindings.length + failFindings.length + coverageFindings.length;
  const backendTotal = readBackendInt('total_kpis');
  const backendPassed = readBackendInt('passed_kpis');
  const backendCritical = readBackendInt('critical_kpis');
  const backendHigh = readBackendInt('high_kpis');
  const backendMedium = readBackendInt('medium_kpis');
  const backendLow = readBackendInt('low_kpis');
  const scoreTotal = backendTotal ?? total;
  const scorePassed = backendPassed ?? passFindings.length;
  const globalScore = scoreTotal > 0 ? Math.round((scorePassed / scoreTotal) * 100) : 0;
  const backendHeadline = typeof backendTopLevel.headline === 'string' && backendTopLevel.headline.trim()
    ? backendTopLevel.headline.trim()
    : typeof backendClient.headline === 'string' && backendClient.headline.trim()
      ? backendClient.headline.trim()
      : '';

  const summary: AuditSummary = {
    total: backendTotal ?? total,
    bugs: bugFindings.length,
    recommendations: recommendationFindings.length,
    compliance: complianceFindings.length,
    critical: backendCritical ?? failFindings.filter((f) => f.criticality === 'critical').length,
    high: backendHigh ?? failFindings.filter((f) => f.criticality === 'high').length,
    medium: backendMedium ?? failFindings.filter((f) => f.criticality === 'medium').length,
    low: backendLow ?? failFindings.filter((f) => f.criticality === 'low').length,
  };

  const passingKpis: AuditPassingKpi[] = passFindings.map((f) => ({
    id: f.id,
    label: f.title,
    source_kpi: f.sourceKpi || f.id,
    observed_value: f.description,
    status: 'pass',
    evidence: f.evidence ?? f.annexes ?? [],
  }));

  const auditCoverage: AuditCoverageItem[] = coverageFindings.map((f) => ({
    id: f.id,
    label: f.title,
    status: f.status === 'not_available' ? 'not_available' : 'not_measured',
    evidence: f.evidence ?? f.annexes ?? [],
  }));

  return {
    id: auditId,
    url: api.domain || project.url,
    siteName: project.site_name,
    date: api.generated_at?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    globalScore,
    maturityLevel: globalScore >= 75 ? 'Avancé' : globalScore >= 50 ? 'Intermédiaire' : 'En développement',
    riskLevel: getRiskLevelFromScore(globalScore),
    axes,
    strategicSummary: backendHeadline || `Audit base sur ${allFindings.length} controles (${passFindings.length} conformes, ${failFindings.length} a corriger, ${coverageFindings.length} non mesures ou non disponibles).`,
    positivePoints: passFindings.slice(0, 6).map((f) => f.title),
    negativePoints: failFindings
      .filter((f) => f.criticality !== 'critical' && f.criticality !== 'high')
      .slice(0, 6)
      .map((f) => f.title),
    opportunities: recommendationFindings
      .filter((f) => f.criticality !== 'critical' && f.criticality !== 'high')
      .slice(0, 6)
      .map((f) => f.title),
    criticalPoints: criticalFindings.slice(0, 6).map((f) => f.title),
    pagesMeta: [],
    imagesToOptimize: [],
    sitemapUrl: '',
    sitemapFound: false,
    newsItems: [],
    summary,
    bugs: bugFindings.map(buildActionItemFromFinding),
    recommendations: recommendationFindings.map(buildActionItemFromFinding),
    compliance: complianceFindings.map(buildActionItemFromFinding),
    auditCoverage,
    passingKpis,
    kpis: [],
    scanId: api.scan_id,
    generatedAt: api.generated_at ?? undefined,
  };
}

function createFinding(
  axisId: string,
  idSuffix: string,
  title: string,
  passed: boolean | null | undefined,
  descriptionStr: string,
  explicitStatus?: FindingStatus,
  issuesList?: string[]
): AuditFinding | null {
  const status: FindingStatus = explicitStatus
    ?? (passed === true ? 'pass' : passed === false ? 'fail' : 'not_measured');

  const isPass = status === 'pass';
  const isFail = status === 'fail';
  const isNotTested = isNonTestedStatus(status);
  const isNotAvailable = status === 'not_available';

  const description = isPass
    ? `Controle conforme : ${descriptionStr}`
    : isFail
      ? `Point a corriger : ${descriptionStr}`
      : isNotAvailable
        ? `Controle non teste : ${descriptionStr}`
        : `Controle non teste : ${descriptionStr}`;

  const inferPriority = (): Priority => {
    const normalized = `${title} ${descriptionStr}`.toLowerCase();
    if (isPass) return 'long-terme';
    if (isNotTested) return 'moyen-terme';
    if (/refonte|architecture|migration|multiplatform|mobile friendly/i.test(normalized)) return 'long-terme';
    if (/ux|ui|ergonomie|navigation|parcours|contenu|seo|maillage|conversion|design/i.test(normalized)) return 'moyen-terme';
    // VETO: No 'quick-win' assignments — fail items get 'moyen-terme'
    return 'moyen-terme';
  };

  const inferCriticality = (): Criticality => {
    if (isPass) return 'low';
    if (isNotTested) return 'medium';
    if (issuesList && issuesList.length > 4) return 'high';
    return 'medium';
  };

  const recommendation = isPass
    ? 'Controle conforme.'
    : isFail
      ? (issuesList && issuesList.length > 0
        ? 'Corriger les problemes detectes dans les preuves du controle.'
        : 'Corriger ce point selon les observations du controle.')
      : isNotAvailable
        ? 'Controle non teste : relancer le scan avec les prerequis complets pour obtenir une mesure exploitable.'
        : 'Controle non teste : relancer le scan avec les prerequis complets pour obtenir une mesure exploitable.';

  return polishAuditFinding({
    id: `${axisId}-${idSuffix}`,
    title,
    description,
    criticality: inferCriticality(),
    priority: inferPriority(),
    type: isPass ? 'pass' : isFail ? 'bug' : 'recommendation',
    status,
    recommendation,
    annexes: issuesList,
    origin: isNotTested ? 'coverage' : undefined,
  });
}

function hasStructuredPayload(api: ApiResponse): boolean {
  return Boolean(
    api.axes || api.summary || api.kpis || api.bugs || api.recommendations || api.compliance || api.audit_coverage || api.passing_kpis,
  );
}

function severityToCriticality(severity?: string): Criticality {
  const value = String(severity ?? '').toLowerCase();
  if (value === 'critical') return 'critical';
  if (value === 'high') return 'high';
  if (value === 'medium') return 'medium';
  return 'low';
}

function effortToPriority(effort?: string): Priority {
  const value = String(effort ?? '').toLowerCase();
  // VETO: No 'quick-win' assignments — low effort items get 'moyen-terme'
  if (value === 'low') return 'moyen-terme';
  if (value === 'medium') return 'moyen-terme';
  return 'long-terme';
}

function inferAxisMetaKey(input: { sourceKpi?: string; title?: string; label?: string; id?: string; scope?: string }): keyof typeof AXIS_META {
  // ── source_kpi prefix table (highest precision — always checked first) ─────
  const kpi = (input.sourceKpi ?? '').toLowerCase();
  if (/^domain_analysis\.(privacy_kpi|privacy)/.test(kpi)) return 'RGPD';
  if (/^domain_analysis\.(cookie_kpi|vulnerability_kpi|exposed_path_kpi|security)/.test(kpi)) return 'SECURITY';
  if (/^domain_analysis\.(cms_kpi|tech)/.test(kpi)) return 'TECHNIQUE';
  if (/^domain_analysis\.functional_kpi/.test(kpi)) return 'FUNCTIONAL';
  if (/^site_metrics\.seo/.test(kpi)) return 'SEO';
  if (/^site_metrics\.performance/.test(kpi)) return 'PERFORMANCE';
  if (/^site_metrics\.content/.test(kpi)) return 'CONTENT';
  if (/^site_metrics\.ux\.plain_email_kpi/.test(kpi)) return 'FUNCTIONAL';
  if (/^site_metrics\.ux/.test(kpi)) return 'UX_UI';
  if (/^image_compression|^headless_sample/.test(kpi)) return 'PERFORMANCE';

  // ── fallback: regex over title + label + id + scope only ──────────────────
  const text = `${input.title ?? ''} ${input.label ?? ''} ${input.id ?? ''} ${input.scope ?? ''}`.toLowerCase();
  if (/privacy|rgpd|legal|consent|dpo|rights|security_policy|declared_purpose|cookie_policy|cookie_banner/.test(text)) return 'RGPD';
  if (/ssl|security_header|cache|sqli|ddos|session|cookie_flag|vulnerability|http_header/.test(text)) return 'SECURITY';
  if (/cms|framework|module|server|programming_language|code_review|console_error/.test(text)) return 'TECHNIQUE';
  if (/eco[-_]index|ecoindex/.test(text)) return 'ECO_INDEX';
  if (/form|button|404|functional|contact|feature|funnel|plain_email|broken_link/.test(text)) return 'FUNCTIONAL';
  if (/lcp|fcp|speed|performance|compression|resource|load_time|mobile_friendly|image_optim/.test(text)) return 'PERFORMANCE';
  if (/meta|sitemap|robots|url_structure|duplicate|keyword|social_sharing|external_link|internal_link/.test(text)) return 'SEO';
  if (/content|typo|thin|news|update_frequency|quality|original/.test(text)) return 'CONTENT';
  if (/ux|design|navigation|journey|mesh|ergonomics|invisible_link|multiplatform/.test(text)) return 'UX_UI';
  return 'FUNCTIONAL';
}

function buildStructuredFindingFromAction(item: AuditActionItem, origin: Exclude<FindingOrigin, 'coverage' | 'passing_kpi' | 'legacy'>): AuditFinding {
  const criticality = severityToCriticality(item.severity);
  const normalizedEvidence = (item.evidence ?? []).map((line) => sanitizeEvidenceLine(line)).filter(Boolean);
  return polishAuditFinding({
    id: item.id,
    title: item.title,
    description: item.description,
    criticality,
    priority: effortToPriority(item.effort),
    recommendation: item.fix,
    type: origin === 'bug' ? 'bug' : 'recommendation',
    status: 'fail',
    risk: item.impact,
    annexes: item.evidence,
    origin,
    effort: item.effort,
    scope: item.scope,
    impact: item.impact,
    fix: item.fix,
    recommendationSource: item.fix ? 'fix' : 'generated',
    sourceKpi: item.source_kpi,
    affectedCount: item.affected_count,
    exampleUrls: item.example_urls,
    evidence: normalizedEvidence,
    evidenceSummary: normalizedEvidence.slice(0, 8),
    evidenceRaw: {
      evidence: item.evidence,
      source_kpi: item.source_kpi,
    },
    page: item.example_urls?.[0],
    pageUrl: item.example_urls?.[0],
  });
}

function buildStructuredFindingFromPassing(item: AuditPassingKpi): AuditFinding {
  const normalizedEvidence = (item.evidence ?? []).map((line) => sanitizeEvidenceLine(line)).filter(Boolean);
  return polishAuditFinding({
    id: item.id,
    title: item.label,
    description: `Controle conforme : ${item.observed_value}`,
    criticality: 'low',
    priority: 'long-terme',
    recommendation: 'Controle conforme.',
    type: 'pass',
    status: 'pass',
    annexes: normalizedEvidence,
    origin: 'passing_kpi',
    sourceKpi: item.source_kpi,
    evidence: normalizedEvidence,
    evidenceSummary: normalizedEvidence.slice(0, 8),
    evidenceRaw: {
      evidence: item.evidence,
      source_kpi: item.source_kpi,
    },
    recommendationSource: 'generated',
  });
}

function normalizeStructuredPassingKpis(api: ApiResponse): AuditPassingKpi[] {
  const incoming = api.passing_kpis ?? [];
  const rawSslValid = api.domain_analysis?.security?.ssl?.valid;
  const hasSslPassItem = incoming.some(
    item => item.id === 'ssl_valid' || item.source_kpi === 'domain_analysis.security.ssl.valid',
  );
  const isRiskPassingKpi = (item: AuditPassingKpi): boolean => {
    const searchable = `${item.id} ${item.label} ${item.source_kpi}`.toLowerCase();
    return /\brisk\b|risque|risk_level|niveau_risque/.test(searchable);
  };

  const normalized = incoming.flatMap((item) => {
    if (isRiskPassingKpi(item)) {
      return [];
    }

    const isSslItem = item.id === 'ssl_valid' || item.source_kpi === 'domain_analysis.security.ssl.valid';
    if (!isSslItem) return [item];

    if (typeof rawSslValid === 'boolean') {
      if (!rawSslValid) {
        console.warn('[auditMapper] Dropping ssl_valid from passing_kpis because raw domain_analysis.security.ssl.valid=false');
        return [];
      }

      const normalizedObserved = String(item.observed_value ?? '').toLowerCase();
      if (normalizedObserved !== 'true') {
        return [{
          ...item,
          observed_value: 'true',
          evidence: [...(item.evidence ?? []), 'normalized_from_raw: domain_analysis.security.ssl.valid=true'],
        }];
      }
    }

    return [item];
  });

  if (!hasSslPassItem && rawSslValid === true) {
    normalized.push({
      id: 'ssl_valid',
      label: 'Certificat de securite valide',
      source_kpi: 'domain_analysis.security.ssl.valid',
      observed_value: 'true',
      status: 'pass',
      evidence: [
        'domain_analysis.security.ssl.valid: true',
        `issuer: ${api.domain_analysis?.security?.ssl?.issuer ?? 'N/A'}`,
        `expires: ${api.domain_analysis?.security?.ssl?.expiry ?? 'N/A'}`,
        `protocol: ${api.domain_analysis?.security?.ssl?.protocol ?? 'N/A'}`,
      ],
    });
  }

  return normalized;
}

function buildStructuredFindingFromCoverage(item: AuditCoverageItem): AuditFinding | null {
  if (item.status === 'covered') return null;
  const normalizedEvidence = (item.evidence ?? []).map((line) => sanitizeEvidenceLine(line)).filter(Boolean);
  return polishAuditFinding({
    id: item.id,
    title: item.label,
    description: 'Contrôle non testé dans les données remontées par le scan.',
    criticality: item.status === 'not_available' ? 'low' : 'medium',
    priority: 'moyen-terme',
    recommendation: 'Relancer ou compléter le scan pour mesurer ce contrôle.',
    type: 'recommendation',
    status: item.status,
    annexes: normalizedEvidence,
    origin: 'coverage',
    evidence: normalizedEvidence,
    evidenceSummary: normalizedEvidence.slice(0, 8),
    evidenceRaw: {
      evidence: item.evidence,
      coverage_status: item.status,
    },
    recommendationSource: 'generated',
  });
}

function formatStructuredDetailLines(prefix: string, value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  const label = humanizeEvidenceLabel(prefix);

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [`${label}: ${String(value)}`];
  }

  if (Array.isArray(value)) {
    const primitives = value
      .map((item) => formatEvidenceScalar(item))
      .filter(Boolean)
      .slice(0, 4);
    if (primitives.length > 0) {
      return [`${label}: ${primitives.join(', ')}`];
    }
    return [`${label}: ${value.length} element(s) structures`];
  }

  if (isRecord(value)) {
    const direct = Object.entries(value)
      .map(([key, itemValue]) => {
        const rendered = formatEvidenceScalar(itemValue);
        return rendered ? `${key}=${rendered}` : '';
      })
      .filter(Boolean)
      .slice(0, 4);

    if (direct.length > 0) {
      return [`${label}: ${direct.join(' | ')}`];
    }

    return [`${label}: donnee technique structuree disponible dans les details bruts`];
  }

  return [];
}

function normalizeRecommendationFromStructuredKpi(kpi: KpiItem, isFailure: boolean): { text: string; source: string } {
  const backendAction = typeof kpi.recommended_action === 'string' ? kpi.recommended_action.trim() : '';
  if (backendAction) {
    return {
      text: backendAction,
      source: typeof kpi.recommendation_source === 'string' ? kpi.recommendation_source : 'generated',
    };
  }

  const fix = typeof kpi.evidence?.fix === 'string' ? kpi.evidence.fix.trim() : '';
  if (fix) {
    return { text: fix, source: 'fix' };
  }

  if (isFailure) {
    return { text: 'Corriger ce point en s appuyant sur les preuves du controle.', source: 'generated' };
  }
  return { text: 'Controle conforme.', source: 'generated' };
}

function buildStructuredFindingFromKpi(kpi: KpiItem): AuditFinding {
  const normalizedStatus = normalizeFindingStatus(kpi.status);
  const isFailure = normalizedStatus === 'fail';
  const isNotTested =
    normalizedStatus === 'not_available' ||
    normalizedStatus === 'not_measured' ||
    normalizedStatus === 'not_evaluated';
  const affectedUrls = kpi.evidence?.items?.map(i => i.found_on) ?? [];
  const affectedPages = kpi.evidence?.affected_pages ?? [];
  const evidenceSummary = kpi.evidence?.summary ?? '';
  const recommendationDetails = normalizeRecommendationFromStructuredKpi(kpi, isFailure);
  const digest = isRecord(kpi.evidence_digest) ? kpi.evidence_digest : {};
  
  // Build complete evidence list from items, affected_pages, and detail
  const evidenceList: string[] = [];
  if (evidenceSummary) evidenceList.push(evidenceSummary);
  if (Array.isArray(digest.top_items) && digest.top_items.length > 0) {
    const topItems = digest.top_items.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 3);
    if (topItems.length > 0) {
      evidenceList.push(`Elements concernes: ${topItems.join(', ')}`);
    }
  }
  if (Array.isArray(digest.top_urls) && digest.top_urls.length > 0) {
    const topUrls = digest.top_urls.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 3);
    if (topUrls.length > 0) {
      evidenceList.push(`Pages concernees: ${topUrls.join(', ')}`);
    }
  }
  if (kpi.evidence?.detail) {
    const detail = kpi.evidence.detail;
    Object.entries(detail).forEach(([key, value]) => {
      evidenceList.push(...formatStructuredDetailLines(key, value));
    });
  }
  kpi.evidence?.items?.forEach(item => {
    const itemDesc = item.name || item.found_on || 'Unknown';
    const status = item.status_code || item.status || 'N/A';
    const error = item.error || 'OK';
    evidenceList.push(`${itemDesc} [${status}] - ${error}`);
  });

  return polishAuditFinding({
    id: `kpi-${kpi.kpi_name.toLowerCase().replace(/\s+/g, '-')}`,
    title: kpi.kpi_name,
    description: isFailure
      ? `Controle non concluant : ${evidenceSummary}`
      : isNotTested
        ? `Controle non teste : ${evidenceSummary}`
        : `Controle conforme : ${evidenceSummary}`,
    criticality: isFailure ? 'high' : 'low',
    priority: isFailure ? 'moyen-terme' : 'long-terme',
    recommendation: recommendationDetails.text,
    type: isFailure ? kpi.type === 'bug' ? 'bug' : 'recommendation' : isNotTested ? 'recommendation' : 'pass',
    status: isFailure ? 'fail' : isNotTested ? normalizedStatus : 'pass',
    origin: isNotTested ? 'coverage' : kpi.type === 'RGPD' || kpi.type === 'compliance' ? 'RGPD' : kpi.type === 'bug' ? 'bug' : 'recommendation',
    impact: kpi.client_impact,
    fix: typeof kpi.evidence?.fix === 'string' ? kpi.evidence.fix : undefined,
    affectedCount: Math.max(affectedUrls.length, affectedPages.length),
    exampleUrls: affectedUrls.length > 0 ? affectedUrls : affectedPages,
    evidence: evidenceList.length > 0 ? evidenceList.map((line) => sanitizeEvidenceLine(line)).filter(Boolean) : [],
    evidenceSummary: evidenceList.length > 0 ? evidenceList.slice(0, 8) : [],
    evidenceRaw: {
      digest: kpi.evidence_digest,
      evidence: kpi.evidence,
    },
    sourceKpi: kpi.kpi_name,
    recommendationSource: recommendationDetails.source,
    effort: affectedUrls.length > 10 ? 'high' : affectedUrls.length > 5 ? 'medium' : 'low',
    annexes: evidenceList.map((line) => sanitizeEvidenceLine(line)).filter(Boolean),
    kpiLabels: resolveKpiLabels(kpi.kpi_name, kpi.status, isFailure ? 'high' : null, kpi.evidence?.detail ?? {}),
  });
}

function buildStructuredReport(
  api: ApiResponse,
  auditId: string,
  project: { url: string; site_name: string },
): AuditReport {
  const summary = api.summary;
  const kpis = api.kpis ?? [];
  const bugs = api.bugs ?? [];
  const recommendations = api.recommendations ?? [];
  const compliance = api.compliance ?? [];
  const roadmap = api.roadmap;
  const auditCoverage = api.audit_coverage ?? [];
  const passingKpis = normalizeStructuredPassingKpis(api);

  const axisBuckets: Record<keyof typeof AXIS_META, AuditFinding[]> = {
    TECHNIQUE: [],
    SECURITY: [],
    FUNCTIONAL: [],
    PERFORMANCE: [],
    SEO: [],
    CONTENT: [],
    UX_UI: [],
    ECO_INDEX: [],
    RGPD: [],
  };
  const seenFindingKeys = new Set<string>();

  const dedupeKeysForFinding = (axisKey: keyof typeof AXIS_META, finding: AuditFinding): string[] => {
    return [finding.sourceKpi, finding.id, finding.title]
      .map((value) => String(value ?? '').trim().toLowerCase())
      .filter(Boolean)
      .map((value) => `${axisKey}:${value}`);
  };

  const pushFinding = (axisKey: keyof typeof AXIS_META, finding: AuditFinding) => {
    // VETO: Filter out quick-win priority findings completely
    if (finding.priority === 'quick-win') {
      console.log(`[auditMapper] Excluding quick-win finding: ${finding.title}`);
      return;
    }
    const dedupeKeys = dedupeKeysForFinding(axisKey, finding);
    if (dedupeKeys.some((key) => seenFindingKeys.has(key))) {
      return;
    }
    dedupeKeys.forEach((key) => seenFindingKeys.add(key));
    axisBuckets[axisKey].push(finding);
  };

  // Process KPIs first
  kpis.forEach(kpi => {
    const finding = buildStructuredFindingFromKpi(kpi);
    
    // Use unified resolver for axis mapping (handles French and English labels with accents)
    let axisKey: keyof typeof AXIS_META;
    const rawAxis = kpi.axis?.trim() ?? '';
    
    // Special case: specific KPI names override axis field
    const kpiNameLower = kpi.kpi_name?.toLowerCase() ?? '';
    if (kpiNameLower.includes('technology stack')) {
      axisKey = 'TECHNIQUE';
      console.log(`[auditMapper] KPI "${kpi.kpi_name}" detected as TECHNIQUE (Technology Stack)`);
    } else if (kpiNameLower.includes('eco index')) {
      axisKey = 'ECO_INDEX';
      console.log(`[auditMapper] KPI "${kpi.kpi_name}" detected as ECO_INDEX`);
    } else {
      // Use the unified resolver that handles French labels like "Contenu"
      axisKey = resolveAxisMetaKey(rawAxis);
      if (rawAxis && axisKey !== 'FUNCTIONAL') {
        console.log(`[auditMapper] KPI "${kpi.kpi_name}" mapped: "${rawAxis}" → ${axisKey}`);
      }
    }
    
    if (axisKey in axisBuckets) {
      pushFinding(axisKey, finding);
    }
  });

  // Process legacy findings if no KPIs
  bugs.forEach(item => pushFinding(inferAxisMetaKey({ sourceKpi: item.source_kpi, title: item.title, id: item.id, scope: item.scope }), buildStructuredFindingFromAction(item, 'bug')));
  recommendations.forEach(item => pushFinding(inferAxisMetaKey({ sourceKpi: item.source_kpi, title: item.title, id: item.id, scope: item.scope }), buildStructuredFindingFromAction(item, 'recommendation')));
  compliance.forEach(item => pushFinding(inferAxisMetaKey({ sourceKpi: item.source_kpi, title: item.title, id: item.id, scope: item.scope }), buildStructuredFindingFromAction(item, 'RGPD')));
  passingKpis.forEach(item => pushFinding(inferAxisMetaKey({ sourceKpi: item.source_kpi, label: item.label, id: item.id }), buildStructuredFindingFromPassing(item)));
  auditCoverage.forEach(item => {
    const finding = buildStructuredFindingFromCoverage(item);
    if (finding) pushFinding(inferAxisMetaKey({ label: item.label, id: item.id }), finding);
  });

  const axes: AuditAxis[] = Object.keys(AXIS_META).map((metaKey) => {
    const key = metaKey as keyof typeof AXIS_META;
    const meta = AXIS_META[key];
    const findings = axisBuckets[key];
    const breakdown = getAxisScoreBreakdown({
      id: meta.id,
      name: meta.name,
      icon: meta.id,
      score: 0,
      maxScore: 0,
      description: meta.description,
      findings,
    });

    return {
      id: meta.id,
      name: meta.name,
      icon: meta.id,
      score: breakdown.x,
      maxScore: breakdown.y,
      description: meta.description,
      findings,
    };
  });

  const passCount = passingKpis.length;
  const failCount = bugs.length + recommendations.length + compliance.length;
  const notMeasuredCount = auditCoverage.filter(item => item.status === 'not_measured').length;
  const globalScoreVal = passCount + failCount + notMeasuredCount > 0
    ? Math.round((passCount / (passCount + failCount + notMeasuredCount)) * 100)
    : 0;

  const criticalTitles = [...bugs, ...compliance]
    .filter(item => /critical|high/i.test(item.severity))
    .slice(0, 6)
    .map(item => item.title);

  return {
    id: auditId,
    url: project.url,
    siteName: project.site_name,
    date: api.generated_at?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    globalScore: globalScoreVal,
    maturityLevel: globalScoreVal >= 75 ? 'Avancé' : globalScoreVal >= 50 ? 'Intermédiaire' : 'En développement',
    riskLevel: getRiskLevelFromScore(globalScoreVal),
    axes,
    strategicSummary: `L'audit a identifie ${summary?.total ?? failCount} element(s) d'action, dont ${summary?.critical ?? 0} critique(s), ${summary?.high ?? 0} eleve(s) et ${passCount} controle(s) conforme(s).`,
    positivePoints: passingKpis.slice(0, 6).map(item => item.label),
    negativePoints: bugs
      .filter(item => !/critical|high/i.test(item.severity))
      .slice(0, 6)
      .map(item => item.title),
    opportunities: [...recommendations]
      .filter(item => !/critical|high/i.test(item.severity))
      .slice(0, 6)
      .map(item => item.title),
    criticalPoints: criticalTitles,
    pagesMeta: [],
    imagesToOptimize: [],
    sitemapUrl: '',
    sitemapFound: false,
    newsItems: [],
    summary,
    bugs,
    recommendations,
    compliance,
    roadmap,
    auditCoverage,
    passingKpis,
    kpis,
    scanId: api.scan_id,
    generatedAt: api.generated_at,
  };
}

export function mapApiResponseToReport(
  api: ApiResponse,
  auditId: string,
  project: { url: string; site_name: string }
): AuditReport {
  if (api.axes && typeof api.axes === 'object') {
    return buildScannerAxesReport(api, auditId, project);
  }

  if (hasStructuredPayload(api)) {
    return buildStructuredReport(api, auditId, project);
  }

  const dman = api.domain_analysis || {};
  const smet = api.site_metrics || {};

  const findingsTech: AuditFinding[] = [];
  const findingsSec: AuditFinding[] = [];
  const findingsFunc: AuditFinding[] = [];
  const findingsPerf: AuditFinding[] = [];
  const findingsSeo: AuditFinding[] = [];
  const findingsCont: AuditFinding[] = [];
  const findingsUx: AuditFinding[] = [];
  const findingsEco: AuditFinding[] = [];
  const findingsRgpd: AuditFinding[] = [];

  const resolveStatus = (source: any): FindingStatus => {
    const raw = String(source?.status ?? source?.state ?? source?.coverage ?? '').toLowerCase();
    if (raw === 'covered' || raw === 'pass' || raw === 'passed' || source?.passed === true) return 'pass';
    if (raw === 'fail' || raw === 'failed' || source?.passed === false) return 'fail';
    if (raw === 'not_available' || raw === 'not-available' || source?.available === false) return 'not_available';
    if (isNonTestedStatus(raw)) return raw === 'not_available' || raw === 'not-available' ? 'not_available' : 'not_measured';
    return 'not_measured';
  };

  // --- 1. Technique ---
  if (dman.cms_kpi) {
    const f = createFinding('tech', 'cms', 'CMS et pile logicielle', dman.cms_kpi.passed, `CMS : ${dman.cms_kpi.cms_detected || 'Inconnu'} (Version : ${dman.cms_kpi.cms_version || 'N/A'})`, resolveStatus(dman.cms_kpi));
    if (f) findingsTech.push(f);
  }
  if (dman.tech) {
    const f = createFinding('tech', 'serveur', 'Serveur Web', dman.tech.passed, `Serveur : ${dman.tech.server || dman.tech.server_tech || 'Inconnu'}`, resolveStatus(dman.tech));
    if (f) findingsTech.push(f);
  }
  if (smet.performance?.console_error_kpi) {
    const kpi = smet.performance.console_error_kpi;
    const f = createFinding('tech', 'console', 'Erreurs de Console JavaScript', kpi.passed, `Pages présentant des erreurs : ${kpi.pages_with_console_errors}`, resolveStatus(kpi), kpi.homepage_console_errors);
    if (f) findingsTech.push(f);
  }

  // --- 2. Sécurité ---
  if (dman.security?.ssl) {
    const f = createFinding('sec', 'ssl', 'Certificat SSL', dman.security.ssl.valid, `Date d'expiration : ${dman.security.ssl.expiry || 'N/A'}`, resolveStatus(dman.security.ssl));
    if (f) findingsSec.push(f);
  }
  if (dman.security?.headers) {
    const f = createFinding('sec', 'headers', 'En-têtes HTTP de sécurité', dman.security.passed, `Nombre d'en-têtes manquants : ${dman.security.missing_headers?.length || 0}`, resolveStatus(dman.security), dman.security.missing_headers);
    if (f) findingsSec.push(f);
  }
  if (dman.cookie_kpi) {
    const kpi = dman.cookie_kpi;
    const missing = (kpi.cookies_with_missing_flags || []).map((c: any) => `${c.name} (Absence attributs Secure/HttpOnly)`);
    const f = createFinding('sec', 'cookies', 'Flags sécurité Cookies', kpi.passed, `Cookies vulnérables : ${kpi.missing_cookie_flag_count}`, resolveStatus(kpi), missing);
    if (f) findingsSec.push(f);
  }
  if (dman.exposed_path_kpi) {
    const kpi = dman.exposed_path_kpi;
    const f = createFinding('sec', 'dorks', 'Chemins publics sensibles', kpi.passed, `Chemins publics sensibles repertories : ${kpi.google_dorks_vuln_count}`, resolveStatus(kpi));
    if (f) findingsSec.push(f);
  }
  if (dman.vulnerability_kpi) {
    const kpi = dman.vulnerability_kpi;
    const issuesList: string[] = [];
    if (kpi.sqli_vulnerable_count > 0) issuesList.push(`Vulnérabilités SQLi (${kpi.sqli_vulnerable_count})`);
    if (kpi.xss_vulnerable_count > 0) issuesList.push(`Vulnérabilités XSS (${kpi.xss_vulnerable_count})`);
    if (kpi.ddos_signal_count > 0) issuesList.push(`Indicateurs DDoS sensibles (${kpi.ddos_signal_count})`);
    
    const f = createFinding('sec', 'vuln', 'Points de vulnérabilité actifs (SQLi, XSS, DDoS)', kpi.passed, `Total failles applicatives critiques identifiées : ${(kpi.sqli_vulnerable_count || 0) + (kpi.xss_vulnerable_count || 0)}`, resolveStatus(kpi), issuesList.length > 0 ? issuesList : undefined);
    if (f) findingsSec.push(f);
  }

  // --- 3. Fonctionnel ---
  if (dman.functional_kpi) {
    const kpi = dman.functional_kpi;
    const f = createFinding('func', 'forms', 'Formulaires globaux', kpi.passed, `Total formulaires identifiés : ${kpi.total_forms}`, resolveStatus(kpi), kpi.issues);
    if (f) findingsFunc.push(f);
  }
  if (smet.seo?.broken_link_kpi) {
    const kpi = smet.seo.broken_link_kpi;
    const links = (kpi.broken_links || []).map((l: any) => `Erreur ${l.status_code} sur la page: ${l.url} (trouvé sur ${l.found_on})`);
    const f = createFinding('func', 'broken-links', 'Liens morts/cassés', kpi.passed, `Total liens morts : ${kpi.broken_link_count}`, resolveStatus(kpi), links);
    if (f) findingsFunc.push(f);
  }
  if (smet.ux?.plain_email_kpi) {
    const kpi = smet.ux.plain_email_kpi;
    const f = createFinding('func', 'plain-email', 'Protections Emails En Clair', kpi.passed, `Pages avec des emails en brut détectés : ${kpi.pages_with_plain_emails}`, resolveStatus(kpi), kpi.plain_emails_found);
    if (f) findingsFunc.push(f);
  }
  if (smet.performance?.button_kpi) {
    const kpi = smet.performance.button_kpi;
    const f = createFinding('func', 'buttons', 'Boutons interactifs', kpi.passed, `Pages avec boutons non fonctionnels : ${kpi.pages_with_nonfunc_buttons}`, resolveStatus(kpi));
    if (f) findingsFunc.push(f);
  }

  // --- 4. Performance ---
  if (smet.performance) {
    const perf = smet.performance;
    const desktopCopy = buildDesktopPerformanceCopy(perf);
    const isDesktopPassed = desktopCopy.score >= 75;
    const explicitPerfStatus = perf.status || perf.state || perf.coverage || typeof perf.passed === 'boolean' || perf.available === false
      ? resolveStatus(perf)
      : undefined;
    const fDp = createFinding('perf', 'desktop', 'Temps de chargement desktop', isDesktopPassed, desktopCopy.description, explicitPerfStatus, desktopCopy.evidence);
    if (fDp) findingsPerf.push(fDp);

    if (perf.mobile_kpi && perf.mobile_kpi.available !== false) {
       const isMobilePassed = perf.mobile_kpi.passed ?? true;
       const fMb = createFinding('perf', 'mobile', 'Métriques de temps de chargement Mobile', isMobilePassed, `Expérience de chargement Mobile monitorée`, resolveStatus(perf.mobile_kpi));
       if (fMb) findingsPerf.push(fMb);
    }
  }
  if (smet.content?.image_compression_stats) {
    const stats = smet.content.image_compression_stats;
    // Map specific issues if we have them in the issues payload, otherwise just show the count
    const issuesImg = (stats.unoptimised_images || []).map((img: any) => `${img.url} (${img.content_type || 'image'}, taille actuelle : ${img.size_kb?.toFixed(0) || '?'}kb)`);
    const fOp = createFinding('perf', 'images', 'Optimisation des medias', stats.passed, `Images lourdes potentiellement non optimisées : ${stats.unoptimised_count} détectées sur ${stats.sampled_images} testées.`, resolveStatus(stats), issuesImg);
    if (fOp) findingsPerf.push(fOp);
  }

  // --- 5. SEO ---
  if (smet.seo) {
    const seo = smet.seo;
    const isMetaPassed = seo.pages_missing_meta_desc === 0;
    const f1 = createFinding('seo', 'meta', 'Descriptions de pages pour le referencement', isMetaPassed, `Pages depourvues de descriptions valides : ${seo.pages_missing_meta_desc}`, resolveStatus(seo.meta_kpi ?? { passed: isMetaPassed }));
    if (f1) findingsSeo.push(f1);

    const f2 = createFinding('seo', 'sitemap', 'Fichier Sitemap XML', seo.has_sitemap, `Sitemap ${seo.has_sitemap ? 'correctement référencé' : 'absent ou introuvable'}.`, resolveStatus(seo.sitemap_kpi ?? { passed: seo.has_sitemap }));
    if (f2) findingsSeo.push(f2);

    const f3 = createFinding('seo', 'robots', 'Fichier Robots.txt', seo.has_robots_txt, `Robots.txt ${seo.has_robots_txt ? 'trouvé' : 'manquant'}.`, resolveStatus(seo.robots_kpi ?? { passed: seo.has_robots_txt }));
    if (f3) findingsSeo.push(f3);

    if (seo.homepage_h1_kpi) {
      const f4 = createFinding('seo', 'h1', 'Hiérarchie H1 Page d\'accueil', seo.homepage_h1_kpi.passed, `Balise d'entête principale (H1) ${seo.homepage_h1_kpi.passed ? 'valide' : 'manquante ou mal configurée'}.`, resolveStatus(seo.homepage_h1_kpi));
       if (f4) findingsSeo.push(f4);
    }
    
    if (seo.duplicate_content_kpi) {
      const f5 = createFinding('seo', 'duplicate', 'Évaluation de contenu dupliqué', seo.duplicate_content_kpi.passed, `Pourcentage évalué de duplicate content : ${seo.duplicate_content_kpi.duplicate_content_rate_pct}%`, resolveStatus(seo.duplicate_content_kpi));
       if (f5) findingsSeo.push(f5);
    }
  }

  // --- 6. Contenu ---
  if (smet.content) {
    const cont = smet.content;
    if (cont.freshness_kpi) {
        const f1 = createFinding('cont', 'freshness', 'Fraîcheur des actualités', cont.freshness_kpi.passed, `Dernier signe d'activité / publication datant du : ${cont.freshness_kpi.latest_pub_date || 'N/A'}`, resolveStatus(cont.freshness_kpi));
        if (f1) findingsCont.push(f1);
    }
    if (cont.typo_detection) {
        const f2 = createFinding('cont', 'typo', 'Erreurs de frappe et grammaire (Typo)', cont.typo_detection.passed, `Score d'erreurs moyen calculé : ${cont.typo_detection.avg_typo_density?.toFixed(2) || '0'}`, resolveStatus(cont.typo_detection));
        if (f2) findingsCont.push(f2);
    }
    const isThinPassed = cont.pages_thin_content_nlp === 0;
    const f3 = createFinding('cont', 'thin', 'Densité Textuelle (Richesse du Contenu)', isThinPassed, `Total des pages présentant un contenu textuel insuffisant : ${cont.pages_thin_content_nlp}`, resolveStatus(cont.thin_content_kpi ?? { passed: isThinPassed }));
    if (f3) findingsCont.push(f3);
  }

  // --- 7. UX / UI ---
  if (smet.ux) {
    const ux = smet.ux;
    if (ux.menu_structure_kpi) {
        const f1 = createFinding('ux', 'menu', 'Sémantique Menus & Navigation', ux.menu_structure_kpi.passed, `Pages possédant une structure de menu douteuse : ${ux.menu_structure_kpi.pages_with_menu_issues}`, resolveStatus(ux.menu_structure_kpi), ux.menu_structure_kpi.evidence);
        if (f1) findingsUx.push(f1);
    }
    const isInvLinkPassed = ux.total_invisible_links === 0;
    const f2 = createFinding('ux', 'inv-links', 'Liens ou surfaces cliquables invisibles', isInvLinkPassed, `Nombre brut de tags invisibles mais interactifs : ${ux.total_invisible_links}`, resolveStatus(ux.invisible_links_kpi ?? { passed: isInvLinkPassed }));
    if (f2) findingsUx.push(f2);
  }

  // --- 8. Eco Index ---
  if (smet.performance) {
    const scoreVal = smet.performance.avg_eco_index || 0;
    const passed = scoreVal > 50; 
    const f1 = createFinding('eco', 'score', 'Bilan Eco Index (Impact CO2)', passed, `Résultat Eco Index : ${scoreVal.toFixed(1)}/100.`, resolveStatus(smet.performance?.eco_kpi ?? { passed }));
    if (f1) findingsEco.push(f1);
  }

  // --- 9. RGPD ---
  if (dman.privacy_kpi) {
    const kpi = dman.privacy_kpi;
    const f1 = createFinding('rgpd', 'global', 'Dispositions Légales et Confidentialité', kpi.passed, `Politique vie privée : ${kpi.has_privacy_policy ? 'Oui' : 'Non'} — Consentement : ${kpi.cookie_consent?.detected ? 'Oui' : 'Non'}`, resolveStatus(kpi), kpi.issues);
    if (f1) findingsRgpd.push(f1);
  }

  // Compile Axes
  function buildAxis(metaKey: string, findingsList: AuditFinding[]): AuditAxis {
    const meta = AXIS_META[metaKey];
    const breakdown = getAxisScoreBreakdown({
      id: meta.id,
      name: meta.name,
      icon: meta.id,
      score: 0,
      maxScore: 0,
      description: meta.description,
      findings: findingsList,
    });
    
    return {
      id: meta.id,
      name: meta.name,
      icon: meta.id,
      score: breakdown.x,
      maxScore: breakdown.y,
      description: meta.description,
      findings: findingsList,
    };
  }

  const axes: AuditAxis[] = [
    buildAxis('TECHNIQUE', findingsTech),
    buildAxis('SECURITY', findingsSec),
    buildAxis('FUNCTIONAL', findingsFunc),
    buildAxis('PERFORMANCE', findingsPerf),
    buildAxis('SEO', findingsSeo),
    buildAxis('CONTENT', findingsCont),
    buildAxis('UX_UI', findingsUx),
    buildAxis('ECO_INDEX', findingsEco),
    buildAxis('RGPD', findingsRgpd),
  ];

  const totalPassed = axes.reduce((sum, a) => sum + a.score, 0);
  const totalFindingsCount = axes.reduce((sum, a) => sum + a.maxScore, 0);
  
  // Guard against divide by zero (empty audit)
  const globalScoreVal = totalFindingsCount > 0 ? Math.round((totalPassed / totalFindingsCount) * 100) : 0;

  return {
    id: auditId,
    url: project.url,
    siteName: project.site_name,
    date: new Date().toISOString().split('T')[0],
    globalScore: globalScoreVal, 
    maturityLevel: globalScoreVal > 75 ? 'Avancé' : 'En développement',
    riskLevel: globalScoreVal < 50 ? 'high' : 'low',
    axes,
    strategicSummary: "La structure des controles inclut les 9 axes majeurs avec suivi du ratio de succes entre controles conformes et controles analyses.",
    positivePoints: [],
    negativePoints: [],
    opportunities: [],
    criticalPoints: [],
    pagesMeta: [],
    imagesToOptimize: [],
    sitemapUrl: '',
    sitemapFound: false,
    newsItems: [],
  };
}
