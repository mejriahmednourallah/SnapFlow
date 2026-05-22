import type {
  AuditReport as SourceAuditReport,
  AuditAxis as SourceAuditAxis,
  AuditFinding as SourceAuditFinding,
  Criticality,
} from '@/data/mockAuditData';
import { getAuditGlobalScore, getAxisScoreBreakdown } from '@/data/mockAuditData';

export type SeverityStatus = 'danger' | 'warning' | 'success';

export interface AuditScore {
  value: number;
  x: number;
  y: number;
  passed: number;
  failed: number;
  notMeasured: number;
  notAvailable: number;
  status: SeverityStatus;
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
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bKPIs\b/gi, 'indicateurs')
    .replace(/\bKPI\b/gi, 'indicateur')
    .replace(/Largest Contentful Paint/gi, "temps d'affichage principal")
    .replace(/\bLCP\b/g, "temps d'affichage principal")
    .replace(/\bFCP\b/g, 'premier affichage visible')
    .replace(/\bCLS\b/g, 'stabilite visuelle')
    .replace(/\bCVE\b/gi, 'vulnerabilite connue')
    .replace(/\bCMS\b/g, 'systeme de gestion du site')
    .replace(/\bSSL\b/g, 'certificat de securite')
    .replace(/\bRGPD\b/gi, 'protection des donnees')
    .replace(/\bSEO\b/gi, 'referencement')
    .replace(/\bJS\b/g, 'JavaScript')
    .replace(/KPI valide\.? Maintenir ce niveau de conformite\.?/gi, 'Controle conforme.')
    .replace(/KPI validé\.? Maintenir ce niveau de conformité\.?/gi, 'Controle conforme.');
}

function toFindingItem(finding: SourceAuditFinding): AuditFindingItem {
  const impact = cleanPdfText(finding.impact || finding.risk || finding.description);
  const evidence = (finding.evidenceSummary ?? finding.evidence ?? finding.annexes ?? []).map((line) => cleanPdfText(line)).filter(Boolean);
  const annexes = (finding.annexes ?? finding.evidenceSummary ?? []).map((line) => cleanPdfText(line)).filter(Boolean);
  const page = finding.page || finding.pageUrl || '';
  const pageUrl = finding.pageUrl || finding.page || '';
  return {
    id: finding.id,
    title: cleanPdfText(finding.title),
    description: cleanPdfText(finding.description),
    recommendation: cleanPdfText(finding.recommendation),
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
    exampleUrls: finding.exampleUrls ?? [],
  };
}

function toAxisItem(axis: SourceAuditAxis): AuditAxisItem {
  const breakdown = getAxisScoreBreakdown(axis);
  return {
    id: axis.id,
    name: axis.name,
    description: axis.description,
    score: {
      value: breakdown.scorePct,
      x: breakdown.x,
      y: breakdown.y,
      passed: breakdown.passed,
      failed: breakdown.failed,
      notMeasured: breakdown.notMeasured,
      notAvailable: breakdown.notAvailable,
      status: toSeverityStatus(breakdown.scorePct),
    },
    findings: axis.findings.map(toFindingItem),
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
        recommendation: finding.recommendation,
        impact: finding.impact,
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
  const axes = audit.axes.map(toAxisItem);
  const recommendations = toRecommendations(axes);
  const globalPct = getAuditGlobalScore(audit);
  const totalX = axes.reduce((sum, axis) => sum + axis.score.x, 0);
  const totalY = axes.reduce((sum, axis) => sum + axis.score.y, 0);
  const totalPassed = axes.reduce((sum, axis) => sum + axis.score.passed, 0);
  const totalFailed = axes.reduce((sum, axis) => sum + axis.score.failed, 0);
  const totalNotMeasured = axes.reduce((sum, axis) => sum + axis.score.notMeasured, 0);
  const totalNotAvailable = axes.reduce((sum, axis) => sum + axis.score.notAvailable, 0);

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
      x: totalX,
      y: totalY,
      passed: totalPassed,
      failed: totalFailed,
      notMeasured: totalNotMeasured,
      notAvailable: totalNotAvailable,
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
