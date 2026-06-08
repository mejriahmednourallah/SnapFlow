import { Page, View, Text } from '@react-pdf/renderer';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles, getStatusColor } from '../theme';
import { PageHeader } from '../shared/PageHeader';
import { PageFooter } from '../shared/PageFooter';
import { SectionTitle } from '../shared/SectionTitle';

interface ConclusionPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function ConclusionPage({ report, theme, clientLogoSrc }: ConclusionPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;
  const measuredAxes = report.axes.filter((axis) => axis.score.scoreMeasured !== null);
  const topAxes = [...measuredAxes].sort((a, b) => (b.score.scoreMeasured ?? 0) - (a.score.scoreMeasured ?? 0)).slice(0, 3);
  const weakAxes = [...measuredAxes].sort((a, b) => (a.score.scoreMeasured ?? 0) - (b.score.scoreMeasured ?? 0)).slice(0, 3);

  return (
    <Page size="A4" style={s.page}>
      <PageHeader
        title="Conclusion"
        siteName={report.siteName}
        subtitle="Synthèse finale"
        theme={theme}
        siteLogoSrc={clientLogoSrc}
      />

      <View style={s.body}>
        <SectionTitle title="Message final" theme={theme} />
        <View style={{ ...s.card, marginBottom: 12 }}>
          <Text style={s.bodyText}>
            Cet audit confirme {report.globalScore.scoreMeasured === null
              ? 'que le score global ne peut pas encore etre calcule'
              : `un niveau global mesure de ${report.globalScore.scoreMeasured}/100`} avec un potentiel de progression rapide
            sur les priorités identifiées. La feuille de route proposée permet d'améliorer la fiabilité, la performance
            et la confiance utilisateur de façon mesurable.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Forces</Text>
            {topAxes.map((axis) => (
              <View key={`top-${axis.id}`} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 9, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827' }}>
                  {axis.name}
                </Text>
                <Text style={{ fontSize: 8, color: getStatusColor(axis.score.status) }}>{axis.score.scoreMeasured}/100</Text>
              </View>
            ))}
          </View>
          <View style={{ ...s.card, flex: 1 }}>
            <Text style={s.h3}>Priorités</Text>
            {weakAxes.map((axis) => (
              <View key={`weak-${axis.id}`} style={{ marginBottom: 6 }}>
                <Text style={{ fontSize: 9, fontFamily: 'DMSans', fontWeight: 700, color: t?.text ?? '#111827' }}>
                  {axis.name}
                </Text>
                <Text style={{ fontSize: 8, color: getStatusColor(axis.score.status) }}>{axis.score.scoreMeasured}/100</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={{ ...s.card, marginTop: 12 }}>
          <Text style={s.h3}>Étapes suivantes recommandées</Text>
          {report.recommendations.slice(0, 4).map((item, idx) => (
            <Text key={`next-${item.id}`} style={{ fontSize: 8.5, color: t?.text ?? '#111827', marginBottom: 4 }}>
              {idx + 1}. {item.title}
            </Text>
          ))}
        </View>
      </View>

      <PageFooter preparedBy={report.preparedBy} theme={theme} />
    </Page>
  );
}
