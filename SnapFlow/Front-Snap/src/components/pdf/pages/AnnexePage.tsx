import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData, AuditFindingItem } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';
import { estimateLines, paginateByHeight, paginateByHeightWithInitial } from '../shared/pagination';

interface AnnexePageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

function findingStatus(status: string) {
  if (status === 'pass') return 'success' as const;
  if (status === 'not_measured' || status === 'not_evaluated' || status === 'not_available') return 'warning' as const;
  return 'danger' as const;
}

function findingBadgeLabel(finding: AuditFindingItem) {
  if (finding.status === 'pass') return 'OK';
  if (finding.status === 'not_available' || finding.status === 'not_measured' || finding.status === 'not_evaluated') return 'NON TESTÉ';
  return finding.type === 'bug' ? 'ANOMALIE' : 'ACTION';
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
    return 'Donnee structuree disponible dans la version interactive de l audit.';
  }

  return normalized
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
    .replace(/\bJS\b/g, 'JavaScript');
}

function buildEvidenceList(finding: AuditFindingItem) {
  const raw: string[] = [];
  if (finding.page) raw.push(`Page: ${finding.page}`);
  if (finding.page && finding.page !== finding.pageUrl && finding.pageUrl) {
    raw.push(`Page: ${finding.pageUrl}`);
  }
  if (!finding.page && finding.pageUrl) raw.push(`Page: ${finding.pageUrl}`);
  if (finding.impact) raw.push(`Impact: ${finding.impact}`);
  if (typeof finding.affectedCount === 'number') raw.push(`Pages ou elements a verifier: ${finding.affectedCount}`);
  if (Array.isArray(finding.evidence)) raw.push(...finding.evidence);
  if (Array.isArray(finding.annexes)) raw.push(...finding.annexes);
  if (Array.isArray(finding.exampleUrls)) raw.push(...finding.exampleUrls.map((url) => `Page: ${url}`));

  const unique = Array.from(new Set(raw.map((item) => normalizeEvidenceEntry(item)).filter(Boolean)));
  return unique;
}

export function AnnexePage({ report, theme, clientLogoSrc }: AnnexePageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const axisHeaderHeight = 26;
  const pageCap = 500;

  const estimateFindingHeight = (finding: AuditFindingItem) => {
    const evidence = buildEvidenceList(finding);
    const titleLines = estimateLines(finding.title, 60);
    const descLines = estimateLines(finding.description, 90);
    const evidenceLines = Math.max(1, evidence.length);
    return 52 + (titleLines + descLines) * 9 + evidenceLines * 9;
  };

  const axisChunks = report.axes.flatMap((axis) => {
    const chunks = paginateByHeight(axis.findings, estimateFindingHeight, pageCap - axisHeaderHeight - 12);
    return chunks.length > 0
      ? chunks.map((chunk) => ({ axis, findings: chunk }))
      : [{ axis, findings: [] }];
  });

  const chunkPages = paginateByHeightWithInitial(
    axisChunks,
    (chunk) => axisHeaderHeight + chunk.findings.reduce((sum, finding) => sum + estimateFindingHeight(finding), 0) + 8,
    pageCap - 28,
    pageCap,
  );

  return (
    <>
      {chunkPages.map((chunks, pageIndex) => (
        <Page key={`annexe-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader title="Annexes - preuves des contrôles" siteName={report.siteName} theme={theme} siteLogoSrc={clientLogoSrc} />

          <View style={s.body}>
            {pageIndex === 0 ? <SectionTitle title="Preuves et localisation des anomalies" theme={theme} /> : null}

            {chunks.map((chunk, chunkIndex) => (
              <View key={`annexe-${chunk.axis.id}-${chunkIndex}`} style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 11, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827', marginBottom: 6 }}>
                  {chunk.axis.name}
                </Text>

                {chunk.findings.map((finding) => {
                  const evidence = buildEvidenceList(finding);
                  return (
                    <View
                      key={`annexe-item-${finding.id}`}
                      style={{
                        ...s.card,
                        padding: 10,
                        marginBottom: 8,
                        borderLeftWidth: 3,
                        borderLeftColor: t?.border ?? '#D7E0EA',
                      }}
                      wrap={false}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ fontSize: 9.2, fontFamily: 'DMSans', fontWeight: 700, width: '72%' }}>{finding.title}</Text>
                        <StatusBadge label={findingBadgeLabel(finding)} status={findingStatus(finding.status)} />
                      </View>
                      <Text style={{ fontSize: 8.1, color: t?.textMuted ?? '#64748B', marginBottom: 6 }}>{finding.description}</Text>

                      <Text style={{ fontSize: 7.8, color: t?.textMuted ?? '#64748B', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
                        Preuves
                      </Text>
                      {evidence.length > 0 ? (
                        evidence.map((item) => (
                          <Text key={`${finding.id}-${item}`} style={{ fontSize: 8.2, color: t?.text ?? '#111827', marginBottom: 2 }}>
                            - {item}
                          </Text>
                        ))
                      ) : (
                        <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B' }}>Aucune preuve fournie</Text>
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
