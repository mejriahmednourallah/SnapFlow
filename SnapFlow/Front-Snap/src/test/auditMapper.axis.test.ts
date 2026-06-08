import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapApiResponseToReport } from '@/lib/auditMapper';
import { getAxisScoreBreakdown } from '@/data/mockAuditData';
import type { ApiResponse } from '@/lib/auditMapper';

describe('Axis Mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Scanner axes', () => {
    it('maps French content/security/technique axis labels to the correct buckets', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-axis-1',
        domain: 'https://example.com',
        axes: {
          Contenu: {
            quality: {
              status: 'fail',
              info: 'Content quality check',
              pages_affected: 2,
              pages_affected_urls: ['https://example.com/page1'],
            },
          },
          'Check Sécurité': {
            ssl_check: {
              status: 'pass',
              info: 'SSL certificate is valid',
            },
          },
          'Audit Technique': {
            cms: {
              status: 'pass',
              info: 'CMS detected',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-axis-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      expect(report.axes.find((axis) => axis.id === 'content')?.findings[0].title).toBe('quality');
      expect(report.axes.find((axis) => axis.id === 'security')?.findings[0].title).toBe('ssl_check');
      expect(report.axes.find((axis) => axis.id === 'technique')?.findings[0].title).toBe('cms');
    });
  });

  describe('Scanner KPI schema compatibility (/scan/{id}/kpis)', () => {
    it('maps evidence-driven flat-axis KPIs to findings', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-v2-flat-1',
        domain: 'https://example.com',
        report_version: 'v2',
        top_level_kpis: {
          total_kpis: 10,
          passed_kpis: 7,
          critical_kpis: 1,
          headline: 'Synthese backend prioritaire.',
        },
        axes: {
          'Performance et Temps de réponse': {
            lcp_homepage: {
              kpi_id: 'perf_lcp_homepage',
              type: 'recommendation',
              name: 'Largest Contentful Paint',
              status: 'failing',
              severity: 'medium',
              confidence: 'high',
              constat: 'Le Largest Contentful Paint est trop élevé sur les pages d’entrée analysées.',
              score: 42,
              impact: 'Temps de chargement long pouvant impacter la conversion.',
              evidence: {
                data_quality: 'VALID',
                detection_source: ['scanner_aggregation'],
                pages_checked: 2,
                affected_pages: 2,
                affected_page_urls_all: ['https://example.com/', 'https://example.com/pricing'],
                lcp_ms: 4200,
              },
              evidence_digest: {
                quality: 'VALID',
                proof_lines: [
                  'LCP mesure a 4200 ms sur les pages d entree analysees.',
                  '2 URLs testees: https://example.com/ et https://example.com/pricing',
                ],
                rows: [
                  { url: 'https://example.com/', lcp_ms: 4200, threshold_ms: 2500 },
                  { url: 'https://example.com/pricing', lcp_ms: 4100, threshold_ms: 2500 },
                ],
                urls: ['https://example.com/', 'https://example.com/pricing'],
                csv_columns: ['url', 'lcp_ms', 'threshold_ms'],
              },
              fix: 'Optimiser les assets LCP sur la page d’accueil et la page pricing.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-v2-flat-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const perfAxis = report.axes.find((axis) => axis.id === 'performance');
      const finding = perfAxis?.findings.find((item) => item.id === 'perf_lcp_homepage');

      expect(perfAxis).toBeDefined();
      expect(finding).toBeDefined();
      expect(finding?.description).toContain("temps d'affichage principal");
      expect(finding?.impact).toContain('conversion');
      expect(finding?.affectedCount).toBe(2);
      expect(finding?.exampleUrls).toContain('https://example.com/');
      expect(finding?.recommendation).toContain('Optimiser');
      expect(report.globalScore).toBe(0);
      expect(report.summary?.total).toBe(1);
      expect(report.summary?.critical).toBe(1);
      expect(report.strategicSummary).toBe('Synthese backend prioritaire.');
      expect(finding?.evidence?.some((line) => line.includes('4200'))).toBe(true);
      expect((finding?.evidence ?? []).some((line) => /evidence\.|data quality|VALID/i.test(line))).toBe(false);
    });

    it('maps nested sous_axes -> kpis payload into the correct axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-v2-nested-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          SEO: {
            sous_axes: {
              crawlabilite: {
                kpis: {
                  broken_links: {
                    kpi_id: 'seo_broken_links',
                    type: 'bug',
                    name: 'Liens cassés',
                    status: 'warning',
                    severity: 'medium',
                    confidence: 'medium',
                    constat: 'Des liens cassés ont été détectés sur des pages catalogue.',
                    score: 52,
                    impact: 'Dégradation SEO et expérience utilisateur.',
                    evidence: {
                      data_quality: 'VALID',
                      detection_source: ['crawler_link_check'],
                      pages_checked: 12,
                      affected_pages: 1,
                      affected_page_urls_all: ['https://example.com/catalogue'],
                    },
                    fix: 'Réparer les destinations internes cassées dans le catalogue.',
                  },
                },
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-v2-nested-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const seoAxis = report.axes.find((axis) => axis.id === 'seo');
      const functionalAxis = report.axes.find((axis) => axis.id === 'functional');

      expect(seoAxis).toBeDefined();
      expect(seoAxis?.findings.some((finding) => finding.id === 'seo_broken_links')).toBe(true);
      expect(seoAxis?.findings.find((finding) => finding.id === 'seo_broken_links')?.status).toBe('fail');
      expect(functionalAxis?.findings.some((finding) => finding.id === 'seo_broken_links')).toBe(false);
    });

    it('maps AI Friendly backend axis and ai_* KPIs to the AI bucket', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-ai-friendly-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'AI Friendly': {
            llms: {
              kpi_id: 'ai_llms_txt',
              type: 'recommendation',
              name: 'AI Readiness (llms.txt)',
              status: 'warning',
              severity: 'low',
              confidence: 'low',
              constat: 'Le fichier llms.txt n est pas detecte.',
              score: 55,
              impact: 'Decouvrabilite reduite dans les moteurs generatifs.',
              evidence: {
                data_quality: 'PARTIAL',
                detection_source: ['http_probe'],
                pages_checked: 1,
                affected_pages: 1,
              },
              fix: 'Publier un fichier llms.txt utile.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-ai-friendly-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const aiAxis = report.axes.find((axis) => axis.id === 'ai-friendly');
      const seoAxis = report.axes.find((axis) => axis.id === 'seo');

      expect(aiAxis).toBeDefined();
      expect(aiAxis?.findings.some((finding) => finding.id === 'ai_llms_txt')).toBe(true);
      expect(seoAxis?.findings.some((finding) => finding.id === 'ai_llms_txt')).toBe(false);
    });

    it('routes legacy seo_ai_readiness KPI to AI Friendly for backward compatibility', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-ai-legacy-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          SEO: {
            llms: {
              kpi_id: 'seo_ai_readiness',
              type: 'recommendation',
              name: 'AI Readiness (llms.txt)',
              status: 'warning',
              severity: 'low',
              confidence: 'low',
              constat: 'Ancien KPI llms.txt.',
              score: 55,
              impact: 'Decouvrabilite IA reduite.',
              evidence: {
                data_quality: 'PARTIAL',
                detection_source: ['http_probe'],
                pages_checked: 1,
                affected_pages: 1,
              },
              fix: 'Publier llms.txt.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-ai-legacy-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      expect(report.axes.find((axis) => axis.id === 'ai-friendly')?.findings.some((finding) => finding.title === 'AI Readiness (llms.txt)')).toBe(true);
      expect(report.axes.find((axis) => axis.id === 'seo')?.findings.some((finding) => finding.title === 'AI Readiness (llms.txt)')).toBe(false);
    });

    it('replaces generic AI Friendly wording with KPI-specific client text', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-ai-wording-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'AI Friendly': {
            llms: {
              kpi_id: 'ai_llms_txt',
              type: 'recommendation',
              name: 'AI Readiness (llms.txt)',
              status: 'warning',
              severity: 'low',
              confidence: 'low',
              constat: 'Un point d amelioration a ete detecte sur ce controle.',
              score: 58,
              impact: 'Decouvrabilite IA reduite.',
              evidence: {
                data_quality: 'PARTIAL',
                detection_source: ['http_probe'],
                pages_checked: 1,
                affected_pages: 1,
              },
              evidence_digest: {
                quality: 'PARTIAL',
                proof_lines: [
                  'URL testee: https://example.com/llms.txt',
                  'Resultat de recuperation: fetch_error:HTTPError',
                ],
                rows: [
                  { llms_url: 'https://example.com/llms.txt', parse_status: 'fetch_error:HTTPError' },
                ],
                urls: ['https://example.com'],
                csv_columns: ['llms_url', 'parse_status'],
              },
              fix: 'Corriger : AI Readiness (llms.txt)',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-ai-wording-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });
      const finding = report.axes.find((axis) => axis.id === 'ai-friendly')?.findings[0];

      expect(finding?.description).toContain('llms.txt');
      expect(finding?.description).not.toContain('Un point d amelioration');
      expect(finding?.recommendation).toContain('moteurs generatifs');
      expect(finding?.recommendation).not.toContain('Corriger :');
    });

    it('formats AI Schema.org JSON-LD evidence with human labels', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-ai-schema-evidence-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'AI Friendly': {
            schema: {
              kpi_id: 'ai_schema_org',
              type: 'recommendation',
              name: 'Schema.org pour IA',
              status: 'warning',
              severity: 'low',
              confidence: 'medium',
              constat: 'JSON-LD partiel.',
              score: 60,
              impact: 'Compréhension IA limitée.',
              evidence: {
                data_quality: 'PARTIAL',
                json_ld_valid_pages: 10,
                json_ld_coverage_pct: 10,
                json_ld_parse_errors: 2,
                schema_types: 'Organization, WebSite',
              },
              evidence_digest: {
                quality: 'PARTIAL',
                proof_lines: [
                  'json_ld_valid_pages: 10',
                  'json_ld_coverage_pct: 10',
                  'json_ld_parse_errors: 2',
                  'schema_types: Organization, WebSite',
                ],
                rows: [
                  { page_url: 'https://example.com/', json_ld_valid: true, json_ld_types: 'Organization' },
                ],
                csv_columns: ['page_url', 'json_ld_valid', 'json_ld_types'],
              },
              fix: 'Ajouter un JSON-LD complet.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-ai-schema-evidence-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const finding = report.axes.find((axis) => axis.id === 'ai-friendly')?.findings[0];
      const evidence = finding?.evidence?.join(' ') ?? '';

      expect(evidence).toContain('Pages avec JSON-LD valide');
      expect(evidence).toContain('Couverture JSON-LD');
      expect(evidence).toContain('Erreurs de parsing JSON-LD');
      expect((finding?.annexes ?? []).join(' ')).toContain('Types detectes');
    });

    it('keeps legacy V1 scanner fields mapped when the new contract is absent', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-v1-legacy-1',
        domain: 'https://example.com',
        axes: {
          Security: {
            csp_header: {
              status: 'fail',
              severity: 'high',
              type: 'bug',
              info: 'L\'en-tête Content-Security-Policy est manquant.',
              impact: 'Risque XSS accru.',
              pages_affected: 1,
              pages_affected_urls: ['https://example.com/login'],
              data: {
                missing_headers: ['Content-Security-Policy'],
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-v1-legacy-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const securityAxis = report.axes.find((axis) => axis.id === 'security');
      const finding = securityAxis?.findings.find((item) => item.title === 'csp_header');

      expect(securityAxis).toBeDefined();
      expect(finding).toBeDefined();
      expect(finding?.description).toContain('regle de securite du contenu');
      expect(finding?.impact).toContain('injection de script');
      expect(finding?.origin).toBe('bug');
      expect(finding?.affectedCount).toBe(1);
      expect(finding?.exampleUrls).toContain('https://example.com/login');
      expect(finding?.evidence?.some((line) => line.includes('regle de securite du contenu'))).toBe(true);
      expect((finding?.evidence ?? []).some((line) => /metrics\.|data quality|VALID/i.test(line))).toBe(false);
    });

    it('keeps backend non-tested KPIs out of client-visible findings and actions', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-non-tested-tech-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Audit Technique': {
            cms: {
              kpi_id: 'tech_cms_version',
              type: null,
              name: 'Version CMS/Framework',
              status: 'passing',
              evidence_digest: { quality: 'VALID', proof_lines: ['CMS detecte: Drupal 10'] },
            },
            modules: {
              kpi_id: 'tech_modules_versions',
              type: null,
              name: 'Version Modules Installes',
              status: 'passing',
              evidence_digest: { quality: 'VALID', proof_lines: ['3 modules detectes avec version'] },
            },
            server: {
              kpi_id: 'tech_server_version',
              type: null,
              name: 'Version serveur',
              status: 'passing',
              evidence_digest: { quality: 'VALID', proof_lines: ['Serveur detecte: Apache 2.4'] },
            },
            language: {
              kpi_id: 'tech_programming_language',
              type: 'recommendation',
              name: 'Langage de Programmation',
              status: 'not_evaluated',
              severity: 'high',
              evidence_digest: { quality: 'MISSING', missing_reason: 'Runtime non detecte par le scan.' },
            },
            cve: {
              kpi_id: 'tech_cve_check',
              type: 'bug',
              name: 'Verification du Code',
              status: 'not_evaluated',
              severity: 'critical',
              evidence_digest: { quality: 'MISSING', missing_reason: 'Aucune table CVE exploitable.' },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-non-tested-tech-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const techAxis = report.axes.find((axis) => axis.id === 'technique');
      const breakdown = getAxisScoreBreakdown(techAxis!);
      const nonTested = techAxis?.findings.filter((finding) => finding.origin === 'coverage') ?? [];

      expect(techAxis?.findings).toHaveLength(2);
      expect(breakdown.x).toBe(2);
      expect(breakdown.y).toBe(2);
      expect(breakdown.scoreMeasured).toBe(100);
      expect(breakdown.coveragePct).toBe(100);
      expect(nonTested).toHaveLength(0);
      expect(report.bugs.some((item) => item.source_kpi === 'tech_cve_check')).toBe(false);
      expect(report.recommendations.some((item) => item.source_kpi === 'tech_programming_language')).toBe(false);
      expect(report.auditCoverage).toEqual([]);
    });

    it('hides all backend non-tested status variants from client lists', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-non-tested-variants-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          Security: {
            unavailable: {
              kpi_id: 'sec_unavailable',
              type: 'bug',
              name: 'Unavailable',
              status: 'not_available',
              evidence_digest: { quality: 'MISSING', missing_reason: 'Probe unavailable.' },
            },
            unevaluated: {
              kpi_id: 'sec_unevaluated',
              type: 'bug',
              name: 'Unevaluated',
              status: 'not_evaluated',
              evidence_digest: { quality: 'MISSING', missing_reason: 'Evidence missing.' },
            },
            unmeasured: {
              kpi_id: 'sec_unmeasured',
              type: 'recommendation',
              name: 'Unmeasured',
              status: 'not_measured',
              evidence_digest: { quality: 'MISSING', missing_reason: 'Metric missing.' },
            },
            frenchLegacy: {
              kpi_id: 'sec_french_legacy',
              type: 'bug',
              name: 'French legacy',
              status: 'non_evalue',
              evidence_digest: { quality: 'MISSING', missing_reason: 'Legacy missing state.' },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-non-tested-variants-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const securityFindings = report.axes.find((axis) => axis.id === 'security')?.findings ?? [];

      expect(securityFindings).toHaveLength(0);
      expect(report.bugs).toHaveLength(0);
      expect(report.recommendations).toHaveLength(0);
      expect(report.auditCoverage).toEqual([]);
    });
  });

  describe('Structured payload dedupe', () => {
    it('does not inject duplicate legacy rows for a KPI already present in structured kpis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-dedupe-1',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'SSL',
            axis: 'Security',
            status: 'failing',
            type: 'bug',
            evidence: { summary: 'SSL failed.' },
            client_impact: 'Trust loss.',
          },
        ],
        bugs: [
          {
            id: 'legacy-ssl',
            title: 'SSL',
            type: 'bug',
            severity: 'high',
            scope: 'global',
            description: 'Legacy SSL duplicate.',
            impact: 'Trust loss.',
            effort: 'medium',
            affected_count: 1,
            example_urls: ['https://example.com'],
            fix: 'Fix SSL.',
            source_kpi: 'SSL',
            evidence: ['Legacy evidence'],
          },
        ],
        recommendations: [],
        compliance: [],
        audit_coverage: [
          {
            id: 'coverage-ssl',
            label: 'SSL',
            status: 'not_measured',
            evidence: ['Legacy coverage duplicate'],
          },
        ],
        passing_kpis: [
          {
            id: 'passing-ssl',
            label: 'SSL',
            source_kpi: 'SSL',
            observed_value: 'Legacy passing duplicate',
            status: 'pass',
            evidence: ['Legacy pass'],
          },
        ],
      };

      const report = mapApiResponseToReport(api, 'audit-dedupe-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const securityFindings = report.axes.find((axis) => axis.id === 'security')?.findings ?? [];

      expect(securityFindings.filter((finding) => finding.title === 'Certificat de sécurité')).toHaveLength(1);
    });
  });

  describe('Recommendation and evidence rendering quality', () => {
    it('prefers backend fix over generic fallback recommendation', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-reco-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Check Sécurité': {
            ssl: {
              kpi_id: 'sec_ssl',
              type: 'bug',
              status: 'failing',
              severity: 'critical',
              confidence: 'high',
              name: 'SSL',
              constat: 'Le certificat SSL du domaine est invalide ou expiré.',
              score: 15,
              impact: 'Risque de sécurité',
              evidence: {
                data_quality: 'VALID',
                detection_source: ['ssl_probe'],
                pages_checked: 1,
                affected_pages: 1,
                certificate_url: 'https://example.com',
              },
              fix: 'Renouveler le certificat SSL avant expiration.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-reco-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const securityAxis = report.axes.find((axis) => axis.id === 'security');
      const finding = securityAxis?.findings.find((item) => item.id === 'sec_ssl');

      expect(finding).toBeDefined();
      expect(finding?.recommendation).toBe('Renouveler le certificat de securite avant expiration.');
      expect(finding?.recommendationSource).toBe('fix');
    });

    it('uses curated digest previews and hides raw evidence payloads by default', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-evidence-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          SEO: {
            meta: {
              kpi_id: 'seo_meta',
              type: 'recommendation',
              status: 'failing',
              severity: 'medium',
              confidence: 'high',
              name: 'Balises META',
              constat: 'Des meta descriptions sont manquantes sur plusieurs pages.',
              score: 40,
              impact: 'Perte de CTR',
              evidence: {
                data_quality: 'VALID',
                detection_source: ['scanner_aggregation', 'nlp'],
                pages_checked: 12,
                affected_pages: 2,
                meta_missing_count: 2,
                meta_missing_urls_all: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
                title_missing_count: 0,
                title_missing_urls_all: [],
              },
              evidence_digest: {
                quality: 'VALID',
                proof_lines: [
                  '2 pages sans meta description sur 12 pages testees.',
                  'URLs concernees: https://example.com/a, https://example.com/b',
                  'Titre present sur toutes les pages testees.',
                ],
                rows: [
                  { page_url: 'https://example.com/a', issue: 'meta description manquante', title_length: 51 },
                  { page_url: 'https://example.com/b', issue: 'meta description manquante', title_length: 48 },
                ],
                urls: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
                csv_columns: ['page_url', 'issue', 'title_length'],
                csv_rows: [
                  { page_url: 'https://example.com/a', issue: 'meta description manquante', title_length: 51 },
                  { page_url: 'https://example.com/b', issue: 'meta description manquante', title_length: 48 },
                ],
              },
              fix: 'Ajouter une meta description unique sur chaque page affectée.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-evidence-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const seoAxis = report.axes.find((axis) => axis.id === 'seo');
      const finding = seoAxis?.findings.find((item) => item.id === 'seo_meta');

      expect(finding).toBeDefined();
      expect(finding?.exampleUrls).toEqual(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'].slice(0, 10));
      expect(finding?.evidence).toEqual([
        '2 pages sans description de page sur 12 pages testees.',
        'Pages concernees: https://example.com/a, https://example.com/b',
        'Titre present sur toutes les pages testees.',
      ]);
      expect(finding?.evidenceRows).toHaveLength(2);
      expect(finding?.evidenceCsvColumns).toEqual(['page_url', 'issue', 'title_length']);
      expect((finding?.evidenceRaw as any)?.digest?.quality).toBe('VALID');
      expect((finding?.evidenceRaw as any)?.evidence).toBeUndefined();
      expect((finding?.evidence ?? []).some((line) => /VALID|data_quality|meta_missing_urls_all|\[object Object\]/i.test(line))).toBe(false);
    });

    it('uses curated form-fuzzer rows and does not expose dangerous payloads as raw JSON', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-forms-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Audit Fonctionnel': {
            forms: {
              kpi_id: 'func_forms',
              type: 'bug',
              status: 'warning',
              severity: 'high',
              confidence: 'medium',
              name: 'Les Formulaires',
              constat: '3 formulaires détectés, 2 testés et 2 anomalies remontées.',
              score: 50,
              impact: 'Des parcours de conversion peuvent échouer.',
              evidence: {
                data_quality: 'PARTIAL',
                detection_source: ['form_fuzzer', 'scanner_aggregation'],
                pages_checked: 2,
                affected_pages: 2,
                forms_detected: 3,
                forms_tested: 2,
                tests_run: 4,
                anomalies_count: 2,
                anomalies_by_type: { server_error: 1, validation_bypass: 1 },
                affected_page_urls_all: ['https://example.com/contact', 'https://example.com/devis'],
                anomalous_tests_all: [
                  {
                    page_url: 'https://example.com/contact',
                    action_url: 'https://example.com/api/contact',
                    form_id: 'contact-form',
                    test_type: 'xss_payload',
                    payload: { message: '<script>alert(1)</script>' },
                    response_type: 'html',
                    status_code: 500,
                    anomaly: 'server_error',
                    anomaly_reason: '500 returned after payload submission',
                    duration_ms: 421,
                    error: '',
                  },
                ],
              },
              evidence_digest: {
                quality: 'PARTIAL',
                proof_lines: [
                  '2 formulaires avec signaux anormaux sur 4 tests executes.',
                  'Formulaire concerne: https://example.com/contact',
                  'Payloads dangereux masques dans les preuves client.',
                ],
                rows: [
                  {
                    page_url: 'https://example.com/contact',
                    action_url: 'https://example.com/api/contact',
                    form_id: 'contact-form',
                    test_type: 'xss_payload',
                    payload: '[masque]',
                    status_code: 500,
                    anomaly: 'server_error',
                    anomaly_reason: '500 returned after payload submission',
                  },
                ],
                urls: ['https://example.com/contact', 'https://example.com/devis'],
                csv_columns: ['page_url', 'action_url', 'form_id', 'test_type', 'status_code', 'anomaly', 'anomaly_reason'],
                csv_rows: [
                  {
                    page_url: 'https://example.com/contact',
                    action_url: 'https://example.com/api/contact',
                    form_id: 'contact-form',
                    test_type: 'xss_payload',
                    status_code: 500,
                    anomaly: 'server_error',
                    anomaly_reason: '500 returned after payload submission',
                  },
                ],
              },
              fix: 'Étendre la couverture du form fuzzer et corriger les anomalies remontées.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-forms-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const functionalAxis = report.axes.find((axis) => axis.id === 'functional');
      const finding = functionalAxis?.findings.find((item) => item.id === 'func_forms');

      expect(finding).toBeDefined();
      expect(finding?.exampleUrls).toContain('https://example.com/contact');
      expect(finding?.evidence).toEqual([
        '2 formulaires avec signaux anormaux sur 4 tests executes.',
        'Formulaire concerne: https://example.com/contact',
        'contenus de test dangereux masques dans les preuves client.',
      ]);
      expect(finding?.evidenceRows?.[0]?.payload).toBe('[masque]');
      expect((finding?.evidenceRaw as any)?.digest?.quality).toBe('PARTIAL');
      expect((finding?.evidenceRaw as any)?.evidence?.anomalous_tests_all).toBeUndefined();
      expect((finding?.evidence ?? []).some((line) => /<script>|data_quality|PARTIAL/i.test(line))).toBe(false);
    });

    it('cleans server version wording for nontechnical readers', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-server-version-copy',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Audit Technique': {
            server: {
              kpi_id: 'tech_server_version',
              type: 'recommendation',
              status: 'warning',
              severity: 'medium',
              name: 'Version serveur',
              constat: 'Le serveur Apache a ete partiellement detecte, mais la version exploitable manque pour conclure son niveau de risque.',
              impact: 'Versions obsoletes exposent a des vulnerabilites connues',
              evidence_digest: {
                quality: 'PARTIAL',
                proof_lines: [
                  'Technologie detectee: Apache',
                  'Source de detection: scanner_aggregation, stack_fingerprint',
                  'Pages verifiees: 1',
                ],
              },
              recommended_action: 'Donnees insuffisantes pour conclure. Relancer le scan avec un contexte plus complet.',
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-server-version-copy', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const finding = report.axes.find((axis) => axis.id === 'technique')?.findings[0];

      expect(finding?.title).toBe('Version serveur');
      expect(finding?.description).toContain('serveur Apache');
      expect(finding?.recommendation).toContain('Verifier la configuration du serveur');
      expect(finding?.impact).not.toBe(finding?.risk);
      expect(finding?.evidenceSummary).toContain('Serveur detecte : Apache');
      expect(finding?.evidenceSummary).toContain('Version serveur : non detectee');
      expect((finding?.evidenceSummary ?? []).some((line) => /Source de detection|scanner_aggregation|stack_fingerprint/i.test(line))).toBe(false);
    });

    it('uses server context when programming language is not directly exposed', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-language-context-copy',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Audit Technique': {
            language: {
              kpi_id: 'tech_programming_language',
              type: 'recommendation',
              status: 'not_evaluated',
              severity: 'medium',
              name: 'Langage de Programmation',
              constat: 'Langage de Programmation: donnees insuffisantes pour conclure de facon fiable sur ce critere.',
              impact: 'Identifier le langage/runtime aide a cibler les correctifs de securite et les upgrades de maintenance.',
              evidence_digest: {
                quality: 'PARTIAL',
                proof_lines: [
                  'Serveur detecte: Apache',
                  'Version serveur: 2.4',
                  'Source de detection: scanner_aggregation, stack_fingerprint',
                  'Pages verifiees: 1',
                ],
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-language-context-copy', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const findings = report.axes.find((axis) => axis.id === 'technique')?.findings ?? [];

      expect(findings).toHaveLength(0);
      expect(report.recommendations.some((item) => item.source_kpi === 'tech_programming_language')).toBe(false);
      expect(report.auditCoverage).toEqual([]);
    });

    it('shows unverified module versions as to-review, not validated', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-module-version-copy',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Audit Technique': {
            modules: {
              kpi_id: 'tech_modules_versions',
              type: 'recommendation',
              status: 'passing',
              severity: null,
              name: 'Version Modules Installes',
              constat: 'Version Modules Installes: 3 modules detectes avec versions',
              evidence_digest: {
                quality: 'VALID',
                proof_lines: [
                  'Modules avec version detectee: 3',
                  'Table des modules: nom, version et source disponibles.',
                ],
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-module-version-copy', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const findings = report.axes.find((axis) => axis.id === 'technique')?.findings ?? [];

      expect(findings).toHaveLength(0);
      expect(report.recommendations.some((item) => item.source_kpi === 'tech_modules_versions')).toBe(false);
      expect(report.auditCoverage).toEqual([]);
    });

    it('uses specific privacy KPI titles instead of repeating the axis label', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-privacy-title-copy',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          RGPD: {
            consent: {
              kpi_id: 'rgpd_cookie_consent',
              type: 'compliance',
              status: 'failing',
              severity: 'high',
              name: 'C) Protection des donnees',
              constat: 'Aucun bouton de refus clair.',
              evidence_digest: {
                quality: 'VALID',
                proof_lines: ['Banniere visible sans refus symetrique.'],
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-privacy-title-copy', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const finding = report.axes.find((axis) => axis.id === 'rgpd')?.findings[0];

      expect(finding?.title).toBe('Gestion du consentement aux cookies');
      expect(finding?.title).not.toContain('Protection des donnees');
      expect(finding?.title).not.toMatch(/^[A-Z]\)/);
    });

    it('renders legacy desktop performance as a plain percentage with readable metrics', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-desktop-perf-copy',
        domain: 'https://example.com',
        domain_analysis: {},
        site_metrics: {
          performance: {
            avg_lcp_ms: 4200,
            avg_fcp_ms: 2100,
            avg_cls: 0.18,
            total_resource_size_kb: 2400,
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-desktop-perf-copy', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const finding = report.axes.find((axis) => axis.id === 'performance')?.findings.find((item) => item.id === 'perf-desktop');

      expect(finding?.title).toBe('Temps de chargement desktop');
      expect(finding?.description).toMatch(/Score desktop estime : \d+ %/);
      expect(finding?.description).toContain('contenu visible');
      expect(finding?.evidenceSummary?.join(' ')).toContain("Temps d'affichage principal");
      expect(finding?.evidenceSummary?.join(' ')).toContain('Stabilite visuelle');
      expect(finding?.description).not.toMatch(/\bLCP\b|\bCLS\b|\bKPI\b/i);
    });

    it('hides failed mobile CWV execution from client findings without fake zero score', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-mobile-cwv-missing',
        domain: 'https://example.com',
        axes: {
          Performance: {
            mobile: {
              kpi_id: 'perf_mobile_speed',
              status: 'not_evaluated',
              severity: null,
              name: 'Temps de Chargement Mobile',
              score: 0,
              constat: 'Pages testees: 2, mesures valides: 0',
              evidence: {
                pages_checked: 2,
                pages_attempted: 2,
                pages_measured: 0,
                valid_measurement_count: 0,
                failure_reason: 'mobile_cwv_measurement_failed',
                execution_status: 'failed',
                data_quality: 'MISSING',
              },
              evidence_digest: {
                quality: 'MISSING',
                proof_lines: [
                  'Pages testees: 2, mesures valides: 0',
                  'Cause technique: mobile_cwv_measurement_failed',
                  'Statut d execution: failed',
                ],
                missing_reason: 'mobile_cwv_measurement_failed',
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-mobile-cwv-missing', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const findings = report.axes.find((axis) => axis.id === 'performance')?.findings ?? [];

      expect(findings.some((item) => item.id === 'perf_mobile_speed')).toBe(false);
      expect(report.recommendations.some((item) => item.source_kpi === 'perf_mobile_speed')).toBe(false);
      expect(report.auditCoverage).toEqual([]);
    });

    it('hides form fuzzer no-signal cases from client findings', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-forms-no-signals',
        domain: 'https://example.com',
        axes: {
          'Audit Fonctionnel': {
            forms: {
              kpi_id: 'func_forms',
              status: 'non_evalue',
              severity: null,
              name: 'Les Formulaires',
              score: 0,
              constat: '122 formulaires detectes mais aucun test exploitable.',
              evidence: {
                forms_detected: 122,
                forms_tested: 0,
                tests_run: 50,
                signal_count: 0,
                anomalies_count: 0,
                execution_status: 'failed',
                failure_reason: 'form_fuzzer_no_usable_signals',
                data_quality: 'MISSING',
              },
              evidence_digest: {
                quality: 'MISSING',
                proof_lines: [
                  'Formulaires detectes/testes: 122/0',
                  'Tests executes: 50, signaux exploitables: 0',
                  'Cause technique: form_fuzzer_no_usable_signals',
                  'Qualite des donnees: MISSING',
                ],
                missing_reason: 'form_fuzzer_no_usable_signals',
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-forms-no-signals', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const findings = report.axes.find((axis) => axis.id === 'functional')?.findings ?? [];

      expect(findings.some((item) => item.id === 'func_forms')).toBe(false);
      expect(report.bugs.some((item) => item.source_kpi === 'func_forms')).toBe(false);
      expect(report.recommendations.some((item) => item.source_kpi === 'func_forms')).toBe(false);
      expect(report.auditCoverage).toEqual([]);
    });
  });
});

describe('Measured-only axis scoring', () => {
  it('keeps a perfect measured score while exposing 20 percent coverage', () => {
    const axis = {
      id: 'technique',
      name: 'Technique',
      icon: 'technique',
      score: 0,
      maxScore: 0,
      description: '',
      findings: [
        { id: 'pass', title: 'Measured pass', status: 'pass', type: 'pass', criticality: 'low', priority: 'moyen-terme', description: '', recommendation: '' },
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `nt-${index}`,
          title: `Not tested ${index}`,
          status: 'not_evaluated',
          type: 'recommendation',
          origin: 'coverage',
          criticality: 'low',
          priority: 'moyen-terme',
          description: '',
          recommendation: '',
        })),
      ],
    } as any;

    const breakdown = getAxisScoreBreakdown(axis);

    expect(breakdown.scoreMeasured).toBe(100);
    expect(breakdown.coveragePct).toBe(20);
    expect(breakdown.measuredKpis).toBe(1);
    expect(breakdown.totalKpis).toBe(5);
  });
});
