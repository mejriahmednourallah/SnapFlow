import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData, AuditAxisItem } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles, getStatusColor } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';
import { estimateLines, paginateByHeight } from '../shared/pagination';

interface KpiGridPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

function cardStatusLabel(axis: AuditAxisItem) {
  if (axis.score.status === 'danger') return 'Critique';
  if (axis.score.status === 'warning') return 'Alerte';
  return 'Bon';
}

export function KpiGridPage({ report, theme, clientLogoSrc }: KpiGridPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const axes = report.axes;
  const rows: Array<[AuditAxisItem, AuditAxisItem | null]> = [];
  for (let i = 0; i < axes.length; i += 2) {
    rows.push([axes[i], axes[i + 1] ?? null]);
  }

  const estimateCardHeight = (axis: AuditAxisItem) => {
    const titleLines = estimateLines(axis.name, 26);
    const descLines = estimateLines(axis.description, 90);
    return 92 + (titleLines + descLines) * 9;
  };

  const estimateRowHeight = (row: [AuditAxisItem, AuditAxisItem | null]) => {
    const left = estimateCardHeight(row[0]);
    const right = row[1] ? estimateCardHeight(row[1]) : 0;
    return Math.max(left, right) + 10;
  };

  const rowPages = paginateByHeight(rows, estimateRowHeight, 500);

  return (
    <>
      {rowPages.map((pageRows, pageIndex) => (
        <Page key={`kpi-grid-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader title="Grille KPI" siteName={report.siteName} theme={theme} siteLogoSrc={clientLogoSrc} />

          <View style={s.body}>
            <SectionTitle title="Tableau de score par axe" theme={theme} />
            {pageRows.map((row, rowIndex) => (
              <View key={`row-${pageIndex}-${rowIndex}`} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                {[row[0], row[1]].map((axis) => (
                  axis ? (
                    <View
                      key={axis.id}
                      style={{
                        ...s.card,
                        width: '48.5%',
                        borderLeftWidth: 4,
                        borderLeftColor: getStatusColor(axis.score.status),
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Text style={{ fontSize: 10.5, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827', width: '70%' }}>
                          {axis.name}
                        </Text>
                        <StatusBadge label={cardStatusLabel(axis)} status={axis.score.status} />
                      </View>
                      <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B', marginBottom: 8 }}>{axis.description}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                          <Text style={{ fontSize: 30, color: getStatusColor(axis.score.status), fontFamily: 'DMSans', fontWeight: 700 }}>
                            {axis.score.value}
                          </Text>
                          <Text style={{ fontSize: 14, color: getStatusColor(axis.score.status), fontFamily: 'DMSans', fontWeight: 700 }}>%</Text>
                        </View>
                        <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B', textAlign: 'right' }}>/100</Text>
                      </View>
                    </View>
                  ) : (
                    <View key={`empty-${rowIndex}`} style={{ width: '48.5%' }} />
                  )
                ))}
              </View>
            ))}
          </View>

          <PageFooter preparedBy={report.preparedBy} theme={theme} />
        </Page>
      ))}
    </>
  );
}
