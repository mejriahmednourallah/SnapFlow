import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';

interface TableOfContentsPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function TableOfContentsPage({ report, theme, clientLogoSrc }: TableOfContentsPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;

  const hasAxes = report.axes.length > 0;
  const hasRecommendations = report.recommendations.length > 0;
  const hasAnnexes = report.axes.some((axis) =>
    axis.findings.some((finding) =>
      finding.evidence.length > 0 ||
      finding.annexes.length > 0 ||
      finding.exampleUrls.length > 0 ||
      finding.page ||
      finding.pageUrl,
    ),
  );
  const labels = [
    'Couverture',
    'Table des matières',
    'Résumé exécutif',
    ...(hasAxes ? ['Grille des contrôles'] : []),
    ...report.axes.map((axis) => axis.name),
    ...(hasRecommendations ? ["Plan d'action", "Priorités d'action"] : []),
    'Conclusion',
    ...(hasAnnexes ? ['Annexes'] : []),
    'Quatrième de couverture',
  ];
  const entries = labels.map((label, idx) => `${String(idx + 1).padStart(2, '0')} ${label}`);

  return (
    <Page size="A4" style={s.page}>
      <PageHeader title="Table des matières" siteName={report.siteName} theme={theme} siteLogoSrc={clientLogoSrc} />

      <View style={s.body}>
        <SectionTitle title="Structure du rapport" theme={theme} />
        <View style={{ ...s.card, paddingVertical: 8 }}>
          {entries.map((entry, idx) => (
            <View
              key={entry}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottomWidth: idx === entries.length - 1 ? 0 : 0.5,
                borderBottomColor: t?.border ?? '#D7E0EA',
                paddingVertical: 8,
              }}
            >
              <Text style={{ fontSize: 9.2, color: t?.text ?? '#111827' }}>{entry}</Text>
              <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B' }}>{idx + 1}</Text>
            </View>
          ))}
        </View>
      </View>

      <PageFooter preparedBy={report.preparedBy} theme={theme} />
    </Page>
  );
}
