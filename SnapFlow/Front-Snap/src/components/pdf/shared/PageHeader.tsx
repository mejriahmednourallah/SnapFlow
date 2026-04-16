import { View, Text, Image } from '@react-pdf/renderer';
import snapflowLogo from '@/assets/snapflow-logo.png';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';

interface PageHeaderProps {
  title?: string;
  siteName: string;
  theme?: PdfTheme;
  subtitle?: string;
  siteLogoSrc?: string;
}

export function PageHeader({ theme, siteLogoSrc }: PageHeaderProps) {
  const s = makePageStyles(theme);
  const borderColor = theme?.border ?? '#D7E0EA';

  return (
    <View style={s.pageHeader} fixed>
      <View>
        <Text style={s.pageHeaderTitle}>En-têtes</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {siteLogoSrc ? (
          <Image src={siteLogoSrc} style={{ width: 76, height: 24, objectFit: 'contain' }} />
        ) : (
          <Text style={s.pageHeaderText}>Logo du site</Text>
        )}
        <View style={{ width: 1, height: 18, backgroundColor: borderColor }} />
        <Image src={snapflowLogo} style={{ width: 86, height: 28, objectFit: 'contain' }} />
      </View>
    </View>
  );
}
