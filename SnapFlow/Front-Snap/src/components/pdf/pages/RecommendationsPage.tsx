import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';
import { estimateLines, paginateByHeight } from '../shared/pagination';

interface RecommendationsPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

function toStatus(criticality: string) {
  if (criticality === 'critical' || criticality === 'high') return 'danger' as const;
  if (criticality === 'medium') return 'warning' as const;
  return 'success' as const;
}

function formatPriority(priority: string) {
  if (priority === 'quick-win') return 'Immédiat';
  if (priority === 'moyen-terme') return 'Moyen terme';
  if (priority === 'long-terme') return 'Long terme';
  return priority;
}

function formatCriticality(criticality: string) {
  if (criticality === 'critical') return 'Critique';
  if (criticality === 'high') return 'Élevée';
  if (criticality === 'medium') return 'Moyenne';
  if (criticality === 'low') return 'Faible';
  return criticality;
}

export function RecommendationsPage({ report, theme, clientLogoSrc }: RecommendationsPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const truncate = (value: string, max: number) => {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max).trim()}...` : value;
  };

  const estimateCardHeight = (item: (typeof report.recommendations)[number]) => {
    const titleLines = estimateLines(item.title, 60);
    const axisLines = estimateLines(item.axisName, 28);
    const recLines = estimateLines(item.recommendation, 90);
    const impactLines = estimateLines(item.impact, 90);
    return 44 + (titleLines + axisLines + recLines + impactLines) * 9;
  };

  const cardPages = paginateByHeight(report.recommendations, estimateCardHeight, 480);

  const rows = report.recommendations;
  const rowHeight = 18;
  const headerHeight = 26;
  const rowsPerPage = Math.max(6, Math.floor((520 - headerHeight) / rowHeight));
  const rowPages: typeof rows[] = [];
  for (let i = 0; i < rows.length; i += rowsPerPage) {
    rowPages.push(rows.slice(i, i + rowsPerPage));
  }

  return (
    <>
      {cardPages.map((items, pageIndex) => (
        <Page key={`rec-cards-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader
            title="Plan d'action"
            siteName={report.siteName}
            subtitle="Priorités d'action"
            theme={theme}
            siteLogoSrc={clientLogoSrc}
          />

          <View style={s.body}>
            <SectionTitle title="Recommandations prioritaires" theme={theme} />
            {items.map((item) => (
              <View key={item.id} style={{ ...s.card, marginBottom: 8 }} wrap={false}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 9.5, fontFamily: 'DMSans', fontWeight: 700, width: '72%' }}>
                    {item.title}
                  </Text>
                  <StatusBadge label={formatCriticality(item.criticality)} status={toStatus(item.criticality)} />
                </View>
                <Text style={{ fontSize: 8.1, color: t?.textMuted ?? '#64748B', marginBottom: 4 }}>
                  Axe: {item.axisName}
                </Text>
                <Text style={{ fontSize: 8.6, color: t?.text ?? '#111827', marginBottom: 4 }}>
                  Recommandation: {item.recommendation}
                </Text>
                <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B' }}>
                  Impact: {item.impact}
                </Text>
              </View>
            ))}
          </View>

          <PageFooter preparedBy={report.preparedBy} theme={theme} />
        </Page>
      ))}

      {rowPages.map((items, pageIndex) => (
        <Page key={`rec-table-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader
            title="Plan d'action"
            siteName={report.siteName}
            subtitle="Priorités d'action"
            theme={theme}
            siteLogoSrc={clientLogoSrc}
          />

          <View style={s.body}>
            <SectionTitle title="Tableau synthétique" theme={theme} />
            <View style={{ ...s.card, padding: 0 }}>
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: t?.primary ?? '#1E3A5F',
                  paddingVertical: 8,
                  paddingHorizontal: 8,
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                }}
              >
                <Text style={{ width: '24%', color: '#FFFFFF', fontSize: 7.3, fontFamily: 'DMSans', fontWeight: 700 }}>Axe</Text>
                  <Text style={{ width: '40%', color: '#FFFFFF', fontSize: 7.3, fontFamily: 'DMSans', fontWeight: 700 }}>Problème</Text>
                  <Text style={{ width: '16%', color: '#FFFFFF', fontSize: 7.3, fontFamily: 'DMSans', fontWeight: 700 }}>Priorité</Text>
                <Text style={{ width: '20%', color: '#FFFFFF', fontSize: 7.3, fontFamily: 'DMSans', fontWeight: 700 }}>Niveau</Text>
              </View>
              {items.map((item, idx) => (
                <View
                  key={`row-${item.id}-${pageIndex}`}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 7,
                    paddingHorizontal: 8,
                    backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                    borderBottomWidth: idx === items.length - 1 ? 0 : 0.5,
                    borderBottomColor: t?.border ?? '#D7E0EA',
                  }}
                >
                  <Text style={{ width: '24%', fontSize: 7.2, color: t?.textMuted ?? '#64748B' }}>{truncate(item.axisName, 24)}</Text>
                  <Text style={{ width: '40%', fontSize: 7.6, color: t?.text ?? '#111827' }}>{truncate(item.title, 46)}</Text>
                  <Text style={{ width: '16%', fontSize: 7.2, color: t?.textMuted ?? '#64748B' }}>
                    {formatPriority(item.priority)}
                  </Text>
                  <Text style={{ width: '20%', fontSize: 7.2, color: t?.textMuted ?? '#64748B' }}>{formatCriticality(item.criticality)}</Text>
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
