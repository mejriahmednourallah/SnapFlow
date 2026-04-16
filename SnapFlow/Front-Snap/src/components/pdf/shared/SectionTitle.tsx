import { View, Text } from '@react-pdf/renderer';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';

interface SectionTitleProps {
  title: string;
  theme?: PdfTheme;
}

export function SectionTitle({ title, theme }: SectionTitleProps) {
  const s = makePageStyles(theme);
  const accent = theme?.accent ?? '#4E8CCF';

  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.h2}>{title}</Text>
      <View style={{ width: 46, height: 2.6, borderRadius: 2, backgroundColor: accent }} />
    </View>
  );
}
