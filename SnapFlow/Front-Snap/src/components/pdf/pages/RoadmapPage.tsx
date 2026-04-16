import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';
import { estimateLines, paginateByHeight } from '../shared/pagination';

interface RoadmapPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function RoadmapPage({ report, theme, clientLogoSrc }: RoadmapPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const truncate = (value: string, max: number) => {
    if (!value) return '';
    return value.length > max ? `${value.slice(0, max).trim()}...` : value;
  };
  const formatPriority = (priority: string) => {
    if (priority === 'quick-win') return 'Immédiat';
    if (priority === 'moyen-terme') return 'Moyen terme';
    if (priority === 'long-terme') return 'Long terme';
    return priority;
  };

  const buckets = report.roadmap;
  const rows: Array<[typeof buckets[number], typeof buckets[number] | null]> = [];
  for (let i = 0; i < buckets.length; i += 2) {
    rows.push([buckets[i], buckets[i + 1] ?? null]);
  }

  const estimateBucketHeight = (bucket: typeof buckets[number]) => {
    if (bucket.items.length === 0) return 70;
    const titleLines = estimateLines(bucket.title, 24);
    const itemLines = bucket.items.reduce((sum, item) => sum + estimateLines(item.title, 52), 0);
    return 36 + titleLines * 10 + bucket.items.length * 16 + Math.max(0, itemLines - bucket.items.length) * 8;
  };

  const estimateRowHeight = (row: [typeof buckets[number], typeof buckets[number] | null]) => {
    const left = estimateBucketHeight(row[0]);
    const right = row[1] ? estimateBucketHeight(row[1]) : 0;
    return Math.max(left, right) + 10;
  };

  const rowPages = paginateByHeight(rows, estimateRowHeight, 500);

  return (
    <>
      {rowPages.map((pageRows, pageIndex) => (
        <Page key={`roadmap-${pageIndex}`} size="A4" style={s.page}>
          <PageHeader
            title="Priorités d'action"
            siteName={report.siteName}
            subtitle="Planification par horizon"
            theme={theme}
            siteLogoSrc={clientLogoSrc}
          />

          <View style={s.body}>
            <SectionTitle title="Exécution par horizon" theme={theme} />
            {pageRows.map((row, rowIndex) => (
              <View key={`row-${pageIndex}-${rowIndex}`} style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
                {[row[0], row[1]].map((bucket) => (
                  bucket ? (
                    <View key={bucket.title} style={{ ...s.card, width: '48.5%' }} wrap={false}>
                      <Text style={{ fontSize: 10, color: t?.primary ?? '#1E3A5F', fontFamily: 'DMSans', fontWeight: 700, marginBottom: 6 }}>
                        {bucket.title}
                      </Text>
                      {bucket.items.length === 0 ? (
                        <Text style={{ fontSize: 8.2, color: t?.textMuted ?? '#64748B' }}>Aucun élément sélectionné.</Text>
                      ) : (
                        bucket.items.map((item) => (
                          <View key={`roadmap-${item.id}`} style={{ marginBottom: 5 }}>
                            <Text style={{ fontSize: 8.5, color: t?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 600 }}>
                              {truncate(item.title, 56)}
                            </Text>
                            <Text style={{ fontSize: 7.4, color: t?.textMuted ?? '#64748B' }}>
                              {truncate(item.axisName, 22)} | {formatPriority(item.priority)}
                            </Text>
                          </View>
                        ))
                      )}
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
