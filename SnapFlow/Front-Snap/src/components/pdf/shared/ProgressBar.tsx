import { View, Text, Svg, Rect } from '@react-pdf/renderer';
import type { PdfTheme } from '../theme';
import { getStatusColor } from '../theme';
import type { SeverityStatus } from '../types';

interface ProgressBarProps {
  label: string;
  value: number;
  status: SeverityStatus;
  width?: number;
  theme?: PdfTheme;
}

export function ProgressBar({
  label,
  value,
  status,
  width = 220,
  theme,
}: ProgressBarProps) {
  const safe = Math.max(0, Math.min(100, value));
  const fill = (safe / 100) * width;
  const track = theme?.border ?? '#D7E0EA';
  const color = getStatusColor(status);

  return (
    <View style={{ marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
        <Text style={{ fontSize: 7.6, color: theme?.textMuted ?? '#64748B' }}>{label}</Text>
        <Text style={{ fontSize: 7.6, color: theme?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 600 }}>{safe}%</Text>
      </View>
      <Svg width={width} height={8}>
        <Rect x={0} y={1} width={width} height={6} rx={3} ry={3} fill={track} />
        <Rect x={0} y={1} width={fill} height={6} rx={3} ry={3} fill={color} />
      </Svg>
    </View>
  );
}
