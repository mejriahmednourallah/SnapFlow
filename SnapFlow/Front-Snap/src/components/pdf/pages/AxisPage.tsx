import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData, AuditAxisItem, AuditFindingItem } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles, getStatusColor } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';
import { estimateLines, packFindingsWithRebalance, rebalanceShortTailPages } from '../shared/pagination';

interface AxisPageProps {
  report: AuditDocumentData;
  axis: AuditAxisItem;
  index: number;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

function findingStatus(finding: AuditFindingItem) {
  if (finding.status === 'pass') return 'success' as const;
  if (finding.type === 'bug' || finding.criticality === 'critical' || finding.criticality === 'high') return 'danger' as const;
  return 'warning' as const;
}

function findingBadgeLabel(finding: AuditFindingItem) {
  if (finding.status === 'pass') return 'OK';
  return finding.type === 'bug' ? 'ANOMALIE' : 'RECO';
}

function ConformingControlsTable({
  findings,
  theme,
}: {
  findings: AuditFindingItem[];
  theme?: PdfTheme;
}) {
  if (findings.length === 0) return null;

  const t = theme ?? undefined;
  const rows: AuditFindingItem[][] = [];
  for (let i = 0; i < findings.length; i += 2) {
    rows.push(findings.slice(i, i + 2));
  }

  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ fontSize: 11.2, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827', marginBottom: 5 }}>
        Contrôles conformes
      </Text>
      <View
        style={{
          borderWidth: 0.7,
          borderColor: t?.border ?? '#D7E0EA',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {rows.map((row, rowIndex) => (
          <View
            key={`ok-row-${rowIndex}`}
            style={{
              flexDirection: 'row',
              backgroundColor: rowIndex % 2 === 0 ? '#FFFFFF' : (t?.bg ?? '#F8FAFC'),
              borderBottomWidth: rowIndex === rows.length - 1 ? 0 : 0.5,
              borderBottomColor: t?.border ?? '#D7E0EA',
            }}
          >
            {row.map((finding) => (
              <View
                key={`ok-${finding.id}`}
                style={{
                  width: '50%',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingVertical: 5,
                  paddingHorizontal: 7,
                  borderRightWidth: row.length === 2 && row[0].id === finding.id ? 0.5 : 0,
                  borderRightColor: t?.border ?? '#D7E0EA',
                }}
              >
                <Text style={{ fontSize: 8.4, color: '#16A34A', fontFamily: 'DMSans', fontWeight: 700 }}>
                  OK
                </Text>
                <Text style={{ flex: 1, fontSize: 8.8, color: t?.text ?? '#111827', lineHeight: 1.22 }}>
                  {finding.title}
                </Text>
              </View>
            ))}
            {row.length === 1 ? <View style={{ width: '50%' }} /> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

function EvidenceTable({ finding, theme }: { finding: AuditFindingItem; theme?: PdfTheme }) {
  const t = theme ?? undefined;
  const evidenceRows = finding.pdfEvidenceRows.slice(0, 3);
  if (evidenceRows.length === 0) return null;

  return (
    <View style={{ marginTop: 5, padding: 6, backgroundColor: t?.bg ?? '#F8FAFC', borderRadius: 5 }}>
      <Text style={{ fontSize: 8.8, fontFamily: 'DMSans', fontWeight: 700, marginBottom: 3 }}>
        Données observées
      </Text>
      {evidenceRows.map((row, evidenceIndex) => (
          <View
            key={`${finding.id}-evidence-${evidenceIndex}`}
            style={{
              flexDirection: 'row',
              borderTopWidth: evidenceIndex === 0 ? 0 : 0.4,
              borderTopColor: t?.border ?? '#D7E0EA',
              paddingTop: evidenceIndex === 0 ? 0 : 3,
              marginTop: evidenceIndex === 0 ? 0 : 3,
            }}
          >
            <Text style={{ width: '34%', fontSize: 8.7, color: t?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 700 }}>
              {row.label}
            </Text>
            <Text style={{ width: '66%', fontSize: 8.7, color: t?.textMuted ?? '#64748B', lineHeight: 1.28 }}>
              {row.value}
            </Text>
          </View>
      ))}
    </View>
  );
}

export function AxisPage({ report, axis, index, theme, clientLogoSrc }: AxisPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const actionFindings = axis.findings.filter((finding) => finding.status !== 'pass');
  const okFindings = axis.findings.filter((finding) => finding.status === 'pass');

  const okTableHeight = okFindings.length > 0 ? 30 + Math.ceil(okFindings.length / 2) * 18 : 0;
  const summaryHeight = 84 + okTableHeight;
  const PAGE_CAP = 704;
  const FIRST_PAGE_CAP = Math.max(170, PAGE_CAP - summaryHeight);

  const estimateFindingHeight = (finding: AuditFindingItem) => {
    const titleLines = estimateLines(finding.title, 58);
    const descLines = estimateLines(finding.pdfConstat, 76);
    const recLines = estimateLines(finding.pdfAction, 78);
    const impactLines = estimateLines(finding.pdfImpact, 78);
    const evidenceLines = finding.pdfEvidenceRows.slice(0, 3).reduce((sum, row) => sum + estimateLines(`${row.label}: ${row.value}`, 82), 0);
    return 58 + (titleLines + descLines + recLines + impactLines + evidenceLines) * 11.2;
  };

  const findingPages = actionFindings.length > 0
    ? rebalanceShortTailPages(
      packFindingsWithRebalance(actionFindings, estimateFindingHeight, FIRST_PAGE_CAP, PAGE_CAP, 0.58),
      {
        minItemsOnLastPage: 2,
        minItemsOnPreviousPage: 1,
        heightFor: estimateFindingHeight,
        maxPageHeight: PAGE_CAP,
      },
    )
    : [[]];

  const pages = findingPages.map((findings, pageIndex) => ({
    findings,
    showSummary: pageIndex === 0,
  }));

  return (
    <>
      {pages.map((page, pageIndex) => (
        <Page key={`${axis.id}-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader
            title={`${String(index + 1).padStart(2, '0')} ${axis.name}`}
            siteName={report.siteName}
            subtitle="Analyse détaillée par axe"
            theme={theme}
            siteLogoSrc={clientLogoSrc}
          />

          <View style={s.body}>
            {page.showSummary ? (
              <>
                <View style={{ ...s.card, marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <SectionTitle title={axis.name} theme={theme} />
                      <Text style={{ ...s.bodyText, marginBottom: 6 }}>{axis.description}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                        <StatusBadge label={`OK ${axis.score.passed}`} status="success" />
                        <StatusBadge label={`À traiter ${axis.score.failed}`} status={axis.score.failed > 0 ? 'danger' : 'success'} />
                        <StatusBadge label={`${axis.score.measuredKpis} contrôles mesurés`} status={axis.score.status} />
                      </View>
                    </View>
                    <View
                      style={{
                        width: 116,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 9,
                        backgroundColor: t?.bg ?? '#F8FAFC',
                        paddingVertical: 8,
                      }}
                    >
                      <Text style={{ fontSize: 26, color: getStatusColor(axis.score.status), fontFamily: 'DMSans', fontWeight: 700 }}>
                        {axis.score.scoreMeasured === null ? 'N/C' : axis.score.scoreMeasured}
                      </Text>
                      <Text style={{ fontSize: 9, color: t?.textMuted ?? '#64748B', marginTop: 1 }}>
                        {axis.score.scoreMeasured === null ? 'Score non calculable' : 'score mesuré'}
                      </Text>
                    </View>
                  </View>
                </View>

                <ConformingControlsTable findings={okFindings} theme={theme} />
              </>
            ) : null}

            {page.findings.length > 0 ? (
              <View style={{ ...s.card, paddingVertical: 9 }}>
                <Text style={{ ...s.h3, fontSize: 13.2 }}>Constats prioritaires</Text>
                {page.findings.map((finding, findingIndex) => (
                  <View
                    key={`finding-${finding.id}`}
                    wrap={false}
                    style={{
                      borderBottomWidth: findingIndex === page.findings.length - 1 ? 0 : 0.5,
                      borderBottomColor: t?.border ?? '#D7E0EA',
                      paddingBottom: findingIndex === page.findings.length - 1 ? 0 : 7,
                      marginBottom: findingIndex === page.findings.length - 1 ? 0 : 7,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
                      <Text style={{ fontSize: 11.2, fontFamily: 'DMSans', fontWeight: 700, width: '72%', lineHeight: 1.24 }}>
                        {finding.title}
                      </Text>
                      <StatusBadge label={findingBadgeLabel(finding)} status={findingStatus(finding)} />
                    </View>
                    <Text style={{ fontSize: 9.7, color: t?.textMuted ?? '#64748B', marginBottom: 5, lineHeight: 1.38 }}>
                      {finding.pdfConstat}
                    </Text>
                    <Text style={{ fontSize: 9.4, color: t?.text ?? '#111827', lineHeight: 1.36 }}>
                      Action: {finding.pdfAction}
                    </Text>
                    <Text style={{ fontSize: 9.2, color: t?.textMuted ?? '#64748B', lineHeight: 1.34, marginTop: 2 }}>
                      Impact: {finding.pdfImpact}
                    </Text>
                    <EvidenceTable finding={finding} theme={theme} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <PageFooter preparedBy={report.preparedBy} theme={theme} />
        </Page>
      ))}
    </>
  );
}
