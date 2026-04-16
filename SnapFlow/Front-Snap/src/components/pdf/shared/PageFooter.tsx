import { View, Text } from '@react-pdf/renderer';
import type { PdfTheme } from '../theme';
import { makePageStyles } from '../theme';

interface PageFooterProps {
  preparedBy: string;
  confidentialityLabel?: string;
  theme?: PdfTheme;
}

export function PageFooter({
  preparedBy,
  confidentialityLabel = 'Rapport confidentiel',
  theme,
}: PageFooterProps) {
  const s = makePageStyles(theme);
  return (
    <View style={s.pageFooter} fixed>
      <Text style={s.pageFooterText}>{preparedBy} | {confidentialityLabel}</Text>
      <Text style={s.pageFooterText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}
