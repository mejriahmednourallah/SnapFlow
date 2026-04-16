import { Page, View, Text, Image, Svg, Rect } from '@react-pdf/renderer';
import snapflowLogo from '@/assets/snapflow-logo.png';
import type { AuditDocumentData } from '../types';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';

interface BackCoverPageProps {
  report: AuditDocumentData;
  theme?: PdfTheme;
  clientLogoSrc?: string;
}

export function BackCoverPage({ report, theme, clientLogoSrc }: BackCoverPageProps) {
  const s = makePageStyles(theme);
  const t = theme ?? undefined;

  return (
    <Page size="A4" style={s.page}>
      <Svg width="595" height="842" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Rect x={0} y={0} width={595} height={842} fill={t?.heroBg ?? '#10243C'} />
        <Rect x={0} y={700} width={595} height={142} fill={t?.accent ?? '#4E8CCF'} opacity={0.18} />
      </Svg>

      <View style={{ paddingHorizontal: 48, paddingTop: 180, alignItems: 'center' }}>
        <Text style={{ fontFamily: 'PlayfairDisplay', fontSize: 36, color: t?.heroText ?? '#EFF6FF', textAlign: 'center' }}>
          Merci
        </Text>
        <Text style={{ fontSize: 11, color: t?.heroText ?? '#EFF6FF', opacity: 0.9, marginTop: 12, textAlign: 'center', lineHeight: 1.5 }}>
          Rapport d'audit de maintenance préventive
        </Text>
        <Text style={{ fontSize: 10, color: t?.heroText ?? '#EFF6FF', opacity: 0.9, marginTop: 6, textAlign: 'center' }}>
          {report.siteName}
        </Text>

        <View style={{ marginTop: 38, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Image src={snapflowLogo} style={{ width: 110, height: 34, objectFit: 'contain' }} />
          {clientLogoSrc ? (
            <>
              <View style={{ width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.35)' }} />
              <Image src={clientLogoSrc} style={{ width: 110, height: 34, objectFit: 'contain' }} />
            </>
          ) : null}
        </View>

        <Text style={{ marginTop: 22, fontSize: 9, color: t?.heroText ?? '#EFF6FF', opacity: 0.85, textAlign: 'center' }}>
          {report.preparedBy}
        </Text>
      </View>
    </Page>
  );
}
