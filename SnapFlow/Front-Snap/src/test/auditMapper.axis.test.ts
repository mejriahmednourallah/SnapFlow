import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapApiResponseToReport } from '@/lib/auditMapper';
import type { ApiResponse } from '@/lib/auditMapper';

describe('Axis Mapping - normalizeAxisLabel & resolveAxisMetaKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Scanner API (api.axes) axis mapping', () => {
    it('should map "Contenu" (French) to CONTENT axis correctly', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-1',
        domain: 'https://example.com',
        axes: {
          'Contenu': {
            'quality': {
              status: 'fail',
              info: 'Content quality check',
              pages_affected: 2,
              pages_affected_urls: ['https://example.com/page1'],
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-1', { url: 'https://example.com', site_name: 'Test Site' });
      
      // Find the CONTENT axis
      const contentAxis = report.axes.find(a => a.id === 'content');
      expect(contentAxis).toBeDefined();
      expect(contentAxis?.findings.length).toBeGreaterThan(0);
      expect(contentAxis?.findings[0].title).toBe('quality');
    });

    it('should map "Check Sécurité" (French with accent) to SECURITY axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-2',
        domain: 'https://example.com',
        axes: {
          'Check Sécurité': {
            'ssl_check': {
              status: 'pass',
              info: 'SSL certificate is valid',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-2', { url: 'https://example.com', site_name: 'Test Site' });
      
      const securityAxis = report.axes.find(a => a.id === 'security');
      expect(securityAxis).toBeDefined();
      expect(securityAxis?.findings.length).toBeGreaterThan(0);
      expect(securityAxis?.findings[0].title).toBe('ssl_check');
    });

    it('should map "Audit Technique" to TECHNIQUE axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-3',
        domain: 'https://example.com',
        axes: {
          'Audit Technique': {
            'cms': {
              status: 'pass',
              info: 'CMS detected',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-3', { url: 'https://example.com', site_name: 'Test Site' });
      
      const techAxis = report.axes.find(a => a.id === 'technique');
      expect(techAxis).toBeDefined();
      expect(techAxis?.findings.length).toBeGreaterThan(0);
    });

    it('should map "Audit Fonctionnel" (French) to FUNCTIONAL axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-4',
        domain: 'https://example.com',
        axes: {
          'Audit Fonctionnel': {
            'forms': {
              status: 'fail',
              info: 'Forms have issues',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-4', { url: 'https://example.com', site_name: 'Test Site' });
      
      const funcAxis = report.axes.find(a => a.id === 'functional');
      expect(funcAxis).toBeDefined();
      expect(funcAxis?.findings.length).toBeGreaterThan(0);
    });

    it('should fallback to FUNCTIONAL for unknown axis label and log warning', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const api: ApiResponse = {
        scan_id: 'test-scan-5',
        domain: 'https://example.com',
        axes: {
          'UnknownAxisFuture': {
            'unknown_check': {
              status: 'pass',
              info: 'Unknown check',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-5', { url: 'https://example.com', site_name: 'Test Site' });
      
      // Should default to FUNCTIONAL
      const funcAxis = report.axes.find(a => a.id === 'functional');
      expect(funcAxis?.findings.some(f => f.title === 'unknown_check')).toBe(true);
      
      // Should have logged a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[auditMapper] Unknown axis label:')
      );
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Structured KPI payload axis mapping', () => {
    it('should map KPI with axis: "Contenu" to CONTENT axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-6',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'Content Quality',
            axis: 'Contenu',
            status: 'failing',
            type: 'recommendation',
            client_impact: 'medium',
            evidence: {
              summary: 'Content needs improvement',
              affected_pages: ['page1', 'page2'],
              items: [],
            },
          },
        ],
        summary: { total: 1, bugs: 0, recommendations: 1, compliance: 0, critical: 0, high: 0, medium: 1, low: 0 },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-6', { url: 'https://example.com', site_name: 'Test Site' });
      
      const contentAxis = report.axes.find(a => a.id === 'content');
      expect(contentAxis).toBeDefined();
      expect(contentAxis?.findings.length).toBeGreaterThan(0);
      expect(contentAxis?.findings[0].title).toBe('Content Quality');
    });

    it('should map KPI with axis: "CONTENT" (uppercase) to CONTENT axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-7',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'Content Standard',
            axis: 'CONTENT',
            status: 'failing',
            type: 'recommendation',
            client_impact: 'low',
            evidence: {
              summary: 'Test',
              affected_pages: [],
              items: [],
            },
          },
        ],
        summary: { total: 1, bugs: 0, recommendations: 1, compliance: 0, critical: 0, high: 0, medium: 1, low: 0 },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-7', { url: 'https://example.com', site_name: 'Test Site' });
      
      const contentAxis = report.axes.find(a => a.id === 'content');
      expect(contentAxis).toBeDefined();
      expect(contentAxis?.findings.some(f => f.title === 'Content Standard')).toBe(true);
    });

    it('should handle accented French labels in KPI axis field', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-8',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'Security Check',
            axis: 'Sécurité',
            status: 'passing',
            type: 'recommendation',
            client_impact: 'high',
            evidence: {
              summary: 'Security is good',
              affected_pages: [],
              items: [],
            },
          },
        ],
        summary: { total: 1, bugs: 0, recommendations: 0, compliance: 0, critical: 0, high: 0, medium: 0, low: 1 },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-8', { url: 'https://example.com', site_name: 'Test Site' });
      
      const securityAxis = report.axes.find(a => a.id === 'security');
      expect(securityAxis).toBeDefined();
      expect(securityAxis?.findings.some(f => f.title === 'Security Check')).toBe(true);
    });

    it('should handle UX/UI slash separator in axis field', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-9',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'UI Design Check',
            axis: 'UX/UI',
            status: 'failing',
            type: 'recommendation',
            client_impact: 'medium',
            evidence: {
              summary: 'UI needs work',
              affected_pages: [],
              items: [],
            },
          },
        ],
        summary: { total: 1, bugs: 0, recommendations: 1, compliance: 0, critical: 0, high: 0, medium: 1, low: 0 },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-9', { url: 'https://example.com', site_name: 'Test Site' });
      
      const uxAxis = report.axes.find(a => a.id === 'ux-ui');
      expect(uxAxis).toBeDefined();
      expect(uxAxis?.findings.some(f => f.title === 'UI Design Check')).toBe(true);
    });

    it('should map Audit de Contenu (French variant) to CONTENT axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-10',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'Content Audit',
            axis: 'Audit de Contenu',
            status: 'failing',
            type: 'recommendation',
            client_impact: 'high',
            evidence: {
              summary: 'Content audit found issues',
              affected_pages: [],
              items: [],
            },
          },
        ],
        summary: { total: 1, bugs: 0, recommendations: 1, compliance: 0, critical: 0, high: 0, medium: 1, low: 0 },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-10', { url: 'https://example.com', site_name: 'Test Site' });
      
      const contentAxis = report.axes.find(a => a.id === 'content');
      expect(contentAxis).toBeDefined();
      expect(contentAxis?.findings.some(f => f.title === 'Content Audit')).toBe(true);
    });
  });

  describe('EdgeCase: Mixed payload with both scanner axes and structured KPIs', () => {
    it('should handle payload with both axes and kpis (uses axes when available)', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-11',
        domain: 'https://example.com',
        axes: {
          'Contenu': {
            'content_quality': {
              status: 'fail',
              info: 'Content quality issue',
            },
          },
          'Check Sécurité': {
            'ssl': {
              status: 'pass',
              info: 'SSL is valid',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-11', { url: 'https://example.com', site_name: 'Test Site' });
      
      // Should have found both axes
      const contentAxis = report.axes.find(a => a.id === 'content');
      const securityAxis = report.axes.find(a => a.id === 'security');
      
      expect(contentAxis?.findings.length).toBeGreaterThan(0);
      expect(securityAxis?.findings.length).toBeGreaterThan(0);
    });
  });

  describe('Regression: Ensure CONTENT axis findings are not misrouted to FUNCTIONAL', () => {
    it('should not put Contenu findings in FUNCTIONAL axis', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-12',
        domain: 'https://example.com',
        axes: {
          'Contenu': {
            'text_quality': {
              status: 'fail',
              info: 'Text quality is poor',
              pages_affected: 5,
              pages_affected_urls: ['page1', 'page2'],
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-12', { url: 'https://example.com', site_name: 'Test Site' });
      
      const contentAxis = report.axes.find(a => a.id === 'content');
      const functionalAxis = report.axes.find(a => a.id === 'functional');
      
      // Content findings should be in CONTENT axis
      expect(contentAxis?.findings.some(f => f.title === 'text_quality')).toBe(true);
      
      // Content findings should NOT be in FUNCTIONAL axis
      expect(functionalAxis?.findings.some(f => f.title === 'text_quality')).toBe(false);
    });
  });

  describe('Accent stripping and normalization', () => {
    it('should normalize accented characters correctly', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-13',
        domain: 'https://example.com',
        axes: {
          'Sécurité': { // Accented
            'security_check': {
              status: 'fail',
              info: 'Security issue',
            },
          },
        },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-13', { url: 'https://example.com', site_name: 'Test Site' });
      
      const securityAxis = report.axes.find(a => a.id === 'security');
      expect(securityAxis?.findings.length).toBeGreaterThan(0);
    });

    it('should handle multiple spaces and separators', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-14',
        domain: 'https://example.com',
        kpis: [
          {
            kpi_name: 'Multi-Space Test',
            axis: 'Audit  de   Contenu', // Multiple spaces
            status: 'failing',
            type: 'recommendation',
            client_impact: 'medium',
            evidence: {
              summary: 'Test',
              affected_pages: [],
              items: [],
            },
          },
        ],
        summary: { total: 1, bugs: 0, recommendations: 1, compliance: 0, critical: 0, high: 0, medium: 1, low: 0 },
        domain_analysis: {},
        site_metrics: {},
      };

      const report = mapApiResponseToReport(api, 'audit-14', { url: 'https://example.com', site_name: 'Test Site' });
      
      const contentAxis = report.axes.find(a => a.id === 'content');
      expect(contentAxis?.findings.some(f => f.title === 'Multi-Space Test')).toBe(true);
    });
  });

  describe('Scanner KPI schema compatibility (/scan/{id}/kpis)', () => {
    it('maps V2 flat-axis KPI fields (client_summary, business_impact, scope, metrics)', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-v2-flat-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Performance et Temps de réponse': {
            lcp_homepage: {
              kpi_id: 'perf_lcp_homepage',
              name: 'LCP homepage',
              status: 'fail',
              severity: 'high',
              client_summary: 'Le Largest Contentful Paint est trop élevé sur la page d\'accueil.',
              business_impact: 'Temps de chargement long pouvant impacter la conversion.',
              scope: {
                pages_affected: 2,
                pages_affected_urls: ['https://example.com/', 'https://example.com/pricing'],
              },
              evidence: {
                sample_affected_pages: ['https://example.com/'],
              },
              metrics: {
                lcp_ms: 4200,
              },
            },
          },
        },
      };

      const report = mapApiResponseToReport(api, 'audit-v2-flat-1', {
        url: 'https://example.com',
        site_name: 'Test Site',
      });

      const perfAxis = report.axes.find((a) => a.id === 'performance');
      expect(perfAxis).toBeDefined();

      const finding = perfAxis?.findings.find((f) => f.id === 'perf_lcp_homepage');
      expect(finding).toBeDefined();
      expect(finding?.description).toContain('Largest Contentful Paint');
      expect(finding?.impact).toContain('conversion');
      expect(finding?.affectedCount).toBe(2);
      expect(finding?.exampleUrls).toContain('https://example.com/');
      expect(finding?.evidence?.some((line) => line.includes('metrics.lcp_ms'))).toBe(true);
    });

    it('maps V2 nested sous_axes -> kpis payload into the correct axis', () => {
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
                    name: 'Liens cassés',
                    status: 'warning',
                    client_summary: 'Des liens cassés ont été détectés.',
                    business_impact: 'Dégradation SEO et expérience utilisateur.',
                    scope: {
                      pages_affected: 1,
                      pages_affected_urls: ['https://example.com/catalogue'],
                    },
                    evidence: {
                      examples: ['https://example.com/catalogue'],
                    },
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

      const seoAxis = report.axes.find((a) => a.id === 'seo');
      const functionalAxis = report.axes.find((a) => a.id === 'functional');

      expect(seoAxis).toBeDefined();
      expect(seoAxis?.findings.some((f) => f.id === 'seo_broken_links')).toBe(true);
      expect(seoAxis?.findings.find((f) => f.id === 'seo_broken_links')?.status).toBe('fail');
      expect(functionalAxis?.findings.some((f) => f.id === 'seo_broken_links')).toBe(false);
    });

    it('keeps legacy V1 scanner fields mapped when V2 fields are absent', () => {
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

      const securityAxis = report.axes.find((a) => a.id === 'security');
      const finding = securityAxis?.findings.find((f) => f.title === 'csp_header');

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
    it('prefers backend recommended_action over generic fallback recommendation', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-reco-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          'Check Sécurité': {
            ssl: {
              kpi_id: 'sec_ssl',
              status: 'failing',
              severity: 'critical',
              name: 'SSL',
              client_summary: 'Certificat invalide',
              business_impact: 'Risque de sécurité',
              recommended_action: 'Renouveler le certificat SSL avant expiration.',
              recommendation_source: 'fix',
              scope: {
                pages_affected: 1,
                pages_affected_urls: ['https://example.com'],
              },
              evidence_digest: {
                summary: 'Le certificat est invalide.',
                top_urls: ['https://example.com'],
              },
              evidence: {
                source: ['ssl_probe'],
                examples: [],
              },
              metrics: {},
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

    it('does not expose raw JSON-like strings in mapped evidence summaries', () => {
      const api: ApiResponse = {
        scan_id: 'test-scan-evidence-1',
        domain: 'https://example.com',
        report_version: 'v2',
        axes: {
          SEO: {
            meta: {
              kpi_id: 'seo_meta',
              status: 'failing',
              severity: 'high',
              name: 'Balises META',
              client_summary: 'Des meta descriptions sont manquantes.',
              business_impact: 'Perte de CTR',
              scope: {
                pages_affected: 2,
                pages_affected_urls: ['https://example.com/a', 'https://example.com/b'],
              },
              evidence: {
                detail: {
                  payload: {
                    nested: { value: 42 },
                  },
                },
                examples: [],
              },
              metrics: {
                detail: {
                  payload: {
                    nested: { value: 42 },
                  },
                },
              },
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

      const evidenceLines = finding?.evidence ?? [];
      expect(evidenceLines.length).toBeGreaterThan(0);
      expect(evidenceLines.some((line) => line.includes('{"'))).toBe(false);
      expect(evidenceLines.some((line) => line.includes('[object Object]'))).toBe(false);
    });
  });
});
