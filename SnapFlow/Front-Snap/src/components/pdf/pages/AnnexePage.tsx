import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData, AuditFindingItem } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';
import { estimateLines, paginateByHeight, paginateByHeightWithInitial, rebalanceShortTailPages } from '../shared/pagination';

interface AnnexePageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

const MAX_ANNEXE_EVIDENCE_ROWS = 6;

function findingStatus(finding: AuditFindingItem) {
  if (finding.type === 'bug' || finding.criticality === 'critical' || finding.criticality === 'high') return 'danger' as const;
  return 'warning' as const;
}

function findingBadgeLabel(finding: AuditFindingItem) {
  return finding.type === 'bug' ? 'ANOMALIE' : 'ACTION';
}

function splitEvidenceLine(line: string): { label: string; value: string } | null {
  const idx = line.indexOf(':');
  if (idx <= 0 || idx > 48) return null;
  const label = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (!label || !value) return null;
  return { label, value };
}

function normalizeEvidenceEntry(value: string): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const jsonLike =
    normalized.startsWith('{') ||
    normalized.startsWith('[') ||
    /\{.*:.*\}/.test(normalized) ||
    (normalized.includes('"') && normalized.includes('{'));

  if (jsonLike) {
    return 'Donnée structurée disponible dans la version interactive de l audit.';
  }

  return normalized
    .replace(/\bKPI\b/gi, 'indicateur')
    .replace(/Largest Contentful Paint/gi, "temps d'affichage principal")
    .replace(/\bLCP\b/g, "temps d'affichage principal")
    .replace(/\bFCP\b/g, 'premier affichage visible')
    .replace(/\bCLS\b/g, 'stabilité visuelle')
    .replace(/\bCVE\b/gi, 'vulnérabilité connue')
    .replace(/\bCMS\b/g, 'système de gestion du site')
    .replace(/\bSSL\b/g, 'certificat de sécurité')
    .replace(/\bRGPD\b/gi, 'protection des données')
    .replace(/\bSEO\b/gi, 'SEO')
    .replace(/\bJS\b/g, 'JavaScript');
}

export function hasUsefulAnnexeEvidence(finding: AuditFindingItem) {
  if (finding.status === 'pass') return false;
  return Boolean(
    finding.page ||
    finding.pageUrl ||
    finding.pdfImpact ||
    finding.pdfEvidenceRows.length > 0 ||
    typeof finding.affectedCount === 'number' ||
    finding.evidence.length > 0 ||
    finding.annexes.length > 0 ||
    finding.exampleUrls.length > 0,
  );
}

function buildEvidenceList(finding: AuditFindingItem) {
  const raw: string[] = [];
  if (finding.page) raw.push(`Page: ${finding.page}`);
  if (finding.page && finding.page !== finding.pageUrl && finding.pageUrl) {
    raw.push(`URL canonique: ${finding.pageUrl}`);
  }
  if (!finding.page && finding.pageUrl) raw.push(`Page: ${finding.pageUrl}`);
  if (typeof finding.affectedCount === 'number') raw.push(`Pages ou éléments concernés: ${finding.affectedCount}`);
  if (finding.pdfAction) raw.push(`Action: ${finding.pdfAction}`);
  if (finding.pdfImpact) raw.push(`Impact: ${finding.pdfImpact}`);
  if (Array.isArray(finding.pdfEvidenceRows)) {
    raw.push(...finding.pdfEvidenceRows.map((row) => `${row.label}: ${row.value}`));
  }
  if (Array.isArray(finding.evidence)) raw.push(...finding.evidence);
  if (Array.isArray(finding.annexes)) raw.push(...finding.annexes);
  if (Array.isArray(finding.exampleUrls)) raw.push(...finding.exampleUrls.map((url) => `Page concernée: ${url}`));
  if (finding.extraExampleUrlCount > 0) {
    raw.push(`Pages supplémentaires: +${finding.extraExampleUrlCount} autres pages disponibles dans les données brutes.`);
  }

  const unique = Array.from(new Set(raw.map((item) => normalizeEvidenceEntry(item)).filter(Boolean)));
  const visible = unique.slice(0, MAX_ANNEXE_EVIDENCE_ROWS);
  const hidden = unique.length - visible.length;
  if (hidden > 0) {
    visible.push(`Preuves supplémentaires: +${hidden} lignes disponibles dans les données brutes.`);
  }
  return visible;
}

export function AnnexePage({ report, theme, clientLogoSrc }: AnnexePageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const axisHeaderHeight = 18;
  const pageCap = 704;

  const estimateFindingHeight = (finding: AuditFindingItem) => {
    const evidence = buildEvidenceList(finding);
    const titleLines = estimateLines(finding.title, 62);
    const descLines = estimateLines(finding.pdfConstat, 92);
    const evidenceLines = Math.max(1, evidence.length);
    return 48 + (titleLines + descLines) * 9.4 + evidenceLines * 11.8;
  };

  const axisChunks = report.axes.flatMap((axis) => {
    const findings = axis.findings.filter(hasUsefulAnnexeEvidence);
    if (findings.length === 0) return [];
    const chunks = paginateByHeight(findings, estimateFindingHeight, pageCap - axisHeaderHeight - 6);
    return chunks.map((chunk) => ({ axis, findings: chunk }));
  });

  if (axisChunks.length === 0) return null;

  const chunkHeight = (chunk: (typeof axisChunks)[number]) =>
    axisHeaderHeight + chunk.findings.reduce((sum, finding) => sum + estimateFindingHeight(finding), 0) + 4;

  const rawChunkPages = paginateByHeightWithInitial(
    axisChunks,
    chunkHeight,
    pageCap - 28,
    pageCap,
  ).filter((chunks) => chunks.some((chunk) => chunk.findings.length > 0));
  const chunkPages = rebalanceShortTailPages(rawChunkPages, {
    minItemsOnLastPage: 2,
    minItemsOnPreviousPage: 1,
    heightFor: chunkHeight,
    maxPageHeight: pageCap,
  });

  if (chunkPages.length === 0) return null;

  return (
    <>
      {chunkPages.map((chunks, pageIndex) => (
        <Page key={`annexe-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader title="Annexes - preuves des contrôles" siteName={report.siteName} theme={theme} siteLogoSrc={clientLogoSrc} />

          <View style={s.body}>
            {pageIndex === 0 ? <SectionTitle title="Preuves utiles et localisation" theme={theme} /> : null}

            {chunks.map((chunk, chunkIndex) => (
              <View key={`annexe-${chunk.axis.id}-${chunkIndex}`} style={{ marginBottom: 7 }}>
                <Text style={{ fontSize: 11.2, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827', marginBottom: 4 }}>
                  {chunk.axis.name}
                </Text>

                {chunk.findings.map((finding) => {
                  const evidence = buildEvidenceList(finding);
                  return (
                    <View
                      key={`annexe-item-${finding.id}`}
                      wrap={false}
                      style={{
                        ...s.card,
                        padding: 7,
                        marginBottom: 6,
                        borderLeftWidth: 3,
                        borderLeftColor: t?.accent ?? '#4E8CCF',
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontSize: 9.8, fontFamily: 'DMSans', fontWeight: 700, width: '72%', lineHeight: 1.22 }}>{finding.title}</Text>
                        <StatusBadge label={findingBadgeLabel(finding)} status={findingStatus(finding)} />
                      </View>
                      <Text style={{ fontSize: 8.7, color: t?.textMuted ?? '#64748B', marginBottom: 5, lineHeight: 1.26 }}>{finding.pdfConstat}</Text>

                      <Text style={{ fontSize: 8.6, color: t?.textMuted ?? '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                        Données observées
                      </Text>
                      {evidence.length > 0 ? (
                        evidence.map((item) => {
                          const split = splitEvidenceLine(item);
                          return split ? (
                            <View
                              key={`${finding.id}-${item}`}
                              style={{
                                flexDirection: 'row',
                                borderTopWidth: 0.4,
                                borderTopColor: t?.border ?? '#D7E0EA',
                                paddingTop: 2.2,
                                marginTop: 1.6,
                              }}
                            >
                              <Text style={{ width: '32%', fontSize: 8.6, color: t?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 700 }}>
                                {split.label}
                              </Text>
                              <Text style={{ width: '68%', fontSize: 8.6, color: t?.textMuted ?? '#64748B', lineHeight: 1.28 }}>
                                {split.value}
                              </Text>
                            </View>
                          ) : (
                            <Text key={`${finding.id}-${item}`} style={{ fontSize: 8.7, color: t?.text ?? '#111827', marginBottom: 2, lineHeight: 1.28 }}>
                              {item}
                            </Text>
                          );
                        })
                      ) : (
                        <Text style={{ fontSize: 8.8, color: t?.textMuted ?? '#64748B' }}>Aucune preuve courte disponible.</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>

          <PageFooter preparedBy={report.preparedBy} theme={theme} />
        </Page>
      ))}
    </>
  );
}
