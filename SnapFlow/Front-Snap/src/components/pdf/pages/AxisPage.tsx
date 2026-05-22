import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData, AuditAxisItem } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { ScoreGauge } from '../shared/ScoreGauge';
import { StatusBadge } from '../shared/StatusBadge';
import { estimateLines, packFindingsWithRebalance } from '../shared/pagination';

interface AxisPageProps {
  report: AuditDocumentData;
  axis: AuditAxisItem;
  index: number;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

function findingStatus(status: string) {
  if (status === 'pass') return 'success' as const;
  if (status === 'not_measured' || status === 'not_evaluated' || status === 'not_available') return 'warning' as const;
  return 'danger' as const;
}

function findingBadgeLabel(finding: AuditAxisItem['findings'][number]) {
  if (finding.status === 'pass') return 'OK';
  if (finding.status === 'not_available' || finding.status === 'not_measured' || finding.status === 'not_evaluated') return 'NON TESTÉ';
  return finding.type === 'bug' ? 'ANOMALIE' : 'RECO';
}

export function AxisPage({ report, axis, index, theme, clientLogoSrc }: AxisPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const subKpis = axis.findings;
  const PAGE_CAP = 460;

  const estimateSummaryHeight = () => {
    const descLines = estimateLines(axis.description, 80);
    const subKpiLines = subKpis.reduce((sum, finding) => sum + estimateLines(finding.title, 60), 0);
    const subKpiRows = subKpis.length;
    return 170 + descLines * 10 + subKpiRows * 18 + Math.max(0, subKpiLines - subKpiRows) * 7;
  };

  const FIRST_PAGE_CAP = Math.max(140, PAGE_CAP - estimateSummaryHeight());

  const estimateFindingHeight = (finding: AuditAxisItem['findings'][number]) => {
    const titleLines = estimateLines(finding.title, 52);
    const descLines = estimateLines(finding.description, 70);
    const recLines = finding.status !== 'pass' ? estimateLines(finding.recommendation, 70) : 0;
    const impactLines = finding.status !== 'pass' ? estimateLines(finding.impact, 70) : 0;
    return 54 + (titleLines + descLines + recLines + impactLines) * 11;
  };

  const findingPages = packFindingsWithRebalance(axis.findings, estimateFindingHeight, FIRST_PAGE_CAP, PAGE_CAP, 0.7);

  const pages = (findingPages.length ? findingPages : [[]]).map((findings, pageIndex) => ({
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
                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
                  <View style={{ ...s.card, flex: 1, paddingVertical: 10 }}>
                    <SectionTitle title={axis.name} theme={theme} />
                    <Text style={s.bodyText}>{axis.description}</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <StatusBadge label={`Conformes ${axis.score.passed}`} status="success" />
                      <StatusBadge label={`Échecs ${axis.score.failed}`} status="danger" />
                      <StatusBadge label={`Non testé ${axis.score.notMeasured + axis.score.notAvailable}`} status="warning" />
                    </View>
                  </View>
                  <View style={{ ...s.card, width: 172, alignItems: 'center', paddingVertical: 10 }}>
                    <ScoreGauge
                      score={axis.score.value}
                      status={axis.score.status}
                      caption={`${axis.score.x}/${axis.score.y}`}
                      size={124}
                      theme={theme}
                    />
                  </View>
                </View>

                <View style={{ ...s.card, marginBottom: 8, paddingVertical: 10 }}>
                  <Text style={s.h3}>Sous-controles</Text>
                  {(() => {
                    const rows: AuditAxisItem['findings'][][] = [];
                    for (let i = 0; i < subKpis.length; i += 2) {
                      rows.push(subKpis.slice(i, i + 2));
                    }
                    return rows.map((row, idx) => (
                      <View key={`kpi-row-${idx}`} style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
                        {row.map((finding) => (
                          <View
                            key={`kpi-${finding.id}`}
                            style={{
                              flex: 1,
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              paddingVertical: 5,
                              borderBottomWidth: 0.5,
                              borderBottomColor: t?.border ?? '#D7E0EA',
                            }}
                            wrap={false}
                          >
                            <Text style={{ fontSize: 8.4, color: t?.text ?? '#111827', width: '72%' }}>
                              {finding.title}
                            </Text>
                            <StatusBadge label={findingBadgeLabel(finding)} status={findingStatus(finding.status)} />
                          </View>
                        ))}
                        {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                      </View>
                    ));
                  })()}
                </View>
              </>
            ) : null}

            <View style={{ ...s.card, paddingVertical: 10 }}>
              <Text style={s.h3}>Constats et impacts</Text>
              {page.findings.map((finding) => (
                <View
                  key={`finding-${finding.id}`}
                  style={{
                    borderBottomWidth: 0.5,
                    borderBottomColor: t?.border ?? '#D7E0EA',
                    paddingBottom: 6,
                    marginBottom: 6,
                  }}
                  wrap={false}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={{ fontSize: 9.2, fontFamily: 'DMSans', fontWeight: 700, width: '72%' }}>
                      {finding.title}
                    </Text>
                    <StatusBadge label={findingBadgeLabel(finding)} status={findingStatus(finding.status)} />
                  </View>
                  <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B', marginBottom: 4 }}>
                    {finding.description}
                  </Text>
                  {finding.status !== 'pass' ? (
                    <Text style={{ fontSize: 8.2, color: t?.text ?? '#111827' }}>
                      Recommandation: {finding.recommendation}
                    </Text>
                  ) : null}
                  {finding.status !== 'pass' ? (
                    <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B' }}>
                      Impact: {finding.impact}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>

          <PageFooter preparedBy={report.preparedBy} theme={theme} />
        </Page>
      ))}
    </>
  );
}
