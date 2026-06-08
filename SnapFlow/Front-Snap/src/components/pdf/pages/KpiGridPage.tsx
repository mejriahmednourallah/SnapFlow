import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData, AuditAxisItem } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles, getStatusColor } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';

interface KpiGridPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

function cardStatusLabel(axis: AuditAxisItem) {
  if (axis.score.scoreMeasured === null) return 'Non calc.';
  if (axis.score.status === 'danger') return 'Critique';
  if (axis.score.status === 'warning') return 'Alerte';
  return 'Bon';
}

export function KpiGridPage({ report, theme, clientLogoSrc }: KpiGridPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const axes = report.axes;
  const columns = axes.length > 9 && axes.length <= 10 ? 2 : 3;
  const rowsPerPage = axes.length > 9 && axes.length <= 10 ? 5 : 3;
  const cardMinHeight = columns === 2 ? 93 : 128;
  const cardPadding = columns === 2 ? 7 : 8;
  const titleWidth = columns === 2 ? '70%' : '64%';
  const rows: AuditAxisItem[][] = [];
  for (let i = 0; i < axes.length; i += columns) {
    rows.push(axes.slice(i, i + columns));
  }

  const rowPages: AuditAxisItem[][][] = [];
  for (let i = 0; i < rows.length; i += rowsPerPage) {
    rowPages.push(rows.slice(i, i + rowsPerPage));
  }

  return (
    <>
      {rowPages.map((pageRows, pageIndex) => (
        <Page key={`kpi-grid-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader title="Grille des contrôles" siteName={report.siteName} theme={theme} siteLogoSrc={clientLogoSrc} />

          <View style={s.body}>
            <SectionTitle title="Tableau de score par axe" theme={theme} />
            <View style={{ ...s.card, padding: 8 }}>
              {pageRows.map((row, rowIndex) => (
                <View key={`row-${pageIndex}-${rowIndex}`} style={{ flexDirection: 'row', gap: 7, marginBottom: rowIndex === pageRows.length - 1 ? 0 : 7 }}>
                  {Array.from({ length: columns }, (_, cellIndex) => row[cellIndex]).map((axis, cellIndex) => (
                    axis ? (
                    <View
                      key={axis.id}
                      style={{
                        flex: 1,
                        minHeight: cardMinHeight,
                        borderWidth: 0.8,
                        borderColor: t?.border ?? '#D7E0EA',
                        borderRadius: 9,
                        padding: cardPadding,
                        borderLeftWidth: 4,
                        borderLeftColor: getStatusColor(axis.score.status),
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                        <Text style={{ fontSize: 10.2, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827', width: titleWidth, lineHeight: 1.18 }}>
                          {axis.name}
                        </Text>
                        <StatusBadge label={cardStatusLabel(axis)} status={axis.score.status} />
                      </View>
                      <Text style={{ fontSize: 8.4, color: t?.textMuted ?? '#64748B', marginBottom: 5, lineHeight: 1.2 }}>{axis.description}</Text>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                          <Text style={{ fontSize: columns === 2 ? 21 : 23, color: getStatusColor(axis.score.status), fontFamily: 'DMSans', fontWeight: 700 }}>
                            {axis.score.scoreMeasured === null ? 'N/C' : axis.score.scoreMeasured}
                          </Text>
                          {axis.score.scoreMeasured !== null ? (
                            <Text style={{ fontSize: 12, color: getStatusColor(axis.score.status), fontFamily: 'DMSans', fontWeight: 700 }}>%</Text>
                          ) : null}
                        </View>
                        <Text style={{ fontSize: 8.7, color: t?.textMuted ?? '#64748B', textAlign: 'right' }}>
                          {axis.score.measuredKpis} mesure{axis.score.measuredKpis > 1 ? 's' : ''}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View key={`empty-${rowIndex}-${cellIndex}`} style={{ flex: 1 }} />
                  )
                ))}
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
