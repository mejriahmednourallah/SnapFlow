import { View, Text, Svg, Circle, Path } from '@react-pdf/renderer';
import type { SeverityStatus } from '../types';
import type { PdfTheme } from '../theme';
import { getStatusColor } from '../theme';

interface ScoreGaugeProps {
  score: number;
  status: SeverityStatus;
  valueText?: string;
  size?: number;
  stroke?: number;
  caption?: string;
  theme?: PdfTheme;
}

export function ScoreGauge({
  score,
  status,
  valueText,
  size = 120,
  stroke = 10,
  caption,
  theme,
}: ScoreGaugeProps) {
  const bounded = Math.max(0, Math.min(100, score));
  const radius = (size - stroke) / 2;
  const color = getStatusColor(status);
  const track = theme?.border ?? '#D7E0EA';
  const text = theme?.text ?? '#111827';
  const muted = theme?.textMuted ?? '#64748B';
  const cx = size / 2;
  const cy = size / 2;

  const polar = (angle: number) => {
    const radians = (angle * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(radians),
      y: cy + radius * Math.sin(radians),
    };
  };

  const clamped = Math.max(0, Math.min(100, bounded));
  const sweep = clamped <= 0 ? 0 : clamped >= 100 ? 359.99 : (clamped / 100) * 360;

  const describeArc = (startAngle: number, endAngle: number) => {
    const start = polar(endAngle - 90);
    const end = polar(startAngle - 90);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  };

  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <Svg width={size} height={size}>
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={track}
          strokeWidth={stroke}
          fill="none"
        />
        {sweep > 0 ? (
          <Path
            d={describeArc(0, sweep)}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}
      </Svg>
      <View style={{ marginTop: -size / 2 - 8, alignItems: 'center' }}>
        <Text style={{ fontSize: valueText ? 14 : 28, color: text, fontFamily: 'DMSans', fontWeight: 700 }}>
          {valueText ?? bounded}
        </Text>
        {!valueText ? <Text style={{ fontSize: 8, color: muted }}>/100</Text> : null}
      </View>
      <View style={{ height: size / 2 - 16 }} />
      {caption ? <Text style={{ fontSize: 8, color: muted }}>{caption}</Text> : null}
    </View>
  );
}
