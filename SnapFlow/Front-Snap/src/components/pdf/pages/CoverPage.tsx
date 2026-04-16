import { Page, View, Text, Image, Svg, Rect, Polygon } from '@react-pdf/renderer';
import snapflowLogo from '@/assets/snapflow-logo.png';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';
import { ScoreGauge } from '../shared/ScoreGauge';

interface CoverPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function CoverPage({ report, theme, clientLogoSrc }: CoverPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;

  return (
    <Page size="A4" style={s.page}>
      <Svg width="595" height="240" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Rect x={0} y={0} width={595} height={220} fill={t?.heroBg ?? '#10243C'} />
        <Polygon points="0,220 595,140 595,260 0,260" fill={t?.accent ?? '#4E8CCF'} opacity={0.15} />
      </Svg>

      <View style={{ paddingHorizontal: 38, paddingTop: 36 }}>
        <Text style={{ fontSize: 10, color: t?.heroText ?? '#EFF6FF', letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'DMSans', fontWeight: 600 }}>
          {report.reportType}
        </Text>
        <Text style={{ ...s.h1, color: t?.heroText ?? '#EFF6FF', marginTop: 8 }}>
          {report.siteName}
        </Text>
        <Text style={{ fontSize: 10, color: t?.heroText ?? '#EFF6FF', opacity: 0.9, marginTop: 8 }}>
          {report.siteUrl}
        </Text>
      </View>

      <View style={{ paddingHorizontal: 38, marginTop: 24, flexDirection: 'row', gap: 16 }}>
        <View style={{ ...s.card, flex: 1 }}>
          <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 }}>
            Score global
          </Text>
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
            <ScoreGauge
              score={report.globalScore.value}
              status={report.globalScore.status}
              size={128}
              caption={`${report.globalScore.x}/${report.globalScore.y}`}
              theme={theme}
            />
          </View>
        </View>

        <View style={{ ...s.card, width: 192, justifyContent: 'space-between', paddingVertical: 12, gap: 10 }}>
          {clientLogoSrc ? (
            <View style={{ alignItems: 'center', padding: 8, borderWidth: 1, borderColor: t?.border ?? '#D7E0EA', borderRadius: 8, backgroundColor: '#FFFFFF' }}>
              <Image src={clientLogoSrc} style={{ width: 80, height: 32, objectFit: 'contain' }} />
            </View>
          ) : null}
          <View>
            <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B', textTransform: 'uppercase', letterSpacing: 1.2 }}>
              Date du rapport
            </Text>
            <Text style={{ fontSize: 13, color: t?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 700, marginTop: 4 }}>
              {new Date(report.date).toLocaleDateString('fr-FR')}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 8 }}>
              Préparé par
            </Text>
            <Text style={{ fontSize: 10, color: t?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 600 }}>
              {report.preparedBy}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ position: 'absolute', left: 38, right: 38, bottom: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
        <Text style={{ fontSize: 8, color: t?.textMuted ?? '#64748B' }}>Édition</Text>
        <Image src={snapflowLogo} style={{ width: 88, height: 30, objectFit: 'contain' }} />
        {clientLogoSrc ? (
          <>
            <View style={{ width: 1, height: 22, backgroundColor: t?.border ?? '#D7E0EA' }} />
            <Image src={clientLogoSrc} style={{ width: 88, height: 30, objectFit: 'contain' }} />
          </>
        ) : null}
      </View>
    </Page>
  );
}
