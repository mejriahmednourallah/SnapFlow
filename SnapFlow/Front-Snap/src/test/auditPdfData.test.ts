import { describe, expect, it } from 'vitest';
import { buildAuditDocumentData } from '@/components/pdf/types';
import { hasUsefulAnnexeEvidence } from '@/components/pdf/pages/AnnexePage';
import { rebalanceShortTailPages } from '@/components/pdf/shared/pagination';
import type { AuditReport } from '@/data/mockAuditData';

function makeAuditReport(): AuditReport {
  return {
    id: 'audit-pdf-visibility',
    url: 'https://example.com',
    siteName: 'Example',
    date: '2026-06-07',
    globalScore: 50,
    maturityLevel: 'Intermediaire',
    riskLevel: 'medium',
    strategicSummary: 'Synthese.',
    positivePoints: [],
    negativePoints: [],
    opportunities: [],
    criticalPoints: [],
    pagesMeta: [],
    imagesToOptimize: [],
    sitemapUrl: '',
    sitemapFound: false,
    newsItems: [],
    axes: [
      {
        id: 'security',
        name: 'Securite',
        icon: 'security',
        score: 0,
        maxScore: 0,
        description: 'Controle securite.',
        findings: [
          {
            id: 'sec-pass',
            title: 'Certificat valide',
            description: 'Controle conforme.',
            recommendation: 'Maintenir.',
            criticality: 'low',
            priority: 'moyen-terme',
            type: 'pass',
            status: 'pass',
            origin: 'passing_kpi',
          },
          {
            id: 'sec-fail',
            title: 'En-tete manquant',
            description: 'Un en-tete de securite manque.',
            recommendation: 'Ajouter l en-tete.',
            impact: 'Surface d attaque accrue.',
            criticality: 'high',
            priority: 'moyen-terme',
            type: 'bug',
            status: 'fail',
            origin: 'bug',
            evidenceSummary: ['Pages verifiees: 3', '{"raw":"json"}'],
          },
          {
            id: 'sec-hidden',
            title: 'Controle non mesure',
            description: 'Pas de mesure exploitable.',
            recommendation: 'Debug backend uniquement.',
            criticality: 'medium',
            priority: 'moyen-terme',
            type: 'recommendation',
            status: 'not_evaluated',
            origin: 'coverage',
            evidenceSummary: ['Cause technique: timeout'],
          },
        ],
      },
      {
        id: 'performance',
        name: 'Performance',
        icon: 'performance',
        score: 0,
        maxScore: 0,
        description: 'Controle performance.',
        findings: [
          {
            id: 'perf-hidden',
            title: 'Mesure mobile indisponible',
            description: 'Pas de metrique fiable.',
            recommendation: 'Debug backend uniquement.',
            criticality: 'medium',
            priority: 'moyen-terme',
            type: 'recommendation',
            status: 'not_measured',
            origin: 'coverage',
          },
        ],
      },
    ],
  };
}

describe('Audit PDF document data', () => {
  it('excludes non-tested findings from client PDF axes and recommendations', () => {
    const data = buildAuditDocumentData(makeAuditReport());

    expect(data.axes).toHaveLength(1);
    expect(data.axes[0].id).toBe('security');
    expect(data.axes[0].findings.map((finding) => finding.id)).toEqual(['sec-pass', 'sec-fail']);
    expect(data.recommendations.map((item) => item.id)).toEqual(['security-sec-fail']);
    expect(data.globalScore.passed).toBe(1);
    expect(data.globalScore.failed).toBe(1);
    expect(data.globalScore.notMeasured).toBe(0);
    expect(data.globalScore.notAvailable).toBe(0);
    expect(data.globalScore.coveragePct).toBe(100);
  });

  it('replaces raw JSON-looking evidence with a human readable fallback', () => {
    const data = buildAuditDocumentData(makeAuditReport());
    const evidence = data.axes[0].findings.find((finding) => finding.id === 'sec-fail')?.evidence ?? [];

    expect(evidence).toContain('Pages verifiees: 3');
    expect(evidence).toContain('Donnee structuree disponible dans la version interactive de l audit.');
    expect(evidence.join(' ')).not.toContain('{"raw"');
  });

  it('limits long URL evidence lists for the client PDF while keeping a hidden count', () => {
    const report = makeAuditReport();
    const failFinding = report.axes[0].findings.find((finding) => finding.id === 'sec-fail');
    if (!failFinding) throw new Error('missing fixture finding');
    failFinding.exampleUrls = Array.from({ length: 15 }, (_, index) => `https://example.com/page-${index + 1}`);

    const data = buildAuditDocumentData(report);
    const finding = data.axes[0].findings.find((item) => item.id === 'sec-fail');

    expect(finding?.exampleUrls).toHaveLength(10);
    expect(finding?.extraExampleUrlCount).toBe(5);
  });

  it('keeps conforming controls out of detailed annexes', () => {
    const data = buildAuditDocumentData(makeAuditReport());
    const passFinding = data.axes[0].findings.find((finding) => finding.id === 'sec-pass');
    const failFinding = data.axes[0].findings.find((finding) => finding.id === 'sec-fail');

    expect(passFinding ? hasUsefulAnnexeEvidence(passFinding) : true).toBe(false);
    expect(failFinding ? hasUsefulAnnexeEvidence(failFinding) : false).toBe(true);
  });

  it('includes AI Friendly axis in PDF data when it has visible findings', () => {
    const report = makeAuditReport();
    report.axes.push({
      id: 'ai-friendly',
      name: 'AI Friendly',
      icon: 'ai-friendly',
      score: 0,
      maxScore: 1,
      description: 'Compatibilite moteurs generatifs.',
      findings: [
        {
          id: 'ai_llms_txt',
          title: 'AI Readiness (llms.txt)',
          description: 'Le fichier llms.txt n est pas detecte.',
          recommendation: 'Publier un fichier llms.txt utile.',
          impact: 'Decouvrabilite IA reduite.',
          criticality: 'low',
          priority: 'moyen-terme',
          type: 'recommendation',
          status: 'fail',
          origin: 'recommendation',
        },
      ],
    });

    const data = buildAuditDocumentData(report);

    expect(data.axes.some((axis) => axis.id === 'ai-friendly')).toBe(true);
    expect(data.recommendations.some((item) => item.id === 'ai-friendly-ai_llms_txt')).toBe(true);
  });

  it('builds KPI-specific PDF narrative fields from available evidence', () => {
    const report = makeAuditReport();
    const failFinding = report.axes[0].findings.find((finding) => finding.id === 'sec-fail');
    if (!failFinding) throw new Error('missing fixture finding');
    failFinding.recommendation = 'Traiter la cause technique indiquee dans les preuves.';

    const data = buildAuditDocumentData(report);
    const finding = data.axes[0].findings.find((item) => item.id === 'sec-fail');

    expect(finding?.pdfConstat).toContain('En-tete manquant');
    expect(finding?.pdfAction).not.toContain('Traiter la cause technique');
    expect(finding?.pdfEvidenceRows).toContainEqual({ label: 'Pages verifiees', value: '3' });
  });

  it('rebalances short continuation pages without page-number-specific rules', () => {
    const pages = [
      Array.from({ length: 20 }, (_, index) => index + 1),
      [21],
    ];

    const balanced = rebalanceShortTailPages(pages, {
      minItemsOnLastPage: 4,
      minItemsOnPreviousPage: 8,
      maxItemsPerPage: 20,
    });

    expect(balanced.map((page) => page.length)).toEqual([17, 4]);
  });
});
