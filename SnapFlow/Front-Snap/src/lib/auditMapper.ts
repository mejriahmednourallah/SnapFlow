import { getAxisScoreBreakdown, getRiskLevelFromScore } from '@/data/mockAuditData';
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
} from '@/data/mockAuditData';

export interface ApiResponse {
  report_version?: string;
  scan_id: string;
  domain: string;
  axes?: Record<string, Record<string, any>>;
  domain_analysis?: any;
  site_metrics?: any;
  issues?: any;
  summary?: AuditSummary;
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
    description: 'Version CMS, modules, erreurs JS.',
  },
  SECURITY: {
    id: 'security',
    name: 'Sécurité',
    description: 'SSL, En-têtes HTTP, Flags cookies, Cache.',
  },
  FUNCTIONAL: {
    id: 'functional',
    name: 'Fonctionnel',
    description: 'Formulaires, liens cassés, boutons, adresses email protégées.',
  },
  PERFORMANCE: {
    id: 'performance',
    name: 'Performance',
    description: 'FCP, LCP, CLS, Speed Index, optimisation images.',
  },
  SEO: {
    id: 'seo',
    name: 'SEO',
    description: 'Balises META, maillage, sitemap, duplicate content.',
  },
  CONTENT: {
    id: 'content',
    name: 'Contenu',
    description: 'Qualité temporelle (fraîcheur), taux de remplissage texte, orthographe.',
  },
  UX_UI: {
    id: 'ux-ui',
    name: 'UX/UI',
    description: 'Menu structuré, liens invisibles, ratios de densité de texte.',
  },
  ECO_INDEX: {
    id: 'eco-index',
    name: 'Eco Index',
    description: 'Impact environnemental global du site web.',
  },
  RGPD: {
    id: 'rgpd',
    name: 'RGPD & Conformité',
    description: 'Bannière de consentement, politique de confidentialité visée.',
  },
};

function normalizeFindingStatus(statusRaw: unknown): FindingStatus {
  const status = String(statusRaw ?? '').toLowerCase();
  if (status === 'passing' || status === 'pass' || status === 'covered') return 'pass';
  if (status === 'failing' || status === 'fail' || status === 'failed') return 'fail';
  if (status === 'warning') return 'fail';
  if (status === 'not_available' || status === 'not-available') return 'not_available';
  if (status === 'not_evaluated') return 'not_evaluated';
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

  const looksLikeJson =
    normalized.startsWith('{') ||
    normalized.startsWith('[') ||
    /\{.*:.*\}/.test(normalized) ||
    normalized.includes('"') && normalized.includes('{');

  if (looksLikeJson) {
    return 'Donnee structuree disponible dans le detail.';
  }

  return normalized;
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
  if (value === null || value === undefined) return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const rendered = String(value).trim();
    return rendered ? [`${prefix}: ${rendered}`] : [];
  }

  if (Array.isArray(value)) {
    const primitiveItems = value
      .filter((item) => ['string', 'number', 'boolean'].includes(typeof item))
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8);

    if (primitiveItems.length > 0) {
      return [`${prefix}: ${primitiveItems.join(', ')}`];
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

        if (compact) return `${prefix}: ${compact}`;
        return `${prefix}: donnee structuree disponible dans le detail`;
      })
      .filter(Boolean);

    return objectItems;
  }

  if (typeof value === 'object') {
    if (isRecord(value) && value.status === 'MISSING' && typeof value.reason === 'string') {
      return [`${prefix}: MISSING - ${value.reason}`];
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
    return { text: 'KPI valide. Maintenir ce niveau de conformite.', source: 'generated' };
  }
  if (status === 'not_available') {
    return {
      text: 'KPI non disponible dans ce contexte de scan. Verifier les prerequis techniques.',
      source: 'generated',
    };
  }
  if (status === 'not_measured' || status === 'not_evaluated') {
    return {
      text: 'KPI non mesure. Relancer le scan avec un contexte plus complet.',
      source: 'generated',
    };
  }
  return {
    text: 'Prioriser la correction en s appuyant sur les preuves techniques de ce KPI.',
    source: 'generated',
  };
}

function extractDigestSummary(kpiNode: any): string[] {
  const digest = isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : {};
  const lines: string[] = [];

  if (typeof digest.summary === 'string' && digest.summary.trim().length > 0) {
    lines.push(sanitizeEvidenceLine(digest.summary));
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
      lines.push(`URLs: ${urls.join(', ')}`);
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
  const legacyOrigin = normalizeOrigin(kpiNode?.type);
  if (kpiNode?.type) return legacyOrigin;
  if (axisKey === 'RGPD') return 'RGPD';
  if (status === 'fail' && (kpiNode?.severity === 'critical' || kpiNode?.severity === 'high')) {
    return 'bug';
  }
  return 'recommendation';
}

function buildFindingFromScannerKpi(axisKey: AxisBucketKey, kpiName: string, kpiNode: any): AuditFinding {
  const status = normalizeFindingStatus(kpiNode?.status);
  const origin = normalizeScannerOrigin(axisKey, status, kpiNode);
  const criticality = normalizeCriticality({ status, severity: kpiNode?.severity });
  const priority = normalizePriority({ status, severity: kpiNode?.severity, type: kpiNode?.type });
  const urls = extractScannerKpiUrls(kpiNode);
  const evidence = extractScannerKpiEvidence(kpiNode, urls);
  const digestSummary = extractDigestSummary(kpiNode);
  const recommendationDetails = extractScannerRecommendation(kpiNode, status);
  const impact = extractScannerKpiImpact(kpiNode);
  const title = typeof kpiNode?.name === 'string' && kpiNode.name.trim().length > 0
    ? kpiNode.name
    : kpiName;
  const affectedCount = extractScannerKpiAffectedCount(kpiNode, urls);

  const summaryEvidence = digestSummary.length > 0 ? digestSummary : evidence.slice(0, 8);

  const type = status === 'pass'
    ? 'pass'
    : origin === 'bug'
      ? 'bug'
      : 'recommendation';

  const kpiId = (typeof kpiNode?.kpi_id === 'string' && kpiNode.kpi_id.trim().length > 0
    ? kpiNode.kpi_id
    : `${axisKey.toLowerCase()}-${kpiName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  ).replace(/-+/g, '-');

  return {
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
    evidence: summaryEvidence.slice(0, 20),
    evidenceSummary: summaryEvidence,
    evidenceRaw: {
      digest: isRecord(kpiNode?.evidence_digest) ? kpiNode.evidence_digest : undefined,
      evidence: isRecord(kpiNode?.evidence) ? kpiNode.evidence : undefined,
      metrics: isRecord(kpiNode?.metrics) ? kpiNode.metrics : undefined,
    },
    pageUrl: typeof urls?.[0] === 'string' ? urls[0] : undefined,
    page: typeof urls?.[0] === 'string' ? urls[0] : undefined,
  };
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
  const coverageFindings = allFindings.filter((f) => f.status === 'not_measured' || f.status === 'not_available' || f.status === 'not_evaluated');
  const complianceFindings = failFindings.filter((f) => f.origin === 'RGPD');
  const recommendationFindings = failFindings.filter((f) => f.origin !== 'RGPD' && f.type !== 'bug');
  const bugFindings = failFindings.filter((f) => f.type === 'bug');
  const criticalFindings = failFindings.filter((f) => f.criticality === 'critical' || f.criticality === 'high');

  const total = passFindings.length + failFindings.length + coverageFindings.length;
  const globalScore = total > 0 ? Math.round((passFindings.length / total) * 100) : 0;

  const summary: AuditSummary = {
    total,
    bugs: bugFindings.length,
    recommendations: recommendationFindings.length,
    compliance: complianceFindings.length,
    critical: failFindings.filter((f) => f.criticality === 'critical').length,
    high: failFindings.filter((f) => f.criticality === 'high').length,
    medium: failFindings.filter((f) => f.criticality === 'medium').length,
    low: failFindings.filter((f) => f.criticality === 'low').length,
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
    strategicSummary: `Audit basé sur ${allFindings.length} KPI (${passFindings.length} validés, ${failFindings.length} en échec, ${coverageFindings.length} non mesurés ou non disponibles).`,
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
  const isNotMeasured = status === 'not_measured' || status === 'not_evaluated';
  const isNotAvailable = status === 'not_available';

  const description = isPass
    ? `Objectif réussi : ${descriptionStr}`
    : isFail
      ? `Anomalie détectée : ${descriptionStr}`
      : isNotAvailable
        ? `KPI non disponible : ${descriptionStr}`
        : `KPI non mesuré : ${descriptionStr}`;

  const inferPriority = (): Priority => {
    const normalized = `${title} ${descriptionStr}`.toLowerCase();
    if (isPass) return 'long-terme';
    if (isNotAvailable || isNotMeasured) return 'moyen-terme';
    if (/refonte|architecture|migration|multiplatform|mobile friendly/i.test(normalized)) return 'long-terme';
    if (/ux|ui|ergonomie|navigation|parcours|contenu|seo|maillage|conversion|design/i.test(normalized)) return 'moyen-terme';
    // VETO: No 'quick-win' assignments — fail items get 'moyen-terme'
    return 'moyen-terme';
  };

  const inferCriticality = (): Criticality => {
    if (isPass) return 'low';
    if (isNotAvailable || isNotMeasured) return 'medium';
    if (issuesList && issuesList.length > 4) return 'high';
    return 'medium';
  };

  const recommendation = isPass
    ? 'KPI validé. Maintenir ce niveau de conformité dans la durée.'
    : isFail
      ? (issuesList && issuesList.length > 0
        ? 'Résoudre les problèmes détectés listés en annexe.'
        : 'Veuillez corriger ou ajuster ce point selon les règles métier.')
      : isNotAvailable
        ? 'La mesure n\'est pas disponible dans le contexte actuel. Vérifiez les dépendances techniques requises.'
        : 'KPI non mesuré : relancer le scan avec les prérequis complets pour obtenir une mesure exploitable.';

  return {
    id: `${axisId}-${idSuffix}`,
    title,
    description,
    criticality: inferCriticality(),
    priority: inferPriority(),
    type: isPass ? 'pass' : isFail ? 'bug' : 'recommendation',
    status,
    recommendation,
    annexes: issuesList,
  };
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
  return {
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
  };
}

function buildStructuredFindingFromPassing(item: AuditPassingKpi): AuditFinding {
  const normalizedEvidence = (item.evidence ?? []).map((line) => sanitizeEvidenceLine(line)).filter(Boolean);
  return {
    id: item.id,
    title: item.label,
    description: `Contrôle validé : ${item.observed_value}`,
    criticality: 'low',
    priority: 'long-terme',
    recommendation: 'KPI validé. Maintenir ce niveau de conformité.',
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
  };
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
      label: 'SSL valide',
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
  return {
    id: item.id,
    title: item.label,
    description: item.status === 'not_available'
      ? 'Contrôle non disponible dans le contexte technique du scan.'
      : 'Contrôle non mesuré dans les données remontées par le scan.',
    criticality: item.status === 'not_available' ? 'low' : 'medium',
    priority: 'moyen-terme',
    recommendation: item.status === 'not_available'
      ? 'Préparer les dépendances nécessaires pour rendre ce contrôle disponible.'
      : 'Relancer ou compléter le scan pour mesurer ce contrôle.',
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
  };
}

function formatStructuredDetailLines(prefix: string, value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [`${prefix}: ${String(value)}`];
  }

  if (Array.isArray(value)) {
    const primitives = value
      .map((item) => formatEvidenceScalar(item))
      .filter(Boolean)
      .slice(0, 4);
    if (primitives.length > 0) {
      return [`${prefix}: ${primitives.join(', ')}`];
    }
    return [`${prefix}: ${value.length} element(s) structures`];
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
      return [`${prefix}: ${direct.join(' | ')}`];
    }

    return [`${prefix}: donnee structuree disponible dans le detail`];
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
    return { text: 'Corriger selon les details techniques remontes par ce KPI.', source: 'generated' };
  }
  return { text: 'KPI valide. Maintenir ce niveau de conformite.', source: 'generated' };
}

function buildStructuredFindingFromKpi(kpi: KpiItem): AuditFinding {
  const isFailure = kpi.status === 'failing';
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
      evidenceList.push(`URLs: ${topUrls.join(', ')}`);
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

  return {
    id: `kpi-${kpi.kpi_name.toLowerCase().replace(/\s+/g, '-')}`,
    title: kpi.kpi_name,
    description: isFailure
      ? `KPI échoué : ${evidenceSummary}`
      : `KPI passant : ${evidenceSummary}`,
    criticality: isFailure ? 'high' : 'low',
    priority: isFailure ? 'moyen-terme' : 'long-terme',
    recommendation: recommendationDetails.text,
    type: isFailure ? kpi.type === 'bug' ? 'bug' : 'recommendation' : 'pass',
    status: isFailure ? 'fail' : 'pass',
    origin: kpi.type === 'RGPD' ? 'RGPD' : kpi.type,
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
    recommendationSource: recommendationDetails.source,
    effort: affectedUrls.length > 10 ? 'high' : affectedUrls.length > 5 ? 'medium' : 'low',
    annexes: evidenceList.map((line) => sanitizeEvidenceLine(line)).filter(Boolean),
  };
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

  const pushFinding = (axisKey: keyof typeof AXIS_META, finding: AuditFinding) => {
    // VETO: Filter out quick-win priority findings completely
    if (finding.priority === 'quick-win') {
      console.log(`[auditMapper] Excluding quick-win finding: ${finding.title}`);
      return;
    }
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
    strategicSummary: `L'audit a identifié ${summary?.total ?? failCount} élément(s) d'action, dont ${summary?.critical ?? 0} critique(s), ${summary?.high ?? 0} élevé(s) et ${passCount} KPI validé(s).`,
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
    if (raw === 'not_measured' || raw === 'not-measured' || raw === 'not_evaluated') return 'not_measured';
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
    const f = createFinding('sec', 'dorks', 'Chemins et URLs exposés', kpi.passed, `Vulnérabilités de type Google Dorks répertoriées : ${kpi.google_dorks_vuln_count}`, resolveStatus(kpi));
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
    const links = (kpi.broken_links || []).map((l: any) => `Erreur ${l.status_code} sur l'URL: ${l.url} (trouvé sur ${l.found_on})`);
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
    const isDesktopPassed = perf.avg_lcp_ms < 2500; // WCAG/Lighthouse best practices baseline
    const fDp = createFinding('perf', 'desktop', 'Vitesse Web et Core Vitals (Desktop)', isDesktopPassed, `LCP moyen : ${(perf.avg_lcp_ms || 0).toFixed(0)} ms. Poids ressources : ${(perf.total_resource_size_kb || 0).toFixed(0)} kb.`, resolveStatus(perf));
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
    const f1 = createFinding('seo', 'meta', 'Attributs META HTML', isMetaPassed, `Pages dépourvues de meta description valides : ${seo.pages_missing_meta_desc}`, resolveStatus(seo.meta_kpi ?? { passed: isMetaPassed }));
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
    strategicSummary: "La structure des KPI inclut dorénavant les 9 axes majeurs avec suivi du ratio de succès (KPIs validés / analysés).",
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
