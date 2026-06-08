import { View, Text, Svg, Rect } from '@react-pdf/renderer';
import type { AuditAxisItem } from '../types';
import type { PdfTheme } from '../theme';

interface AxisBarChartProps {
  axes: AuditAxisItem[];
  theme?: PdfTheme;
  width?: number;
}

export function AxisBarChart({ axes, theme, width = 460 }: AxisBarChartProps) {
  const barHeight = 10;
  const gap = 6;
  const leftLabel = 110;
  const usable = width - leftLabel - 40;
  const totalHeight = axes.length * (barHeight + gap) + 8;

  return (
    <View>
      <Svg width={width} height={totalHeight}>
        {axes.map((axis, i) => {
          const y = i * (barHeight + gap);
          const fillWidth = (Math.max(0, Math.min(100, axis.score.scoreMeasured ?? 0)) / 100) * usable;
          return (
            [
              <Rect key={`bg-${axis.id}`} x={leftLabel} y={y} width={usable} height={barHeight} rx={7} ry={7} fill={theme?.border ?? '#D7E0EA'} />,
              <Rect key={`fg-${axis.id}`} x={leftLabel} y={y} width={fillWidth} height={barHeight} rx={7} ry={7} fill={theme?.accent ?? '#4E8CCF'} />,
            ]
          );
        })}
      </Svg>
      <View style={{ marginTop: -totalHeight, gap: gap }}>
        {axes.map((axis) => (
          <View key={`label-${axis.id}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: barHeight }}>
            <Text style={{ width: leftLabel - 8, fontSize: 7, color: theme?.textMuted ?? '#64748B' }}>{axis.name}</Text>
            <Text style={{ width: 32, textAlign: 'right', fontSize: 7.6, color: theme?.text ?? '#111827', fontFamily: 'DMSans', fontWeight: 600 }}>
              {axis.score.scoreMeasured === null ? 'N/C' : axis.score.scoreMeasured}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
