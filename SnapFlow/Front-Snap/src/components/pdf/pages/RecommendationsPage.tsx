import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { StatusBadge } from '../shared/StatusBadge';
import { rebalanceShortTailPages } from '../shared/pagination';

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

function truncate(value: string, max: number) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max).trim()}...` : value;
}

export function RecommendationsPage({ report, theme, clientLogoSrc }: RecommendationsPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const recommendations = report.recommendations;
  const majorCards = recommendations
    .filter((item) => item.criticality === 'critical' || item.criticality === 'high')
    .slice(0, 6);
  const topCards = majorCards.length > 0 ? majorCards : recommendations.slice(0, 4);
  const inlineTopCards = topCards.length > 0 && topCards.length <= 4;
  const standaloneTopCards = topCards.length > 4 ? topCards : [];

  const rowsPerPage = inlineTopCards ? 12 : 16;
  const rawRowPages: typeof recommendations[] = [];
  for (let i = 0; i < recommendations.length; i += rowsPerPage) {
    rawRowPages.push(recommendations.slice(i, i + rowsPerPage));
  }
  const rowPages = rebalanceShortTailPages(rawRowPages, {
    minItemsOnLastPage: 4,
    minItemsOnPreviousPage: 8,
    maxItemsPerPage: rowsPerPage,
  });

  return (
    <>
      {standaloneTopCards.length > 0 ? (
        <Page key="rec-major" size="A4" style={s.page}>
          <PageHeader
            title="Plan d'action"
            siteName={report.siteName}
            subtitle="Priorités majeures"
            theme={theme}
            siteLogoSrc={clientLogoSrc}
          />

          <View style={s.body}>
            <SectionTitle title="Actions à traiter en premier" theme={theme} />
            <View style={{ ...s.card, padding: 8 }}>
              {[0, 1, 2].map((rowIndex) => {
                const row = standaloneTopCards.slice(rowIndex * 2, rowIndex * 2 + 2);
                if (row.length === 0) return null;
                return (
                  <View key={`major-row-${rowIndex}`} style={{ flexDirection: 'row', gap: 8, marginBottom: rowIndex === 2 ? 0 : 8 }}>
                    {row.map((item) => (
                      <View
                        key={item.id}
                        style={{
                          flex: 1,
                          minHeight: 122,
                          borderWidth: 0.7,
                          borderColor: t?.border ?? '#D7E0EA',
                          borderRadius: 8,
                          padding: 8,
                          backgroundColor: '#FFFFFF',
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 5 }}>
                          <Text style={{ fontSize: 10.5, fontFamily: 'DMSans', fontWeight: 700, width: '68%', lineHeight: 1.24 }}>
                            {item.title}
                          </Text>
                          <StatusBadge label={formatCriticality(item.criticality)} status={toStatus(item.criticality)} />
                        </View>
                        <Text style={{ fontSize: 8.8, color: t?.textMuted ?? '#64748B', marginBottom: 5 }}>
                          Axe: {item.axisName} · {formatPriority(item.priority)}
                        </Text>
                        <Text style={{ fontSize: 9.2, color: t?.text ?? '#111827', lineHeight: 1.34, marginBottom: 4 }}>
                          {truncate(item.recommendation, 180)}
                        </Text>
                        <Text style={{ fontSize: 8.8, color: t?.textMuted ?? '#64748B', lineHeight: 1.28 }}>
                          Impact: {truncate(item.impact, 130)}
                        </Text>
                      </View>
                    ))}
                    {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                  </View>
                );
              })}
            </View>
          </View>

          <PageFooter preparedBy={report.preparedBy} theme={theme} />
        </Page>
      ) : null}

      {rowPages.map((items, pageIndex) => (
        <Page key={`rec-table-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader
            title="Plan d'action"
            siteName={report.siteName}
            subtitle="Tableau priorisé"
            theme={theme}
            siteLogoSrc={clientLogoSrc}
          />

          <View style={s.body}>
            <SectionTitle title={pageIndex === 0 ? 'Tableau synthétique des actions' : 'Tableau synthétique - suite'} theme={theme} />
            {pageIndex === 0 && inlineTopCards ? (
              <View style={{ ...s.card, padding: 7, marginBottom: 8 }}>
                <Text style={{ ...s.h3, fontSize: 12.2, marginBottom: 6 }}>Actions à traiter en premier</Text>
                {[0, 1].map((rowIndex) => {
                  const row = topCards.slice(rowIndex * 2, rowIndex * 2 + 2);
                  if (row.length === 0) return null;
                  return (
                    <View key={`inline-major-row-${rowIndex}`} style={{ flexDirection: 'row', gap: 7, marginBottom: rowIndex === 1 ? 0 : 7 }}>
                      {row.map((item) => (
                        <View
                          key={`inline-${item.id}`}
                          wrap={false}
                          style={{
                            flex: 1,
                            minHeight: 84,
                            borderWidth: 0.7,
                            borderColor: t?.border ?? '#D7E0EA',
                            borderRadius: 8,
                            padding: 7,
                            backgroundColor: '#FFFFFF',
                          }}
                        >
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                            <Text style={{ fontSize: 9.8, fontFamily: 'DMSans', fontWeight: 700, width: '70%', lineHeight: 1.18 }}>
                              {item.title}
                            </Text>
                            <StatusBadge label={formatCriticality(item.criticality)} status={toStatus(item.criticality)} />
                          </View>
                          <Text style={{ fontSize: 8.3, color: t?.textMuted ?? '#64748B', marginBottom: 3 }}>
                            Axe: {item.axisName} - {formatPriority(item.priority)}
                          </Text>
                          <Text style={{ fontSize: 8.7, color: t?.text ?? '#111827', lineHeight: 1.25 }}>
                            {truncate(item.recommendation, 150)}
                          </Text>
                        </View>
                      ))}
                      {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
            <View style={{ ...s.card, padding: 0, overflow: 'hidden' }}>
              <View
                style={{
                  flexDirection: 'row',
                  backgroundColor: t?.primary ?? '#1E3A5F',
                  paddingVertical: 7,
                  paddingHorizontal: 8,
                  borderTopLeftRadius: 10,
                  borderTopRightRadius: 10,
                }}
              >
                <Text style={{ width: '18%', color: '#FFFFFF', fontSize: 8.2, fontFamily: 'DMSans', fontWeight: 700 }}>Priorité</Text>
                <Text style={{ width: '18%', color: '#FFFFFF', fontSize: 8.2, fontFamily: 'DMSans', fontWeight: 700 }}>Axe</Text>
                <Text style={{ width: '30%', color: '#FFFFFF', fontSize: 8.2, fontFamily: 'DMSans', fontWeight: 700 }}>Constat</Text>
                <Text style={{ width: '34%', color: '#FFFFFF', fontSize: 8.2, fontFamily: 'DMSans', fontWeight: 700 }}>Action recommandée</Text>
              </View>
              {items.map((item, idx) => (
                <View
                  key={`row-${item.id}-${pageIndex}`}
                  wrap={false}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 5.6,
                    paddingHorizontal: 8,
                    backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                    borderBottomWidth: idx === items.length - 1 ? 0 : 0.5,
                    borderBottomColor: t?.border ?? '#D7E0EA',
                  }}
                >
                  <Text style={{ width: '18%', fontSize: 8.5, color: t?.textMuted ?? '#64748B', lineHeight: 1.22 }}>
                    {formatPriority(item.priority)}
                  </Text>
                  <Text style={{ width: '18%', fontSize: 8.5, color: t?.textMuted ?? '#64748B', lineHeight: 1.22 }}>
                    {truncate(item.axisName, 24)}
                  </Text>
                  <Text style={{ width: '30%', fontSize: 8.7, color: t?.text ?? '#111827', lineHeight: 1.24 }}>
                    {truncate(item.title, 72)}
                  </Text>
                  <Text style={{ width: '34%', fontSize: 8.7, color: t?.text ?? '#111827', lineHeight: 1.24 }}>
                    {truncate(item.recommendation, 96)}
                  </Text>
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
