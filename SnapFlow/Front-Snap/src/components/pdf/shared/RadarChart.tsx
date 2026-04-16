import { Svg, Polygon, Line, Text as SvgText } from '@react-pdf/renderer';
import type { AuditAxisItem } from '../types';
import type { PdfTheme } from '../theme';

interface RadarChartProps {
  axes: AuditAxisItem[];
  size?: number;
  theme?: PdfTheme;
}

function pointAt(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

export function RadarChart({ axes, size = 150, theme }: RadarChartProps) {
  const data = axes.slice(0, 8);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 18;
  const step = (2 * Math.PI) / Math.max(data.length, 1);

  const rings = [0.25, 0.5, 0.75, 1];

  const polygonPoints = data
    .map((axis, i) => {
      const ratio = Math.max(0, Math.min(100, axis.score.value)) / 100;
      const p = pointAt(cx, cy, maxR * ratio, -Math.PI / 2 + i * step);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  return (
    <Svg width={size} height={size}>
      {rings.map((ring) => {
        const points = data
          .map((_, i) => {
            const p = pointAt(cx, cy, maxR * ring, -Math.PI / 2 + i * step);
            return `${p.x},${p.y}`;
          })
          .join(' ');
        return (
          <Polygon
            key={`ring-${ring}`}
            points={points}
            fill="none"
            stroke={theme?.border ?? '#D7E0EA'}
            strokeWidth={0.8}
          />
        );
      })}

      {data.map((axis, i) => {
        const p = pointAt(cx, cy, maxR, -Math.PI / 2 + i * step);
        return (
          <Line
            key={`line-${axis.id}`}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke={theme?.border ?? '#D7E0EA'}
            strokeWidth={0.8}
          />
        );
      })}

      <Polygon
        points={polygonPoints}
        fill={theme?.accent ?? '#4E8CCF'}
        fillOpacity={0.2}
        stroke={theme?.primary ?? '#1E3A5F'}
        strokeWidth={1.5}
      />

      {data.map((axis, i) => {
        const label = axis.name.length > 14 ? `${axis.name.slice(0, 14)}...` : axis.name;
        const p = pointAt(cx, cy, maxR + 8, -Math.PI / 2 + i * step);
        return (
          <SvgText
            key={`label-${axis.id}`}
            x={p.x}
            y={p.y}
            fontSize={5.6}
            fill={theme?.textMuted ?? '#64748B'}
            textAnchor="middle"
          >
            {label}
          </SvgText>
        );
      })}
    </Svg>
  );
}
