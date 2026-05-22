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

  const baseEntries = [
    '01 Couverture',
    '02 Table des matières',
    '03 Résumé exécutif',
    '04 Grille des contrôles',
  ];
  const axisEntries = report.axes.map((axis, idx) => `${String(idx + 5).padStart(2, '0')} ${axis.name}`);
  const endEntries = [
    `${String(axisEntries.length + 5).padStart(2, '0')} Plan d'action`,
    `${String(axisEntries.length + 6).padStart(2, '0')} Priorités d'action`,
    `${String(axisEntries.length + 7).padStart(2, '0')} Conclusion`,
    `${String(axisEntries.length + 8).padStart(2, '0')} Annexes`,
    `${String(axisEntries.length + 9).padStart(2, '0')} Quatrième de couverture`,
  ];
  const entries = [...baseEntries, ...axisEntries, ...endEntries];

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
