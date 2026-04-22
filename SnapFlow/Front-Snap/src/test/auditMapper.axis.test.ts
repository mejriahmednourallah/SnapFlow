import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapApiResponseToReport } from '@/lib/auditMapper';
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
      expect(finding?.description).toContain('Largest Contentful Paint');
      expect(finding?.impact).toContain('conversion');
      expect(finding?.affectedCount).toBe(2);
      expect(finding?.exampleUrls).toContain('https://example.com/');
      expect(finding?.recommendation).toContain('Optimiser');
      expect(finding?.evidence?.some((line) => line.includes('evidence.lcp_ms'))).toBe(true);
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
      expect(finding?.description).toContain('Content-Security-Policy');
      expect(finding?.impact).toContain('XSS');
      expect(finding?.origin).toBe('bug');
      expect(finding?.affectedCount).toBe(1);
      expect(finding?.exampleUrls).toContain('https://example.com/login');
      expect(finding?.evidence?.some((line) => line.includes('metrics.missing_headers'))).toBe(true);
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
      expect(finding?.recommendation).toBe('Renouveler le certificat SSL avant expiration.');
      expect(finding?.recommendationSource).toBe('fix');
    });

    it('keeps full evidence in evidenceRaw while showing compact previews', () => {
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
      expect((finding?.evidenceRaw as any)?.evidence?.meta_missing_urls_all).toHaveLength(3);
      expect((finding?.evidence ?? []).some((line) => line.includes('[object Object]'))).toBe(false);
    });

    it('keeps full anomalous fuzz payloads in evidenceRaw and readable previews in evidence', () => {
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
      expect((finding?.evidenceRaw as any)?.evidence?.anomalous_tests_all?.[0]?.payload).toEqual({
        message: '<script>alert(1)</script>',
      });
      expect((finding?.evidence ?? []).some((line) => line.includes('xss_payload') || line.includes('server_error'))).toBe(true);
    });
  });
});
