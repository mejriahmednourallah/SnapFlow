import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { ScoreGauge } from '../shared/ScoreGauge';
import { RadarChart } from '../shared/RadarChart';

interface ExecutiveSummaryPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function ExecutiveSummaryPage({ report, theme, clientLogoSrc }: ExecutiveSummaryPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const truncate = (value: string, max: number) => {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max).trim()}...` : value;
  };

  const validatedCount = report.globalScore.passed;
  const failedCount = report.globalScore.failed;
  const totalKpiCount = validatedCount + failedCount;

  const distributionRows = [
    { label: 'Validés', count: validatedCount, color: '#16A34A' },
    { label: 'En échec', count: failedCount, color: '#DC2626' },
  ];

  const toPercent = (count: number): string => {
    if (totalKpiCount <= 0) return '0%';
    return `${Math.round((count / totalKpiCount) * 100)}%`;
  };

  return (
    <Page size="A4" style={s.page}>
      <PageHeader title="Résumé exécutif" siteName={report.siteName} theme={theme} siteLogoSrc={clientLogoSrc} />

      <View style={s.body}>
        <SectionTitle title="Vue globale" theme={theme} />
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
          <View style={{ ...s.card, width: 170, alignItems: 'center', justifyContent: 'center' }}>
            <ScoreGauge
              score={report.globalScore.scoreMeasured ?? 0}
              status={report.globalScore.status}
              valueText={report.globalScore.scoreMeasured === null ? 'N/C' : undefined}
              caption={report.globalScore.scoreMeasured === null
                ? 'Score non calculable'
                : 'Score sur contrôles mesurés'}
              theme={theme}
            />
          </View>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Répartition des contrôles</Text>
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: t?.primary ?? '#1E3A5F',
                paddingVertical: 6,
                paddingHorizontal: 8,
                borderTopLeftRadius: 8,
                borderTopRightRadius: 8,
              }}
            >
              <Text style={{ width: '56%', color: '#FFFFFF', fontSize: 7.4, fontFamily: 'DMSans', fontWeight: 700 }}>Statut</Text>
              <Text style={{ width: '20%', color: '#FFFFFF', fontSize: 7.4, textAlign: 'right', fontFamily: 'DMSans', fontWeight: 700 }}>Nombre</Text>
              <Text style={{ width: '24%', color: '#FFFFFF', fontSize: 7.4, textAlign: 'right', fontFamily: 'DMSans', fontWeight: 700 }}>Part</Text>
            </View>
            <View style={{ borderWidth: 0.8, borderColor: t?.border ?? '#D7E0EA', borderTopWidth: 0, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}>
              {distributionRows.map((row, index) => (
                <View
                  key={row.label}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 6,
                    paddingHorizontal: 8,
                    borderBottomWidth: index === distributionRows.length - 1 ? 0 : 0.6,
                    borderBottomColor: t?.border ?? '#D7E0EA',
                    backgroundColor: index % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                  }}
                >
                  <View style={{ width: '56%', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: row.color }} />
                    <Text style={{ fontSize: 8.2, color: t?.text ?? '#111827' }}>{row.label}</Text>
                  </View>
                  <Text style={{ width: '20%', textAlign: 'right', fontSize: 8.2, color: t?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 600 }}>
                    {row.count}
                  </Text>
                  <Text style={{ width: '24%', textAlign: 'right', fontSize: 8.2, color: t?.textMuted ?? '#64748B' }}>
                    {toPercent(row.count)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Lecture radar</Text>
            <View style={{ alignItems: 'center' }}>
              <RadarChart axes={report.axes} theme={theme} size={150} />
            </View>
          </View>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Signaux clés</Text>
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B' }}>Points positifs</Text>
              {report.positivePoints.slice(0, 3).map((p) => (
                <Text key={p} style={{ fontSize: 8.4, color: t?.text ?? '#111827', marginTop: 3 }}>- {truncate(p, 60)}</Text>
              ))}
            </View>
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B' }}>Points négatifs</Text>
              {report.negativePoints.slice(0, 3).map((p) => (
                <Text key={p} style={{ fontSize: 8.4, color: t?.text ?? '#111827', marginTop: 3 }}>- {truncate(p, 60)}</Text>
              ))}
            </View>
            <View>
              <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B' }}>Opportunités</Text>
              {report.opportunities.slice(0, 2).map((p) => (
                <Text key={p} style={{ fontSize: 8.4, color: t?.text ?? '#111827', marginTop: 3 }}>- {truncate(p, 60)}</Text>
              ))}
            </View>
          </View>
        </View>
      </View>

      <PageFooter preparedBy={report.preparedBy} theme={theme} />
    </Page>
  );
}
