import { useMemo } from 'react';

interface ScoreGaugeProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  valueText?: string;
  centerScale?: number;
}

export function ScoreGauge({
  score,
  size = 120,
  strokeWidth = 8,
  label,
  valueText,
  centerScale = 1,
}: ScoreGaugeProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const baseFont = valueText
    ? Math.max(9, Math.floor(size / 5.4))
    : Math.max(12, Math.floor(size / 5));
  const centerFontSize = Math.round(baseFont * Math.max(0.8, centerScale));

  const color = useMemo(() => {
    if (score >= 80) return 'hsl(160, 84%, 39%)';
    if (score >= 60) return 'hsl(38, 92%, 50%)';
    if (score >= 40) return 'hsl(25, 95%, 53%)';
    return 'hsl(0, 72%, 51%)';
  }, [score]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative score-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="hsl(222, 30%, 14%)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono font-bold" style={{ color, fontSize: centerFontSize }}>{valueText ?? score}</span>
        </div>
      </div>
      {label && <span className="text-xs text-muted-foreground font-medium">{label}</span>}
    </div>
  );
}
