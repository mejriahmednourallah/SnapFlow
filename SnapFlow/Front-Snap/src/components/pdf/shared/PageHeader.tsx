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

export function PageHeader({ title, siteName, theme, subtitle, siteLogoSrc }: PageHeaderProps) {
  const s = makePageStyles(theme);
  const borderColor = theme?.border ?? '#D7E0EA';
  const heading = title || siteName;
  const subheading = subtitle || (title ? siteName : undefined);

  return (
    <View style={s.pageHeader} fixed>
      <View style={{ maxWidth: 300 }}>
        <Text style={s.pageHeaderTitle}>{heading}</Text>
        {subheading ? <Text style={s.pageHeaderText}>{subheading}</Text> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {siteLogoSrc ? (
          <Image src={siteLogoSrc} style={{ width: 76, height: 24, objectFit: 'contain' }} />
        ) : (
          <Text style={s.pageHeaderText}>{siteName}</Text>
        )}
        <View style={{ width: 1, height: 18, backgroundColor: borderColor }} />
        <Image src={snapflowLogo} style={{ width: 86, height: 28, objectFit: 'contain' }} />
      </View>
    </View>
  );
}
