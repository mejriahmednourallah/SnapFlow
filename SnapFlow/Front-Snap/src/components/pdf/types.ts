import type {
  AuditReport as SourceAuditReport,
  AuditAxis as SourceAuditAxis,
  AuditFinding as SourceAuditFinding,
  Criticality,
} from '@/data/mockAuditData';
import { getAuditGlobalScore, getAxisScoreBreakdown, isClientVisibleFinding } from '@/data/mockAuditData';

export type SeverityStatus = 'danger' | 'warning' | 'success';

export interface AuditScore {
  value: number;
  scoreMeasured: number | null;
  x: number;
  y: number;
  measuredKpis: number;
  totalKpis: number;
  coveragePct: number;
  scoreBasis: 'measured_only';
  passed: number;
  failed: number;
  notMeasured: number;
  notAvailable: number;
  status: SeverityStatus;
}

export interface AuditEvidenceRow {
  label: string;
  value: string;
}

export interface AuditFindingItem {
  id: string;
  title: string;
  description: string;
  recommendation: string;
  impact: string;
  evidence: string[];
  annexes: string[];
  page: string;
  pageUrl: string;
  type: string;
  priority: string;
  criticality: Criticality;
  status: string;
  affectedCount?: number;
  exampleUrls: string[];
  extraExampleUrlCount: number;
  pdfConstat: string;
  pdfAction: string;
  pdfImpact: string;
  pdfEvidenceRows: AuditEvidenceRow[];
}

export interface AuditAxisItem {
  id: string;
  name: string;
  description: string;
  score: AuditScore;
  findings: AuditFindingItem[];
}

export interface RecommendationItem {
  id: string;
  axisName: string;
  title: string;
  recommendation: string;
  impact: string;
  priority: string;
  criticality: Criticality;
}

export interface RoadmapBucket {
  title: string;
  items: RecommendationItem[];
}

export interface AuditDocumentData {
  id: string;
  siteName: string;
  siteUrl: string;
  date: string;
  language: 'fr';
  reportType: string;
  preparedBy: string;
  globalScore: AuditScore;
  maturityLevel: string;
  riskLevel: Criticality;
  strategicSummary: string;
  positivePoints: string[];
  negativePoints: string[];
  opportunities: string[];
  criticalPoints: string[];
  axes: AuditAxisItem[];
  recommendations: RecommendationItem[];
  roadmap: RoadmapBucket[];
}

function toSeverityStatus(score: number): SeverityStatus {
  if (score <= 40) return 'danger';
  if (score <= 70) return 'warning';
  return 'success';
}

function cleanPdfText(value: string | undefined): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  const jsonLike =
    normalized.startsWith('{') ||
    normalized.startsWith('[') ||
    /\{.*:.*\}/.test(normalized) ||
    (normalized.includes('"') && normalized.includes('{'));
  if (jsonLike) {
    return 'Donnee structuree disponible dans la version interactive de l audit.';
  }
  return normalized
    .replace(/\bKPIs\b/gi, 'indicateurs')
    .replace(/\bKPI\b/gi, 'indicateur')
    .replace(/Largest Contentful Paint/gi, "temps d'affichage principal")
    .replace(/\bLCP\b/g, "temps d'affichage principal")
    .replace(/\bFCP\b/g, 'premier affichage visible')
    .replace(/\bCLS\b/g, 'stabilite visuelle')
    .replace(/\bCVE\b/gi, 'vulnerabilite connue')
    .replace(/\bCMS\b/g, 'systeme de gestion du site')
    .replace(/\bSSL\b/g, 'certificat de securite')
    .replace(/\bRGPD\b/gi, 'protection des données')
    .replace(/\bSEO\b/gi, 'SEO')
    .replace(/\bJS\b/g, 'JavaScript')
    .replace(/KPI valide\.? Maintenir ce niveau de conformite\.?/gi, 'Controle conforme.')
    .replace(/KPI validé\.? Maintenir ce niveau de conformité\.?/gi, 'Controle conforme.');
}

function normalizeKey(value: string): string {
  return cleanPdfText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isGenericPdfText(value: string): boolean {
  const normalized = normalizeKey(value);
  return !normalized ||
    normalized.includes('traiter la cause technique') ||
    normalized.includes('relancer uniquement ce controle') ||
    normalized.includes('relancer le scan') ||
    normalized.includes('maintenir ce niveau') ||
    normalized.includes('debug backend uniquement') ||
    normalized.includes('aucune action requise');
}

function splitEvidenceRow(line: string): AuditEvidenceRow | null {
  const cleaned = cleanPdfText(line);
  const idx = cleaned.indexOf(':');
  if (idx <= 0 || idx > 48) return null;
  const label = cleaned.slice(0, idx).trim();
  const value = cleaned.slice(idx + 1).trim();
  if (!label || !value) return null;
  return { label, value };
}

function dedupeEvidenceRows(rows: AuditEvidenceRow[]): AuditEvidenceRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label.toLowerCase()}::${row.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildPdfEvidenceRows(
  finding: SourceAuditFinding,
  evidence: string[],
  annexes: string[],
  page: string,
  pageUrl: string,
  affectedCount?: number,
): AuditEvidenceRow[] {
  const rows: AuditEvidenceRow[] = [];
  if (typeof affectedCount === 'number') rows.push({ label: 'Elements concernes', value: String(affectedCount) });
  if (page) rows.push({ label: 'Page observee', value: page });
  if (pageUrl && pageUrl !== page) rows.push({ label: 'URL canonique', value: pageUrl });

  [...evidence, ...annexes].forEach((line) => {
    const split = splitEvidenceRow(line);
    if (split) {
      rows.push(split);
    } else if (line && !line.includes('Donnee structuree disponible')) {
      rows.push({ label: 'Observation', value: line });
    }
  });

  if (Array.isArray(finding.exampleUrls) && finding.exampleUrls.length > 0) {
    rows.push({ label: 'Exemples de pages', value: finding.exampleUrls.slice(0, 3).join(', ') });
  }

  return dedupeEvidenceRows(rows).slice(0, 5);
}

function buildPdfNarrative(
  finding: SourceAuditFinding,
  axis: SourceAuditAxis,
  evidenceRows: AuditEvidenceRow[],
  fallback: { title: string; description: string; recommendation: string; impact: string },
) {
  const key = normalizeKey(`${finding.id} ${finding.title} ${axis.id} ${axis.name}`);
  const primaryEvidence = evidenceRows[0] ? `${evidenceRows[0].label}: ${evidenceRows[0].value}` : '';
  const affected = typeof finding.affectedCount === 'number' ? `${finding.affectedCount} element(s) concerne(s)` : '';
  const evidenceSuffix = primaryEvidence || affected || fallback.description;

  let pdfConstat = evidenceSuffix
    ? `${fallback.title}: ${evidenceSuffix}.`
    : fallback.description;
  let pdfAction = isGenericPdfText(fallback.recommendation)
    ? `Corriger le point "${fallback.title}" sur les pages concernees, puis relancer ce controle.`
    : fallback.recommendation;
  let pdfImpact = isGenericPdfText(fallback.impact)
    ? `Ce point peut degrader l axe ${cleanPdfText(axis.name)} et rendre le controle "${fallback.title}" moins fiable pour le client.`
    : fallback.impact;

  if (key.includes('admin')) {
    pdfConstat = `Un chemin d administration ou de configuration a ete signale publiquement: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Verifier le statut HTTP final, bloquer les chemins non publics et journaliser les acces suspects.';
    pdfImpact = 'Cette exposition facilite la reconnaissance technique et les tentatives d acces ciblees.';
  } else if (key.includes('fichier') && key.includes('sensible')) {
    pdfConstat = `Un fichier sensible potentiel a ete detecte: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Confirmer que le contenu reel est protege, puis retirer ou bloquer les fichiers de configuration du repertoire public.';
    pdfImpact = 'Un fichier sensible accessible peut exposer configuration, dependances ou informations d infrastructure.';
  } else if (key.includes('console') || key.includes('javascript')) {
    pdfConstat = `Des erreurs JavaScript ont ete observees pendant le rendu navigateur: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Corriger les scripts concernes et relancer le controle console JavaScript.';
    pdfImpact = 'Ces erreurs peuvent casser des interactions utilisateur et fausser certains controles fonctionnels.';
  } else if (key.includes('mobile') || key.includes('chargement')) {
    pdfConstat = `La mesure de performance mobile indique un point a traiter: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Verifier le rendu mobile, les ressources bloquantes et les metriques Core Web Vitals sur les pages observees.';
    pdfImpact = 'Une mesure mobile faible ou incomplete peut masquer des lenteurs percues par les visiteurs.';
  } else if (key.includes('formulaire')) {
    pdfConstat = `Le controle des formulaires a produit le constat suivant: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Verifier les formulaires critiques avec des donnees de test, les validations et la reponse serveur.';
    pdfImpact = 'Un formulaire instable peut bloquer une demande, une conversion ou une prise de contact.';
  } else if (key.includes('eco') || key.includes('ecologique')) {
    pdfConstat = `L impact ecologique mesure montre une optimisation possible: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Reduire le poids des pages, compresser les medias et supprimer les scripts non essentiels.';
    pdfImpact = 'Des pages lourdes augmentent le temps de chargement, les couts serveur et l empreinte energetique.';
  } else if (key.includes('rgpd') || key.includes('confidentialite') || key.includes('donnees')) {
    pdfConstat = `Le controle protection des donnees indique: ${primaryEvidence || fallback.title}.`;
    pdfAction = 'Mettre a jour les contenus RGPD visibles et aligner les traceurs avec le consentement utilisateur.';
    pdfImpact = 'Une information incomplete reduit la transparence et augmente le risque de non-conformite.';
  }

  return {
    pdfConstat: cleanPdfText(pdfConstat).replace(/\.+$/, '.'),
    pdfAction: cleanPdfText(pdfAction).replace(/\.+$/, '.'),
    pdfImpact: cleanPdfText(pdfImpact).replace(/\.+$/, '.'),
  };
}

const MAX_PDF_EXAMPLE_URLS = 10;

function toPdfExampleUrls(urls: string[] | undefined): { visible: string[]; hiddenCount: number } {
  const unique = Array.from(
    new Set(
      (urls ?? [])
        .map((url) => String(url ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  );

  return {
    visible: unique.slice(0, MAX_PDF_EXAMPLE_URLS),
    hiddenCount: Math.max(0, unique.length - MAX_PDF_EXAMPLE_URLS),
  };
}

function toFindingItem(finding: SourceAuditFinding, axis: SourceAuditAxis): AuditFindingItem {
  const impact = cleanPdfText(finding.impact || finding.risk || finding.description);
  const evidence = (finding.evidenceSummary ?? finding.evidence ?? finding.annexes ?? []).map((line) => cleanPdfText(line)).filter(Boolean);
  const annexes = (finding.annexes ?? finding.evidenceSummary ?? []).map((line) => cleanPdfText(line)).filter(Boolean);
  const page = finding.page || finding.pageUrl || '';
  const pageUrl = finding.pageUrl || finding.page || '';
  const exampleUrls = toPdfExampleUrls(finding.exampleUrls);
  const title = cleanPdfText(finding.title);
  const description = cleanPdfText(finding.description);
  const recommendation = cleanPdfText(finding.recommendation);
  const pdfEvidenceRows = buildPdfEvidenceRows(finding, evidence, annexes, page, pageUrl, finding.affectedCount);
  const narrative = buildPdfNarrative(finding, axis, pdfEvidenceRows, {
    title,
    description,
    recommendation,
    impact,
  });
  return {
    id: finding.id,
    title,
    description,
    recommendation,
    impact,
    evidence,
    annexes,
    page,
    pageUrl,
    type: finding.type,
    priority: finding.priority,
    criticality: finding.criticality,
    status: finding.status || finding.type,
    affectedCount: finding.affectedCount,
    exampleUrls: exampleUrls.visible,
    extraExampleUrlCount: exampleUrls.hiddenCount,
    pdfConstat: narrative.pdfConstat,
    pdfAction: narrative.pdfAction,
    pdfImpact: narrative.pdfImpact,
    pdfEvidenceRows,
  };
}

function toAxisItem(axis: SourceAuditAxis): AuditAxisItem {
  const visibleFindings = axis.findings.filter(isClientVisibleFinding);
  const breakdown = getAxisScoreBreakdown({ ...axis, findings: visibleFindings });
  return {
    id: axis.id,
    name: axis.name,
    description: axis.description,
    score: {
      value: breakdown.scorePct,
      scoreMeasured: breakdown.scoreMeasured,
      x: breakdown.x,
      y: breakdown.y,
      measuredKpis: breakdown.measuredKpis,
      totalKpis: breakdown.totalKpis,
      coveragePct: breakdown.coveragePct,
      scoreBasis: breakdown.scoreBasis,
      passed: breakdown.passed,
      failed: breakdown.failed,
      notMeasured: breakdown.notMeasured,
      notAvailable: breakdown.notAvailable,
      status: toSeverityStatus(breakdown.scorePct),
    },
    findings: visibleFindings.map((finding) => toFindingItem(finding, axis)),
  };
}

function toRecommendations(axes: AuditAxisItem[]): RecommendationItem[] {
  const list = axes.flatMap((axis) =>
    axis.findings
      .filter((finding) => (
        finding.status !== 'pass' &&
        finding.status !== 'not_available' &&
        finding.status !== 'not_measured' &&
        finding.status !== 'not_evaluated'
      ))
      .map((finding) => ({
        id: `${axis.id}-${finding.id}`,
        axisName: axis.name,
        title: finding.title,
        recommendation: finding.pdfAction,
        impact: finding.pdfImpact,
        priority: finding.priority,
        criticality: finding.criticality,
      })),
  );

  const order: Record<Criticality, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  return list.sort((a, b) => order[a.criticality] - order[b.criticality]);
}

function toRoadmap(recommendations: RecommendationItem[]): RoadmapBucket[] {
  const immediate = recommendations.filter((item) => item.priority === 'quick-win').slice(0, 6);
  const sprint = recommendations.filter((item) => item.priority === 'moyen-terme').slice(0, 6);
  const quarter = recommendations.filter((item) => item.priority === 'long-terme').slice(0, 6);
  const backlog = recommendations.slice(6, 12);

  return [
    { title: 'Immédiat', items: immediate },
    { title: 'Ce sprint', items: sprint },
    { title: 'Ce trimestre', items: quarter },
    { title: 'À planifier', items: backlog },
  ];
}

export function buildAuditDocumentData(audit: SourceAuditReport): AuditDocumentData {
  const axes = audit.axes.map(toAxisItem).filter((axis) => axis.findings.length > 0);
  const recommendations = toRecommendations(axes);
  const totalX = axes.reduce((sum, axis) => sum + axis.score.x, 0);
  const totalY = axes.reduce((sum, axis) => sum + axis.score.y, 0);
  const globalPct = totalY > 0 ? Math.round((totalX / totalY) * 100) : getAuditGlobalScore(audit);
  const totalPassed = axes.reduce((sum, axis) => sum + axis.score.passed, 0);
  const totalFailed = axes.reduce((sum, axis) => sum + axis.score.failed, 0);
  const totalKpis = totalY;
  const globalScoreMeasured = totalY > 0 ? globalPct : null;

  return {
    id: audit.id,
    siteName: audit.siteName,
    siteUrl: audit.url,
    date: audit.date,
    language: 'fr',
    reportType: 'Audit de maintenance préventive',
    preparedBy: 'Medianet x Snapflow App',
    globalScore: {
      value: globalPct,
      scoreMeasured: globalScoreMeasured,
      x: totalX,
      y: totalY,
      measuredKpis: totalY,
      totalKpis,
      coveragePct: totalY > 0 ? 100 : 0,
      scoreBasis: 'measured_only',
      passed: totalPassed,
      failed: totalFailed,
      notMeasured: 0,
      notAvailable: 0,
      status: toSeverityStatus(globalPct),
    },
    maturityLevel: audit.maturityLevel,
    riskLevel: audit.riskLevel,
    strategicSummary: audit.strategicSummary,
    positivePoints: audit.positivePoints,
    negativePoints: audit.negativePoints,
    opportunities: audit.opportunities,
    criticalPoints: audit.criticalPoints,
    axes,
    recommendations,
    roadmap: toRoadmap(recommendations),
  };
}
