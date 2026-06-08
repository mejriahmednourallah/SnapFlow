import { Page, View, Text, Image } from '@react-pdf/renderer';
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
    <Page
      size="A4"
      style={{
        ...s.page,
        backgroundColor: t?.heroBg ?? '#10243C',
        paddingBottom: 0,
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 142,
          backgroundColor: t?.accent ?? '#4E8CCF',
          opacity: 0.18,
        }}
      />

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
